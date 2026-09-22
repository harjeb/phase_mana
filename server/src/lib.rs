//! Local single-session transport; all decisions and rules belong to phase crates.
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use engine::{
    database::{is_card_playable, CardDatabase},
    game::{
        coverage::card_face_gaps,
        deck_loading::{load_and_hydrate_decks, resolve_deck_list, DeckList, PlayerDeckList},
        deck_validation::validate_name_deck_for_format_full,
        engine::{apply, start_game},
        interaction::bind_interaction_authority,
    },
    types::{
        actions::GameAction,
        format::FormatConfig,
        game_state::{GameState, WaitingFor},
        interaction::InteractionSessionId,
        player::PlayerId,
    },
};
use manabrew_compat::{
    build_prompt, build_state_update, prepare_snapshot_with_prompt_id, translate_client_message,
    AdapterError, ClientToServerMessage, PreparedManabrewSnapshot, PromptOutput,
};
use manabrew_protocol::prompts::{
    ChooseActionOutput, PassUntil, PromptOutput as UpstreamPromptOutput,
};
use phase_ai::{
    auto_play::{run_ai_actions, AiActionsStop},
    config::AiConfig,
    session::AiSession,
};
use rand::{rngs::StdRng, Rng, SeedableRng};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[cfg(test)]
mod commander_tests;

const HUMAN: PlayerId = PlayerId(0);
const AI: PlayerId = PlayerId(1);

/// Upper bound on the priority passes one skip request may replay.
///
/// A stop the engine can no longer reach — a step already behind us, or one
/// this turn never enters — has to terminate somewhere, and the honest end
/// state is the current prompt, not a spin.
const MAX_SKIP_PASSES: usize = 256;

/// A protocol `pass` carrying a skip modifier.
///
/// `until` names the stop the client is skipping to; `exhaustStack` means
/// "pass until the stack empties". ManaBrew's own hosts replay both; compat
/// rejects them because neither maps onto a single engine action.
#[derive(Clone)]
struct SkipRequest {
    until: Option<PassUntil>,
    exhaust_stack: bool,
}

/// Read a skip out of a response without translating it.
fn skip_request(message: &ClientToServerMessage) -> Option<(u32, SkipRequest)> {
    let ClientToServerMessage::Response { prompt_id, action } = message else {
        return None;
    };
    let PromptOutput::Upstream(UpstreamPromptOutput::ChooseAction(ChooseActionOutput::Pass {
        until,
        exhaust_stack,
    })) = action
    else {
        return None;
    };
    if until.is_none() && !*exhaust_stack {
        return None;
    }
    Some((
        *prompt_id,
        SkipRequest {
            until: until.clone(),
            exhaust_stack: *exhaust_stack,
        },
    ))
}

/// Bind the engine's interaction authority for this game.
///
/// `GameState::new` leaves `interaction_session_id` unset, and while it is
/// unset `derive_viewer_interaction` reports `AuthorityUnbound` and returns no
/// opportunities — so every prompt served by the engine's generic interaction
/// projection (the CR 514.1 cleanup hand-size discard, for one) goes dark,
/// while the families compat builds by hand keep working. Phase's own
/// `engine-wasm` host binds exactly this way: a fresh random id per game, never
/// one carried by a restored snapshot, because the id namespaces every minted
/// `InteractionId` and re-binding the same session deliberately keeps the
/// counters.
fn bind_interaction_session(game: &mut GameState) {
    let session = InteractionSessionId(format!("phase-mana-{:016x}", rand::rng().random::<u64>()));
    if let Err(error) = bind_interaction_authority(game, session) {
        // Decimal-serial exhaustion is the only failure; the same
        // `debug_assert` discipline phase's own callers use.
        debug_assert!(false, "interaction authority bind failed: {error:?}");
    }
}

/// CR 117.3d: only a plain priority point may be passed automatically.
fn human_holds_priority(game: &GameState) -> bool {
    matches!(game.waiting_for, WaitingFor::Priority { player } if player == HUMAN)
}

