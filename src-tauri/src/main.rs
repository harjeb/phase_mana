#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tokio::io::AsyncWriteExt;

// Windows closes this private job when the shell terminates, including crashes.
// Only our sidecar is assigned; unrelated servers are never touched.
#[cfg(windows)]
struct ChildJob(usize);
#[cfg(windows)]
impl ChildJob {
    fn attach(child: &Child) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let job = Self(handle as usize);
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            ) == 0
                || AssignProcessToJobObject(handle, child.as_raw_handle()) == 0
            {
                return Err(format!(
                    "Cannot contain server lifetime: {}",
                    std::io::Error::last_os_error()
                ));
            }
            Ok(job)
        }
    }
}
#[cfg(windows)]
impl Drop for ChildJob {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0 as *mut _);
        }
    }
}

#[derive(Default)]
struct Runtime {
    child: Mutex<Option<Child>>,
    operation: tokio::sync::Mutex<()>,
    #[cfg(windows)]
    job: Mutex<Option<ChildJob>>,
}
impl Runtime {
    fn stop(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        #[cfg(windows)]
        {
            self.job.lock().unwrap().take();
        }
    }
}
impl Drop for Runtime {
    fn drop(&mut self) {
        self.stop();
    }
}

fn trusted(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|e| e.to_string())?;
    let local = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"));
    if window.label() == "setup" && local {
        Ok(())
    } else {
        Err("Setup IPC is restricted to the bundled setup page".into())
    }
}
fn state_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}
fn database(path: &Path) -> Result<PathBuf, String> {
    let path = path
        .canonicalize()
        .map_err(|e| format!("Cannot open database: {e}"))?;
    if !path.is_file()
        || !path
            .extension()
            .is_some_and(|x| x.eq_ignore_ascii_case("json"))
    {
        return Err("Select a JSON file (AtomicCards.json or a pre-parsed export)".into());
    }
    let mut head = [0; 4096];
    let n = std::fs::File::open(&path)
        .and_then(|mut f| f.read(&mut head))
        .map_err(|e| e.to_string())?;
    if head[..n].iter().find(|b| !b.is_ascii_whitespace()) != Some(&b'{') {
        return Err("Database must be a JSON object; HTML, compressed downloads and empty files are not supported".into());
    }
    // Full shape validation is performed by the server's database loader.
    Ok(path)
}
fn readiness(line: &str, pid: u32) -> Option<u16> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    if value["event"] != "ready" || value["pid"].as_u64()? != u64::from(pid) {
        return None;
    }
    let address: std::net::SocketAddr = value["address"].as_str()?.parse().ok()?;
    let api = u16::try_from(value["port"].as_u64()?).ok()?;
    let client = u16::try_from(value["clientPort"].as_u64()?).ok()?;
    (address.ip().is_loopback() && address.port() == api && api != 0 && client != 0)
        .then_some(client)
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    message: String,
    received: u64,
    total: Option<u64>,
}
fn progress(app: &tauri::AppHandle, message: &str, received: u64, total: Option<u64>) {
    let _ = app.emit_to(
        "setup",
        "setup-progress",
        Progress {
            message: message.into(),
            received,
            total,
        },
    );
}

