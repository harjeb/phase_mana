//! Public, bounded transport projection of engine-authored event logs.
// All capture happens on the transactional candidate session, never on reads.
use super::*;
use engine::{
    game::log::resolve_log_entries,
    types::{
        events::GameEvent,
        log::{GameLogEntry, LogCategory, LogImportance, LogSegment, LogVisibility},
        phase::Phase,
    },
};
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogRow {
    pub seq: u64,
    pub turn: u32,
    pub phase: Phase,
    pub message: String,
    pub entry_type: &'static str,
    pub timestamp_ms: u64,
}

#[derive(Clone)]
pub(crate) struct GameLog {
    pub id: String,
    next_seq: u64,
    pub rows: Vec<LogRow>,
    /// The unfiltered engine-authored entries the LLM opponent prompt reads
    /// from. Kept alongside the transport projection so both come from the same
    /// `resolve_log_entries` pass.
    history: Vec<GameLogEntry>,
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
impl GameLog {
    pub fn new() -> Self {
        static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);
        Self {
            id: format!(
                "local-{}-{}-{}",
                std::process::id(),
                now_ms(),
                NEXT_SESSION.fetch_add(1, Ordering::Relaxed)
            ),
            next_seq: 1,
            rows: Vec::new(),
            history: Vec::new(),
        }
    }
    /// Engine-authored history, oldest first. Callers window it themselves.
    pub fn history(&self) -> &[GameLogEntry] {
        &self.history
    }
    pub fn capture(&mut self, before: &GameState, after: &GameState, events: &[GameEvent]) {
        let timestamp_ms = now_ms();
        for entry in resolve_log_entries(events, before, after) {
            self.history.push(entry.clone());
            if entry.presentation.visibility != LogVisibility::Public
                || entry.presentation.importance == LogImportance::Diagnostic
                || entry.category == LogCategory::Debug
            {
                continue;
            }
            let message = entry
                .segments
                .iter()
                .map(|segment| match segment {
                    LogSegment::Text(text) | LogSegment::Mana(text) | LogSegment::Keyword(text) => {
                        text.clone()
                    }
                    LogSegment::CardName { name, .. } | LogSegment::PlayerName { name, .. } => {
                        name.clone()
                    }
                    LogSegment::Number(number) => number.to_string(),
                    LogSegment::Zone(zone) => format!("{zone:?}"),
                })
                .collect::<String>();
            let entry_type = match entry.category {
                LogCategory::Stack | LogCategory::Trigger => "stack",
                LogCategory::Combat
                | LogCategory::Zone
                | LogCategory::Mana
                | LogCategory::Special
                | LogCategory::Destroy => "action",
                _ => "info",
            };
            self.rows.push(LogRow {
                seq: self.next_seq,
                turn: entry.turn,
                phase: entry.phase,
                message,
                entry_type,
                timestamp_ms,
            });
            self.next_seq += 1;
        }
        if self.rows.len() > 200 {
            self.rows.drain(..self.rows.len() - 200);
        }
        if self.history.len() > 400 {
            self.history.drain(..self.history.len() - 400);
        }
    }
    pub fn attach(&self, snapshot: &mut Snapshot) {
        snapshot.log_session_id = self.id.clone();
        snapshot.game_log = self.rows.clone();
    }
}
