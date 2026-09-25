//! Local single-session transport; all decisions and rules belong to phase crates.
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

use axum::{
    extract::{Request, State},
    http::{header, HeaderMap, Method, StatusCode, Uri},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use engine::{
    database::{is_card_playable, CardDatabase},
    game::{
        coverage::card_face_gaps,
        deck_loading::{load_and_hydrate_decks, load_deck_with_conspiracy_choices, resolve_deck_list, ConspiracyChoice, DeckList, PlayerDeckList},
        deck_validation::validate_name_deck_for_format_full,
        engine::{apply, start_game},
        interaction::bind_interaction_authority,
    },
    types::{
        actions::GameAction,
        custom_format::{
            custom_format_registry, passes_legacy_axis_gate, CommandZoneMode, CustomFormatDef,
            CustomFormatId, CustomFormatRules, PrintingFidelity, ReprintPolicy,
            OLD_SCHOOL_93_94_ID, OLD_SCHOOL_95_ID,
        },
        format::{DeckSizeRule, FormatConfig},
        game_state::{GameState, WaitingFor},
        interaction::InteractionSessionId,
        player::PlayerId,
        CoreType,
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

pub mod host_process;

#[cfg(test)]
mod commander_tests;
#[cfg(test)]
mod custom_format_tests;
#[cfg(test)]
mod conspiracy_tests;
#[cfg(test)]
mod table_tests;
#[cfg(test)]
mod game_log_tests;

mod game_log;
use game_log::GameLog;
pub use game_log::LogRow;

const HUMAN: PlayerId = PlayerId(0);

/// Upper bound on the priority passes one skip request may replay.
///
/// A stop the engine can no longer reach — a step already behind us, or one
/// this turn never enters — has to terminate somewhere, and the honest end
/// state is the current prompt, not a spin.
const MAX_SKIP_PASSES: usize = 256;

/// A protocol `pass` carrying a phase-stop modifier.
///
/// Exact `until` stops retain the local replay implementation. Exhaust-only
/// requests go through compat to native UntilStackEmpty auto-pass.
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
    if until.is_none() {
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

/// Start the multiplayer host engine, or return the one already running.
///
/// Blocking on purpose (`spawn_blocking`): startup waits for the engine to load
/// its card database, which is seconds at best and minutes for a raw MTGJSON
/// pool. Holding a reactor thread for that would stall every other request.
async fn host_start() -> Result<Json<host_process::HostInfo>, HostError> {
    tokio::task::spawn_blocking(host_process::start)
        .await
        .map_err(|e| internal(format!("Host task failed: {e}")))?
        .map(Json)
        .map_err(internal)
}
async fn host_stop() -> Result<Json<serde_json::Value>, HostError> {
    tokio::task::spawn_blocking(host_process::stop)
        .await
        .map_err(|e| internal(format!("Host task failed: {e}")))?
        .map_err(internal)?;
    Ok(Json(serde_json::json!({"running": false})))
}
async fn host_status() -> Result<Json<serde_json::Value>, HostError> {
    let host = tokio::task::spawn_blocking(host_process::status)
        .await
        .map_err(|e| internal(format!("Host task failed: {e}")))?;
    Ok(Json(serde_json::json!({"host": host})))
}

fn validate_host_request(method: &Method, headers: &HeaderMap) -> Result<(), HostError> {
    let forbidden = |message: &str| HostError(StatusCode::FORBIDDEN, message.to_string());
    if method != Method::GET && method != Method::HEAD
        && (headers.get_all("x-phase-host").iter().count() != 1
            || headers.get("x-phase-host").and_then(|h| h.to_str().ok()) != Some("1"))
    {
        return Err(forbidden("Host mutations require X-Phase-Host: 1"));
    }
    let local_host = headers.get(header::HOST).and_then(|h| h.to_str().ok())
        .and_then(|h| h.parse::<axum::http::uri::Authority>().ok())
        .is_some_and(|h| matches!(h.host(), "localhost" | "127.0.0.1" | "[::1]") && !h.as_str().contains('@'));
    if !local_host || headers.get_all(header::HOST).iter().count() != 1 {
        return Err(forbidden("Host control is available only through a loopback Host"));
    }
    let origins = headers.get_all(header::ORIGIN);
    let mut origins = origins.iter();
    let Some(origin) = origins.next() else { return Ok(()) };
    if origins.next().is_some() {
        return Err(forbidden("Multiple Origin headers are not allowed"));
    }
    let origin = origin.to_str().ok().and_then(|s| s.parse::<Uri>().ok())
        .ok_or_else(|| forbidden("Invalid host control Origin"))?;
    let scheme = origin.scheme_str().filter(|s| matches!(*s, "http" | "https"))
        .ok_or_else(|| forbidden("Host control Origin must use HTTP or HTTPS"))?;
    if origin.path_and_query().is_some_and(|path| path.as_str() != "/") {
        return Err(forbidden("Invalid host control Origin"));
    }
    let authority = origin.authority().filter(|a| !a.as_str().contains('@'))
        .ok_or_else(|| forbidden("Invalid host control Origin"))?;
    if headers.get_all(header::HOST).iter().count() != 1 {
        return Err(forbidden("Host control requires one Host header"));
    }
    let host = headers.get(header::HOST).and_then(|h| h.to_str().ok())
        .and_then(|h| h.parse::<axum::http::uri::Authority>().ok())
        .filter(|h| !h.as_str().contains('@'))
        .ok_or_else(|| forbidden("Invalid Host header"))?;
    let default_port = if scheme == "https" { 443 } else { 80 };
    let origin_port = authority.port_u16().unwrap_or(default_port);
    let api_port = host.port_u16().unwrap_or(default_port);
    let same_host = authority.host().eq_ignore_ascii_case(host.host()) && origin_port == api_port;
    let local_ui = matches!(authority.host(), "localhost" | "127.0.0.1")
        && (origin_port == 1420 || origin_port == api_port);
    if !same_host && !local_ui {
        return Err(forbidden("Foreign Origin cannot control the host process"));
    }
    Ok(())
}

async fn host_control_guard(request: Request, next: Next) -> Result<Response, HostError> {
    validate_host_request(request.method(), request.headers())?;
    Ok(next.run(request).await)
}

fn host_control_router() -> Router {
    Router::new()
        .route("/api/host/start", post(host_start))
        .route("/api/host/stop", post(host_stop))
        .route("/api/host/status", get(host_status))
        .route_layer(middleware::from_fn(host_control_guard))
}

#[cfg(test)]
mod host_control_tests {
    use super::*;

    fn headers(origin: Option<&str>, marker: bool) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, "127.0.0.1:7432".parse().unwrap());
        if let Some(origin) = origin {
            headers.insert(header::ORIGIN, origin.parse().unwrap());
        }
        if marker {
            headers.insert("x-phase-host", "1".parse().unwrap());
        }
        headers
    }

    #[test]
    fn host_control_accepts_same_host_and_local_ui() {
        for origin in [None, Some("http://127.0.0.1:7432"), Some("http://localhost:7432"),
            Some("http://localhost:1420"), Some("http://127.0.0.1:1420")] {
            assert!(validate_host_request(&Method::POST, &headers(origin, true)).is_ok(), "{origin:?}");
        }
        let mut proxied = headers(Some("https://play.example.com"), true);
        proxied.insert(header::HOST, "play.example.com".parse().unwrap());
        assert!(validate_host_request(&Method::POST, &proxied).is_err());
    }

    #[test]
    fn host_control_rejects_foreign_null_and_malformed_origins() {
        for origin in ["https://evil.example", "null", "http://localhost:9999",
            "http://127.0.0.1.evil.example:1420", "http://user@127.0.0.1:7432",
            "http://127.0.0.1:7432/path", "ftp://127.0.0.1:7432",
            "http://127.0.0.1:7432 http://evil.example"] {
            for method in [Method::GET, Method::POST] {
                assert_eq!(validate_host_request(&method, &headers(Some(origin), true)).unwrap_err().0,
                    StatusCode::FORBIDDEN, "{origin}");
            }
        }
    }

    #[test]
    fn host_control_mutations_always_require_custom_header() {
        for origin in [None, Some("http://127.0.0.1:7432")] {
            assert!(validate_host_request(&Method::POST, &headers(origin, false)).is_err());
            assert!(validate_host_request(&Method::GET, &headers(origin, false)).is_ok());
        }
        let mut invalid = headers(None, true);
        invalid.insert("x-phase-host", "0".parse().unwrap());
        assert!(validate_host_request(&Method::POST, &invalid).is_err());
        let mut duplicate = headers(Some("http://localhost:1420"), true);
        duplicate.append(header::ORIGIN, "https://evil.example".parse().unwrap());
        assert!(validate_host_request(&Method::POST, &duplicate).is_err());
    }

    #[tokio::test]
    async fn host_control_middleware_guards_all_routes() {
        let app = host_control_router();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app.into_make_service()).await.unwrap();
        });
        tokio::task::spawn_blocking(move || {
            use std::io::{Read, Write};
            for (method, path, extra) in [
                ("POST", "start", ""),
                ("POST", "stop", ""),
                ("GET", "status", "Origin: https://evil.example\r\n"),
            ] {
                let mut stream = std::net::TcpStream::connect(address).unwrap();
                stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
                write!(stream, "{method} /api/host/{path} HTTP/1.1\r\nHost: {address}\r\n{extra}Content-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
                let mut response = String::new();
                stream.read_to_string(&mut response).unwrap();
                assert!(response.starts_with("HTTP/1.1 403"), "{response}");
            }
        }).await.unwrap();
        server.abort();
    }
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
    /// CR 905.4: conspiracy cards the human starts with in the command zone.
    #[serde(default)]
    pub human_conspiracies: Vec<String>,
    /// Secret pregame names, keyed by seat and physical conspiracy index.
    #[serde(default)]
    pub conspiracy_choices: Vec<ConspiracyChoice>,
    /// CR 905.4: conspiracy cards the single built-in AI seat starts with.
    #[serde(default)]
    pub ai_conspiracies: Vec<String>,
    pub human_deck: Option<Vec<String>>,
    pub ai_deck: Option<Vec<String>>,
    #[serde(default)]
    pub human_sideboard: Vec<String>,
    #[serde(default)]
    pub ai_sideboard: Vec<String>,
    /// P5 native `Resolved` path: a fully-authored custom format. The host
    /// rebuilds the live `FormatConfig` from these rules through
    /// `FormatConfig::for_custom_rules` and then re-runs the engine's full
    /// format validation on every start, so a config persisted by an older
    /// build cannot bypass a capability gate added later. Supersedes `format`
    /// when present.
    #[serde(default)]
    pub custom_rules: Option<CustomFormatRules>,
    /// Additional opponents after seat 1; the local human always owns seat 0.
    #[serde(default)]
    pub extra_opponents: Vec<OpponentDeck>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpponentDeck {
    pub deck: Vec<String>,
    #[serde(default)]
    pub sideboard: Vec<String>,
    #[serde(default)]
    pub commanders: Vec<String>,
    /// CR 905.4: conspiracy cards this extra seat starts with.
    #[serde(default)]
    pub conspiracy: Vec<String>,
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
    pub log_session_id: String,
    pub game_log: Vec<LogRow>,
}

struct Session {
    log: GameLog,
    game: GameState,
    prepared: PreparedManabrewSnapshot,
    snapshot: Snapshot,
    ai_session: Arc<AiSession>,
    rng: StdRng,
}

mod limited;

pub struct Host {
    limited: limited::LimitedService,
    db: Arc<CardDatabase>,
    session: Option<Session>,
    next_prompt: u32,
}

impl Host {
    pub fn new(db: CardDatabase) -> Self {
        Self {
            limited: limited::LimitedService::from_env(),
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
        let limited = request.custom_rules.is_none()
            && matches!(request.format.as_deref(), Some("draft" | "sealed"));
        if request.extra_opponents.len() > 2 {
            return Err(bad("Local tables support 2–4 players"));
        }
        let player_count = 2 + request.extra_opponents.len() as u8;
        if let Some(rules) = request.custom_rules.as_ref() {
            let validation = validate_custom_format_rules(rules, player_count);
            if !validation.valid {
                return Err(bad(validation.reasons.join("; ")));
            }
        }
        let format_id = request.format.as_deref();
        let (config, commander, fixed_deck) =
            resolve_format(format_id, player_count, request.custom_rules.as_ref())?;
        if !commander
            && (!request.human_commanders.is_empty()
                || !request.ai_commanders.is_empty()
                || request
                    .extra_opponents
                    .iter()
                    .any(|seat| !seat.commanders.is_empty()))
        {
            return Err(bad("Commander slots require format: commander"));
        }
        if commander && (request.human_deck.is_none() || request.ai_deck.is_none()) {
            return Err(bad(
                "Commander requires explicit humanDeck and aiDeck main decks",
            ));
        }
        if limited && (request.human_deck.is_none() || request.ai_deck.is_none()) {
            return Err(bad(
                "Limited requires explicit decks built from your card pool",
            ));
        }
        let human = request.human_deck.unwrap_or_else(preset_deck);
        let ai = request.ai_deck.unwrap_or_else(preset_deck);
        let seats: Vec<_> = [
            (
                "Human",
                &human,
                &request.human_commanders,
                &request.human_conspiracies,
                &request.human_sideboard,
            ),
            ("AI", &ai, &request.ai_commanders, &request.ai_conspiracies, &request.ai_sideboard),
        ]
        .into_iter()
        .chain(request.extra_opponents.iter().map(|seat| {
            ("AI", &seat.deck, &seat.commanders, &seat.conspiracy, &seat.sideboard)
        }))
        .collect();
        for &(label, deck, commanders, conspiracies, sideboard) in &seats {
            // A format that supplies its own fixed deck (Momir) ignores every
            // submitted deck, so its cards must not be gated on playability.
            if fixed_deck {
                continue;
            }
            if limited && deck.len() < 40 {
                return Err(bad(format!(
                    "{label}: Limited main deck requires at least 40 cards"
                )));
            }
            if !(7..=250).contains(&deck.len()) {
                return Err(bad("Deck must contain 7–250 names (one entry per copy)"));
            }
            if commanders.len() > 2 {
                return Err(bad(format!(
                    "{label}: at most two commanders are supported"
                )));
            }
            for name in conspiracies {
                conspiracy_name_count(&self.db, name)?;
            }
            for name in deck {
                if self.db.get_face_by_name(name).is_some_and(|face| {
                    face.card_type.core_types.contains(&CoreType::Conspiracy)
                }) {
                    return Err(bad(format!("{label}: conspiracies belong in the conspiracy slot, not the main deck")));
                }
            }
            for name in deck.iter().chain(commanders).chain(conspiracies).chain(sideboard) {
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
        if commander || config.custom_rules.is_some() {
            let format = request.format.as_deref();
            for &(label, deck, commanders, _conspiracies, sideboard) in &seats {
                // This wire API uses exclusive slots. The engine also accepts
                // inclusive decklists; the raw count prevents that convention
                // from silently changing the submitted library here.
                if let DeckSizeRule::Exactly(size) = config.deck_size {
                    if deck.len() + commanders.len() != usize::from(size) {
                        return Err(bad(format!(
                            "{label}: main deck plus commanders must contain exactly {size} cards; main deck excludes commanders"
                        )));
                    }
                }
                let (commanders, signature) = split_command_slots(&self.db, format, commanders);
                validate_name_deck_for_format_full(
                    &self.db,
                    deck,
                    sideboard,
                    &commanders,
                    &[],
                    &[],
                    &[],
                    &signature,
                    &[],
                    &config,
                    None,
                    usize::from(player_count),
                )
                .map_err(|reasons| bad(format!("{label}: {}", reasons.join("; "))))?;
            }
        }
        let format = request.format.as_deref();
        let (human_commanders, human_signature) =
            split_command_slots(&self.db, format, &request.human_commanders);
        let (ai_commanders, ai_signature) =
            split_command_slots(&self.db, format, &request.ai_commanders);
        let list = DeckList {
            player: PlayerDeckList {
                main_deck: human,
                sideboard: request.human_sideboard,
                commander: human_commanders,
                signature_spell: human_signature,
                conspiracy: request.human_conspiracies,
                ..Default::default()
            },
            opponent: PlayerDeckList {
                main_deck: ai,
                sideboard: request.ai_sideboard,
                commander: ai_commanders,
                signature_spell: ai_signature,
                conspiracy: request.ai_conspiracies,
                ..Default::default()
            },
            ai_decks: request
                .extra_opponents
                .into_iter()
                .map(|seat| {
                    let (commanders, signature) =
                        split_command_slots(&self.db, format, &seat.commanders);
                    PlayerDeckList {
                        main_deck: seat.deck,
                        sideboard: seat.sideboard,
                        commander: commanders,
                        signature_spell: signature,
                        conspiracy: seat.conspiracy,
                        ..Default::default()
                    }
                })
                .collect(),
            ..Default::default()
        };
        let seed = request.seed.unwrap_or(42);
        config
            .validate_for_player_count(player_count)
            .map_err(bad)?;
        let mut game = GameState::new(config, player_count, seed);
        let payload = resolve_deck_list(&self.db, &list);
        if list.player.conspiracy.is_empty()
            && list.opponent.conspiracy.is_empty()
            && list.ai_decks.iter().all(|seat| seat.conspiracy.is_empty())
            && request.conspiracy_choices.is_empty()
        {
            load_and_hydrate_decks(&mut game, &payload, Some(&self.db));
        } else {
            load_deck_with_conspiracy_choices(&mut game, &payload, &request.conspiracy_choices, &self.db)
                .map_err(bad)?;
        }
        let mut log = GameLog::new();
        let before = game.clone();
        let result = start_game(&mut game);
        log.capture(&before, &game, &result.events);
        bind_interaction_session(&mut game);
        let ai_session = AiSession::arc_from_game(&game);
        let mut rng = StdRng::seed_from_u64(seed);
        let ai_actions = advance_ai(&mut game, &mut rng, &ai_session, &mut log)?;
        let id = self.reserve_prompt()?;
        let (prepared, mut snapshot) = snapshot(&game, &self.db, id, ai_actions)?;
        log.attach(&mut snapshot);
        self.session = Some(Session {
            log,
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

    /// CR 905.4a + CR 702.106: reveal one of the human's face-down hidden-agenda
    /// conspiracies in the command zone, then re-snapshot. Revealing is a
    /// special action that does not use the stack, so it is offered as its own
    /// endpoint rather than a prompt response. Addressed by the wire card id
    /// (`card-<n>`), because compat redacts the name of a face-down command-zone
    /// card for every viewer.
    pub fn reveal_conspiracy(&mut self, card_id: &str, prompt_id: u32) -> Result<Snapshot, HostError> {
        let session = self.session.as_ref().ok_or_else(|| bad("No session"))?;
        if prompt_id != session.prepared.prompt_id {
            return Err(HostError(StatusCode::CONFLICT, "Stale conspiracy reveal prompt".into()));
        }
        if !matches!(session.game.waiting_for, WaitingFor::Priority { player } if player == HUMAN) {
            return Err(bad("Revealing a conspiracy requires human priority"));
        }
        let target = manabrew_compat::parse_object_id(card_id)
            .map_err(|_| bad(format!("Malformed conspiracy card id '{card_id}'")))?;
        let mut game = session.game.clone();
        let valid = game.objects.get(&target).is_some_and(|obj| {
            obj.owner == HUMAN && obj.face_down && engine::game::conspiracy::is_conspiracy(obj)
        });
        if !valid {
            return Err(bad(format!(
                "No face-down conspiracy '{card_id}' for the human player"
            )));
        }
        let mut log = session.log.clone();
        let before = game.clone();
        let result = apply(&mut game, HUMAN, GameAction::TurnFaceUp { object_id: target, x: 0 })
            .map_err(|error| bad(format!("Conspiracy reveal rejected: {error:?}")))?;
        log.capture(&before, &game, &result.events);
        let mut rng = session.rng.clone();
        let ai_session = Arc::clone(&session.ai_session);
        let ai_actions = advance_ai(&mut game, &mut rng, &ai_session, &mut log)?;
        let id = self.reserve_prompt()?;
        let (prepared, mut snapshot) = snapshot(&game, &self.db, id, ai_actions)?;
        log.attach(&mut snapshot);
        self.session = Some(Session {
            log,
            game,
            prepared,
            snapshot: snapshot.clone(),
            ai_session,
            rng,
        });
        Ok(snapshot)
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
        let mut log = session.log.clone();
        let before = game.clone();
        let result = apply(&mut game, HUMAN, action)
            .map_err(|e| bad(format!("Engine rejected response: {e:?}")))?;
        log.capture(&before, &game, &result.events);
        let mut ai_actions = advance_ai(&mut game, &mut rng, &ai_session, &mut log)?;
        if let Some((_, skip)) = &skip {
            ai_actions += self.replay_skip(&mut game, &mut rng, &ai_session, skip, &mut log)?;
        }
        let id = self.reserve_prompt()?;
        let (prepared, mut snapshot) = snapshot(&game, &self.db, id, ai_actions)?;
        log.attach(&mut snapshot);
        self.session = Some(Session {
            log,
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
        log: &mut GameLog,
    ) -> Result<usize, HostError> {
        let mut ai_actions = 0;
        for _ in 0..MAX_SKIP_PASSES {
            if !human_holds_priority(game) || self.skip_reached(game, skip)? {
                break;
            }
            let before = game.clone();
            let result = apply(game, HUMAN, GameAction::PassPriority)
                .map_err(|e| bad(format!("Engine rejected replayed pass: {e:?}")))?;
            log.capture(&before, game, &result.events);
            ai_actions += advance_ai(game, rng, ai, log)?;
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

/// Oathbreaker carries two command-zone slots in the same `commanders` array:
/// the legendary Planeswalker and its signature spell. Split them using the
/// card database's own `is_oathbreaker` marker and core type, leaving every
/// other format's arrays untouched.
fn split_command_slots(
    db: &CardDatabase,
    format: Option<&str>,
    names: &[String],
) -> (Vec<String>, Vec<String>) {
    if format != Some("oathbreaker") {
        return (names.to_vec(), Vec::new());
    }
    let mut commanders = Vec::new();
    let mut signature = Vec::new();
    for name in names {
        let is_signature = db.get_face_by_name(name).is_some_and(|face| {
            !face.is_oathbreaker
                && face
                    .card_type
                    .core_types
                    .iter()
                    .any(|t| matches!(t, CoreType::Instant | CoreType::Sorcery))
        });
        if is_signature {
            signature.push(name.clone());
        } else {
            commanders.push(name.clone());
        }
    }
    (commanders, signature)
}

/// Resolve a wire format id to its engine config plus the two host-side facts
/// the rest of [`Host::start`] needs: whether the `commanders` slots fill the
/// command zone, and whether the engine supplies a fixed deck for every seat.
fn resolve_format(
    format: Option<&str>,
    player_count: u8,
    custom_rules: Option<&CustomFormatRules>,
) -> Result<(FormatConfig, bool, bool), HostError> {
    // P5: an authored custom format supersedes the wire format id. The live
    // config is rebuilt from the resolved rules; `Host::start`'s custom-format
    // validation block (and `validate_for_player_count`) re-validates it on
    // every start, capability gates included.
    if let Some(rules) = custom_rules {
        return Ok((FormatConfig::for_custom_rules(rules), false, false));
    }
    let choice = match format {
        Some("commander") => (FormatConfig::commander(), true, false),
        Some("commander_draft") => (FormatConfig::commander_draft(), true, false),
        Some("oathbreaker") => (FormatConfig::oathbreaker(), true, false),
        Some("duel_commander") => (FormatConfig::duel_commander(), true, false),
        Some("pauper_commander") => (FormatConfig::pauper_commander(), true, false),
        Some("tiny_leaders") => (FormatConfig::tiny_leaders(), true, false),
        Some("momir") => (FormatConfig::momir(), false, true),
        Some("archenemy") => (FormatConfig::archenemy(), false, false),
        Some("planechase") => (FormatConfig::planechase(), false, false),
        Some("two_headed_giant") => (FormatConfig::two_headed_giant(), false, false),
        Some("old_school_93_94") => (custom_format_config(OLD_SCHOOL_93_94_ID)?, false, false),
        Some("old_school_95") => (custom_format_config(OLD_SCHOOL_95_ID)?, false, false),
        Some("draft" | "sealed") => (FormatConfig::limited(), false, false),
        None
        | Some(
            "standard" | "modern" | "legacy" | "vintage" | "pioneer" | "pauper" | "historic"
            | "explorer" | "timeless" | "premodern" | "casual",
        ) => (
            FormatConfig::default_for_player_count(player_count),
            false,
            false,
        ),
        Some(other) => return Err(bad(format!("Unsupported format: {other}"))),
    };
    Ok(choice)
}

/// Resolve a bundled custom-format preset id through the registry, then build
/// the live config the same way a resolved custom format runs.
fn custom_format_config(id: CustomFormatId) -> Result<FormatConfig, HostError> {
    let rules: CustomFormatRules = custom_format_registry()
        .into_iter()
        .find(|def| def.rules.id == id)
        .map(|def| def.rules)
        .ok_or_else(|| internal(format!("Custom format {} is not registered", id.0)))?;
    Ok(FormatConfig::for_custom_rules(&rules))
}

fn advance_ai(
    game: &mut GameState,
    rng: &mut StdRng,
    session: &Arc<AiSession>,
    log: &mut GameLog,
) -> Result<usize, HostError> {
    let players: HashSet<_> = (1..game.players.len()).map(|i| PlayerId(i as u8)).collect();
    let configs: HashMap<_, _> = players
        .iter()
        .map(|&id| (id, AiConfig::default()))
        .collect();
    let initial = game.clone();
    let run = run_ai_actions(game, &players, &configs, rng, session);
    let mut before = &initial;
    for result in &run.results {
        log.capture(before, &result.state, &result.events);
        before = &result.state;
    }
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
        log_session_id: String::new(),
        game_log: Vec::new(),
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
        .route("/api/limited", post(limited_command))
        .route("/api/custom-formats", get(custom_formats))
        .route("/api/custom-formats/base", get(custom_format_base))
        .route("/api/custom-formats/validate", post(validate_custom_format))
        .route("/api/conspiracy/prepare", post(prepare_conspiracies))
        .route("/api/conspiracy/reveal", post(reveal_conspiracy))
        .with_state(Arc::new(Mutex::new(host)))
        .merge(host_control_router())
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
        // Isolate engine panics. A format whose auto-injected default deck
        // references a card the loaded database cannot resolve (Archenemy's
        // scheme deck, Planechase's planar deck) panics inside the engine.
        // That must fail this one request, not poison the shared mutex for
        // every later one. `catch_unwind` stops the unwind before the guard's
        // scope ends, so the mutex stays healthy.
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| op(&mut host))) {
            Ok(result) => result.map(Json),
            Err(payload) => {
                let message = payload
                    .downcast_ref::<&str>()
                    .map(|s| (*s).to_string())
                    .or_else(|| payload.downcast_ref::<String>().cloned())
                    .unwrap_or_else(|| "engine panicked".to_string());
                Err(internal(format!("Host request panicked: {message}")))
            }
        }
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
#[derive(Deserialize)]
struct LimitedCommand {
    command: String,
    #[serde(default)]
    args: serde_json::Value,
}
async fn limited_command(
    State(host): State<SharedHost>,
    Json(request): Json<LimitedCommand>,
) -> Result<Json<serde_json::Value>, HostError> {
    blocking(host, move |host| {
        host.limited
            .invoke(&request.command, request.args)
            .map_err(bad)
    })
    .await
}
async fn state(State(host): State<SharedHost>) -> Result<Json<Snapshot>, HostError> {
    blocking(host, |host| host.state()).await
}

fn conspiracy_name_count(db: &CardDatabase, name: &str) -> Result<usize, HostError> {
    let face = db.get_face_by_name(name).ok_or_else(|| bad(format!("Unknown conspiracy: {name}")))?;
    if !face.card_type.core_types.contains(&CoreType::Conspiracy) {
        return Err(bad(format!("{name} is not a conspiracy card")));
    }
    Ok(engine::game::conspiracy::agenda_name_count(face))
}

async fn prepare_conspiracies(
    State(host): State<SharedHost>,
    Json(names): Json<Vec<String>>,
) -> Result<Json<Vec<usize>>, HostError> {
    blocking(host, move |host| names.iter().map(|name| conspiracy_name_count(&host.db, name)).collect()).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevealConspiracyRequest {
    id: String,
    prompt_id: u32,
}
async fn custom_format_base() -> Result<Json<serde_json::Value>, HostError> {
    // The editor starts from a complete, engine-valid ruleset built through
    // the real Axis-A constructor, so the UI never re-derives the schema and a
    // new `StructuralRules` field cannot silently fall out of the editor.
    let def = CustomFormatDef::from_lobby_config(
        "Custom format".to_string(),
        &FormatConfig::default_for_player_count(2),
    )
    .map_err(|error| internal(error.to_string()))?;
    Ok(Json(serde_json::json!({
        "label": def.label,
        "shortLabel": def.short_label,
        "rules": def.rules,
    })))
}

async fn custom_formats() -> Json<Vec<CustomFormatDto>> {
    Json(
        custom_format_registry()
            .into_iter()
            .map(|def| CustomFormatDto {
                id: def.rules.id.0,
                label: def.label,
                short_label: def.short_label,
                description: def.description,
                reprint_policy: def.reprint_policy,
                printing_fidelity: def.printing_fidelity,
                rules: def.rules,
            })
            .collect(),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidateCustomFormatRequest {
    rules: CustomFormatRules,
    #[serde(default)]
    player_count: Option<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CustomFormatValidation {
    valid: bool,
    reasons: Vec<String>,
}

/// P5: the same capability gates the game-start path applies, exposed before a
/// format is saved so the editor can reject a config up front. This is a
/// format-only check (no deck), so it names the two format-level rejections the
/// engine's custom-format evaluator can raise; a deck-dependent rejection still
/// surfaces at start time.
async fn validate_custom_format(
    Json(request): Json<ValidateCustomFormatRequest>,
) -> Result<Json<CustomFormatValidation>, HostError> {
    Ok(Json(validate_custom_format_rules(
        &request.rules,
        request.player_count.unwrap_or(2),
    )))
}

/// The format-level checks the editor can run before saving. Kept pure so the
/// gate can be unit-tested without a router; `Host::start` re-runs the same
/// capability gate through `evaluate_custom_format`, so this is convenience,
/// not the enforcement point.
fn validate_custom_format_rules(
    rules: &CustomFormatRules,
    player_count: u8,
) -> CustomFormatValidation {
    let mut reasons = Vec::new();
    if !(2..=4).contains(&player_count) {
        reasons.push("Local tables support 2–4 players".to_string());
    }
    if rules.structural.starting_life <= 0 {
        reasons.push("Starting life must be positive".to_string());
    }
    let size = match rules.structural.deck_size {
        DeckSizeRule::Minimum(size) | DeckSizeRule::Exactly(size) => size,
    };
    if !(7..=250).contains(&size) {
        reasons.push("Local custom deck size must be 7–250 cards".to_string());
    }
    if matches!(
        rules.structural.command_zone_mode,
        CommandZoneMode::Enabled { .. }
    ) {
        reasons.push(
            "Custom formats cannot declare a command zone; only constructed-shaped formats are \
             supported"
                .to_string(),
        );
    }
    if !passes_legacy_axis_gate(&rules.legality.legacy) {
        reasons.push(
            "This format declares a legacy rules axis the engine has not implemented yet"
                .to_string(),
        );
    }
    if reasons.is_empty() {
        let config = FormatConfig::for_custom_rules(rules);
        if let Err(reason) = config.validate_for_player_count(player_count) {
            reasons.push(reason);
        }
    }
    CustomFormatValidation {
        valid: reasons.is_empty(),
        reasons,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CustomFormatDto {
    id: u16,
    label: String,
    short_label: String,
    description: String,
    reprint_policy: Option<ReprintPolicy>,
    printing_fidelity: PrintingFidelity,
    /// The full resolved ruleset, so a client can import/export a bundled
    /// preset verbatim and re-submit it through `StartRequest.custom_rules`.
    rules: CustomFormatRules,
}

async fn reveal_conspiracy(
    State(host): State<SharedHost>,
    Json(request): Json<RevealConspiracyRequest>,
) -> Result<Json<Snapshot>, HostError> {
    blocking(host, move |host| host.reveal_conspiracy(&request.id, request.prompt_id)).await
}
