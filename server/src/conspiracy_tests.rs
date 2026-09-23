use super::*;

#[test]
fn double_agenda_start_validates_both_names_and_rematch_uses_fresh_choices() {
    std::thread::Builder::new().stack_size(16 * 1024 * 1024).spawn(|| {
        let db = CardDatabase::from_mtgjson(&std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../phase/data/mtgjson/test_fixture.json")).unwrap();
        let atomic = serde_json::from_value(serde_json::json!({
            "name": "Summoner's Bond", "colors": [], "colorIdentity": [], "layout": "normal",
            "type": "Conspiracy", "types": ["Conspiracy"], "manaValue": 0, "identifiers": {},
            "keywords": ["Double agenda", "Hidden agenda"],
            "text": "Double agenda (Start the game with this conspiracy face down in the command zone and secretly choose two different card names. You may turn this conspiracy face up any time and reveal those names.)\nWhenever you cast a creature spell with one of the chosen names, you may search your library for a creature card with the other chosen name, reveal it, put it into your hand, then shuffle."
        })).unwrap();
        let face = engine::database::synthesis::build_oracle_face(&atomic, None);
        assert_eq!(face.triggers.len(), 1);
        let mut export: serde_json::Value = serde_json::from_str(&db.export_subset_json(
            &["Plains".to_string(), "Island".to_string(), "Forest".to_string()].into_iter().collect(),
        )).unwrap();
        export["summoner's bond"] = serde_json::to_value(face).unwrap();
        let mut host = Host::new(CardDatabase::from_json_str(&export.to_string()).unwrap());
        assert_eq!(conspiracy_name_count(&host.db, "Summoner's Bond").unwrap(), 2);
        let mut request = serde_json::json!({
            "humanDeck": vec!["Plains"; 60], "aiDeck": vec!["Plains"; 60],
            "humanConspiracies": ["Summoner's Bond"],
        });
        assert!(host.start(serde_json::from_value(request.clone()).unwrap()).is_err());
        for names in [["Plains", "Island"], ["Island", "Forest"]] {
            let choices: Vec<_> = names.iter().map(|name| engine::types::ability::ChosenAttribute::CardName((*name).into())).collect();
            request["conspiracyChoices"] = serde_json::to_value(vec![ConspiracyChoice { player: HUMAN, index: 0, choices: choices.clone() }]).unwrap();
            host.start(serde_json::from_value(request.clone()).unwrap()).unwrap();
            let game = &host.session.as_ref().unwrap().game;
            let id = game.command_zone[0];
            assert_eq!(game.objects[&id].chosen_attributes, choices);
            assert!(game.objects[&id].face_down);
            assert!(engine::game::visibility::filter_state_for_viewer(game, PlayerId(1)).objects[&id].chosen_attributes.is_empty());
        }
        request["conspiracyChoices"][0]["choices"][1] = request["conspiracyChoices"][0]["choices"][0].clone();
        assert!(host.start(serde_json::from_value(request).unwrap()).is_err());
        let game = &host.session.as_ref().unwrap().game;
        assert_eq!(game.objects[&game.command_zone[0]].chosen_attributes, vec![
            engine::types::ability::ChosenAttribute::CardName("Island".into()),
            engine::types::ability::ChosenAttribute::CardName("Forest".into()),
        ]);
    }).unwrap().join().unwrap();
}

#[test]
fn immediate_action_only_grants_haste_to_the_owners_chosen_name_after_reveal() {
    use engine::game::{conspiracy, game_object::GameObject, layers};
    use engine::types::{ability::ChosenAttribute, identifiers::{CardId, ObjectId}, keywords::Keyword, zones::Zone};
    let mut game = GameState::new_two_player(7);
    let parsed = engine::parser::parse_oracle_text(
        "Hidden agenda (Start the game with this conspiracy face down in the command zone and secretly choose a card name. You may turn this conspiracy face up any time and reveal that name.)\nCreatures you control with the chosen name have haste.",
        "Immediate Action", &["Hidden agenda".into()], &["Conspiracy".into()], &[],
    );
    assert!(!parsed.statics.is_empty());
    let mut face = engine::types::card::CardFace::default();
    face.card_type.core_types = vec![CoreType::Conspiracy];
    face.static_abilities = parsed.statics;
    engine::database::synthesis::synthesize_conspiracy(&mut face);
    let agenda = ObjectId(100);
    let mut source = GameObject::new(agenda, CardId(100), HUMAN, "Immediate Action".into(), Zone::Command);
    source.card_types = face.card_type.clone();
    source.base_card_types = face.card_type;
    source.static_definitions = face.static_abilities.into();
    source.chosen_attributes.push(ChosenAttribute::CardName("Grizzly Bears".into()));
    game.objects.insert(agenda, source);
    conspiracy::start_with_conspiracy(&mut game, agenda, true);
    for (index, (owner, name)) in [(HUMAN, "Grizzly Bears"), (HUMAN, "Runeclaw Bear"), (PlayerId(1), "Grizzly Bears")].into_iter().enumerate() {
        let id = ObjectId(101 + index as u64);
        let mut creature = GameObject::new(id, CardId(id.0), owner, name.into(), Zone::Battlefield);
        creature.card_types.core_types.push(CoreType::Creature);
        creature.base_card_types = creature.card_types.clone();
        game.objects.insert(id, creature);
        game.battlefield.push_back(id);
    }
    layers::evaluate_layers(&mut game);
    assert!(!game.objects[&ObjectId(101)].has_keyword(&Keyword::Haste));
    assert!(conspiracy::turn_hidden_agenda_face_up(&mut game, agenda, HUMAN));
    layers::evaluate_layers(&mut game);
    assert!(game.objects[&ObjectId(101)].has_keyword(&Keyword::Haste));
    assert!(!game.objects[&ObjectId(102)].has_keyword(&Keyword::Haste));
    assert!(!game.objects[&ObjectId(103)].has_keyword(&Keyword::Haste));
}


#[test]
fn reveal_checks_prompt_priority_zone_and_ownership_transactionally() {
    std::thread::Builder::new().stack_size(16 * 1024 * 1024).spawn(|| {
        let db = CardDatabase::from_mtgjson(
            &std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../phase/data/mtgjson/test_fixture.json"),
        ).unwrap();
        // Synthetic face isolates the host boundary; no real card text is altered.
        let mut face = db.get_face_by_name("Plains").unwrap().clone();
        face.name = "Test hidden agenda".into();
        face.card_type.core_types = vec![CoreType::Conspiracy];
        face.oracle_text = Some("Hidden agenda".into());
        let mut export: serde_json::Value = serde_json::from_str(
            &db.export_subset_json(&["Plains".to_string()].into_iter().collect()),
        ).unwrap();
        export["test hidden agenda"] = serde_json::to_value(&face).unwrap();
        let mut visible = face.clone();
        visible.name = "Test visible agenda".into();
        visible.oracle_text = Some(String::new());
        export["test visible agenda"] = serde_json::to_value(&visible).unwrap();
        let mut host = Host::new(CardDatabase::from_json_str(&export.to_string()).unwrap());
        let mut request = serde_json::json!({
            "humanDeck": vec!["Plains"; 60], "aiDeck": vec!["Plains"; 60],
            "humanConspiracies": ["Test hidden agenda", "Test visible agenda", "Test hidden agenda"],
        });
        assert!(host.start(serde_json::from_value(request.clone()).unwrap()).is_err());
        request["conspiracyChoices"] = serde_json::to_value(vec![ConspiracyChoice {
            player: HUMAN, index: 0,
            choices: vec![engine::types::ability::ChosenAttribute::CardName("Plains".into())],
        }, ConspiracyChoice {
            player: HUMAN, index: 2,
            choices: vec![engine::types::ability::ChosenAttribute::CardName("Test visible agenda".into())],
        }]).unwrap();
        host.start(serde_json::from_value(request).unwrap()).unwrap();
        let session = host.session.as_mut().unwrap();
        let id = *session.game.command_zone.iter().find(|id| {
            session.game.objects[id].name == "Test hidden agenda"
        }).unwrap();
        assert_eq!(session.game.objects[&id].chosen_card_name(), Some("Plains"));
        let command: Vec<_> = session.game.command_zone.iter().map(|id| &session.game.objects[id]).collect();
        assert_eq!(command[1].name, "Test visible agenda");
        assert_eq!(command[2].chosen_card_name(), Some("Test visible agenda"));
        let wire = manabrew_compat::encode_object_id(id);
        let prompt = session.prepared.prompt_id;
        assert!(host.reveal_conspiracy(&wire, prompt + 1).is_err());
        assert!(host.reveal_conspiracy(&wire, prompt).is_err()); // still mulligan
        let game = &mut host.session.as_mut().unwrap().game;
        game.waiting_for = WaitingFor::Priority { player: HUMAN };
        game.priority_player = HUMAN;
        game.objects.get_mut(&id).unwrap().owner = PlayerId(1);
        assert!(host.reveal_conspiracy(&wire, prompt).is_err());
        let game = &mut host.session.as_mut().unwrap().game;
        game.objects.get_mut(&id).unwrap().owner = HUMAN;
        game.objects.get_mut(&id).unwrap().zone = engine::types::zones::Zone::Graveyard;
        assert!(host.reveal_conspiracy(&wire, prompt).is_err());
        let game = &mut host.session.as_mut().unwrap().game;
        assert!(game.objects[&id].face_down);
        game.objects.get_mut(&id).unwrap().zone = engine::types::zones::Zone::Command;
        game.objects.get_mut(&id).unwrap().chosen_attributes.clear();
        assert!(host.reveal_conspiracy(&wire, prompt).is_err()); // no pregame name
        let game = &mut host.session.as_mut().unwrap().game;
        game.objects.get_mut(&id).unwrap().chosen_attributes = vec![
            engine::types::ability::ChosenAttribute::CardName("Plains".into()),
        ];
        let opponent_view = engine::game::visibility::filter_state_for_viewer(game, PlayerId(1));
        assert!(opponent_view.objects[&id].chosen_attributes.is_empty());
        assert_ne!(opponent_view.objects[&id].name, "Test hidden agenda");
        let owner_view = engine::game::visibility::filter_state_for_viewer(game, HUMAN);
        assert_eq!(owner_view.objects[&id].chosen_card_name(), Some("Plains"));
        if let Some(session_id) = game.interaction_session_id.clone() {
            bind_interaction_authority(game, session_id).unwrap();
        }
        assert!(engine::ai_support::legal_actions(game).contains(&GameAction::TurnFaceUp { object_id: id, x: 0 }));
        let (_, offered) = snapshot(game, &host.db, prompt, 0).unwrap();
        assert!(serde_json::to_string(&offered).unwrap().contains("Reveal hidden agenda"));
        host.reveal_conspiracy(&wire, prompt).unwrap();
        assert!(!host.session.as_ref().unwrap().game.objects[&id].face_down);
        assert!(host.reveal_conspiracy(&wire, prompt).is_err());
    }).unwrap().join().unwrap();
}
