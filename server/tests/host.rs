use engine::database::CardDatabase;
use manabrew_compat::{ClientToServerMessage, MulliganOutput, PromptOutput};
use phase_mana_server::{Host, StartRequest};
use std::path::PathBuf;

fn database() -> CardDatabase {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../phase/data/mtgjson/test_fixture.json");
    CardDatabase::from_mtgjson(&path).expect("load real engine MTGJSON fixture")
}
fn keep(id: u32) -> ClientToServerMessage {
    ClientToServerMessage::Response {
        prompt_id: id,
        action: PromptOutput::Mulligan(MulliganOutput::MulliganDecision { keep: true }),
    }
}
fn prompt_id(snapshot: &phase_mana_server::Snapshot) -> u32 {
    snapshot.prompt["promptId"]
        .as_u64()
        .expect("AgentPrompt.promptId") as u32
}

fn on_engine_stack(test: fn()) {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(test)
        .unwrap()
        .join()
        .unwrap();
}

#[test]
fn start_runs_real_ai_and_preserves_cached_snapshot() {
    on_engine_stack(start_and_snapshot);
}

fn start_and_snapshot() {
    let mut host = Host::new(database());
    let started = host.start(StartRequest::default()).expect("start");
    assert!(
        started.ai_actions > 0,
        "phase-ai must answer AI's opening decision"
    );
    assert_eq!(started.human_player_id, "player-0");
    assert!(!started.log_session_id.is_empty());
    assert!(started.game_log.iter().any(|row| row.message == "Game started"));
    assert!(started.game_log.iter().all(|row| row.timestamp_ms > 0));
    assert!(!serde_json::to_string(&started.game_log).unwrap().contains("Grizzly Bears"), "opening private cards must not leak");
    assert_eq!(serde_json::to_value(&host.state().unwrap().game_log).unwrap(), serde_json::to_value(&started.game_log).unwrap());
    assert!(started.state["gameView"].is_object());
    assert_eq!(host.state().unwrap().prompt, started.prompt);
    let next = host
        .respond(keep(prompt_id(&started)))
        .expect("human keeps");
    assert_ne!(prompt_id(&started), prompt_id(&next));
    assert_eq!(started.log_session_id, next.log_session_id);
    assert!(next.game_log.last().unwrap().seq > started.game_log.last().unwrap().seq);
    assert!(next.game_log.windows(2).all(|rows| rows[1].seq == rows[0].seq + 1));
    assert_eq!(serde_json::to_value(&host.state().unwrap().game_log).unwrap(), serde_json::to_value(&next.game_log).unwrap());
    assert!(
        host.respond(keep(prompt_id(&started))).is_err(),
        "replay rejected"
    );
    assert_eq!(host.state().unwrap().prompt, next.prompt);
}

#[test]
fn human_passes_drive_ai_priority_and_turn_decisions() {
    on_engine_stack(drive_turns);
}

fn drive_turns() {
    let mut host = Host::new(database());
    let started = host.start(StartRequest::default()).unwrap();
    let mut current = host.respond(keep(prompt_id(&started))).unwrap();
    let mut ai_actions = current.ai_actions;
    for _ in 0..80 {
        if current.state["gameView"]["turn"].as_u64().unwrap() >= 3 {
            break;
        }
        let response = serde_json::from_value(serde_json::json!({
            "kind": "response", "promptId": prompt_id(&current),
            "action": {"type": "chooseAction", "output": {"type": "pass"}}
        }))
        .unwrap();
        current = host
            .respond(response)
            .expect("pass priority through engine/AI loop");
        ai_actions += current.ai_actions;
    }
    assert!(ai_actions > 0, "AI must make decisions beyond mulligan");
    assert!(current.game_log.iter().any(|row| row.turn >= 2));
    assert!(current.game_log.iter().any(|row| row.message.contains("plays") || row.message.contains("casts")), "real AI public actions must be logged");
    assert!(current.game_log.len() <= 200);
    assert!(current.game_log.windows(2).all(|rows| rows[1].seq == rows[0].seq + 1));
    assert!(current.state["gameView"]["turn"].as_u64().unwrap() >= 3);
}

#[test]
fn old_game_and_zero_prompt_ids_are_rejected() {
    on_engine_stack(stale_prompts);
}

fn stale_prompts() {
    let mut host = Host::new(database());
    let old = host.start(StartRequest::default()).unwrap();
    let current = host.start(StartRequest::default()).unwrap();
    assert_ne!(prompt_id(&old), prompt_id(&current));
    assert_ne!(old.log_session_id, current.log_session_id);
    assert_eq!(current.game_log.first().unwrap().seq, 1);
    assert!(host.respond(keep(prompt_id(&old))).is_err());
    assert!(host.respond(keep(0)).is_err());
    assert_eq!(host.state().unwrap().prompt, current.prompt);
}

