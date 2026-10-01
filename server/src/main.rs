use engine::database::CardDatabase;
use phase_mana_server::{router, Host};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

mod startup;
mod gateway;
#[cfg(test)]
mod cache_tests;

/// `PHASE_CARD_DB` takes either shape the engine reads: a raw MTGJSON
/// `AtomicCards.json` (`{"meta":…,"data":…}`, its Oracle text parsed at
/// startup) or a pre-parsed oracle-gen export (`{"card name": {…}}`). The two
/// formats share no keys, so the first one decides.
fn is_raw_mtgjson(path: &Path) -> bool {
    let mut head = [0u8; 64];
    std::fs::File::open(path)
        .and_then(|mut file| file.read(&mut head))
        .is_ok_and(|read| {
            let filtered: Vec<u8> = head[..read]
                .iter()
                .copied()
                .filter(|b| !b.is_ascii_whitespace())
                .take(7)
                .collect();
            filtered == b"{\"meta\""
        })
}

/// Where the pre-parsed export of `source` is cached: the app state directory
/// when one is configured (the desktop always passes it), otherwise beside the
/// source file — which is where phase's own `gen-card-data.sh` puts it.
fn export_cache_path(source: &Path) -> PathBuf {
    let dir = std::env::var_os("PHASE_MANA_STATE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| source.parent().unwrap_or(Path::new(".")).to_path_buf());
    dir.join("card-data.json")
}

/// Trust a cache only when it is at least as new as both its source and this
/// executable: rebuilding the engine must invalidate exports from older parsers.
fn usable_export_cache(source: &Path) -> Option<PathBuf> {
    let cache = export_cache_path(source);
    let executable = std::env::current_exe().ok()?;
    export_cache_is_fresh(&cache, source, &executable).then_some(cache)
}

fn export_cache_is_fresh(cache: &Path, source: &Path, executable: &Path) -> bool {
    let modified = |path: &Path| path.metadata().and_then(|metadata| metadata.modified());
    match (modified(cache), modified(source), modified(executable)) {
        (Ok(cached), Ok(raw), Ok(built)) => cached >= raw && cached >= built,
        _ => false,
    }
}

/// Raw MTGJSON needs its Oracle text parsed at startup — minutes of work for the
/// full card pool, against seconds to re-read the export of that same parse. Pay
/// for the parse once per install and cache it. Returns the database and the file
/// it actually came from, so the startup log names the real source.
fn load_card_db(path: &Path) -> Result<(CardDatabase, PathBuf), String> {
    if !is_raw_mtgjson(path) {
        let db = CardDatabase::from_export(path)
            .map_err(|e| format!("Cannot load {}: {e}", path.display()))?;
        return Ok((db, path.to_path_buf()));
    }
    if let Some(cache) = usable_export_cache(path) {
        if let Ok(db) = CardDatabase::from_export(&cache) {
            return Ok((db, cache));
        }
        // An unreadable cache is worth replacing, not failing on.
        let _ = std::fs::remove_file(&cache);
    }
    let db = CardDatabase::from_mtgjson(path)
        .map_err(|e| format!("Cannot load {}: {e}", path.display()))?;
    let cache = export_cache_path(path);
    if let Err(error) = write_export_cache(&db, &cache) {
        eprintln!("phase-mana: cannot cache the parsed card database: {error}");
    }
    Ok((db, path.to_path_buf()))
}

fn write_export_cache(db: &CardDatabase, cache: &Path) -> std::io::Result<()> {
    // Write beside the target and rename, so a half-written cache is never read.
    let partial = cache.with_extension("json.partial");
    // The engine's subset export preserves stored face keys and metadata but
    // deliberately omits legality. Restore it for a full application cache.
    let names = db.face_iter().map(|(key, _)| key.to_owned()).collect();
    let mut export: serde_json::Value = serde_json::from_str(&db.export_subset_json(&names))?;
    for (name, entry) in export.as_object_mut().expect("card export is an object") {
        if let Some(legalities) = db.get_legalities(name) {
            entry["legalities"] = serde_json::to_value(engine::database::legality::legalities_to_export_map(legalities))?;
        }
    }
    std::fs::write(&partial, serde_json::to_vec(&export)?)?;
    std::fs::rename(&partial, cache)
}

/// The pre-parsed oracle-gen export when phase's pipeline has written one (it
/// builds in seconds), else the raw MTGJSON download whose Oracle text is
/// parsed at startup, else the 87-card fixture that ships with phase. Keeps
/// `npm run server` zero-config while preferring the fastest card pool.
fn default_card_db() -> PathBuf {
    let data = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../phase/data");
    let export = data.join("card-data.json");
    if export.is_file() {
        return export;
    }
    let mtgjson = data.join("mtgjson/AtomicCards.json");
    if mtgjson.is_file() {
        mtgjson
    } else {
        data.join("mtgjson/test_fixture.json")
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Command {
    Serve,
    Prepare { raw: PathBuf, output: PathBuf },
    Validate(PathBuf),
}

fn parse_command(args: &[std::ffi::OsString]) -> Result<Command, String> {
    match args {
        [] => Ok(Command::Serve),
        [command, raw, output] if command == "--prepare-card-db" => Ok(Command::Prepare {
            raw: raw.into(), output: output.into(),
        }),
        [command, export] if command == "--validate-card-db" => Ok(Command::Validate(export.into())),
        _ => Err("Usage: phase-mana-server [--prepare-card-db <raw.json> <output.json> | --validate-card-db <export.json>]".into()),
    }
}

fn validate_card_db(path: &Path) -> Result<usize, String> {
    let db = CardDatabase::from_export(path)
        .map_err(|error| format!("Cannot validate {}: {error}", path.display()))?;
    let faces = db.face_iter().count();
    if faces == 0 {
        return Err(format!("Card database {} contains no faces", path.display()));
    }
    Ok(faces)
}

fn run_card_db_command(command: Command) -> Result<(), String> {
    let started = std::time::Instant::now();
    match command {
        Command::Prepare { raw, output } => {
            // Always parse raw input with the current engine; never consult caches.
            let db = CardDatabase::from_mtgjson(&raw)
                .map_err(|error| format!("Cannot parse {}: {error}", raw.display()))?;
            let faces = db.face_iter().count();
            if faces == 0 {
                return Err(format!("Raw card database {} contains no faces", raw.display()));
            }
            if let Some(parent) = output.parent().filter(|parent| !parent.as_os_str().is_empty()) {
                std::fs::create_dir_all(parent)
                    .map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
            }
            write_export_cache(&db, &output)
                .map_err(|error| format!("Cannot write {}: {error}", output.display()))?;
            drop(db);
            let restored_faces = validate_card_db(&output)?;
            if restored_faces != faces {
                return Err(format!("Export {} has {restored_faces} faces; expected {faces}", output.display()));
            }
            eprintln!("Prepared and validated {faces} card faces from {} to {} in {:?}", raw.display(), output.display(), started.elapsed());
        }
        Command::Validate(path) => {
            let faces = validate_card_db(&path)?;
            eprintln!("Validated {faces} card faces from {} in {:?}", path.display(), started.elapsed());
        }
        Command::Serve => return Err("Expected an offline card database command".into()),
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let command = parse_command(&std::env::args_os().skip(1).collect::<Vec<_>>())?;
    if command != Command::Serve {
        // Full deserialization and Oracle parsing need the same stack as serve's
        // blocking workers, without constructing a runtime or binding listeners.
        std::thread::Builder::new()
            .name("card-db".into())
            .stack_size(16 * 1024 * 1024)
            .spawn(move || run_card_db_command(command))?
            .join()
            .map_err(|_| "Card database worker panicked")??;
        return Ok(());
    }
    // Engine parsing and debug-mode reducers need more than the default 2 MiB
    // worker stack. This also configures the spawn_blocking AI workers.
    tokio::runtime::Builder::new_multi_thread()
        .thread_stack_size(16 * 1024 * 1024)
        .enable_all()
        .build()?
        .block_on(serve())
}

async fn serve() -> Result<(), Box<dyn std::error::Error>> {
    let port = match std::env::var("PHASE_MANA_PORT") {
        Ok(value) => value.parse::<u16>()?,
        Err(std::env::VarError::NotPresent) => 3001,
        Err(error) => return Err(error.into()),
    };
    // Reserve the endpoint before potentially minutes of database parsing.
    let listener = startup::bind(port)?;
    let address = listener.local_addr()?;
    let listener = tokio::net::TcpListener::from_std(listener)?;
    // Reserve the optional client listener before database initialization too.
    let gateway = match gateway::Config::from_env()? {
        Some(config) => {
            let client = startup::bind(config.port)?;
            let client_port = client.local_addr()?.port();
            let app = gateway::router(config, client_port, address.port())?;
            Some((tokio::net::TcpListener::from_std(client)?, app, client_port))
        }
        None => None,
    };
    let path = std::env::var_os("PHASE_CARD_DB")
        .map(PathBuf::from)
        .unwrap_or_else(default_card_db);
    let started = std::time::Instant::now();
    let load_path = path.clone();
    let (db, loaded_from) = tokio::task::spawn_blocking(move || load_card_db(&load_path))
        .await?
        .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
    eprintln!(
        "loaded {} cards from {} in {:?}",
        db.card_count(),
        loaded_from.display(),
        started.elapsed()
    );
    let app = router(Host::new(db));
    let pid = std::process::id();
    if let Some(endpoint) = std::env::var_os("PHASE_MANA_ENDPOINT_FILE") {
        startup::publish_endpoint(Path::new(&endpoint), address.port(), pid)?;
    }
    // One flushed JSON line is the launcher contract; diagnostics go to stderr.
    let mut stdout = std::io::stdout().lock();
    let mut ready = serde_json::json!({
        "event": "ready", "address": address.to_string(),
        "port": address.port(), "pid": pid,
    });
    if let Some((_, _, client_port)) = &gateway {
        ready["clientPort"] = serde_json::json!(client_port);
    }
    writeln!(stdout, "{ready}")?;
    stdout.flush()?;
    drop(stdout);
    eprintln!(
        "phase-mana API: http://{address} (database {})",
        path.display()
    );
    if let Some((client, gateway_app, _)) = gateway {
        tokio::try_join!(
            async { axum::serve(listener, app).await },
            async { axum::serve(client, gateway_app).await },
        )?;
    } else {
        axum::serve(listener, app).await?;
    }
    Ok(())
}
