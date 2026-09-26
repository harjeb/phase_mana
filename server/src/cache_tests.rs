use super::*;
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