#[tauri::command]
async fn saved_database(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<String>, String> {
    trusted(&window)?;
    let file = state_dir(&app)?.join("desktop.json");
    if !file.exists() {
        return Ok(None);
    }
    let config: serde_json::Value =
        serde_json::from_slice(&std::fs::read(file).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Cannot read saved configuration: {e}"))?;
    Ok(config["database"].as_str().map(str::to_owned))
}
#[tauri::command]
async fn choose_database(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    trusted(&window)?;
    Ok(rfd::AsyncFileDialog::new()
        .set_title("Choose AtomicCards.json or pre-parsed card database")
        .add_filter("JSON database", &["json"])
        .pick_file()
        .await
        .map(|f| f.path().to_string_lossy().into_owned()))
}

#[tauri::command]
async fn download_database(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    runtime: tauri::State<'_, Runtime>,
) -> Result<String, String> {
    trusted(&window)?;
    let _guard = runtime
        .operation
        .try_lock()
        .map_err(|_| "An operation is already running")?;
    let dir = state_dir(&app)?;
    // MTGJSON's documented current-version endpoint, never a guessed release URL.
    let destination = dir.join("AtomicCards.json");
    let partial = dir.join("AtomicCards.json.partial");
    let result: Result<(), String> = async {
        let client = reqwest::Client::builder()
            .https_only(true)
            .connect_timeout(Duration::from_secs(30))
            .timeout(Duration::from_secs(3600))
            .build()
            .map_err(|e| e.to_string())?;
        let mut response = client
            .get("https://mtgjson.com/api/v5/AtomicCards.json")
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let total = response.content_length();
        let mut file = tokio::fs::File::create(&partial)
            .await
            .map_err(|e| e.to_string())?;
        let mut received = 0;
        let mut last = Instant::now();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;
            received += chunk.len() as u64;
            if last.elapsed() > Duration::from_millis(200) {
                progress(&app, "Downloading official MTGJSON…", received, total);
                last = Instant::now();
            }
        }
        file.sync_all().await.map_err(|e| e.to_string())?;
        drop(file);
        // Validate content before publishing, without loading this large file into memory.
        let mut head = [0; 4096];
        let n = std::fs::File::open(&partial)
            .and_then(|mut f| f.read(&mut head))
            .map_err(|e| e.to_string())?;
        if head[..n].iter().find(|b| !b.is_ascii_whitespace()) != Some(&b'{')
            || total.is_some_and(|t| t != received)
        {
            return Err("Download is incomplete or is not JSON".into());
        }
        tokio::fs::rename(&partial, &destination)
            .await
            .map_err(|e| format!("Cannot publish download: {e}"))?;
        progress(&app, "Download complete", received, total);
        Ok(())
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&partial).await;
    }
    result?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
async fn start_server(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    runtime: tauri::State<'_, Runtime>,
    path: String,
) -> Result<String, String> {
    trusted(&window)?;
    let _guard = runtime
        .operation
        .try_lock()
        .map_err(|_| "An operation is already running")?;
    let db = database(Path::new(&path))?;
    let dir = state_dir(&app)?;
    runtime.stop();
    let resources = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources");
    let executable = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("No executable directory")?
        .join(if cfg!(windows) {
            "phase-mana-server.exe"
        } else {
            "phase-mana-server"
        });
    let mut command = Command::new(executable);
    command
        .current_dir(&dir)
        .env("PHASE_CARD_DB", &db)
        .env("PHASE_MANA_STATE_DIR", &dir)
        .env("PHASE_MANA_WEB_ROOT", resources.join("web-dist"))
        .env("PHASE_MANA_HOST", "127.0.0.1")
        .env("PHASE_MANA_CLIENT_PORT", "1420")
        .env("PHASE_MANA_PORT", "3001")
        .env_remove("PHASE_MANA_ENDPOINT_FILE")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if resources.join("draft-pools").is_dir() {
        command.env("PHASE_MANA_DRAFT_POOLS", resources.join("draft-pools"));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    progress(
        &app,
        "Loading cards; raw AtomicCards parsing can take several minutes…",
        0,
        None,
    );
    let mut child = command.spawn().map_err(|e| {
        format!("Cannot start bundled server: {e}. Run the desktop staging script first.")
    })?;
    #[cfg(windows)]
    match ChildJob::attach(&child) {
        Ok(job) => *runtime.job.lock().unwrap() = Some(job),
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    }
    let pid = child.id();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    *runtime.child.lock().unwrap() = Some(child);
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(port) = readiness(&line, pid) {
                let _ = tx.send(port);
            }
        }
    });
    let tail = std::sync::Arc::new(Mutex::new(String::new()));
    let log = tail.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            eprintln!("{line}");
            let mut text = log.lock().unwrap();
            text.push_str(&line);
            text.push('\n');
            if text.len() > 12000 {
                let start = text
                    .char_indices()
                    .rev()
                    .nth(6000)
                    .map(|(i, _)| i)
                    .unwrap_or(0);
                *text = text[start..].to_owned();
            }
        }
    });
    let started = Instant::now();
    let result: Result<u16, String> = loop {
        if let Ok(port) = rx.try_recv() {
            break Ok(port);
        }
        let status = {
            let mut child = runtime.child.lock().unwrap();
            match child.as_mut() {
                Some(child) => child.try_wait().map_err(|e| e.to_string()),
                None => Err("Server stopped".to_string()),
            }
        };
        let status = match status {
            Ok(status) => status,
            Err(error) => break Err(error),
        };
        if let Some(status) = status {
            break Err(format!(
                "Server exited ({status}). {}",
                tail.lock().unwrap()
            ));
        }
        if started.elapsed() > Duration::from_secs(900) {
            break Err(format!(
                "Server readiness timed out after 15 minutes. {}",
                tail.lock().unwrap()
            ));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    };
    let port = match result {
        Ok(port) => port,
        Err(error) => {
            runtime.stop();
            return Err(error);
        }
    };
    let url = format!("http://127.0.0.1:{port}");
    let complete = (|| -> Result<(), String> {
        std::fs::write(
            dir.join("desktop.json"),
            serde_json::to_vec_pretty(&serde_json::json!({"database": db})).unwrap(),
        )
        .map_err(|e| format!("Cannot save database selection: {e}"))?;
        window
            .navigate(url.parse::<tauri::Url>().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(error) = complete {
        runtime.stop();
        return Err(error);
    }
    Ok(url)
}
fn main() {
    let app = tauri::Builder::default()
        .manage(Runtime::default())
        .invoke_handler(tauri::generate_handler![
            saved_database,
            choose_database,
            download_database,
            start_server
        ])
        .build(tauri::generate_context!())
        .expect("Cannot initialize Phase Mana desktop");
    app.run(|app, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            app.state::<Runtime>().stop();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn readiness_requires_matching_child_and_loopback() {
        let line = r#"{"event":"ready","pid":42,"port":3002,"clientPort":1421,"address":"127.0.0.1:3002"}"#;
        assert_eq!(readiness(line, 42), Some(1421));
        assert_eq!(readiness(line, 43), None);
        assert_eq!(readiness(&line.replace("127.0.0.1", "0.0.0.0"), 42), None);
        assert_eq!(readiness(&line.replace("1421", "65536"), 42), None);
        assert_eq!(readiness("diagnostic output", 42), None);
        assert_eq!(readiness(&line.replace("1421", "0"), 42), None);
        assert_eq!(readiness(&line.replace("clientPort", "missing"), 42), None);
        assert_eq!(
            readiness(&line.replace("127.0.0.1:3002", "127.0.0.1:3003"), 42),
            None
        );
    }
    #[test]
    fn rejects_missing_database() {
        assert!(database(Path::new("does-not-exist.json")).is_err());
    }
    #[test]
    fn validates_database_paths_and_prefix() {
        let dir = std::env::temp_dir().join(format!("phase-mana-path-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(database(&dir).is_err());
        let file = dir.join("cards.json");
        for invalid in ["", "<html>failure</html>", "[]"] {
            std::fs::write(&file, invalid).unwrap();
            assert!(database(&file).is_err());
        }
        std::fs::write(&file, " \n{\"data\":{}}").unwrap();
        assert_eq!(database(&file).unwrap(), file.canonicalize().unwrap());
        let wrong_extension = dir.join("cards.zip");
        std::fs::rename(&file, &wrong_extension).unwrap();
        assert!(database(&wrong_extension).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
