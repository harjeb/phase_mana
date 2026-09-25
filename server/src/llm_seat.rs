//! Optional LLM-driven AI seats, using the player's own OpenAI-compatible
//! endpoint.
//!
//! This is the phase-mana (native server) counterpart of the engine's WASM
//! adapter: the engine authors the decision prompt and the finite option
//! domain, the model answers, and the reply is bound back to a `GameAction`
//! through the same `AiDecisionContract` boundary the built-in AI uses. A
//! model reply is an untrusted hint — `select_action` refuses anything that
//! does not name an issued option, and `apply_ai_action_proposal` re-checks
//! the contract before the action reaches the reducer.
//!
//! Every failure (build, network, parse, admission) falls back to the built-in
//! AI for that one decision; after [`MAX_CONSECUTIVE_FAILURES`] in a row the
//! seat gives up for the rest of the game. An LLM seat can therefore never
//! stall a game or lose it to a bad reply.
//!
//! ponytail: the LLM call runs synchronously inside the request that is
//! already holding the host lock, so a slow model freezes state polling for
//! that turn. Streaming decisions to the client is the upgrade path if a
//! hosted model's latency is unacceptable.

use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc,
    },
    time::Duration,
};

use engine::{
    ai_support::{apply_ai_action_proposal, AiDecisionContract, AiProposalApplication},
    database::CardDatabase,
    game::turn_control,
    types::{
        actions::GameAction, game_state::GameState, log::GameLogEntry, player::PlayerId,
    },
};
use phase_ai::{
    config::{AiConfig, AiDifficulty},
    search::choose_action_with_session,
    session::AiSession,
};
use phase_llm::{LlmEndpointConfig, LlmProvider};
use rand::Rng;

/// Consecutive failures a seat may take before it stops trying and stays on the
/// built-in AI for the rest of the game.
const MAX_CONSECUTIVE_FAILURES: u32 = 3;
/// Per-request wall-clock budget, so a hung endpoint cannot hold the host lock
/// indefinitely.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Trailing engine log entries handed to the model. `history_window` decides
/// how many of these the prompt actually shows; this only bounds the copy.
const HISTORY_LIMIT: usize = 120;
/// Upper bound on LLM calls in one AI advance, so a pathological turn cannot
/// run up an unbounded bill or hang forever.
const MAX_LLM_DECISIONS_PER_ADVANCE: usize = 40;

/// Settings the client submits to turn an AI seat into an LLM seat. Everything
/// is free text or optional: an OpenAI-compatible server (Ollama, LM Studio,
/// vLLM, OpenRouter, ...) needs only a base URL, a model, and usually a key.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LlmSeatSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub temperature: Option<f32>,
}

impl LlmSeatSettings {
    /// `None` unless the player actually turned LLM mode on with a usable
    /// endpoint — a disabled or half-filled block keeps today's behavior.
    pub fn resolve(&self) -> Option<LlmEndpointConfig> {
        if !self.enabled || self.base_url.trim().is_empty() || self.model.trim().is_empty() {
            return None;
        }
        Some(LlmEndpointConfig {
            provider: LlmProvider::OpenAiCompatible,
            base_url: Some(self.base_url.trim().to_string()),
            api_key: self.api_key.trim().to_string(),
            model: self.model.trim().to_string(),
            max_output_tokens: None,
            temperature: self.temperature,
        })
    }
}

/// One game's LLM seat state: the endpoint plus the failure streak.
pub struct LlmSeat {
    endpoint: LlmEndpointConfig,
    client: reqwest::Client,
    /// Own runtime so the blocking bridge does not depend on an ambient Tokio
    /// runtime — the host calls this from `spawn_blocking`, but tests and any
    /// direct caller have none.
    runtime: tokio::runtime::Runtime,
    // Atomics so a decision can update the streak through a shared `&LlmSeat`:
    // the transport reads the session immutably so a rejected response stays
    // transactional, and the seat is shared across a session by `Arc`.
    consecutive_failures: AtomicU32,
    disabled: AtomicBool,
}

impl LlmSeat {
    pub fn new(endpoint: LlmEndpointConfig) -> Self {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("build the LLM HTTP runtime");
        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .unwrap_or_default();
        Self {
            endpoint,
            client,
            runtime,
            consecutive_failures: AtomicU32::new(0),
            disabled: AtomicBool::new(false),
        }
    }

    /// The engine action the model chose, or `None` to use the built-in AI.
    fn choose_action(
        &self,
        state: &GameState,
        contract: &AiDecisionContract,
        difficulty: AiDifficulty,
        db: &CardDatabase,
        history: &[GameLogEntry],
    ) -> Option<GameAction> {
        if self.disabled.load(Ordering::Relaxed) {
            return None;
        }
        match self.try_choose(state, contract, difficulty, db, history) {
            Ok(action) => {
                self.consecutive_failures.store(0, Ordering::Relaxed);
                Some(action)
            }
            Err(error) => {
                let failures = self.consecutive_failures.fetch_add(1, Ordering::Relaxed) + 1;
                if failures >= MAX_CONSECUTIVE_FAILURES {
                    self.disabled.store(true, Ordering::Relaxed);
                    eprintln!(
                        "[llm-seat] {error}; using the built-in AI for the rest of this game"
                    );
                }
                None
            }
        }
    }

