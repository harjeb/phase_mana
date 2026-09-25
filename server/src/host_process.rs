//! The multiplayer host process: the native `phase-server` that runs the
//! authoritative engine for a hosted room.
//!
//! The design gives this job to a desktop shell. phase-mana ships no
//! `src-tauri/`, but it already runs a local Axum host for the single-player
//! engine, so the process backing the UI's `/api` also spawns and reaps the
//! multiplayer binary. "Start hosting" then costs one click in the browser
//! with nothing extra to install, which is what the invite flow needs.
//!
//! The engine stays on the machine that owns the room: guests connect to this
//! child over WebSocket and never load a rules engine themselves.

use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use serde::Serialize;

/// Startup loads a card database, and a raw MTGJSON pool parses for minutes on
/// a cold page cache, so this is generous rather than tight.
const READY_TIMEOUT: Duration = Duration::from_secs(180);
const READY_POLL: Duration = Duration::from_millis(150);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    /// Loopback endpoint — always reachable from this machine.
    pub endpoint: String,
    /// Addresses a guest on the same network can dial. Empty unless the host
    /// was started with LAN exposure, because binding `0.0.0.0` publishes the
    /// engine to the whole network.
    pub lan_endpoints: Vec<String>,
    pub binary: String,
    pub port: u16,
}

struct Running {
    child: Child,
    /// Held open so `--exit-on-stdin-close` reaps the engine if this host dies.
    _stdin: Option<ChildStdin>,
    info: HostInfo,
}

static RUNNING: OnceLock<Mutex<Option<Running>>> = OnceLock::new();

fn slot() -> &'static Mutex<Option<Running>> {
    RUNNING.get_or_init(|| Mutex::new(None))
}

pub fn status() -> Option<HostInfo> {
    let mut guard = slot().lock().ok()?;
    live_info(&mut guard)
}

fn live_info(running: &mut Option<Running>) -> Option<HostInfo> {
    match running.as_mut()?.child.try_wait() {
        Ok(None) => running.as_ref().map(|r| r.info.clone()),
        Ok(Some(_)) => { running.take(); None }
        Err(_) => {
            if let Some(mut process) = running.take() {
                reap(&mut process.child);
            }
            None
        }
    }
}

fn reap(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

pub fn stop() -> Result<(), String> {
    let mut guard = slot().lock().map_err(|_| "host process lock poisoned".to_string())?;
    if let Some(mut running) = guard.take() {
        reap(&mut running.child);
    }
    Ok(())
}

/// Spawn the host, or return the one already running. One room per process:
/// the engine, the port, and the invite all belong to a single session.
pub fn start() -> Result<HostInfo, String> {
    let mut guard = slot().lock().map_err(|_| "host process lock poisoned".to_string())?;
    if let Some(info) = live_info(&mut guard) {
        return Ok(info);
    }

    let binary = resolve_binary()?;
    let data_dir = data_dir();
    validate_data(&data_dir, std::env::var("PHASE_DEV_FIXTURE").as_deref().ok())?;
    let lan = lan_enabled(std::env::var("PHASE_HOST_LAN").as_deref().ok());
    let bind = if lan { "0.0.0.0" } else { "127.0.0.1" };
    let port = configured_port(std::env::var("PHASE_HOST_PORT").as_deref().ok())?
        .map(Ok).unwrap_or_else(free_port)?;

    // Fail before spawning if a fixed proxy port is already owned by another
    // service; otherwise its listener could be mistaken for engine readiness.
    let reservation = TcpListener::bind((bind, port))
        .map_err(|error| format!("Cannot bind host port {port}: {error}"))?;

    let mut command = Command::new(&binary);
    command
        .args(["--port", &port.to_string(), "--bind", bind])
        .arg("--data-dir")
        .arg(&data_dir)
        // Keep the game database out of the engine checkout: this host is a
        // guest in that tree and must not leave state behind in it.
        .arg("--games-db")
        .arg(std::env::temp_dir().join(format!("phase-mana-host-{port}-{:016x}.db", rand::random::<u64>())))
        .arg("--no-data-download")
        .arg("--exit-on-stdin-close")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit());
    // PHASE_DEV_FIXTURE is inherited only when explicitly set by the operator.
    // A reverse proxy or tunnel the operator already runs. The engine advertises
    // it as `ServerHello.public_url`, which is what turns the invitation from a
    // LAN address into a `wss://` one. `NGROK_AUTHTOKEN` needs no flag here: the
    // engine grows its own tunnel when built with `--features ngrok`, and this
    // child inherits the environment.
    if let Ok(public_url) = std::env::var("PHASE_HOST_PUBLIC_URL") {
        if !public_url.trim().is_empty() {
            command.args(["--public-url", public_url.trim()]);
        }
    }

    drop(reservation);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Cannot start {}: {e}", binary.display()))?;
    let stdin = child.stdin.take();

    let deadline = Instant::now() + READY_TIMEOUT;
    loop {
        let exited = match child.try_wait() {
            Ok(status) => status,
            Err(error) => {
                reap(&mut child);
                return Err(format!("Cannot inspect host process: {error}"));
            }
        };
        if let Some(status) = exited {
            return Err(format!(
                "{} exited during startup ({status}). Set PHASE_SERVER_BIN or build it with `--features manabrew`.",
                binary.display()
            ));
        }
        if let Ok(stream) = TcpStream::connect_timeout(&SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port), Duration::from_millis(200)) {
            if let Err(error) = verify_protocol(stream, port) {
                reap(&mut child);
                return Err(error);
            }
            break;
        }
        if Instant::now() >= deadline {
            reap(&mut child);
            return Err(format!("{} did not accept connections within {READY_TIMEOUT:?}", binary.display()));
        }
        std::thread::sleep(READY_POLL);
    }

    let info = HostInfo {
        endpoint: format!("ws://127.0.0.1:{port}/ws"),
        lan_endpoints: if lan {
            lan_addresses().into_iter().map(|ip| format!("ws://{ip}:{port}/ws")).collect()
        } else {
            Vec::new()
        },
        binary: binary.display().to_string(),
        port,
    };
    *guard = Some(Running { child, _stdin: stdin, info: info.clone() });
    Ok(info)
}

