use super::*;

fn database() -> CardDatabase {
    CardDatabase::from_mtgjson(
        &std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../phase/data/mtgjson/test_fixture.json"),
    )
    .unwrap()
}
fn request() -> StartRequest {
    serde_json::from_value(serde_json::json!({
        "format": "commander", "seed": 42,
        "humanDeck": vec!["Plains"; 99], "aiDeck": vec!["Plains"; 99],
        "humanCommanders": ["Linden, the Steadfast Queen"],
        "aiCommanders": ["Linden, the Steadfast Queen"]
    }))
    .unwrap()
}
fn on_stack(test: fn()) {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(test)
        .unwrap()
        .join()
        .unwrap();
}
#[test]
fn commander_life_and_exclusive_zones() {
    on_stack(|| {
        let mut host = Host::new(database());
        host.start(request()).unwrap();
        let game = &host.session.as_ref().unwrap().game;
        assert_eq!(game.command_zone.len(), 2);
        for player in &game.players {
            assert_eq!(player.life, 40);
            assert_eq!(player.library.len() + player.hand.len(), 99);
            for id in &game.command_zone {
                assert!(!player.library.contains(id));
                assert!(!player.hand.contains(id));
            }
        }
    });
}
// Probe the adapter seam directly: no simulated death or engine return is
// claimed here. Both decisions must survive the generic interaction projection.
#[test]
fn commander_return_prompt_translates_both_choices() {
    on_stack(|| {
        use engine::types::zones::Zone;
        let mut host = Host::new(database());
        host.start(request()).unwrap();
        let mut game = host.session.as_ref().unwrap().game.clone();
        let commander_id = game.command_zone[0];
        game.waiting_for = WaitingFor::CommanderZoneChoice {
            player: HUMAN,
            commander_id,
            current_zone: Zone::Graveyard,
        };
        let (prepared, snap) = snapshot(&game, &host.db, 900, 0).unwrap();
        for index in 0..2 {
            let message = serde_json::from_value(serde_json::json!({
                "kind": "response", "promptId": 900,
                "action": {"type": "chooseFromSelection", "output": {
                    "type": "selectionDecision", "chosenIndices": [index]
                }}
            }))
            .unwrap();
            let action = translate_client_message(message, &prepared.prompt_context(), &game)
                .unwrap_or_else(|error| panic!("{error:?}; prompt: {}", snap.prompt));
            assert!(
                matches!(action, GameAction::DecideOptionalEffect { accept } if accept == (index == 0))
            );
        }
    });
}

#[test]
fn commander_boundary_rejections_preserve_session() {
    on_stack(|| {
        let mut host = Host::new(database());
        let original = host.start(request()).unwrap();
        let mut cases = Vec::new();
        let mut r = request();
        r.human_commanders.clear();
        cases.push(r);
        let mut r = request();
        r.ai_commanders = vec!["Grizzly Bears".into()];
        cases.push(r);
        let mut r = request();
        r.human_commanders = vec!["missing card".into()];
        cases.push(r);
        let mut r = request();
        r.ai_deck.as_mut().unwrap()[0] = "Forest".into();
        cases.push(r);
        let mut r = request();
        r.human_deck.as_mut().unwrap()[0] = "Linden, the Steadfast Queen".into();
        cases.push(r);
        let mut r = request();
        r.human_deck.as_mut().unwrap().pop();
        cases.push(r);
        let mut r = request();
        r.ai_deck = None;
        cases.push(r);
        let mut r = request();
        r.format = Some("brawl".into());
        cases.push(r);
        let mut r = request();
        r.format = Some("duelcommander".into());
        cases.push(r);
        let mut r = request();
        r.format = None;
        cases.push(r);
        let mut r = request();
        r.human_commanders
            .push("Linden, the Steadfast Queen".into());
        r.human_deck.as_mut().unwrap().pop();
        cases.push(r);
        for r in cases {
            let error = host
                .start(r)
                .err()
                .expect("invalid Commander request accepted");
            assert_eq!(error.0, StatusCode::BAD_REQUEST);
            assert_eq!(host.state().unwrap().prompt, original.prompt);
        }
    });
}

