//! Isolated, local two-seat AI matches. No session writes, broker, or LLM.
use super::*;
use phase_ai::{auto_play::run_ai_actions_bounded, config::ACCEPTED_DIFFICULTY_LABELS};
use std::time::{Duration, Instant};

const MAX_ACTIONS: usize = 10_000;
const MAX_RUNTIME: Duration = Duration::from_secs(60);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SimulateRequest {
    format: String,
    players: [Seat; 2],
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Seat {
    deck: Vec<String>,
    #[serde(default)]
    commanders: Vec<String>,
    difficulty: String,
}

#[derive(Debug, Serialize)]
pub(super) struct Outcome {
    winner: Option<u8>,
    draw: bool,
    turns: u32,
    actions: usize,
}

pub(super) async fn simulate(
    State(host): State<SharedHost>,
    Json(request): Json<SimulateRequest>,
) -> Result<Json<Outcome>, HostError> {
    blocking(host, move |host| run(host, request)).await
}

fn prepare(
    host: &Host,
    request: SimulateRequest,
) -> Result<(GameState, HashMap<PlayerId, AiConfig>, u64), HostError> {
    let mut configs = HashMap::new();
    for (index, seat) in request.players.iter().enumerate() {
        if !ACCEPTED_DIFFICULTY_LABELS
            .iter()
            .any(|label| label.eq_ignore_ascii_case(seat.difficulty.trim()))
        {
            return Err(bad(format!(
                "Player {index}: invalid difficulty; expected {}",
                ACCEPTED_DIFFICULTY_LABELS.join(", ")
            )));
        }
        // Even formats with generated libraries must not silently discard malformed input.
        if !(7..=250).contains(&seat.deck.len()) || seat.commanders.len() > 2 {
            return Err(bad(format!(
                "Player {index}: deck requires 7–250 names and at most two commanders"
            )));
        }
        for name in seat.deck.iter().chain(&seat.commanders) {
            if !is_card_playable(&host.db, name) {
                return Err(bad(format!("Player {index}: cannot play {name}")));
            }
        }
        configs.insert(
            PlayerId(index as u8),
            create_config(AiDifficulty::from_label(&seat.difficulty), Platform::Native),
        );
    }
    let [first, second] = request.players;
    let seed = rand::rng().random::<u64>();
    let prepared = host.prepare_game(StartRequest {
        format: Some(request.format),
        seed: Some(seed),
        human_deck: Some(first.deck),
        ai_deck: Some(second.deck),
        human_commanders: first.commanders,
        ai_commanders: second.commanders,
        ..Default::default()
    })?;
    Ok((prepared.game, configs, seed))
}

fn run(host: &Host, request: SimulateRequest) -> Result<Outcome, HostError> {
    let (mut game, configs, seed) = prepare(host, request)?;
    drive(&mut game, &configs, seed, MAX_ACTIONS, MAX_RUNTIME)
}

fn drive(
    game: &mut GameState,
    configs: &HashMap<PlayerId, AiConfig>,
    seed: u64,
    max_actions: usize,
    runtime: Duration,
) -> Result<Outcome, HostError> {
    let players = configs.keys().copied().collect();
    let session = AiSession::arc_from_game(game);
    let mut rng = StdRng::seed_from_u64(seed);
    let started = Instant::now();
    let mut actions = 0;
    loop {
        if let WaitingFor::GameOver { winner } = game.waiting_for {
            return Ok(Outcome {
                winner: winner.map(|id| id.0),
                draw: winner.is_none(),
                turns: game.turn_number,
                actions,
            });
        }
        if actions >= max_actions || started.elapsed() >= runtime {
            return Err(internal(format!(
                "Tournament simulation budget exceeded after {actions} actions and {} turns",
                game.turn_number
            )));
        }
        // A single action per batch bounds retained snapshots and lets us check the
        // deadline between AI decisions. An in-flight engine/search call cannot
        // be preempted; this is a cooperative, not a hard process timeout.
        let result = run_ai_actions_bounded(game, &players, configs, &mut rng, &session, 1);
        actions += result.results.len();
        if matches!(game.waiting_for, WaitingFor::GameOver { .. }) {
            continue;
        }
        if result.results.is_empty()
            || !matches!(result.stop, AiActionsStop::ActionBudgetReached { .. })
        {
            return Err(internal(format!(
                "Tournament simulation stalled after {actions} actions: {:?}",
                result.stop
            )));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> SimulateRequest {
        serde_json::from_value(serde_json::json!({"format":"casual", "players":[
            {"deck":vec!["Plains"; 7],"difficulty":"VeryEasy"},
            {"deck":vec!["Plains"; 7],"difficulty":"Easy"}
        ]}))
        .unwrap()
    }
    #[test]
    fn fixture_validation_simulation_and_budgets() {
        std::thread::Builder::new()
            .stack_size(16 * 1024 * 1024)
            .spawn(|| {
                let db = CardDatabase::from_mtgjson(
                    &std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("../../phase/data/mtgjson/test_fixture.json"),
                )
                .unwrap();
                let mut host = Host::new(db);
                host.start(StartRequest {
                    human_deck: Some(vec!["Plains".into(); 40]),
                    ai_deck: Some(vec!["Plains".into(); 40]),
                    ..Default::default()
                })
                .unwrap();
                let prompt = host.next_prompt;
                let snapshot = serde_json::to_value(host.state().unwrap()).unwrap();
                let mut invalid = request();
                invalid.players[0].difficulty = "random".into();
                assert_eq!(
                    prepare(&host, invalid).err().unwrap().0,
                    StatusCode::BAD_REQUEST
                );
                let mut invalid = request();
                invalid.players[0].deck[0] = "not a card".into();
                assert!(prepare(&host, invalid).is_err());
                let mut invalid = request();
                invalid.format = "bogus".into();
                assert!(prepare(&host, invalid).is_err());
                let mut invalid = request();
                invalid.players[0].commanders.push("Plains".into());
                assert!(prepare(&host, invalid).is_err());
                let mut invalid = request();
                invalid.players[0].deck.clear();
                assert!(prepare(&host, invalid).is_err());
                let (mut game, configs, seed) = prepare(&host, request()).unwrap();
                assert_eq!(configs[&PlayerId(0)].difficulty, AiDifficulty::VeryEasy);
                assert_eq!(configs[&PlayerId(1)].difficulty, AiDifficulty::Easy);
                assert!(drive(&mut game, &configs, seed, 0, MAX_RUNTIME)
                    .unwrap_err()
                    .1
                    .contains("budget exceeded"));
                assert!(
                    drive(&mut game, &configs, seed, MAX_ACTIONS, Duration::ZERO)
                        .unwrap_err()
                        .1
                        .contains("budget exceeded")
                );
                assert!(drive(
                    &mut game.clone(),
                    &HashMap::new(),
                    seed,
                    MAX_ACTIONS,
                    MAX_RUNTIME
                )
                .unwrap_err()
                .1
                .contains("stalled"));
                let outcome = drive(&mut game, &configs, seed, MAX_ACTIONS, MAX_RUNTIME).unwrap();
                assert!(outcome.winner == Some(0) || outcome.winner == Some(1));
                assert!(!outcome.draw);
                assert!(outcome.actions > 0);
                // Have the engine produce a simultaneous-loss draw on a real loaded
                // fixture, rather than assigning a synthetic terminal result.
                let (mut drawn_game, _, _) = prepare(&host, request()).unwrap();
                for player in &mut drawn_game.players {
                    player.life = 0;
                }
                engine::game::sba::check_state_based_actions(&mut drawn_game, &mut Vec::new());
                assert!(matches!(
                    drawn_game.waiting_for,
                    WaitingFor::GameOver { winner: None }
                ));
                let draw = drive(&mut drawn_game, &configs, seed, 0, Duration::ZERO).unwrap();
                assert!(draw.draw);
                assert_eq!(draw.winner, None);
                assert_eq!(host.next_prompt, prompt);
                assert_eq!(
                    serde_json::to_value(host.state().unwrap()).unwrap(),
                    snapshot
                );
            })
            .unwrap()
            .join()
            .unwrap();
    }
}