#[test]
fn unknown_card_is_not_silently_dropped() {
    on_engine_stack(unknown_card);
}

fn unknown_card() {
    let mut host = Host::new(database());
    assert!(host
        .start(StartRequest {
            human_deck: Some(vec!["not a real card".into(); 60]),
            ..Default::default()
        })
        .is_err());
    assert!(host.state().is_err());
}

/// The empty-stack Pass and End Turn controls in the copied UI send
/// `pass` with a stop modifier. Compat rejects both modifiers as
/// non-single-action, so the host replays them; this is the exact payload
/// `usePromptEffects.unifiedPass` produces.
#[test]
fn ui_pass_until_payload_replays_real_priority_passes() {
    let mut host = Host::new(database());
    let started = host.start(StartRequest::default()).unwrap();
    let after_keep = host.respond(keep(prompt_id(&started))).unwrap();
    let response = serde_json::from_value(serde_json::json!({
        "kind": "response",
        "promptId": prompt_id(&after_keep),
        "action": {
            "type": "chooseAction",
            "output": {
                "type": "pass",
                // `throughCombat` is 5.11.1; the pinned 5.2.0 wire ignores it,
                // and the stop below is reached without it.
                "until": { "playerId": "player-0", "phase": "main1", "throughCombat": false },
                "exhaustStack": false
            }
        }
    }))
    .expect("UI pass payload deserializes");
    let skipped = host.respond(response).expect("skip is replayed");
    assert_eq!(skipped.state["gameView"]["step"], "main1");
    assert_eq!(skipped.state["gameView"]["activePlayerId"], "player-0");
    assert_eq!(
        skipped.prompt["input"]["type"], "chooseAction",
        "the replay must hand control back for the human's next decision"
    );
}

/// The CR 514.1 cleanup hand-size discard is served by the engine's generic
/// interaction projection, not by a hand-written compat family, so it only
/// renders while the engine's interaction authority is bound. An unbound host
/// answers this prompt with "Unsupported" instead, which is exactly the bug
/// this pins: pass (as the UI's autopass does) until the human's hand is too
/// big, and the snapshot must arrive as an answerable `chooseCards`.
#[test]
fn cleanup_hand_size_discard_is_served_and_answerable() {
    on_engine_stack(discard_to_hand_size);
}

fn discard_to_hand_size() {
    let mut host = Host::new(database());
    let started = host.start(StartRequest::default()).unwrap();
    let mut current = host.respond(keep(prompt_id(&started))).unwrap();
    let mut discarded = 0;
    for _ in 0..200 {
        match current.prompt["input"]["type"].as_str() {
            Some("chooseCards") => {
                let prompt = serde_json::json!({
                    "kind": "response",
                    "promptId": prompt_id(&current),
                    "action": {
                        "type": "chooseCards",
                        "output": {
                            "type": "chooseCardsDecision",
                            "chosenCardIds": current.prompt["input"]["cards"]
                                .as_array()
                                .expect("candidate cards")
                                .iter()
                                .take(current.prompt["input"]["min"].as_u64().expect("min") as usize)
                                .map(|card| card["id"].clone())
                                .collect::<Vec<_>>(),
                        }
                    }
                });
                current = host
                    .respond(serde_json::from_value(prompt).unwrap())
                    .expect("the hand-size discard is answerable");
                discarded += 1;
                break;
            }
            Some("chooseAction") => {
                let pass = serde_json::json!({
                    "kind": "response",
                    "promptId": prompt_id(&current),
                    "action": { "type": "chooseAction", "output": { "type": "pass" } }
                });
                current = host
                    .respond(serde_json::from_value(pass).unwrap())
                    .expect("plain priority pass");
            }
            other => panic!("unexpected prompt while passing: {other:?}"),
        }
    }
    assert_eq!(discarded, 1, "passing with a full hand must owe a discard");
    assert!(
        current.prompt["input"]["type"] == "chooseAction"
            || current.prompt["input"]["type"] == "chooseCards",
        "the discard must hand control back, not wedge: {:?}",
        current.prompt["input"]["type"]
    );
}

/// A skip bypasses compat's translation, so it has to enforce compat's
/// prompt-id rule itself.
#[test]
fn ui_skip_with_a_stale_prompt_id_is_rejected() {
    let mut host = Host::new(database());
    let started = host.start(StartRequest::default()).unwrap();
    let current = host.respond(keep(prompt_id(&started))).unwrap();
    let stale = serde_json::from_value(serde_json::json!({
        "kind": "response",
        "promptId": prompt_id(&started),
        "action": {
            "type": "chooseAction",
            "output": {
                "type": "pass",
                "until": { "playerId": "player-0", "phase": "main1" },
                "exhaustStack": false
            }
        }
    }))
    .unwrap();
    assert!(host.respond(stale).is_err());
    assert_eq!(host.state().unwrap().prompt, current.prompt);
}
