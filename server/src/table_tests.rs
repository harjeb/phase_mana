use super::*;

#[test]
fn limited_and_four_player_tables() {
    std::thread::Builder::new().stack_size(16 * 1024 * 1024).spawn(|| {
        let db = CardDatabase::from_mtgjson(&std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../phase/data/mtgjson/test_fixture.json")).unwrap();
        let mut host = Host::new(db);
        for format in ["draft", "sealed", "commander"] {
            let commander = format == "commander";
            for opponents in 1..=if commander { 3 } else { 1 } {
                let deck = vec!["Plains"; if commander { 99 } else { 40 }];
                let commanders = if commander { vec!["Linden, the Steadfast Queen"] } else { vec![] };
                let request = serde_json::json!({
                    "format": format, "seed": 42,
                    "humanDeck": deck, "aiDeck": deck,
                    "humanCommanders": commanders, "aiCommanders": commanders,
                    "extraOpponents": (1..opponents).map(|_| serde_json::json!({
                        "deck": deck, "commanders": commanders
                    })).collect::<Vec<_>>()
                });
                host.start(serde_json::from_value(request.clone()).unwrap()).unwrap();
                let game = &host.session.as_ref().unwrap().game;
                assert_eq!(game.players.len(), opponents + 1);
                assert_eq!(game.command_zone.len(), if commander { opponents + 1 } else { 0 });
                for player in &game.players {
                    assert_eq!(player.life, if commander { 40 } else { 20 });
                    assert_eq!(player.library.len() + player.hand.len(), deck.len());
                }
                if opponents == 3 {
                    let start = host.state().unwrap();
                    assert_eq!(start.state["gameView"]["players"].as_array().unwrap().len(), 4);
                    let mut current = host.respond(ClientToServerMessage::Response {
                        prompt_id: start.prompt["promptId"].as_u64().unwrap() as u32,
                        action: PromptOutput::Mulligan(manabrew_compat::MulliganOutput::MulliganDecision { keep: true }),
                    }).unwrap();
                    for _ in 0..200 {
                        if host.session.as_ref().unwrap().game.turn_number >= 5 { break; }
                        let input = &current.prompt["input"];
                        let action = match input["type"].as_str() {
                            Some("chooseAction") => serde_json::json!({"type": "chooseAction", "output": {"type": "pass"}}),
                            Some("chooseCards") => serde_json::json!({"type": "chooseCards", "output": {
                                "type": "chooseCardsDecision", "chosenCardIds": input["cards"].as_array().unwrap().iter()
                                    .take(input["min"].as_u64().unwrap() as usize).map(|card| card["id"].clone()).collect::<Vec<_>>()
                            }}),
                            other => panic!("unexpected prompt: {other:?}"),
                        };
                        current = host.respond(serde_json::from_value(serde_json::json!({
                            "kind": "response", "promptId": current.prompt["promptId"], "action": action
                        })).unwrap()).unwrap();
                    }
                    assert!(host.session.as_ref().unwrap().game.turn_number >= 5);
                }
                let original = host.state().unwrap().prompt;
                let mut invalid = request.clone();
                invalid["humanDeck"] = serde_json::json!(["Plains"]);
                assert_eq!(host.start(serde_json::from_value(invalid).unwrap()).err().unwrap().0, StatusCode::BAD_REQUEST);
                assert_eq!(host.state().unwrap().prompt, original);
                let mut invalid = request;
                invalid["extraOpponents"] = serde_json::json!([
                    {"deck": deck}, {"deck": deck}, {"deck": deck}
                ]);
                assert!(host.start(serde_json::from_value(invalid).unwrap()).is_err());
            }
        }
    }).unwrap().join().unwrap();
}

#[test]
fn commander_draft_four_player_table_uses_minimum_sixty_decks() {
    std::thread::Builder::new().stack_size(16 * 1024 * 1024).spawn(|| {
        let db = CardDatabase::from_mtgjson(&std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../phase/data/mtgjson/test_fixture.json")).unwrap();
        let mut host = Host::new(db);
        // CR 903.13f(1): at least 60 cards including the commander. The wire
        // API keeps the commander out of the library, so 59 + 1.
        let deck: Vec<&str> = vec!["Plains"; 59];
        let commanders = vec!["Linden, the Steadfast Queen"];
        let request = serde_json::json!({
            "format": "commander_draft", "seed": 7,
            "humanDeck": deck, "aiDeck": deck,
            "humanCommanders": commanders, "aiCommanders": commanders,
            "extraOpponents": [
                {"deck": deck, "commanders": commanders},
                {"deck": deck, "commanders": commanders}
            ]
        });
        host.start(serde_json::from_value(request.clone()).unwrap()).unwrap();
        let game = &host.session.as_ref().unwrap().game;
        assert_eq!(game.players.len(), 4);
        assert_eq!(game.command_zone.len(), 4);
        for player in &game.players {
            assert_eq!(player.life, 40);
            assert_eq!(player.library.len() + player.hand.len(), 59);
        }
        // Fewer than 60 total is refused.
        let mut short = request;
        short["humanDeck"] = serde_json::json!(vec!["Plains"; 40]);
        assert!(host.start(serde_json::from_value(short).unwrap()).is_err());
    }).unwrap().join().unwrap();
}

#[test]
fn oathbreaker_table_splits_planeswalker_and_signature_spell() {
    std::thread::Builder::new().stack_size(16 * 1024 * 1024).spawn(|| {
        let db = CardDatabase::from_mtgjson(&std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../phase/data/mtgjson/test_fixture.json")).unwrap();
        let mut host = Host::new(db);
        // Oathbreaker RC: exactly 60 cards including the command-zone slots and
        // the signature spell, singleton, 20 life.
        let deck: Vec<&str> = vec!["Island"; 58];
        let command = vec!["Jace, the Mind Sculptor", "Brainstorm"];
        let request = serde_json::json!({
            "format": "oathbreaker", "seed": 11,
            "humanDeck": deck, "aiDeck": deck,
            "humanCommanders": command, "aiCommanders": command
        });
        let started = host.start(serde_json::from_value(request.clone()).unwrap());
        if let Err(err) = started {
            panic!("oathbreaker start rejected: {}", err.0);
        }
        let game = &host.session.as_ref().unwrap().game;
        assert_eq!(game.players.len(), 2);
        assert_eq!(game.players[0].life, 20);
        assert_eq!(game.players[0].library.len() + game.players[0].hand.len(), 58);
        // Both command-zone slots (Oathbreaker + signature spell) are live.
        assert!(!game.command_zone.is_empty());
        assert_eq!(game.command_zone.len() % 2, 0);
        // A non-planeswalker commander is refused.
        let mut bad = request;
        bad["humanCommanders"] = serde_json::json!(["Grizzly Bears", "Brainstorm"]);
        assert!(host.start(serde_json::from_value(bad).unwrap()).is_err());
    }).unwrap().join().unwrap();
}

#[test]
fn casual_constructed_formats_resolve_to_their_engine_configs() {
    use engine::types::format::DeckSizeRule;
    for (id, life, size) in [
        ("duel_commander", 30i32, 100u16),
        ("pauper_commander", 40, 100),
        ("tiny_leaders", 20, 50),
        ("oathbreaker", 20, 60),
        ("commander", 40, 100),
    ] {
        let (config, commander, fixed) = resolve_format(Some(id), 2, None).unwrap();
        assert_eq!(config.starting_life, life, "{id}");
        assert_eq!(config.deck_size, DeckSizeRule::Exactly(size), "{id}");
        assert!(commander, "{id} uses command slots");
        assert!(!fixed, "{id}");
    }
    // Momir supplies its own deck and takes no command slots.
    let (momir, commander, fixed) = resolve_format(Some("momir"), 2, None).unwrap();
    assert_eq!(momir.deck_size, DeckSizeRule::Exactly(60));
    assert!(!commander && fixed);
    // The two bundled retro presets resolve through the custom-format registry.
    for id in ["old_school_93_94", "old_school_95"] {
        let (config, commander, fixed) = resolve_format(Some(id), 2, None).unwrap();
        assert!(config.custom_rules.is_some(), "{id}");
        assert!(!commander && !fixed, "{id}");
    }
    let (limited, commander, fixed) = resolve_format(Some("sealed"), 2, None).unwrap();
    assert_eq!(limited.deck_size, DeckSizeRule::Minimum(40));
    assert!(!commander && !fixed);
    // Casual special tables resolve to their engine configs.
    let (archenemy, commander, fixed) = resolve_format(Some("archenemy"), 2, None).unwrap();
    assert!(archenemy.archenemy_player.is_some() && !commander && !fixed);
    let (planechase, commander, fixed) = resolve_format(Some("planechase"), 2, None).unwrap();
    assert_eq!(planechase.starting_life, 20);
    assert!(!commander && !fixed);
    let (two_headed, commander, fixed) = resolve_format(Some("two_headed_giant"), 4, None).unwrap();
    assert_eq!(two_headed.starting_life, 30);
    assert!(two_headed.team_based);
    assert!(!commander && !fixed);
    assert!(resolve_format(Some("not_a_format"), 2, None).is_err());
}

#[test]
fn casual_tables_start_tiny_leaders_duel_commander_and_momir() {
    std::thread::Builder::new().stack_size(16 * 1024 * 1024).spawn(|| {
        let db = CardDatabase::from_mtgjson(&std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../phase/data/mtgjson/test_fixture.json")).unwrap();
        let mut host = Host::new(db);
        let commander = vec!["Linden, the Steadfast Queen"];

        // Tiny Leaders: 50 cards total including the commander, 20 life.
        let tiny: Vec<&str> = vec!["Plains"; 49];
        host.start(serde_json::from_value(serde_json::json!({
            "format": "tiny_leaders", "seed": 3,
            "humanDeck": tiny, "aiDeck": tiny,
            "humanCommanders": commander, "aiCommanders": commander
        })).unwrap()).unwrap();
        {
            let game = &host.session.as_ref().unwrap().game;
            assert_eq!(game.players[0].life, 20);
            assert_eq!(game.players[0].library.len() + game.players[0].hand.len(), 49);
            assert!(!game.command_zone.is_empty());
        }

        // Duel Commander: 100 cards, 30 life.
        let duel: Vec<&str> = vec!["Plains"; 99];
        host.start(serde_json::from_value(serde_json::json!({
            "format": "duel_commander", "seed": 3,
            "humanDeck": duel, "aiDeck": duel,
            "humanCommanders": commander, "aiCommanders": commander
        })).unwrap()).unwrap();
        {
            let game = &host.session.as_ref().unwrap().game;
            assert_eq!(game.players[0].life, 30);
            assert_eq!(game.players[0].library.len() + game.players[0].hand.len(), 99);
        }
    }).unwrap().join().unwrap();
}

#[test]
fn momir_table_supplies_snow_basics_without_a_submitted_deck() {
    std::thread::Builder::new().stack_size(16 * 1024 * 1024).spawn(|| {
        // The shared fixture has no snow basics, so build the tiny database
        // Momir's fixed deck needs rather than skipping the end-to-end check.
        let mut data = serde_json::Map::new();
        for (name, color, subtype) in [
            ("Snow-Covered Plains", 'W', "Plains"),
            ("Snow-Covered Island", 'U', "Island"),
            ("Snow-Covered Swamp", 'B', "Swamp"),
            ("Snow-Covered Mountain", 'R', "Mountain"),
            ("Snow-Covered Forest", 'G', "Forest"),
        ] {
            data.insert(name.to_string(), serde_json::json!([{
                "name": name, "manaCost": "", "manaValue": 0.0,
                "colors": [], "colorIdentity": [color.to_string()],
                "types": ["Land"], "subtypes": [subtype],
                "supertypes": ["Basic", "Snow"],
                "text": format!("({{T}}: Add {{{color}}}.)"),
                "layout": "normal",
                "type": format!("Basic Snow Land — {subtype}"),
                "keywords": [],
                "identifiers": {"scryfallOracleId": format!("test-{subtype}")}
            }]));
        }
        let path = std::env::temp_dir().join(format!("pm-momir-{}.json", std::process::id()));
        std::fs::write(&path, serde_json::json!({
            "meta": {"date": "2026-03-01", "version": "5.3.0"}, "data": data
        }).to_string()).unwrap();
        let db = CardDatabase::from_mtgjson(&path).unwrap();
        let mut host = Host::new(db);
        host.start(serde_json::from_value(serde_json::json!({"format": "momir", "seed": 3})).unwrap()).unwrap();
        let game = &host.session.as_ref().unwrap().game;
        assert_eq!(game.players.len(), 2);
        for player in &game.players {
            assert_eq!(player.library.len() + player.hand.len(), 60);
        }
        assert!(game
            .players
            .iter()
            .flat_map(|p| p.library.iter().chain(p.hand.iter()))
            .all(|id| game.objects[id].name.contains("Snow-Covered")));
        let _ = std::fs::remove_file(&path);
    }).unwrap().join().unwrap();
}
