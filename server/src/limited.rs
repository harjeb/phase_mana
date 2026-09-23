//! Local, single-human Limited adapter. Pack collation and draft transitions are
//! owned by draft-core; this module owns resources, DTOs and session lifetimes.
use std::{collections::HashMap, path::PathBuf};

use draft_core::{
    pack_generator::PackGenerator, pack_source::PackSource, session, set_pool::*, types::*,
    validation::validate_limited_deck, view,
};
use draft_wasm::{
    bot_ai::{bot_pick, winston_decision},
    suggest::suggest_deck,
};
use engine::types::{card::DraftEffect, player::PlayerId};
use phase_ai::config::AiDifficulty;
use rand::SeedableRng;
use rand_chacha::ChaCha20Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
struct Card {
    id: String,
    name: String,
    set_code: String,
    card_number: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    foil: bool,
}
impl From<&DraftCardInstance> for Card {
    fn from(c: &DraftCardInstance) -> Self {
        Self {
            id: c.instance_id.clone(),
            name: c.name.clone(),
            set_code: c.set_code.clone(),
            card_number: c.collector_number.clone(),
            foil: false,
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
struct Deck {
    name: String,
    main: Vec<Card>,
    sideboard: Vec<Card>,
}
#[derive(Clone)]
struct Snapshot {
    session: DraftSession,
    rng: ChaCha20Rng,
}
struct Draft {
    current: Snapshot,
    undo: Vec<Snapshot>,
    /// Human picks buffered for Commander Draft or an opted-in draft effect.
    pending: Vec<String>,
    pending_effect: bool,
    commander_draft: bool,
}
#[derive(Clone)]
struct Sealed {
    session: DraftSession,
    suggested: Deck,
    opponents: Vec<Deck>,
}
struct Gauntlet {
    kind: &'static str,
    human: Deck,
    pool: Vec<DraftCardInstance>,
    opponents: Vec<Deck>,
    opponent_conspiracies: Vec<Vec<String>>,
    round: usize,
    wins: usize,
    losses: usize,
    round_recorded: bool,
}
/// A ready pack source plus the bookkeeping `DraftConfig` needs. `set_code` is
/// the land/land-set label; the cube source uses a placeholder.
struct LimitSource {
    source: Box<dyn PackSource>,
    draft_source: DraftSource,
    set_code: String,
    cards_per_pack: u8,
}

/// In-memory service; callers serialize access with their existing server mutex.
/// Sessions and undo history intentionally expire when the server restarts.
pub struct LimitedService {
    pools_dir: PathBuf,
    drafts: HashMap<String, Draft>,
    sealed: HashMap<String, Sealed>,
    winston: HashMap<String, Snapshot>,
    gauntlets: HashMap<String, Gauntlet>,
    next_id: u64,
}
impl Default for LimitedService {
    fn default() -> Self {
        Self::from_env()
    }
}
impl LimitedService {
    pub fn from_env() -> Self {
        Self::new(std::env::var_os("PHASE_MANA_DRAFT_POOLS").map(PathBuf::from))
    }
    pub fn new(pools_dir: Option<PathBuf>) -> Self {
        Self {
            pools_dir: pools_dir.unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/draft-pools")
            }),
            drafts: HashMap::new(),
            sealed: HashMap::new(),
            winston: HashMap::new(),
            gauntlets: HashMap::new(),
            next_id: 0,
        }
    }
    fn id(&mut self, kind: &str) -> String {
        self.next_id += 1;
        format!("local-{kind}-{}", self.next_id)
    }
    fn load_pool(&self, code: &str) -> Result<LimitedSetPool> {
        if code.is_empty() || code.len() > 16 || !code.bytes().all(|c| c.is_ascii_alphanumeric()) {
            return Err("Invalid set code (expected letters and digits)".into());
        }
        let dir = &self.pools_dir;
        let upper = dir.join(format!("{}.json", code.to_ascii_uppercase()));
        let path = if upper.exists() {
            upper
        } else {
            dir.join(format!("{}.json", code.to_ascii_lowercase()))
        };
        let bytes = std::fs::read(&path).map_err(|e| format!("No usable Limited pool for {code} at {}: {e}. Run scripts/fetch-limited-pools.sh {code} and configure PHASE_MANA_DRAFT_POOLS.", path.display()))?;
        let pool: LimitedSetPool = serde_json::from_slice(&bytes).map_err(|e| {
            format!(
                "Invalid extracted LimitedSetPool at {}: {e}",
                path.display()
            )
        })?;
        if !pool.code.eq_ignore_ascii_case(code) {
            return Err("Pool file set code does not match requested set".into());
        }
        validate_pool(&pool)?;
        Ok(pool)
    }
    fn list_sets(&self) -> Result<Value> {
        let help = format!(
            "Run scripts/fetch-limited-pools.sh SET ... or set PHASE_MANA_DRAFT_POOLS to an extracted pool directory (current: {}).",
            self.pools_dir.display()
        );
        let entries = std::fs::read_dir(&self.pools_dir)
            .map_err(|e| format!("Cannot read local Limited pools: {e}. {help}"))?;
        let mut codes = Vec::new();
        for entry in entries {
            let entry =
                entry.map_err(|e| format!("Cannot list local Limited pools: {e}. {help}"))?;
            let path = entry.path();
            if path.is_file() && path.extension().is_some_and(|ext| ext == "json") {
                if let Some(code) = path.file_stem().and_then(|s| s.to_str()) {
                    codes.push(code.to_ascii_lowercase());
                }
            }
        }
        codes.sort();
        codes.dedup();
        let mut pools: Vec<_> = codes
            .iter()
            .filter_map(|code| self.load_pool(code).ok())
            .collect();
        if pools.is_empty() {
            return Err(format!(
                "No playable local Limited pools found; files may be missing, invalid or have unsupported/incomplete booster data. {help}"
            ));
        }
        pools.sort_by(|a, b| {
            b.release_date
                .cmp(&a.release_date)
                .then_with(|| a.code.cmp(&b.code))
        });
        Ok(json!(pools
            .iter()
            .map(|pool| {
                let code = pool.code.to_ascii_lowercase();
                let mut set = json!({"object":"set", "id":format!("limited:{code}"),
                "code":code, "name":pool.name, "set_type":"local",
                "card_count":pool.prints.iter().filter(|p| p.booster_eligible).count(),
                "digital":false, "icon_svg_uri":""});
                if let Some(date) = &pool.release_date {
                    set["released_at"] = json!(date);
                }
                set
            })
            .collect::<Vec<_>>()))
    }
    /// Resolve the client-supplied pool into a pack source. A single standard
    /// set keeps MTGJSON collation; a custom pool (Cube or imported JSON) is
    /// dealt as a shuffled cube; several merged standard sets become a Chaos
    /// draft with a real per-seat/per-round assignment.
    fn build_source(
        &self,
        setup: &Setup,
        seats: u8,
        pack_count: u8,
        seed: u64,
    ) -> Result<LimitSource> {
        if setup.variant.as_deref().is_some_and(|v| !v.is_empty()) {
            return Err("Local Limited supports standard set boosters and custom pools only; named variants are not implemented".into());
        }
        let custom = setup.custom_pool || setup.pool_type.as_deref() == Some("Custom");
        let mut codes: Vec<String> = Vec::new();
        if !custom {
            for card in &setup.pool {
                if let Some(code) = card
                    .id
                    .strip_prefix("limited:")
                    .and_then(|r| r.split(':').next())
                {
                    if !codes.iter().any(|c| c.eq_ignore_ascii_case(code)) {
                        codes.push(code.to_string());
                    }
                }
            }
        }
        if custom || codes.is_empty() {
            let cards = to_instances(&setup.pool);
            if cards.is_empty() {
                return Err("Custom pool is empty".into());
            }
            let cards_per_pack = 15u8;
            let required =
                usize::from(seats) * usize::from(pack_count) * usize::from(cards_per_pack);
            if cards.len() < required {
                return Err(format!(
                    "Custom pool needs at least {required} cards for {seats} seats × {pack_count} packs; got {}",
                    cards.len()
                ));
            }
            // A custom pool is projected as a one-sheet set so Draft, Sealed and
            // Winston all accept it through the same `PackSource`.
            let pool = cube_pool(&cards);
            validate_pool(&pool)?;
            return Ok(LimitSource {
                source: Box::new(PackGenerator::new(pool)),
                draft_source: DraftSource::Set {
                    layout: SetLayout::UniformByRound {
                        codes: vec!["CUBE".into()],
                    },
                },
                set_code: "CUBE".into(),
                cards_per_pack,
            });
        }
        if codes.len() == 1 {
            let pool = self.load_pool(&codes[0])?;
            verify_pool(&setup.pool, std::slice::from_ref(&pool))?;
            let cards_per_pack = pool.cards_per_pack().ok_or("Invalid pack size")?;
            return Ok(LimitSource {
                source: Box::new(PackGenerator::new(pool.clone())),
                draft_source: DraftSource::Set {
                    layout: SetLayout::UniformByRound {
                        codes: vec![pool.code.clone()],
                    },
                },
                set_code: pool.code.clone(),
                cards_per_pack,
            });
        }
        // Several standard sets merged by the client (Chaos Draft). Draw a real
        // per-seat, per-round assignment so each booster keeps its collation.
        let pools: Vec<LimitedSetPool> = codes
            .iter()
            .map(|c| self.load_pool(c))
            .collect::<Result<_>>()?;
        verify_pool(&setup.pool, &pools)?;
        let cards_per_pack = pools[0].cards_per_pack().ok_or("Invalid pack size")?;
        let assignments = PackGenerator::chaos_assignments(&codes, seats, pack_count, seed)
            .map_err(|e| e.to_string())?;
        let source = PackGenerator::for_chaos(pools, &codes, &assignments, seats, pack_count)
            .map_err(|e| e.to_string())?;
        Ok(LimitSource {
            source: Box::new(source),
            draft_source: DraftSource::Set {
                layout: SetLayout::Chaos {
                    candidate_codes: codes.clone(),
                    assignments,
                },
            },
            set_code: codes[0].clone(),
            cards_per_pack,
        })
    }
    /// Implements the existing UI invoke command/argument DTO surface.
    pub fn invoke(&mut self, command: &str, args: Value) -> Result<Value> {
        match command {
            "limited_list_sets" => self.list_sets(),
            "limited_get_set_pool" => {
                Ok(json!(pool_cards(&self.load_pool(text(&args, "setCode")?)?)))
            }
            "limited_get_edition_info" => {
                let p = self.load_pool(text(&args, "setCode")?)?;
                Ok(
                    json!({"code":p.code,"name":p.name,"editionType":"MTGJSON", "date":p.release_date,
                    "slots":[{"label":"MTGJSON booster","count":p.cards_per_pack()}],
                    "foilChance":0,"foilType":"MTGJSON sheet collation","variants":[],"hasReplacementHooks":false}),
                )
            }
            "limited_list_sealed_templates" => Ok(
                json!([{"id":"standard","label":"Standard Sealed","description":"Six MTGJSON set boosters","numPacks":6}]),
            ),
            "limited_list_chaos_themes" => Ok(json!([
                {"tag":"STANDARD","label":"Standard window (last 3 years)","orderNumber":1},
                {"tag":"PIONEER","label":"Pioneer window (2012+)","orderNumber":2},
                {"tag":"MODERN","label":"Modern window (2003+)","orderNumber":3},
                {"tag":"DEFAULT","label":"All downloaded sets","orderNumber":4}
            ])),
            "limited_list_conspiracy_hooks" => Ok(json!([{
                "cardName": "Cogwork Librarian",
                "flagName": "additional_pick",
                "description": "As you draft a card, you may draft an additional card from that booster pack, then return Cogwork Librarian to the pack (CR 905.2)."
            }])),
            "limited_start_booster_draft" | "limited_start_sealed" => {
                let setup = parse_setup(&args)?;
                let seed = setup.seed.unwrap_or_else(rand::random);
                if command == "limited_start_sealed" {
                    let custom = setup.pool_type.as_deref() == Some("Custom");
                    if !custom && setup.pool_type.as_deref() != Some("Full") {
                        return Err("Sealed requires poolType Full or Custom".into());
                    }
                    if setup.pod_size.is_some()
                        || setup.rounds.is_some()
                        || setup.picks_per_pass.is_some()
                    {
                        return Err("Sealed does not take pod size, rounds or picks".into());
                    }
                    let pack_count = setup.num_boosters.unwrap_or(6);
                    // A custom (Cube) pool rarely holds the 720 cards eight
                    // 15-card-pack seats need, so size the pod to the pool.
                    let seats = if custom {
                        (setup.pool.len() / (usize::from(pack_count) * 15)).clamp(2, 8) as u8
                    } else {
                        8u8
                    };
                    let src = self.build_source(&setup, seats, pack_count, seed)?;
                    let id = self.id("sealed");
                    let session =
                        start_session(&id, DraftKind::Sealed, seats, pack_count, src, seed)?;
                    let suggested = build_deck(&session.pools[0], "Suggested deck")?;
                    let opponents = session
                        .pools
                        .iter()
                        .enumerate()
                        .skip(1)
                        .map(|(i, p)| build_deck(p, &format!("AI {i}")))
                        .collect::<Result<Vec<_>>>()?;
                    let value = sealed_view(&id, &session, &suggested, &opponents);
                    self.sealed.insert(
                        id,
                        Sealed {
                            session,
                            suggested,
                            opponents,
                        },
                    );
                    Ok(value)
                } else {
                    let pod = setup.pod_size.ok_or("Draft requires podSize")?;
                    if !(2..=8).contains(&pod) {
                        return Err("Draft pod size must be between 2 and 8".into());
                    }
                    let rounds = setup.rounds.unwrap_or(3);
                    if rounds != 3 {
                        return Err("Standard Draft uses three packs".into());
                    }
                    if setup.picks_per_pass.unwrap_or(1) != 1 {
                        return Err("Standard Draft uses one pick per pass".into());
                    }
                    let src = self.build_source(&setup, pod, rounds, seed)?;
                    let id = self.id("draft");
                    let session = start_session(&id, DraftKind::Quick, pod, rounds, src, seed)?;
                    let value = draft_view(&session, &[], false, false);
                    let rng = ChaCha20Rng::seed_from_u64(session.config.rng_seed);
                    self.drafts.insert(
                        id,
                        Draft {
                            current: Snapshot { session, rng },
                            undo: Vec::new(),
                            pending: Vec::new(),
                            pending_effect: false,
                            commander_draft: false,
                        },
                    );
                    Ok(value)
                }
            }
            "limited_start_winston" => {
                let setup = parse_setup(&args)?;
                let seats = 2u8;
                // WotC "Casual Formats": each player supplies three packs, so
                // the shared stack is `packs_per_player × seats` boosters.
                let pack_count = DraftKind::Winston.procedure().packs_per_player;
                let seed = setup.seed.unwrap_or_else(rand::random);
                let src = self.build_source(&setup, seats, pack_count, seed)?;
                let id = self.id("winston");
                let session = start_session(&id, DraftKind::Winston, seats, pack_count, src, seed)?;
                let mut snapshot = Snapshot {
                    session,
                    rng: ChaCha20Rng::seed_from_u64(seed),
                };
                run_winston_bots(&mut snapshot)?;
                let value = winston_view(&id, &snapshot.session);
                self.winston.insert(id, snapshot);
                Ok(value)
            }
            "limited_get_winston_state" | "limited_winston_take" | "limited_winston_pass" => {
                let id = text(&args, "sessionId")?;
                let snapshot = self
                    .winston
                    .get_mut(id)
                    .ok_or("Unknown local Winston session")?;
                if command != "limited_get_winston_state" {
                    apply_winston_human(snapshot, command == "limited_winston_take")?;
                    run_winston_bots(snapshot)?;
                }
                Ok(winston_view(id, &snapshot.session))
            }
            "limited_start_commander_draft" => {
                let setup = parse_setup(&args)?;
                let pod = setup.pod_size.unwrap_or(4);
                if !(3..=8).contains(&pod) {
                    return Err("Commander Draft needs a pod of 3 to 8 seats".into());
                }
                let seed = setup.seed.unwrap_or_else(rand::random);
                let procedure = DraftKind::CommanderDraft.procedure();
                let pack_count = procedure.packs_per_player;
                let src = self.build_source(&setup, pod, pack_count, seed)?;
                let id = self.id("commander-draft");
                let session =
                    start_session(&id, DraftKind::CommanderDraft, pod, pack_count, src, seed)?;
                let value = draft_view(&session, &[], true, false);
                let rng = ChaCha20Rng::seed_from_u64(session.config.rng_seed);
                self.drafts.insert(
                    id,
                    Draft {
                        current: Snapshot { session, rng },
                        undo: Vec::new(),
                        pending: Vec::new(),
                        pending_effect: false,
                        commander_draft: true,
                    },
                );
                Ok(value)
            }
            "limited_get_draft_state" | "limited_pick_card" | "limited_undo_pick" => {
                let draft = self
                    .drafts
                    .get_mut(text(&args, "sessionId")?)
                    .ok_or("Unknown local draft session")?;
                if command == "limited_undo_pick" {
                    draft.current = draft.undo.pop().ok_or("No draft pick to undo")?;
                    draft.pending.clear();
                    draft.pending_effect = false;
                } else if command == "limited_pick_card" {
                    let mut next = draft.current.clone();
                    let name = text(&args, "cardName")?;
                    let set = text(&args, "setCode")?;
                    let number = text(&args, "cardNumber")?;
                    // Prefer the engine instance id when the client sends it:
                    // two copies of one printing in a pack are distinct
                    // instances, and name lookup cannot tell them apart. The
                    // only local source of in-pack duplicates is a CR 905.2
                    // effect returning a card to its own pack.
                    let card_id = args.get("cardId").and_then(Value::as_str);
                    let id = next.session.current_pack[0]
                        .as_ref()
                        .and_then(|pack| {
                            pack.0
                                .iter()
                                .find(|c| match card_id {
                                    Some(card_id) => c.instance_id == card_id,
                                    None => {
                                        c.name == name
                                            && c.set_code.eq_ignore_ascii_case(set)
                                            && c.collector_number == number
                                    }
                                })
                                .map(|c| c.instance_id.clone())
                        })
                        .ok_or("Selected card is not in the current pack")?;
                    if draft.pending.contains(&id) {
                        return Err("That card is already selected for this pick step".into());
                    }
                    let use_effect = if draft.pending.is_empty() {
                        match args.get("useDraftEffect") {
                            None => false,
                            Some(value) => value.as_bool().ok_or("useDraftEffect must be a boolean")?,
                        }
                    } else {
                        draft.pending_effect
                    };
                    let (required, effect) = human_pick_step(&next.session, use_effect);
                    if use_effect && effect.is_none() {
                        return Err("No additional-pick effect is available".into());
                    }
                    let mut pending = draft.pending.clone();
                    pending.push(id);
                    if pending.len() < required {
                        draft.pending = pending;
                        draft.pending_effect = use_effect;
                        return Ok(draft_view(
                            &draft.current.session,
                            &draft.pending,
                            draft.commander_draft,
                            draft.pending_effect,
                        ));
                    }
                    pick_and_bots(&mut next, pending, effect)?;
                    draft.pending.clear();
                    draft.pending_effect = false;
                    // Commit only after every reducer action succeeds. Undo includes bot RNG.
                    draft.undo.push(std::mem::replace(&mut draft.current, next));
                }
                Ok(draft_view(
                    &draft.current.session,
                    &draft.pending,
                    draft.commander_draft,
                    draft.pending_effect,
                ))
            }
            "limited_get_sealed_pool" => {
                let id = text(&args, "sessionId")?;
                let sealed = self.sealed.get(id).ok_or("Unknown local sealed session")?;
                Ok(sealed_view(
                    id,
                    &sealed.session,
                    &sealed.suggested,
                    &sealed.opponents,
                ))
            }
            "limited_commander_draft_info" => {
                let draft = self
                    .drafts
                    .get(text(&args, "sessionId")?)
                    .ok_or("Unknown local draft session")?;
                if !draft.commander_draft {
                    return Err("Not a Commander Draft session".into());
                }
                let commanders: Vec<String> = draft.current.session.pools[0]
                    .iter()
                    .filter(|c| eligible_commander(c))
                    .map(|c| c.name.clone())
                    .collect();
                Ok(json!({"commanders": commanders, "minDeckSize": 60}))
            }
            "limited_start_commander_game" => {
                let id = text(&args, "sessionId")?;
                let draft = self.drafts.get(id).ok_or("Unknown local draft session")?;
                if !draft.commander_draft {
                    return Err("Not a Commander Draft session".into());
                }
                let s = &draft.current.session;
                if s.status != DraftStatus::Deckbuilding {
                    return Err("Finish drafting before playing the Commander game".into());
                }
                let commander = text(&args, "commander")?.to_string();
                let main: Vec<Card> =
                    serde_json::from_value(args.get("main").cloned().ok_or("Missing main")?)
                        .map_err(|e| e.to_string())?;
                let sideboard: Vec<Card> =
                    serde_json::from_value(args.get("sideboard").cloned().unwrap_or(json!([])))
                        .map_err(|e| e.to_string())?;
                let pool = &s.pools[0];
                let basics = DeckAddableCards::standard_basics();
                if !pool.iter().any(|c| c.name == commander) {
                    return Err("Commander must be a card you drafted".into());
                }
                let main_names: Vec<String> = main.iter().map(|c| c.name.clone()).collect();
                if !main_names.iter().any(|n| n == &commander) {
                    return Err(
                        "The commander must be one of the main-deck cards you submit".into(),
                    );
                }
                let all_names: Vec<String> = pool.iter().map(|c| c.name.clone()).collect();
                validate_limited_deck(
                    &main_names,
                    &all_names,
                    &basics,
                    60,
                    &[],
                    std::slice::from_ref(&commander),
                    1,
                )
                .map_err(|errors| {
                    errors
                        .iter()
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                        .join("; ")
                })?;
                let mut remaining = pool.clone();
                for card in main.iter().chain(&sideboard) {
                    if basics.is_addable(&card.name) {
                        continue;
                    }
                    let i = remaining
                        .iter()
                        .position(|p| p.name == card.name)
                        .ok_or("Deck contains a card not in your draft pool")?;
                    remaining.remove(i);
                }
                if !remaining.is_empty() {
                    return Err("Every unused pool card must remain in the sideboard".into());
                }
                let opponents = (1..s.pools.len()).map(|seat| {
                    let commander = pick_commander(&s.pools[seat])
                        .ok_or_else(|| format!("AI {seat} has no eligible commander"))?;
                    let deck = build_commander_deck(&s.pools[seat], &commander, &format!("AI {seat}"))?;
                    Ok(json!({"deck": deck.main.iter().filter(|c| c.name != commander).map(|c| c.name.clone()).collect::<Vec<_>>(),
                        "commanders": [commander]}))
                }).collect::<Result<Vec<_>>>()?;
                // The host wire format keeps the commander out of the library.
                let mut human_deck = main_names.clone();
                if let Some(pos) = human_deck.iter().position(|n| n == &commander) {
                    human_deck.remove(pos);
                }
                Ok(
                    json!({"humanDeck": human_deck, "humanCommanders":[commander],
                    "humanSideboard": sideboard.iter().map(|c| c.name.clone()).collect::<Vec<_>>(),
                    "opponents": opponents}),
                )
            }
            "limited_start_gauntlet_from_draft" => {
                let draft = self
                    .drafts
                    .get(text(&args, "sessionId")?)
                    .ok_or("Unknown local draft session")?;
                let s = &draft.current.session;
                if s.status != DraftStatus::Deckbuilding {
                    return Err("Finish drafting before starting matches".into());
                }
                let rounds =
                    args.get("rounds")
                        .and_then(Value::as_u64)
                        .filter(|n| *n >= 1 && *n < s.pools.len() as u64)
                        .ok_or("Invalid number of draft opponents")? as usize;
                let human = submitted_deck(&args, &s.pools[0])?;
                let opponents = s
                    .pools
                    .iter()
                    .enumerate()
                    .skip(1)
                    .take(rounds)
                    .map(|(i, p)| build_deck(p, &format!("AI {i}")))
                    .collect::<Result<Vec<_>>>()?;
                let opponent_conspiracies = s
                    .pools
                    .iter()
                    .skip(1)
                    .take(rounds)
                    .map(|p| {
                        p.iter()
                            .filter(|c| c.type_line.contains("Conspiracy"))
                            .map(|c| c.name.clone())
                            .collect()
                    })
                    .collect();
                let gauntlet = Gauntlet {
                    kind: "draft",
                    human,
                    pool: s.pools[0].clone(),
                    opponents,
                    opponent_conspiracies,
                    round: 1,
                    wins: 0,
                    losses: 0,
                    round_recorded: false,
                };
                let id = self.id("gauntlet");
                let view = gauntlet_view(&id, &gauntlet);
                self.gauntlets.insert(id, gauntlet);
                Ok(view)
            }
            "limited_start_gauntlet_from_sealed" => {
                let sealed = self
                    .sealed
                    .get(text(&args, "sessionId")?)
                    .ok_or("Unknown local sealed session")?;
                let rounds = args
                    .get("rounds")
                    .and_then(Value::as_u64)
                    .filter(|n| (1..=7).contains(n))
                    .ok_or("Gauntlet rounds must be between 1 and 7")?
                    as usize;
                let human = submitted_deck(&args, &sealed.session.pools[0])?;
                let opponent_conspiracies = sealed
                    .session
                    .pools
                    .iter()
                    .skip(1)
                    .take(rounds)
                    .map(|p| {
                        p.iter()
                            .filter(|c| c.type_line.contains("Conspiracy"))
                            .map(|c| c.name.clone())
                            .collect()
                    })
                    .collect();
                let gauntlet = Gauntlet {
                    kind: "sealed",
                    human,
                    pool: sealed.session.pools[0].clone(),
                    opponents: sealed.opponents[..rounds].to_vec(),
                    opponent_conspiracies,
                    round: 1,
                    wins: 0,
                    losses: 0,
                    round_recorded: false,
                };
                let id = self.id("gauntlet");
                let view = gauntlet_view(&id, &gauntlet);
                self.gauntlets.insert(id, gauntlet);
                Ok(view)
            }
            "limited_get_gauntlet_state"
            | "limited_get_gauntlet_match_decks"
            | "limited_update_gauntlet_human_deck"
            | "limited_record_gauntlet_outcome"
            | "limited_advance_gauntlet_round" => {
                let id = text(&args, "gauntletId")?;
                let g = self.gauntlets.get_mut(id).ok_or("Unknown local gauntlet")?;
                match command {
                    "limited_update_gauntlet_human_deck" => {
                        g.human = submitted_deck(&args, &g.pool)?;
                    }
                    "limited_get_gauntlet_match_decks" => {
                        let opponent = &g.opponents[g.round - 1];
                        let conspiracies = conspiracy_names(&g.human, &g.pool);
                        let opponent_conspiracies = &g.opponent_conspiracies[g.round - 1];
                        let human_sideboard: Vec<_> = g
                            .human
                            .sideboard
                            .iter()
                            .filter(|c| !conspiracies.contains(&c.name))
                            .collect();
                        let opponent_sideboard: Vec<_> = opponent
                            .sideboard
                            .iter()
                            .filter(|c| !opponent_conspiracies.contains(&c.name))
                            .collect();
                        return Ok(
                            json!({"humanDeckName":g.human.name,"humanMain":g.human.main,"humanSideboard":human_sideboard,
                            "humanConspiracies":conspiracies,"opponentConspiracies":opponent_conspiracies,
                            "opponentName":opponent.name,"opponentMain":opponent.main,"opponentSideboard":opponent_sideboard}),
                        );
                    }
                    "limited_record_gauntlet_outcome" => {
                        if g.round_recorded {
                            return Err("Round outcome already recorded".into());
                        }
                        let _won_game = boolean(&args, "wonGame")?;
                        let over = boolean(&args, "matchOver")?;
                        let won = boolean(&args, "matchWon")?;
                        let outcome = if !over {
                            "matchInProgress"
                        } else {
                            g.round_recorded = true;
                            if won {
                                g.wins += 1;
                            } else {
                                g.losses += 1;
                            }
                            if !won {
                                "lostRound"
                            } else if g.round == g.opponents.len() {
                                "wonTournament"
                            } else {
                                "advanceNextRound"
                            }
                        };
                        return Ok(json!({"state":gauntlet_view(id,g),"outcome":outcome,
                            "nextRoundIndex":if over && g.round < g.opponents.len() {Some(g.round+1)} else {None}}));
                    }
                    "limited_advance_gauntlet_round" => {
                        if !g.round_recorded || g.round == g.opponents.len() {
                            return Err("No completed round available to advance".into());
                        }
                        g.round += 1;
                        g.round_recorded = false;
                    }
                    _ => {}
                }
                Ok(gauntlet_view(id, g))
            }
            _ => Err(format!(
                "Local Limited command '{command}' is not implemented. Only standard set Quick Draft and six-pack Sealed (one human versus AI) are supported; no variants, custom pools or networking."
            )),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Setup {
    pool: Vec<Card>,
    variant: Option<String>,
    seed: Option<u64>,
    #[serde(default)]
    custom_pool: bool,
    #[serde(default)]
    #[allow(dead_code)]
    singleton: bool,
    pod_size: Option<u8>,
    rounds: Option<u8>,
    picks_per_pass: Option<u8>,
    pool_type: Option<String>,
    num_boosters: Option<u8>,
    #[allow(dead_code)]
    pool_packs: Option<u8>,
}
fn text<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing string argument {key}"))
}
fn boolean(args: &Value, key: &str) -> Result<bool> {
    args.get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| format!("Missing boolean argument {key}"))
}
fn pool_cards(pool: &LimitedSetPool) -> Vec<Card> {
    pool.prints
        .iter()
        .filter(|p| p.booster_eligible)
        .map(|p| Card {
            id: format!("limited:{}:{}", pool.code, p.print_id),
            name: p.name.clone(),
            set_code: p.set_code.clone(),
            card_number: p.collector_number.clone(),
            foil: false,
        })
        .collect()
}

/// The submitted pool must be exactly the union of the loaded set pools, so a
/// tampered card list cannot silently become a custom draft.
fn verify_pool(supplied: &[Card], pools: &[LimitedSetPool]) -> Result<()> {
    let mut expected: Vec<Card> = pools.iter().flat_map(pool_cards).collect();
    let mut supplied = supplied.to_vec();
    expected.sort();
    supplied.sort();
    if supplied != expected {
        return Err(
            "Modified/custom set pools are not supported; fetch the complete standard set pool again"
                .into(),
        );
    }
    Ok(())
}

/// Client card identities → draft instances. The client pool carries no rarity,
/// colours or type line, so bots fall back to name/rarity-free heuristics;
/// packs still carry the true set code and collector number.
fn to_instances(cards: &[Card]) -> Vec<DraftCardInstance> {
    cards
        .iter()
        .enumerate()
        .map(|(i, c)| DraftCardInstance {
            instance_id: if c.id.is_empty() {
                format!("custom:{i}:{}", c.card_number)
            } else {
                c.id.clone()
            },
            name: c.name.clone(),
            set_code: c.set_code.clone(),
            collector_number: c.card_number.clone(),
            rarity: "common".into(),
            colors: Vec::new(),
            cmc: 0,
            type_line: String::new(),
            draft_effect: None,
        })
        .collect()
}

fn parse_setup(args: &Value) -> Result<Setup> {
    serde_json::from_value(args.get("setup").cloned().ok_or("Missing setup")?)
        .map_err(|e| format!("Invalid Limited setup: {e}"))
}

/// Project a client card list as a single-sheet set pool so Draft, Sealed and
/// Winston all deal it through the same `PackGenerator` collation path.
fn cube_pool(cards: &[DraftCardInstance]) -> LimitedSetPool {
    let sheet_cards: Vec<SheetCard> = cards
        .iter()
        .map(|c| SheetCard {
            name: c.name.clone(),
            set_code: c.set_code.clone(),
            collector_number: c.collector_number.clone(),
            rarity: Rarity::Common,
            weight: 1,
            colors: Vec::new(),
            cmc: 0,
            type_line: String::new(),
            draft_effect: None,
        })
        .collect();
    let prints: Vec<LimitedCardPrint> = cards
        .iter()
        .map(|c| LimitedCardPrint {
            print_id: c.instance_id.clone(),
            name: c.name.clone(),
            set_code: c.set_code.clone(),
            collector_number: c.collector_number.clone(),
            rarity: Rarity::Common,
            booster_eligible: true,
        })
        .collect();
    let mut sheets = BTreeMap::new();
    sheets.insert(
        "cube".into(),
        SheetDefinition {
            cards: sheet_cards,
            total_weight: cards.len() as u64,
            allow_duplicates: false,
            fixed: false,
            foil: false,
            balance_colors: false,
        },
    );
    LimitedSetPool {
        code: "CUBE".into(),
        name: "Custom pool".into(),
        release_date: None,
        pack_variants: vec![PackVariant {
            contents: vec![PackSlot {
                slot: "cube".into(),
                count: 15,
                choices: vec![WeightedSheetChoice {
                    sheet: "cube".into(),
                    weight: 1,
                }],
            }],
            weight: 1,
        }],
        pack_variants_total_weight: 1,
        sheets,
        prints,
        basic_lands: ["Plains", "Island", "Swamp", "Mountain", "Forest"]
            .iter()
            .map(ToString::to_string)
            .collect(),
    }
}

/// Refuse incomplete resources rather than triggering PackGenerator's legacy
/// missing-sheet backfill. No fabricated common substitutes for bonus sheets.
fn validate_pool(pool: &LimitedSetPool) -> Result<()> {
    let invalid = |reason: &str| {
        format!(
            "Unsupported or incomplete MTGJSON booster data for {}: {reason}. Re-extract with all referenced set files present.",
            pool.code
        )
    };
    if pool.cards_per_pack().is_none_or(|n| n == 0) || pool.prints.is_empty() {
        return Err(invalid("no uniform nonempty pack/printing catalog"));
    }
    let variants: u64 = pool.pack_variants.iter().map(|v| u64::from(v.weight)).sum();
    if variants == 0 || variants != u64::from(pool.pack_variants_total_weight) {
        return Err(invalid("invalid variant weights"));
    }
    for variant in &pool.pack_variants {
        for slot in &variant.contents {
            if slot.choices.is_empty() || slot.choices.iter().all(|c| c.weight == 0) {
                return Err(invalid("empty weighted slot"));
            }
            for choice in &slot.choices {
                let sheet = pool
                    .sheets
                    .get(&choice.sheet)
                    .ok_or_else(|| invalid("missing referenced sheet"))?;
                let total = sheet
                    .cards
                    .iter()
                    .try_fold(0u64, |n, c| n.checked_add(c.weight))
                    .ok_or_else(|| invalid("sheet weight overflow"))?;
                if total == 0
                    || total != sheet.total_weight
                    || sheet.cards.iter().any(|c| c.weight == 0)
                {
                    return Err(invalid("invalid sheet weights"));
                }
                if sheet.fixed && total != u64::from(slot.count) {
                    return Err(invalid("fixed sheet does not match slot count"));
                }
                if !sheet.fixed
                    && !sheet.allow_duplicates
                    && sheet.cards.len() < usize::from(slot.count)
                {
                    return Err(invalid("sheet too small; refusing replacement backfill"));
                }
                // CR 905.2 (Cogwork Librarian): the only DraftEffect variant is
                // `AdditionalPick`, and the host drives it through
                // `DraftAction::PickWithDraftEffect`, so such sheets are
                // supported rather than a reason to refuse the whole pool.
            }
        }
    }
    Ok(())
}
fn start_session(
    id: &str,
    kind: DraftKind,
    seats: u8,
    pack_count: u8,
    src: LimitSource,
    seed: u64,
) -> Result<DraftSession> {
    let procedure = kind.procedure();
    let config = DraftConfig {
        source: src.draft_source,
        set_code: src.set_code,
        kind,
        pod_size: seats,
        cards_per_pack: src.cards_per_pack,
        pack_count,
        min_deck_size: procedure.min_deck_size,
        addable_cards: DeckAddableCards::standard_basics(),
        rng_seed: seed,
        tournament_format: TournamentFormat::Swiss,
        pod_policy: PodPolicy::Casual,
        spectator_visibility: SpectatorVisibility::Public,
    };
    let seats = (0..seats)
        .map(|seat| {
            if seat == 0 {
                DraftSeat::Human {
                    player_id: PlayerId(0),
                    display_name: "You".into(),
                }
            } else {
                DraftSeat::Bot {
                    name: format!("AI {seat}"),
                }
            }
        })
        .collect();
    let mut session = DraftSession::new(config, seats, id.into());
    session::apply(
        &mut session,
        DraftAction::StartDraft,
        Some(src.source.as_ref()),
    )
    .map_err(|e| e.to_string())?;
    Ok(session)
}
/// The pooled card whose CR 905.2 draft effect this seat may still activate.
fn draft_effect_card(s: &DraftSession, seat: usize) -> Option<String> {
    s.pools[seat]
        .iter()
        .find(|card| matches!(card.draft_effect, Some(DraftEffect::AdditionalPick)))
        .map(|card| card.instance_id.clone())
}

/// The human must opt into CR 905.2; otherwise use the procedure's count.
/// The returned instance is the Librarian to return to the pack.
fn human_pick_step(s: &DraftSession, use_effect: bool) -> (usize, Option<String>) {
    let base = usize::from(s.config.kind.procedure().cards_per_pick);
    let pack_len = s.current_pack[0].as_ref().map_or(0, |p| p.0.len());
    match draft_effect_card(s, 0).filter(|_| use_effect && pack_len >= 2) {
        Some(effect) => (2, Some(effect)),
        None => (base.min(pack_len), None),
    }
}

fn pick_and_bots(
    snapshot: &mut Snapshot,
    human_ids: Vec<String>,
    human_effect: Option<String>,
) -> Result<()> {
    let s = &mut snapshot.session;
    let human_action = match human_effect {
        Some(effect_card_instance_id) if human_ids.len() == 2 => DraftAction::PickWithDraftEffect {
            seat: 0,
            effect_card_instance_id,
            card_instance_ids: human_ids,
        },
        _ => DraftAction::Pick {
            seat: 0,
            card_instance_ids: human_ids,
        },
    };
    session::apply(s, human_action, None).map_err(|e| e.to_string())?;
    let per_pick = usize::from(s.config.kind.procedure().cards_per_pick);
    for seat in 1..s.seats.len() {
        let effect = draft_effect_card(s, seat);
        let pack_len = s.current_pack[seat].as_ref().map_or(0, |p| p.0.len());
        if pack_len == 0 {
            return Err("Bot has an empty pack before passing".into());
        }
        // A CR 905.2 effect makes the bot's step two cards and returns the
        // effect card to the pack; otherwise the procedure's count applies.
        // Both clamp to the pack, so an odd final step takes what remains.
        let use_effect = effect.is_some() && pack_len >= 2;
        let take = if use_effect {
            2
        } else {
            per_pick.min(pack_len)
        };
        let pack = s.current_pack[seat].as_ref().expect("pack measured above");
        let mut remaining = pack.0.clone();
        let mut ids = Vec::with_capacity(take);
        for _ in 0..take {
            let i = bot_pick(
                &remaining,
                AiDifficulty::Medium,
                &s.pools[seat],
                None,
                &mut snapshot.rng,
            );
            ids.push(remaining.remove(i).instance_id);
        }
        let action = if use_effect {
            DraftAction::PickWithDraftEffect {
                seat: seat as u8,
                effect_card_instance_id: effect.expect("effect checked above"),
                card_instance_ids: ids,
            }
        } else {
            DraftAction::Pick {
                seat: seat as u8,
                card_instance_ids: ids,
            }
        };
        session::apply(s, action, None).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Apply the human's take/decline on the engine's current cursor, then let
/// every bot seat act until the human is on turn again or the draft completes.
fn apply_winston_human(snapshot: &mut Snapshot, take: bool) -> Result<()> {
    let s = &mut snapshot.session;
    if s.status != DraftStatus::Drafting {
        return Err("Winston draft is already complete".into());
    }
    let (seat, pile) = {
        let stack = s.shared_stack().map_err(|e| e.to_string())?;
        if stack.active_seat != 0 {
            return Err("It is not your turn in this Winston draft".into());
        }
        (stack.active_seat, stack.cursor)
    };
    let decision = if take {
        SharedStackPileDecision::Take
    } else {
        SharedStackPileDecision::Decline
    };
    session::apply(
        s,
        DraftAction::SharedStackDecision {
            seat,
            pile,
            decision,
        },
        None,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn run_winston_bots(snapshot: &mut Snapshot) -> Result<()> {
    let s = &mut snapshot.session;
    loop {
        if s.status != DraftStatus::Drafting {
            break;
        }
        let active = s.shared_stack().map_err(|e| e.to_string())?.active_seat;
        if active == 0 {
            break;
        }
        let player_view = view::filter_for_player(s, active);
        let Some((pile, decision)) = winston_decision(&player_view, AiDifficulty::Medium, None)
        else {
            break;
        };
        session::apply(
            s,
            DraftAction::SharedStackDecision {
                seat: active,
                pile,
                decision,
            },
            None,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn winston_view(id: &str, s: &DraftSession) -> Value {
    let complete = s.status != DraftStatus::Drafting;
    let (active_seat, current_pile, piles, deck_size) = match s.shared_stack() {
        Ok(st) => {
            // The client renders the active pile's cards and every other pile
            // face-down. Contents are shown only for the human's own turn.
            let piles: Vec<Vec<Card>> = st
                .piles
                .iter()
                .enumerate()
                .map(|(i, pile)| {
                    if st.active_seat == 0 && i == usize::from(st.cursor) {
                        pile.iter().map(Card::from).collect()
                    } else {
                        // Face-down elsewhere: keep the height the UI renders,
                        // without shipping the hidden cards to the client.
                        (0..pile.len())
                            .map(|n| Card {
                                id: format!("hidden-{i}-{n}"),
                                name: String::new(),
                                set_code: String::new(),
                                card_number: String::new(),
                                foil: false,
                            })
                            .collect()
                    }
                })
                .collect();
            let remaining = st.main_stack.len() + st.piles.iter().map(Vec::len).sum::<usize>();
            (st.active_seat, st.cursor, piles, remaining)
        }
        Err(_) => (0, 0, Vec::new(), 0),
    };
    let ai_picks = s.pools.iter().skip(1).map(Vec::len).sum::<usize>();
    json!({"sessionId":id,"activeSeat":active_seat,"currentPile":current_pile,"piles":piles,
        "deckSize":deck_size,"pickedPile":s.pools[0].iter().map(Card::from).collect::<Vec<_>>(),
        "aiPickCount":ai_picks,"awaitingHuman":!complete && active_seat==0,"isComplete":complete})
}
fn draft_view(s: &DraftSession, pending: &[String], commander_draft: bool, pending_effect: bool) -> Value {
    let complete = s.status != DraftStatus::Drafting;
    let pack: Vec<Card> = s.current_pack[0]
        .as_ref()
        .map(|p| {
            p.0.iter()
                .filter(|c| !pending.contains(&c.instance_id))
                .map(Card::from)
                .collect()
        })
        .unwrap_or_default();
    let (required, _) = human_pick_step(s, pending_effect);
    // CR 905.4: only conspiracy cards can start in the command zone.
    // Draft abilities do not make creatures such as Cogwork Librarian conspiracies.
    let effects: Vec<Card> = s.pools[0]
        .iter()
        .filter(|card| card.type_line.contains("Conspiracy"))
        .map(Card::from)
        .collect();
    let seats: Vec<Value> = s.seats.iter().enumerate().map(|(i,_)| json!({"seat":i,"name":if i==0 {"You".into()} else {format!("AI {i}")},
        "isHuman":i==0,"picksMade":s.pools[i].len(),"lastPickName":s.pools[i].last().map(|c|&c.name),
        "currentPackSize":s.current_pack[i].as_ref().map_or(0,|p|p.0.len()),"packsWaiting":0,"awaitingPick":!complete})).collect();
    json!({"sessionId":s.draft_code,"round":s.current_pack_number+1,"totalRounds":s.config.pack_count,
        "pickNumber":s.pick_number+1,"packSize":s.cards_in_pack(s.current_pack_number),"currentPack":pack,
        "pickedPile":s.pools[0].iter().map(Card::from).collect::<Vec<_>>(),"seatSummaries":seats,
        "isRoundOver":complete,"isComplete":complete,"awaitingHuman":!complete,
        "humanConspiracies":effects.iter().map(|c| c.name.clone()).collect::<Vec<_>>(),"picksPerPass":required,
        "picksRemainingInPack":if complete {0} else {required.saturating_sub(pending.len())},
        "draftEffectAvailable":!complete && pending.is_empty() && human_pick_step(s, true).1.is_some(),
        "draftEffectActive":pending_effect,
        "commanderDraft":commander_draft, "minDeckSize":s.config.min_deck_size,
        "passDirection":match s.pass_direction {PassDirection::Left=>"left",PassDirection::Right=>"right"}})
}
fn build_deck(pool: &[DraftCardInstance], name: &str) -> Result<Deck> {
    let playable: Vec<_> = pool
        .iter()
        .filter(|c| !c.type_line.contains("Conspiracy"))
        .cloned()
        .collect();
    let suggested = suggest_deck(
        &playable,
        AiDifficulty::Medium,
        None,
        40,
        0,
        &DeckAddableCards::standard_basics(),
    );
    let mut remaining: Vec<Card> = pool.iter().map(Card::from).collect();
    let mut main = Vec::new();
    for name in suggested.main_deck {
        let index = remaining
            .iter()
            .position(|c| c.name == name)
            .ok_or("Suggested card absent from pool")?;
        main.push(remaining.remove(index));
    }
    let mut lands: Vec<_> = suggested.lands.into_iter().collect();
    lands.sort();
    for (name, count) in lands {
        for i in 0..count {
            main.push(Card {
                id: format!("basic:{name}:{i}"),
                name: name.clone(),
                set_code: String::new(),
                card_number: format!("basic-{}-{i}", name.to_ascii_lowercase()),
                foil: false,
            });
        }
    }
    let deck = Deck {
        name: name.into(),
        main,
        sideboard: remaining,
    };
    validate_deck(&deck, pool)?;
    Ok(deck)
}
fn pick_commander(pool: &[DraftCardInstance]) -> Option<String> {
    pool.iter()
        .find(|c| eligible_commander(c))
        .or_else(|| pool.iter().find(|c| c.type_line.contains("Creature")))
        .or_else(|| pool.first())
        .map(|c| c.name.clone())
}

fn eligible_commander(c: &DraftCardInstance) -> bool {
    (c.type_line.contains("Legendary") && c.type_line.contains("Creature"))
        || c.type_line.contains("Planeswalker")
}

/// Build a CR 903.13f AI deck: 59 main-deck cards plus the drafted commander.
fn build_commander_deck(pool: &[DraftCardInstance], commander: &str, name: &str) -> Result<Deck> {
    let basics = DeckAddableCards::standard_basics();
    let spells: Vec<DraftCardInstance> = pool
        .iter()
        .filter(|c| c.name != commander)
        .cloned()
        .collect();
    let suggested = suggest_deck(&spells, AiDifficulty::Medium, None, 59, 0, &basics);
    let mut remaining: Vec<Card> = spells.iter().map(Card::from).collect();
    let mut main = Vec::new();
    for n in suggested.main_deck {
        let index = remaining
            .iter()
            .position(|c| c.name == n)
            .ok_or("Suggested card absent from pool")?;
        main.push(remaining.remove(index));
    }
    let mut lands: Vec<_> = suggested.lands.into_iter().collect();
    lands.sort();
    for (land, count) in lands {
        for i in 0..count {
            main.push(Card {
                id: format!("basic:{land}:{i}"),
                name: land.clone(),
                set_code: String::new(),
                card_number: format!("basic-{}-{i}", land.to_ascii_lowercase()),
                foil: false,
            });
        }
    }
    // The commander is one of the deck's 60 cards (inclusive convention) and is
    // also designated separately.
    let commander_card = pool.iter().find(|c| c.name == commander).map(Card::from);
    let deck = Deck {
        name: name.into(),
        main,
        sideboard: remaining,
    };
    if let Some(card) = commander_card {
        // `main` was built from `spells` (commander excluded), so insert it.
        let mut with_commander = vec![card];
        with_commander.extend(deck.main);
        return finish_commander_deck(with_commander, deck.sideboard, pool, commander, name);
    }
    let names: Vec<String> = deck.main.iter().map(|c| c.name.clone()).collect();
    let pool_names: Vec<String> = pool.iter().map(|c| c.name.clone()).collect();
    validate_limited_deck(
        &names,
        &pool_names,
        &basics,
        60,
        &[],
        std::slice::from_ref(&commander.to_string()),
        1,
    )
    .map_err(|errors| {
        errors
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("; ")
    })?;
    Ok(deck)
}

fn finish_commander_deck(
    main: Vec<Card>,
    sideboard: Vec<Card>,
    pool: &[DraftCardInstance],
    commander: &str,
    name: &str,
) -> Result<Deck> {
    let basics = DeckAddableCards::standard_basics();
    let names: Vec<String> = main.iter().map(|c| c.name.clone()).collect();
    let pool_names: Vec<String> = pool.iter().map(|c| c.name.clone()).collect();
    validate_limited_deck(
        &names,
        &pool_names,
        &basics,
        60,
        &[],
        std::slice::from_ref(&commander.to_string()),
        1,
    )
    .map_err(|errors| {
        errors
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("; ")
    })?;
    Ok(Deck {
        name: name.into(),
        main,
        sideboard,
    })
}

fn validate_deck(deck: &Deck, pool: &[DraftCardInstance]) -> Result<()> {
    // CR 905.4: conspiracies come from the sideboard, never the library.
    if deck.main.iter().any(|c| {
        pool.iter()
            .any(|p| p.name == c.name && p.type_line.contains("Conspiracy"))
    }) {
        return Err("Conspiracy cards must be in the sideboard, not the main deck".into());
    }
    let names: Vec<String> = pool.iter().map(|c| c.name.clone()).collect();
    let main: Vec<String> = deck.main.iter().map(|c| c.name.clone()).collect();
    let all: Vec<String> = deck
        .main
        .iter()
        .chain(&deck.sideboard)
        .map(|c| c.name.clone())
        .collect();
    let basics = DeckAddableCards::standard_basics();
    for cards in [&main, &all] {
        validate_limited_deck(cards, &names, &basics, 40, &[], &[], 0).map_err(|errors| {
            errors
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("; ")
        })?;
    }
    // Validate printing identities as well as core's card-name multiset.
    let mut remaining: Vec<Card> = pool.iter().map(Card::from).collect();
    for card in deck.main.iter().chain(&deck.sideboard) {
        if basics.is_addable(&card.name) {
            continue;
        }
        let i = remaining
            .iter()
            .position(|p| {
                p.name == card.name
                    && p.set_code.eq_ignore_ascii_case(&card.set_code)
                    && p.card_number == card.card_number
            })
            .ok_or("Deck contains a printing not in this pool")?;
        remaining.remove(i);
    }
    if remaining.iter().any(|c| !basics.is_addable(&c.name)) {
        return Err("Every unused pool card must remain in the sideboard".into());
    }
    Ok(())
}
fn submitted_deck(args: &Value, pool: &[DraftCardInstance]) -> Result<Deck> {
    let deck = Deck {
        name: "Your Sealed deck".into(),
        main: serde_json::from_value(args.get("main").cloned().ok_or("Missing main")?)
            .map_err(|e| e.to_string())?,
        sideboard: serde_json::from_value(
            args.get("sideboard").cloned().ok_or("Missing sideboard")?,
        )
        .map_err(|e| e.to_string())?,
    };
    validate_deck(&deck, pool)?;
    Ok(deck)
}

/// CR 905.4: the drafted conspiracy cards the human submitted, which begin the
/// game in the command zone rather than the library or sideboard.
fn conspiracy_names(deck: &Deck, pool: &[DraftCardInstance]) -> Vec<String> {
    let in_deck: std::collections::HashSet<&str> = deck
        .main
        .iter()
        .chain(deck.sideboard.iter())
        .map(|c| c.name.as_str())
        .collect();
    pool.iter()
        .filter(|c| c.type_line.contains("Conspiracy") && in_deck.contains(c.name.as_str()))
        .map(|c| c.name.clone())
        .collect()
}
fn sealed_view(id: &str, s: &DraftSession, suggested: &Deck, opponents: &[Deck]) -> Value {
    json!({"sessionId":id,"deckName":format!("{} Sealed",s.set_code),"landSetCode":s.set_code,
        "cards":s.pools[0].iter().map(Card::from).collect::<Vec<_>>(),"suggestedDeck":suggested,"aiDecks":opponents})
}
#[cfg(test)]
mod conspiracy_tests {
    use super::*;

    #[test]
    fn optional_effect_uses_instance_ids_and_undo_restores_duplicates() {
        let mut service = LimitedService::default();
        let pool: Vec<Value> = (0..90).map(|i| json!({
            "id":format!("cube-{i}"), "name":format!("Card {i}"),
            "setCode":"CUBE", "cardNumber":i.to_string()
        })).collect();
        let initial = service.invoke("limited_start_booster_draft", json!({
            "setup":{"pool":pool,"customPool":true,"podSize":2,"rounds":3,"seed":3}
        })).unwrap();
        let id = initial["sessionId"].as_str().unwrap().to_owned();
        let draft = service.drafts.get_mut(&id).unwrap();
        let pack = &mut draft.current.session.current_pack[0].as_mut().unwrap().0;
        let mut duplicate = pack[0].clone();
        duplicate.instance_id = "duplicate-printing".into();
        pack[1] = duplicate;
        let mut librarian = pack[0].clone();
        librarian.instance_id = "librarian".into();
        librarian.name = "Cogwork Librarian".into();
        librarian.draft_effect = Some(DraftEffect::AdditionalPick);
        draft.current.session.pools[0].push(librarian);
        let before = service.invoke("limited_get_draft_state", json!({"sessionId":id})).unwrap();
        let cards = before["currentPack"].as_array().unwrap();
        let request = |card: &Value, effect: bool| json!({
            "sessionId":id,"cardId":card["id"],"cardName":card["name"],
            "setCode":card["setCode"],"cardNumber":card["cardNumber"],"useDraftEffect":effect
        });
        // Select the second copy first: printing-based lookup would select the wrong one.
        let buffered = service.invoke("limited_pick_card", request(&cards[1], true)).unwrap();
        assert_eq!(buffered["currentPack"][0]["id"], cards[0]["id"]);
        assert!(service.invoke("limited_pick_card", request(&cards[1], true)).is_err());
        let picked = service.invoke("limited_pick_card", request(&cards[0], false)).unwrap();
        assert_eq!(picked["pickedPile"].as_array().unwrap().len(), 2);
        let session = &service.drafts[&id].current.session;
        assert!(session.current_pack.iter().flatten().any(|p| p.0.iter().any(|c| c.instance_id == "librarian")));
        let restored = service.invoke("limited_undo_pick", json!({"sessionId":id})).unwrap();
        assert_eq!(restored, before);
        service.invoke("limited_pick_card", request(&cards[1], true)).unwrap();
        assert_eq!(service.invoke("limited_pick_card", request(&cards[0], false)).unwrap(), picked);
    }

    #[test]
    fn conspiracies_do_not_count_as_main_deck_cards_or_duplicate_pool_copies() {
        // Names and types verified against MTGJSON AtomicCards.
        let pool: Vec<DraftCardInstance> = [
            ("Power Play", "Conspiracy"),
            ("Cogwork Librarian", "Artifact Creature — Construct"),
        ]
        .into_iter()
        .enumerate()
        .map(|(i, (name, type_line))| DraftCardInstance {
            instance_id: i.to_string(),
            name: name.into(),
            set_code: "cns".into(),
            collector_number: i.to_string(),
            rarity: "uncommon".into(),
            colors: vec![],
            cmc: 0,
            type_line: type_line.into(),
            draft_effect: None,
        })
        .collect();
        let mut deck = build_deck(&pool, "test").unwrap();
        assert!(!deck.main.iter().any(|c| c.name == "Power Play"));
        assert_eq!(conspiracy_names(&deck, &pool), vec!["Power Play"]);
        let index = deck
            .sideboard
            .iter()
            .position(|c| c.name == "Power Play")
            .unwrap();
        let conspiracy = deck.sideboard.remove(index);
        deck.main.push(conspiracy.clone());
        assert!(validate_deck(&deck, &pool).is_err());
        deck.main.pop();
        deck.sideboard.extend([conspiracy.clone(), conspiracy]);
        assert!(validate_deck(&deck, &pool).is_err());
    }
}

fn gauntlet_view(id: &str, g: &Gauntlet) -> Value {
    let opponents: Vec<Value> = g.opponents.iter().enumerate().map(|(i,d)|json!({"round":i+1,"deckName":d.name,"mainCount":d.main.len(),"sideboardCount":d.sideboard.len()})).collect();
    let complete = g.round_recorded && g.round == g.opponents.len();
    json!({"gauntletId":id,"kind":g.kind,"rounds":g.opponents.len(),"currentRound":g.round,"wins":g.wins,"losses":g.losses,
        "completed":complete,"humanDeckName":g.human.name,"currentOpponent":if complete {None} else {opponents.get(g.round-1)},"opponents":opponents})
}
