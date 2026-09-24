use engine::database::CardDatabase;
use phase_mana_server::{router, Host};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

mod startup;
mod gateway;

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

fn load_card_db(path: &Path) -> Result<CardDatabase, String> {
    let load = if is_raw_mtgjson(path) {
        CardDatabase::from_mtgjson(path)
    } else {
        CardDatabase::from_export(path)
    };
    load.map_err(|e| format!("Cannot load {}: {e}", path.display()))
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

fn main() -> Result<(), Box<dyn std::error::Error>> {
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
    let db = load_card_db(&path).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
    eprintln!(
        "loaded {} cards from {} in {:?}",
        db.card_count(),
        path.display(),
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
