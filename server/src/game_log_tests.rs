use super::*;
use engine::types::events::GameEvent;

#[test]
fn public_projection_excludes_private_draw_diagnostics_and_bounds_history() {
    let game = GameState::new(FormatConfig::default_for_player_count(2), 2, 42);
    let mut log = GameLog::new();
    let private = GameEvent::CardsDrawn {
        player_id: PlayerId(1),
        count: 7,
    };
    assert!(!engine::game::log::resolve_log_entries(&[private.clone()], &game, &game).is_empty());
    log.capture(&game, &game, &[private]);
    assert!(
        log.rows.is_empty(),
        "hidden diagnostics are never transported"
    );
    for _ in 0..250 {
        log.capture(&game, &game, &[GameEvent::GameStarted]);
    }
    assert_eq!(log.rows.len(), 200);
    assert_eq!(log.rows.first().unwrap().seq, 51);
    assert_eq!(log.rows.last().unwrap().seq, 250);
    assert!(log.rows.iter().all(|row| row.message == "Game started"));
    let wire = serde_json::to_value(&log.rows[0]).unwrap();
    assert!(wire["timestampMs"].is_u64());
    assert_eq!(wire["entryType"], "info");
    assert!(wire["phase"].is_string());
}