/// Reap the engine when this process exits, including on an unclean exit.
pub fn shutdown() {
    let _ = stop();
}

fn resolve_binary() -> Result<PathBuf, String> {
    if let Some(configured) = std::env::var_os("PHASE_SERVER_BIN") {
        let path = PathBuf::from(configured);
        return path.is_file().then_some(path).ok_or_else(|| "PHASE_SERVER_BIN does not name a file".to_string());
    }
    let candidate = Path::new(env!("CARGO_MANIFEST_DIR")).join("../.phase-host/target/debug/phase-server");
    if candidate.is_file() { return Ok(candidate); }
    Err("No compatible host engine installed. Run `npm run host:build`, or set PHASE_SERVER_BIN to a Phase 76 / ManaBrew 2 binary.".to_string())
}

fn compatible_hello(value: &serde_json::Value) -> bool {
    value["type"] == "ServerHello" && value["data"]["mode"] == "Full"
        && value["data"]["protocol_version"] == 76 && value["data"]["manabrew_version"] == 2
}

fn verify_protocol(stream: TcpStream, port: u16) -> Result<(), String> {
    let probe = || -> Result<(), Box<dyn std::error::Error>> {
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        stream.set_write_timeout(Some(Duration::from_secs(5)))?;
        let (mut socket, _) = tungstenite::client(format!("ws://127.0.0.1:{port}/ws").as_str(), stream)?;
        let value: serde_json::Value = serde_json::from_str(socket.read()?.to_text()?)?;
        let _ = socket.close(None);
        if !compatible_hello(&value) { return Err("expected Full protocol 76 / ManaBrew 2".into()); }
        Ok(())
    };
    probe().map_err(|e| format!("Host protocol check failed: {e}. Run `npm run host:build` or configure a compatible PHASE_SERVER_BIN."))
}

fn lan_enabled(value: Option<&str>) -> bool {
    value != Some("0")
}

fn configured_port(value: Option<&str>) -> Result<Option<u16>, String> {
    value.map(|value| value.parse::<u16>().ok().filter(|port| *port != 0)
        .ok_or_else(|| "PHASE_HOST_PORT must be an integer between 1 and 65535".to_string()))
        .transpose()
}

fn validate_data(directory: &Path, fixture: Option<&str>) -> Result<(), String> {
    if fixture == Some("1") || directory.join("card-data.json").is_file() {
        return Ok(());
    }
    Err(format!(
        "Missing {}. Run `npm run host:build` to generate the full card database, or set PHASE_HOST_DATA_DIR to a directory containing card-data.json. For development fixtures only, explicitly set PHASE_DEV_FIXTURE=1.",
        directory.join("card-data.json").display()
    ))
}