// Controlled fixture: skip opening turns and supply floating white mana. Everything
// under test (advertisement, cast, auto-payment, resolution, SBA and return choice)
// uses the real engine and the host's current prompt capability, not fabricated choices.
fn refresh(host: &mut Host) {
    let id = host.reserve_prompt().unwrap();
    let session = host.session.as_mut().unwrap();
    let (prepared, snap) = snapshot(&session.game, &host.db, id, 0).unwrap();
    session.prepared = prepared;
    session.snapshot = snap;
}
fn answer(host: &mut Host, action: Value) {
    let id = host.state().unwrap().prompt["promptId"].clone();
    host.respond(serde_json::from_value(serde_json::json!({
        "kind": "response", "promptId": id, "action": action
    })).unwrap()).unwrap();
}
fn fund_main(host: &mut Host, amount: usize) {
    use engine::types::{phase::Phase, mana::{ManaType, ManaUnit, ManaPipId}, identifiers::ObjectId};
    let game = &mut host.session.as_mut().unwrap().game;
    game.phase = Phase::PreCombatMain;
    game.active_player = HUMAN;
    game.priority_player = HUMAN;
    game.turn_number = 2;
    game.waiting_for = WaitingFor::Priority { player: HUMAN };
    let pool = &mut game.players[0].mana_pool;
    assert_eq!(pool.total(), 0);
    for _ in 0..amount {
        pool.add(ManaUnit { color: ManaType::White, source_id: ObjectId(0),
            pip_id: ManaPipId(0), supertype: None,
            source_could_produce_two_or_more_colors: false,
            restrictions: vec![], grants: vec![], expiry: None });
    }
    refresh(host);
}
fn cast_commander(host: &mut Host, id: engine::types::identifiers::ObjectId) {
    let prompt = host.state().unwrap().prompt;
    let card = format!("card-{}", id.0);
    let action = prompt["input"]["actions"].as_array().unwrap().iter()
        .find(|a| a["cardId"] == card).unwrap_or_else(|| panic!("No commander cast: {prompt}"));
    answer(host, serde_json::json!({"type":"chooseAction", "output":{
        "type":"act", "actionId":action["id"]
    }}));
}
#[test]
fn commander_cast_autopays_and_repeated_returns_increase_tax() {
    on_stack(|| {
        use engine::{game::{commander::commander_tax, sba::check_state_based_actions, zone_pipeline::{move_object_for_test, ZoneMoveRequest}}, types::zones::Zone};
        let mut host = Host::new(database());
        host.start(request()).unwrap();
        let id = host.session.as_ref().unwrap().game.command_zone.iter().copied()
            .find(|id| host.session.as_ref().unwrap().game.objects[id].owner == HUMAN).unwrap();
        for (cast, destination) in [Zone::Graveyard, Zone::Exile, Zone::Graveyard].into_iter().enumerate() {
            fund_main(&mut host, 3 + 2 * cast);
            assert_eq!(commander_tax(&host.session.as_ref().unwrap().game, id), 2 * cast as u32);
            cast_commander(&mut host, id);
            let game = &host.session.as_ref().unwrap().game;
            assert_eq!(game.objects[&id].zone, Zone::Stack);
            assert!(!game.command_zone.contains(&id));
            assert_eq!(game.players[0].mana_pool.total(), 0, "WWW plus tax auto-paid");
            assert_eq!(commander_tax(game, id), 2 * (cast as u32 + 1));
            answer(&mut host, serde_json::json!({"type":"chooseAction","output":{"type":"pass"}}));
            assert_eq!(host.session.as_ref().unwrap().game.objects[&id].zone, Zone::Battlefield);
            // Inject lethal marked damage (death must actually be processed by SBA),
            // or invoke the engine's zone transition as a resolving exile effect would.
            let game = &mut host.session.as_mut().unwrap().game;
            if destination == Zone::Graveyard {
                game.objects.get_mut(&id).unwrap().damage_marked = 100;
            } else {
                assert!(!move_object_for_test(game, ZoneMoveRequest::effect(id, Zone::Exile, id), &mut vec![]));
            }
            check_state_based_actions(game, &mut vec![]);
            assert_eq!(game.objects[&id].zone, destination);
            assert!(matches!(game.waiting_for, WaitingFor::CommanderZoneChoice { commander_id, current_zone, .. }
                if commander_id == id && current_zone == destination));
            refresh(&mut host);
            let accept = cast < 2;
            answer(&mut host, serde_json::json!({"type":"chooseFromSelection","output":{
                "type":"selectionDecision","chosenIndices":[if accept {0} else {1}]
            }}));
            let game = &host.session.as_ref().unwrap().game;
            assert_eq!(game.objects[&id].zone, if accept {Zone::Command} else {destination});
            assert_eq!(game.command_zone.contains(&id), accept);
            assert!(!matches!(game.waiting_for, WaitingFor::CommanderZoneChoice {..}));
        }
    });
}
