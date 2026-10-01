use super::*;

struct TestDir(PathBuf);
impl TestDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("phase-db-test-{:016x}", rand::random::<u64>()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn offline_cli_is_strict() {
    let parse = |args: &[&str]| parse_command(&args.iter().map(std::ffi::OsString::from).collect::<Vec<_>>());
    assert_eq!(parse(&[]).unwrap(), Command::Serve);
    assert_eq!(parse(&["--prepare-card-db", "raw.json", "out.json"]).unwrap(), Command::Prepare {
        raw: "raw.json".into(), output: "out.json".into(),
    });
    assert_eq!(parse(&["--validate-card-db", "out.json"]).unwrap(), Command::Validate("out.json".into()));
    for args in [
        vec!["--unknown"], vec!["raw.json"], vec!["--prepare-card-db"],
        vec!["--prepare-card-db", "raw.json"],
        vec!["--prepare-card-db", "raw.json", "out.json", "extra"],
        vec!["--validate-card-db"], vec!["--validate-card-db", "out.json", "extra"],
    ] {
        assert!(parse(&args).is_err(), "accepted {args:?}");
    }
}

#[test]
fn cache_must_be_as_new_as_source_and_executable() {
    let dir = TestDir::new();
    let cache = dir.0.join("cache");
    let raw = dir.0.join("raw");
    let executable = dir.0.join("executable");
    let set_time = |path: &Path, seconds| {
        let file = std::fs::File::create(path).unwrap();
        file.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds)).unwrap();
    };
    set_time(&cache, 1000);
    set_time(&raw, 1000);
    set_time(&executable, 1000);
    assert!(export_cache_is_fresh(&cache, &raw, &executable));
    set_time(&executable, 2000);
    assert!(!export_cache_is_fresh(&cache, &raw, &executable));
    set_time(&cache, 2000);
    assert!(export_cache_is_fresh(&cache, &raw, &executable));
    set_time(&raw, 3000);
    assert!(!export_cache_is_fresh(&cache, &raw, &executable));
    std::fs::remove_file(&executable).unwrap();
    assert!(!export_cache_is_fresh(&cache, &raw, &executable));
}

#[test]
fn validation_rejects_empty_invalid_and_missing_exports() {
    let dir = TestDir::new();
    let path = dir.0.join("export.json");
    assert!(validate_card_db(&path).is_err());
    for text in ["{}", "not json", r#"{"invalid":{"name":"Invalid"}}"#] {
        std::fs::write(&path, text).unwrap();
        assert!(validate_card_db(&path).is_err());
    }
}

#[test]
fn prepare_parses_raw_and_validates_export_with_legality() {
    std::thread::Builder::new().stack_size(16 * 1024 * 1024).spawn(|| {
        use engine::database::legality::{LegalityFormat, LegalityStatus};
        let dir = TestDir::new();
        let raw = dir.0.join("raw.json");
        let output = dir.0.join("nested/export.json");
        std::fs::write(&raw, serde_json::json!({
            "meta": {"version":"5.3.0"},
            "data": {"Forest": [{
                "name":"Forest", "manaCost":"", "manaValue":0.0,
                "colors":[], "colorIdentity":["G"], "types":["Land"],
                "subtypes":["Forest"], "supertypes":["Basic"],
                "text":"", "layout":"normal", "type":"Basic Land — Forest",
                "keywords":[], "identifiers":{"scryfallOracleId":"00000000-0000-0000-0000-000000000001"},
                "legalities":{"standard":"Legal"}
            }]}
        }).to_string()).unwrap();
        // A bogus existing cache must not affect the explicit preparation path.
        std::fs::write(dir.0.join("card-data.json"), "{}").unwrap();
        run_card_db_command(Command::Prepare { raw: raw.clone(), output: output.clone() }).unwrap();
        assert_eq!(validate_card_db(&output).unwrap(), 1);
        let db = CardDatabase::from_export(&output).unwrap();
        assert_eq!(db.legality_status("Forest", LegalityFormat::Standard), Some(LegalityStatus::Legal));
        run_card_db_command(Command::Validate(output.clone())).unwrap();
        // Export input is not accepted as raw input, even when valid.
        assert!(run_card_db_command(Command::Prepare { raw: output.clone(), output: dir.0.join("bad.json") }).is_err());
        std::fs::write(&raw, r#"{"meta":{},"data":{}}"#).unwrap();
        assert!(run_card_db_command(Command::Prepare { raw, output }).is_err());
    }).unwrap().join().unwrap();
}

#[test]
fn cache_round_trip_preserves_faces_metadata_and_legality() {
    use engine::database::legality::{LegalityFormat, LegalityStatus};
    let mut records = serde_json::Map::new();
    for (name, index) in [("Front", 0), ("Back", 1)] {
        records.insert(name.to_lowercase(), serde_json::json!({
            "name": name, "mana_cost":{"type":"NoCost"},
            "card_type":{"supertypes":[],"core_types":[],"subtypes":[]},
            "keywords":[],"abilities":[],"triggers":[],"static_abilities":[],"replacements":[],
            "scryfall_oracle_id":"00000000-0000-0000-0000-000000000001",
            "layout":"transform","face_index":index,"printings":["TST"],
            "legalities":{"standard":"Legal","premodern":"Banned","commander":"not_legal"}
        }));
    }
    let db = CardDatabase::from_json_str(&serde_json::Value::Object(records).to_string()).unwrap();
    let dir = std::env::temp_dir().join(format!("phase-cache-test-{:016x}", rand::random::<u64>()));
    std::fs::create_dir(&dir).unwrap();
    let cache = dir.join("cards.json");
    write_export_cache(&db, &cache).unwrap();
    let restored = CardDatabase::from_export(&cache).unwrap();
    for name in ["Front", "Back"] {
        assert!(restored.get_face_by_name(name).is_some());
        assert_eq!(restored.legality_status(name, LegalityFormat::Standard), Some(LegalityStatus::Legal));
        assert_eq!(restored.legality_status(name, LegalityFormat::Premodern), Some(LegalityStatus::Banned));
        assert_eq!(restored.legality_status(name, LegalityFormat::Commander), Some(LegalityStatus::NotLegal));
        assert_eq!(restored.printings_for(name), Some(["TST".to_owned()].as_slice()));
    }
    assert!(restored.is_front_face_key("front"));
    assert!(!restored.is_front_face_key("back"));
    assert_eq!(restored.get_layout_kind("00000000-0000-0000-0000-000000000001"), db.get_layout_kind("00000000-0000-0000-0000-000000000001"));
    std::fs::remove_dir_all(dir).unwrap();
}