fn data_dir() -> PathBuf {
    std::env::var_os("PHASE_HOST_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.phase-host/data"))
}

/// Ask the OS for an unused port by binding one, so two hosts never collide.
fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|e| e.to_string())?;
    listener.local_addr().map(|address| address.port()).map_err(|e| e.to_string())
}

/// The address a guest on this network would dial.
///
/// Asking the routing table which interface reaches the outside world avoids a
/// dependency, at the cost of the usual caveats: a multi-homed machine reports
/// only its default route, and a VPN-only network reports the VPN address.
///
/// ponytail: one address from the default route, enumerate interfaces if
/// multi-homed hosting turns out to matter.
fn lan_addresses() -> Vec<Ipv4Addr> {
    let Ok(socket) = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) else { return Vec::new() };
    // Connecting a UDP socket sends nothing; it only selects a route.
    if socket.connect((Ipv4Addr::new(8, 8, 8, 8), 80)).is_err() {
        return Vec::new();
    }
    match socket.local_addr().map(|address| address.ip()) {
        Ok(IpAddr::V4(ip)) if !ip.is_loopback() && !ip.is_unspecified() => vec![ip],
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_incompatible_protocol() {
        let mut hello = serde_json::json!({"type":"ServerHello","data":{"mode":"Full","protocol_version":76,"manabrew_version":2}});
        assert!(compatible_hello(&hello));
        hello["data"]["protocol_version"] = 78.into();
        assert!(!compatible_hello(&hello));
        hello["data"]["protocol_version"] = 76.into();
        hello["data"]["manabrew_version"] = serde_json::Value::Null;
        assert!(!compatible_hello(&hello));
    }

    #[test]
    fn lan_is_default_and_only_zero_disables_it() {
        assert!(lan_enabled(None));
        assert!(lan_enabled(Some("1")));
        assert!(lan_enabled(Some("")));
        assert!(!lan_enabled(Some("0")));
    }

    #[test]
    fn fixed_port_requires_a_nonzero_tcp_port() {
        assert_eq!(configured_port(None).unwrap(), None);
        assert_eq!(configured_port(Some("9900")).unwrap(), Some(9900));
        for value in ["0", "65536", "", "abc", "-1"] {
            assert!(configured_port(Some(value)).is_err(), "{value}");
        }
    }

    #[test]
    fn missing_data_requires_explicit_fixture_opt_in() {
        let missing = std::env::temp_dir().join(format!("phase-missing-data-{}", std::process::id()));
        for fixture in [None, Some("0"), Some("true")] {
            let error = validate_data(&missing, fixture).unwrap_err();
            assert!(error.contains("card-data.json") && error.contains("PHASE_HOST_DATA_DIR"));
        }
        assert!(validate_data(&missing, Some("1")).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn exited_child_is_removed_from_status() {
        let mut child = Command::new("sh").args(["-c", "exit 0"]).spawn().unwrap();
        child.wait().unwrap();
        let mut running = Some(Running {
            child,
            _stdin: None,
            info: HostInfo { endpoint: String::new(), lan_endpoints: vec![], binary: String::new(), port: 1 },
        });
        assert!(live_info(&mut running).is_none());
        assert!(running.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn failed_startup_cleanup_reaps_child() {
        let mut child = Command::new("sh").args(["-c", "exec sleep 60"]).spawn().unwrap();
        reap(&mut child);
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    fn no_host_is_running_before_one_starts() {
        assert!(status().is_none());
    }

    #[test]
    fn stopping_a_host_that_never_started_is_not_an_error() {
        stop().expect("stopping an idle host must be a no-op, not a failure");
        assert!(status().is_none());
    }

    #[test]
    fn the_reported_port_can_actually_be_listened_on() {
        let port = free_port().expect("a free port");
        assert!(port > 0);
        TcpListener::bind((Ipv4Addr::LOCALHOST, port)).expect("the reported port must still be bindable");
    }

    #[test]
    fn a_shared_address_is_never_loopback() {
        // Vacuous on a machine with no default route; on one that has a route
        // the point is that an invite never advertises 127.0.0.1 to a friend.
        for address in lan_addresses() {
            assert!(!address.is_loopback() && !address.is_unspecified(), "{address} is not shareable");
        }
    }
}
