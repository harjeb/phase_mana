use engine::database::CardDatabase;
use phase_mana_server::{router, Host};
use std::io::Read;
use std::path::{Path, PathBuf};

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
    let port: u16 = std::env::var("PHASE_MANA_PORT")
        .unwrap_or_else(|_| "3001".into())
        .parse()?;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    eprintln!(
        "phase-mana API: http://127.0.0.1:{port} (database {})",
        path.display()
    );
    axum::serve(listener, router(Host::new(db))).await?;
    Ok(())
}