    fn try_choose(
        &self,
        state: &GameState,
        contract: &AiDecisionContract,
        difficulty: AiDifficulty,
        db: &CardDatabase,
        history: &[GameLogEntry],
    ) -> Result<GameAction, String> {
        let request = phase_llm::build_game_decision_prompt(
            state,
            contract,
            difficulty,
            Some(db),
            history,
        )
        .map_err(|error| format!("could not build a prompt: {error}"))?;
        let http = phase_llm::build_chat_request(&self.endpoint, &request.prompt)
            .map_err(|error| format!("could not build the HTTP request: {error}"))?;
        let (status, body) = self.execute(&http)?;
        let completion =
            phase_llm::completion_from_response(self.endpoint.provider, status, &body)
                .map_err(|error| format!("endpoint returned no completion: {error}"))?;
        let selection = phase_llm::select_action(state, contract, &request.fingerprint, &completion)
            .map_err(|error| format!("reply was refused: {error}"))?;
        // `select_action` already bounds the reply to the issued options; this
        // repeats the admission check the WASM adapter performs so a mismatch
        // is a fallback here too rather than a rejected action mid-turn.
        if !contract.contains_action(state, &selection.action) {
            return Err("reply was outside the issued decision domain".to_string());
        }
        Ok(selection.action)
    }

    fn execute(&self, spec: &phase_llm::HttpRequestSpec) -> Result<(u16, String), String> {
        let method = reqwest::Method::from_bytes(spec.method.as_bytes())
            .map_err(|error| format!("bad HTTP method: {error}"))?;
        let mut request = self.client.request(method, &spec.url);
        for header in &spec.headers {
            request = request.header(&header.name, &header.value);
        }
        let request = request
            .body(spec.body.clone())
            .build()
            .map_err(|error| format!("bad HTTP request: {error}"))?;
        // Runs on the seat's own runtime, so this is safe from a blocking task
        // or a plain test thread alike.
        self.runtime
            .block_on(async {
                let response = self.client.execute(request).await?;
                let status = response.status().as_u16();
                let body = response.text().await?;
                Ok::<_, reqwest::Error>((status, body))
            })
            .map_err(|error| format!("request failed: {error}"))
    }
}

/// The pending decision whose authorized submitter is an AI seat. Mirrors
/// `phase_ai::auto_play`'s private actor selection; control effects can make
/// the authorized submitter a different player than the semantic owner.
fn eligible_ai_decision(
    state: &GameState,
    ai_players: &HashSet<PlayerId>,
) -> Option<(PlayerId, PlayerId)> {
    state
        .waiting_for
        .acting_players()
        .into_iter()
        .find_map(|semantic_owner| {
            let actor = turn_control::authorized_submitter_for_player(state, semantic_owner);
            ai_players.contains(&actor).then_some((semantic_owner, actor))
        })
}

/// Whether the only thing the engine is asking for is a priority pass. Those
/// are trivia the model should never be billed for; the built-in AI handles
/// them immediately.
fn is_only_priority_pass(contract: &AiDecisionContract) -> bool {
    !contract.candidates.is_empty()
        && contract
            .candidates
            .iter()
            .all(|candidate| matches!(candidate.action, GameAction::PassPriority))
}

/// Run AI decisions until a human owes an action, sourcing each decision from
/// the LLM where it is worth asking and from the built-in AI otherwise.
///
/// Engine log capture happens here, per applied action, so the history each
/// model call reads includes the actions this turn has already taken. Returns
/// the number of actions applied.
pub fn run_llm_ai_actions(
    state: &mut GameState,
    ai_players: &HashSet<PlayerId>,
    ai_config: &AiConfig,
    rng: &mut impl Rng,
    session: &Arc<AiSession>,
    llm: &LlmSeat,
    db: &CardDatabase,
    log: &mut crate::GameLog,
) -> usize {
    let mut taken = 0;

    for _ in 0..MAX_LLM_DECISIONS_PER_ADVANCE {
        let Some((semantic_owner, actor)) = eligible_ai_decision(state, ai_players) else {
            break;
        };
        let contract = AiDecisionContract::issue(state, semantic_owner);
        if contract.candidates.is_empty() {
            break;
        }

        let llm_action = if is_only_priority_pass(&contract) {
            None
        } else {
            let history = log.history();
            let tail_start = history.len().saturating_sub(HISTORY_LIMIT);
            llm.choose_action(
                state,
                &contract,
                ai_config.difficulty,
                db,
                &history[tail_start..],
            )
        };
        let action = match llm_action {
            Some(action) => action,
            None => match choose_action_with_session(state, semantic_owner, ai_config, rng, session)
            {
                Some(action) => action,
                None => break,
            },
        };

        let before = state.clone();
        match apply_ai_action_proposal(state, &contract, actor, action) {
            AiProposalApplication::AppliedAction { result }
            | AiProposalApplication::AppliedStackPass { result } => {
                log.capture(&before, state, &result.events);
                taken += 1;
            }
            AiProposalApplication::Stale | AiProposalApplication::Rejected { .. } => break,
        }
    }

    taken
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(enabled: bool, base_url: &str, model: &str) -> LlmSeatSettings {
        LlmSeatSettings {
            enabled,
            base_url: base_url.to_string(),
            api_key: "k".to_string(),
            model: model.to_string(),
            temperature: None,
        }
    }

    #[test]
    fn disabled_or_incomplete_settings_do_not_resolve() {
        assert!(ctx(false, "http://localhost:11434/v1", "llama3").resolve().is_none());
        assert!(ctx(true, "  ", "llama3").resolve().is_none());
        assert!(ctx(true, "http://localhost:11434/v1", "").resolve().is_none());
    }

    #[test]
    fn a_complete_openai_compatible_block_resolves() {
        let endpoint = ctx(true, "http://localhost:11434/v1", "llama3")
            .resolve()
            .expect("complete settings resolve");
        assert_eq!(endpoint.provider, LlmProvider::OpenAiCompatible);
        assert_eq!(endpoint.model, "llama3");
    }
}
