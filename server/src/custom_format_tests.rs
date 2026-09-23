use super::*;

fn rules() -> CustomFormatRules {
    CustomFormatDef::from_lobby_config(
        "Test format".into(),
        &FormatConfig::default_for_player_count(2),
    )
    .unwrap()
    .rules
}

#[tokio::test]
async fn editor_base_and_presets_pass_the_validation_gate() {
    let Json(base) = custom_format_base().await.unwrap();
    let base: CustomFormatRules = serde_json::from_value(base["rules"].clone()).unwrap();
    assert!(validate_custom_format_rules(&base, 2).valid);
    let Json(presets) = custom_formats().await;
    for id in [OLD_SCHOOL_93_94_ID, OLD_SCHOOL_95_ID] {
        let preset = presets.iter().find(|preset| preset.id == id.0).unwrap();
        assert!(validate_custom_format_rules(&preset.rules, 2).valid);
    }
    let mut unsupported = base.clone();
    unsupported.structural.starting_life = 0;
    assert!(!validate_custom_format_rules(&unsupported, 2).valid);
    unsupported.structural.starting_life = 20;
    unsupported.structural.deck_size = DeckSizeRule::Minimum(0);
    assert!(!validate_custom_format_rules(&unsupported, 2).valid);
    unsupported.structural.deck_size = base.structural.deck_size;
    unsupported.legality.legacy.damage_timing = engine::types::custom_format::CombatDamageTiming::OnStack;
    assert!(!validate_custom_format_rules(&unsupported, 2).valid);
    assert!(!validate_custom_format_rules(&base, 1).valid);
    let mut invalid = serde_json::to_value(base).unwrap();
    invalid["structural"]["command_zone_mode"] = serde_json::json!({
        "Enabled": {"commander_damage_threshold": 21, "eligibility_rule": "Standard"}
    });
    let invalid = serde_json::from_value(invalid).unwrap();
    assert!(!validate_custom_format_rules(&invalid, 2).valid);
}

#[test]
fn resolved_rules_control_start_and_rejected_decks_preserve_session() {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(|| {
            let db = CardDatabase::from_mtgjson(
                &std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../../phase/data/mtgjson/test_fixture.json"),
            )
            .unwrap();
            let mut host = Host::new(db);
            let mut custom = rules();
            custom.structural.starting_life = 30;
            let request = serde_json::json!({
                "format": "standard", "customRules": custom,
                "humanDeck": vec!["Plains"; 60], "aiDeck": vec!["Plains"; 60]
            });
            host.start(serde_json::from_value(request.clone()).unwrap()).unwrap();
            assert!(host.session.as_ref().unwrap().game.players.iter().all(|p| p.life == 30));
            let mut invalid = request;
            invalid["humanSideboard"] = serde_json::json!(vec!["Plains"; 16]);
            assert!(host.start(serde_json::from_value(invalid.clone()).unwrap()).is_err());
            invalid["humanSideboard"] = serde_json::json!(["Plains"]);
            host.start(serde_json::from_value(invalid.clone()).unwrap()).unwrap();
            let prompt = host.session.as_ref().unwrap().prepared.prompt_id;
            invalid["humanDeck"] = serde_json::json!(vec!["Plains"; 7]);
            assert!(host.start(serde_json::from_value(invalid).unwrap()).is_err());
            assert_eq!(host.session.as_ref().unwrap().prepared.prompt_id, prompt);
        })
        .unwrap()
        .join()
        .unwrap();
}
