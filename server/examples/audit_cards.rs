//! Offline coverage inventory. No HTTP requests or host/session changes.
//! cargo run --manifest-path server/Cargo.toml --example audit_cards -- DB PRESETS OUTPUT
use engine::{
    database::{is_card_playable, CardDatabase},
    game::coverage::card_face_gaps,
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Read,
    path::PathBuf,
};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 3 {
        return Err("usage: audit_cards DB PRESETS OUTPUT.json".into());
    }
    let path = PathBuf::from(&args[0]);
    // Deliberately match server/src/main.rs format detection.
    let mut head = [0u8; 16];
    let n = fs::File::open(&path)?.read(&mut head)?;
    let raw = head[..n].starts_with(b"{\"meta\"");
    let started = std::time::Instant::now();
    let db = if raw {
        CardDatabase::from_mtgjson(&path)?
    } else {
        CardDatabase::from_export(&path)?
    };
    eprintln!(
        "loaded {} rules in {:?}",
        db.card_count(),
        started.elapsed()
    );
    let mut inventory: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut presets = BTreeMap::new();
    let mut paths: Vec<_> = fs::read_dir(&args[1])?
        .map(|p| p.map(|p| p.path()))
        .collect::<Result<_, _>>()?;
    paths.sort();
    for p in paths {
        if p.extension().and_then(|s| s.to_str()) != Some("json")
            || p.file_name().unwrap() == "index.json"
        {
            continue;
        }
        let d: Value = serde_json::from_slice(&fs::read(&p)?)?;
        let id = p.file_stem().unwrap().to_str().unwrap().to_string();
        presets.insert(id.clone(), d["label"].clone());
        for zone in ["cards", "sideboard"] {
            if zone == "cards" && !d[zone].is_array() {
                return Err(format!("{}: cards must be an array", p.display()).into());
            }
            if let Some(cards) = d[zone].as_array() {
                for card in cards {
                    let name = card["name"].as_str().ok_or("card without name")?;
                    inventory
                        .entry(name.into())
                        .or_default()
                        .insert(format!("{id}:{zone}"));
                }
            }
        }
        for zone in ["commander", "signatureSpell"] {
            if let Some(name) = d[zone].as_str().filter(|s| !s.is_empty()) {
                inventory
                    .entry(name.into())
                    .or_default()
                    .insert(format!("{id}:{zone}"));
            }
        }
    }
    let check = |name: &str| {
        let face = db.get_face_by_name(name);
        json!({"name": name, "playable": is_card_playable(&db, name),
            "missing": face.is_none(), "resolved_face": face.map(|f| &f.name),
            "gaps": face.map(card_face_gaps).unwrap_or_default()})
    };
    let preset_cards: Vec<_> = inventory
        .iter()
        .map(|(name, refs)| {
            let mut row = check(name);
            row["presets"] = json!(refs);
            row
        })
        .collect();
    let names = db.card_names();
    let database_unsupported: Vec<_> = names
        .iter()
        .map(|n| check(n))
        .filter(|r| r["playable"] == false)
        .collect();
    let output = json!({"database_path": path.canonicalize()?.display().to_string(),
        "loader": if raw { "from_mtgjson" } else { "from_export" },
        "database_rules": db.card_count(), "database_face_names": names.len(),
        "database_unsupported": database_unsupported, "presets": presets, "preset_cards": preset_cards});
    fs::write(&args[2], serde_json::to_string_pretty(&output)?)?;
    eprintln!("wrote {} in {:?}", args[2], started.elapsed());
    Ok(())
}
fn main() {
    // Same stack allowance as the host, without creating an async server.
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(|| {
            if let Err(e) = run() {
                eprintln!("{e}");
                std::process::exit(1);
            }
        })
        .unwrap()
        .join()
        .unwrap();
}