#[derive(Debug)]
pub struct HostError(pub StatusCode, pub String);
impl IntoResponse for HostError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({"error": self.1}))).into_response()
    }
}
fn bad(message: impl Into<String>) -> HostError {
    HostError(StatusCode::BAD_REQUEST, message.into())
}
fn internal(message: impl Into<String>) -> HostError {
    HostError(StatusCode::UNPROCESSABLE_ENTITY, message.into())
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartRequest {
    pub seed: Option<u64>,
    pub format: Option<String>,
    #[serde(default)]
    pub human_commanders: Vec<String>,
    #[serde(default)]
    pub ai_commanders: Vec<String>,
    pub human_deck: Option<Vec<String>>,
    pub ai_deck: Option<Vec<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Exactly compat's StateUpdate, including its gameView wrapper.
    pub state: Value,
    /// Exactly compat's extension-aware AgentPrompt, not upstream PromptInput.
    pub prompt: Value,
    pub human_player_id: String,
    pub ai_actions: usize,
}

struct Session {
    game: GameState,
    prepared: PreparedManabrewSnapshot,
    snapshot: Snapshot,
    ai_session: Arc<AiSession>,
    rng: StdRng,
}

pub struct Host {
    db: Arc<CardDatabase>,
    session: Option<Session>,
    next_prompt: u32,
}

impl Host {
    pub fn new(db: CardDatabase) -> Self {
        Self {
            db: Arc::new(db),
            session: None,
            next_prompt: 1,
        }
    }

    fn reserve_prompt(&mut self) -> Result<u32, HostError> {
        let id = self.next_prompt;
        self.next_prompt = id
            .checked_add(1)
            .ok_or_else(|| internal("Prompt ID space exhausted; restart host"))?;
        Ok(id)
    }

    pub fn start(&mut self, request: StartRequest) -> Result<Snapshot, HostError> {
        let commander = match request.format.as_deref() {
            Some("commander") => true,
            None
            | Some(
                "standard" | "modern" | "legacy" | "vintage" | "pioneer" | "pauper" | "historic"
                | "explorer" | "timeless" | "premodern" | "casual",
            ) => false,
            Some(format) => return Err(bad(format!("Unsupported format: {format}"))),
        };
        if !commander && (!request.human_commanders.is_empty() || !request.ai_commanders.is_empty())
        {
            return Err(bad("Commander slots require format: commander"));
        }
        if commander && (request.human_deck.is_none() || request.ai_deck.is_none()) {
            return Err(bad(
                "Commander requires explicit humanDeck and aiDeck main decks",
            ));
        }
        let human = request.human_deck.unwrap_or_else(preset_deck);
        let ai = request.ai_deck.unwrap_or_else(preset_deck);
        for (label, deck, commanders) in [
            ("Human", &human, &request.human_commanders),
            ("AI", &ai, &request.ai_commanders),
        ] {
            if !(7..=250).contains(&deck.len()) {
                return Err(bad("Deck must contain 7–250 names (one entry per copy)"));
            }
            if commanders.len() > 2 {
                return Err(bad(format!(
                    "{label}: at most two commanders are supported"
                )));
            }
            for name in deck.iter().chain(commanders) {
                if !is_card_playable(&self.db, name) {
                    // The engine's own list of what it has not implemented is the
                    // only useful thing to say about a card it refuses to run.
                    let reason = match self.db.get_face_by_name(name) {
                        None => "not in the card database".to_string(),
                        Some(face) => format!(
                            "the engine has not implemented {}",
                            card_face_gaps(face).join("; ")
                        ),
                    };
                    return Err(bad(format!("Cannot play {name}: {reason}")));
                }
            }
        }
        if commander {
            for (label, deck, commanders) in [
                ("Human", &human, &request.human_commanders),
                ("AI", &ai, &request.ai_commanders),
            ] {
                // This wire API uses exclusive slots. The engine also accepts
                // inclusive decklists; the raw count prevents that convention
                // from silently changing the submitted library here.
                if deck.len() + commanders.len() != 100 {
                    return Err(bad(format!("{label}: main deck plus commanders must contain exactly 100 cards; main deck excludes commanders")));
                }
                validate_name_deck_for_format_full(
                    &self.db,
                    deck,
                    &[],
                    commanders,
                    &[],
                    &[],
                    &[],
                    &[],
                    &[],
                    &FormatConfig::commander(),
                    None,
                    2,
                )
                .map_err(|reasons| bad(format!("{label}: {}", reasons.join("; "))))?;
            }
        }
        let list = DeckList {
            player: PlayerDeckList {
                main_deck: human,
                commander: request.human_commanders,
                ..Default::default()
            },
            opponent: PlayerDeckList {
                main_deck: ai,
                commander: request.ai_commanders,
                ..Default::default()
            },
            ..Default::default()
        };
        let seed = request.seed.unwrap_or(42);
        let mut game = if commander {
            GameState::new(FormatConfig::commander(), 2, seed)
        } else {
            GameState::new_two_player(seed)
        };
        let payload = resolve_deck_list(&self.db, &list);
        load_and_hydrate_decks(&mut game, &payload, Some(&self.db));
        start_game(&mut game);
        bind_interaction_session(&mut game);
        let ai_session = AiSession::arc_from_game(&game);
        let mut rng = StdRng::seed_from_u64(seed);
        let ai_actions = advance_ai(&mut game, &mut rng, &ai_session)?;
        let id = self.reserve_prompt()?;
        let (prepared, snapshot) = snapshot(&game, &self.db, id, ai_actions)?;
        self.session = Some(Session {
            game,
            prepared,
            snapshot: snapshot.clone(),
            ai_session,
            rng,
        });
        Ok(snapshot)
    }

    pub fn state(&self) -> Result<Snapshot, HostError> {
        self.session
            .as_ref()
            .map(|s| s.snapshot.clone())
            .ok_or_else(|| {
                HostError(
                    StatusCode::CONFLICT,
                    "No session; POST /api/start first".into(),
                )
            })
    }

    pub fn respond(&mut self, message: ClientToServerMessage) -> Result<Snapshot, HostError> {
        // Transactional: failed translation, engine rejection, unsupported prompt or
        // AI stall cannot consume the previously advertised human capability.
        let session = self.session.as_ref().ok_or_else(|| bad("No session"))?;
        let skip = skip_request(&message);
        let action = match &skip {
            // A skip is not one engine action, so it bypasses compat's
            // translation — but not its prompt-id check, which a replay has to
            // pass exactly like a translated response.
            Some((prompt_id, _)) => {
                if *prompt_id != session.prepared.prompt_id {
                    return Err(HostError(
                        StatusCode::CONFLICT,
                        format!(
                            "{:?}",
                            manabrew_compat::AdapterError::PromptIdMismatch {
                                expected: session.prepared.prompt_id,
                                actual: *prompt_id,
                            }
                        ),
                    ));
                }
                GameAction::PassPriority
            }
            None => {
                translate_client_message(message, &session.prepared.prompt_context(), &session.game)
                    .map_err(|e| HostError(StatusCode::CONFLICT, format!("{e:?}")))?
            }
        };
        let mut game = session.game.clone();
        let mut rng = session.rng.clone();
        let ai_session = Arc::clone(&session.ai_session);
        apply(&mut game, HUMAN, action)
            .map_err(|e| bad(format!("Engine rejected response: {e:?}")))?;
        let mut ai_actions = advance_ai(&mut game, &mut rng, &ai_session)?;
        if let Some((_, skip)) = &skip {
            ai_actions += self.replay_skip(&mut game, &mut rng, &ai_session, skip)?;
        }
        let id = self.reserve_prompt()?;
        let (prepared, snapshot) = snapshot(&game, &self.db, id, ai_actions)?;
        self.session = Some(Session {
            game,
            prepared,
            snapshot: snapshot.clone(),
            ai_session,
            rng,
        });
        Ok(snapshot)
    }

    /// Replay a client skip as the real priority passes it stands for.
    ///
    /// CR 117.3d + CR 500.2: passing priority is a real player action, so every
    /// replayed pass goes through `apply` and triggers, state-based actions and
    /// the AI's own responses run exactly as they would if the client clicked
    /// Pass again. Control returns the moment the human owes anything other
    /// than a plain priority pass (CR 117.3d — a target, attackers, blockers or
    /// a mulligan keeps its own prompt), so no decision is ever answered for
    /// them. A pass the engine rejects aborts the replay rather than being
    /// skipped over.
    fn replay_skip(
        &mut self,
        game: &mut GameState,
        rng: &mut StdRng,
        ai: &Arc<AiSession>,
        skip: &SkipRequest,
    ) -> Result<usize, HostError> {
        let mut ai_actions = 0;
        for _ in 0..MAX_SKIP_PASSES {
            if !human_holds_priority(game) || self.skip_reached(game, skip)? {
                break;
            }
            apply(game, HUMAN, GameAction::PassPriority)
                .map_err(|e| bad(format!("Engine rejected replayed pass: {e:?}")))?;
            ai_actions += advance_ai(game, rng, ai)?;
        }
        Ok(ai_actions)
    }

    /// Has the game reached the stop the client asked to skip to?
    ///
    /// The position is read back through compat's own view builder, so the stop
    /// means exactly what the client measured when it computed it
    /// (`GameViewDto::step` / `active_player_id`) — no second phase mapping to
    /// drift from the first.
    fn skip_reached(&self, game: &GameState, skip: &SkipRequest) -> Result<bool, HostError> {
        if let Some(until) = &skip.until {
            let prepared = prepare_snapshot_with_prompt_id(game, HUMAN, "local", self.next_prompt)
                .map_err(|e| internal(format!("Snapshot unsupported: {e:?}")))?;
            let view = manabrew_compat::build_game_view(&prepared, &*self.db)
                .map_err(|e| internal(format!("State unsupported: {e:?}")))?;
            if view.active_player_id == until.player_id && view.step == until.phase {
                return Ok(true);
            }
        }
        Ok(skip.exhaust_stack && game.stack.is_empty())
    }
}

fn advance_ai(
    game: &mut GameState,
    rng: &mut StdRng,
    session: &Arc<AiSession>,
) -> Result<usize, HostError> {
    let players: HashSet<_> = [AI].into_iter().collect();
    let configs: HashMap<_, _> = [(AI, AiConfig::default())].into_iter().collect();
    let run = run_ai_actions(game, &players, &configs, rng, session);
    match run.stop {
        AiActionsStop::NoEligibleAiActor => Ok(run.results.len()),
        stop => Err(internal(format!(
            "phase-ai stopped without human handoff: {stop:?}"
        ))),
    }
}

/// Report an unrepresentable state with the engine's own name for it.
///
/// The compat error says only "Unsupported"; `WaitingFor::variant_name` and
/// `WaitingFor::acting_players` are the engine's own labels for *which* decision
/// the adapter could not render and *who* owes it. Without them a reader cannot
/// tell "this prompt is missing" from "the AI is stuck", which are different
/// bugs. Both are the engine's, so no second variant list lives here.
fn snapshot_error(error: AdapterError, game: &GameState) -> HostError {
    let waiting = game.waiting_for.variant_name();
    let actors = game.waiting_for.acting_players();
    let whose = if actors.is_empty() {
        "no acting player".to_string()
    } else {
        format!("owed by {actors:?}")
    };
    internal(format!(
        "Unsupported engine state: {error:?} — engine waiting_for is {waiting} ({whose})"
    ))
}

fn snapshot(
    game: &GameState,
    db: &CardDatabase,
    id: u32,
    ai_actions: usize,
) -> Result<(PreparedManabrewSnapshot, Snapshot), HostError> {
    let prepared = prepare_snapshot_with_prompt_id(game, HUMAN, "local", id)
        .map_err(|e| snapshot_error(e, game))?;
    let state = build_state_update(&prepared, db).map_err(|e| snapshot_error(e, game))?;
    let prompt = build_prompt(&prepared, db).map_err(|e| snapshot_error(e, game))?;
    let snapshot = Snapshot {
        state: serde_json::to_value(state).map_err(|e| internal(e.to_string()))?,
        prompt: serde_json::to_value(prompt).map_err(|e| internal(e.to_string()))?,
        human_player_id: manabrew_compat::encode_player_id(HUMAN),
        ai_actions,
    };
    Ok((prepared, snapshot))
}

pub fn preset_deck() -> Vec<String> {
    // A casual demonstration deck, not a format legality claim.
    std::iter::repeat_n("Forest", 24)
        .chain(std::iter::repeat_n("Grizzly Bears", 36))
        .map(str::to_owned)
        .collect()
}

type SharedHost = Arc<Mutex<Host>>;
pub fn router(host: Host) -> Router {
    Router::new()
        .route("/api/start", post(start))
        .route("/api/respond", post(respond))
        .route("/api/state", get(state))
        .with_state(Arc::new(Mutex::new(host)))
}

// Search is CPU-bound: never hold up the Tokio reactor with the AI loop.
async fn blocking<T: Send + 'static>(
    host: SharedHost,
    op: impl FnOnce(&mut Host) -> Result<T, HostError> + Send + 'static,
) -> Result<Json<T>, HostError> {
    tokio::task::spawn_blocking(move || {
        let mut host = host
            .lock()
            .map_err(|_| internal("Host lock poisoned; restart required"))?;
        op(&mut host).map(Json)
    })
    .await
    .map_err(|e| internal(format!("Host task failed: {e}")))?
}
async fn start(
    State(host): State<SharedHost>,
    Json(request): Json<StartRequest>,
) -> Result<Json<Snapshot>, HostError> {
    blocking(host, move |host| host.start(request)).await
}
async fn respond(
    State(host): State<SharedHost>,
    Json(message): Json<ClientToServerMessage>,
) -> Result<Json<Snapshot>, HostError> {
    blocking(host, move |host| host.respond(message)).await
}
async fn state(State(host): State<SharedHost>) -> Result<Json<Snapshot>, HostError> {
    blocking(host, |host| host.state()).await
}
