// Also compiles the service independently of the HTTP integration module.
#[path = "../src/limited.rs"]
mod limited;

use limited::LimitedService;
use serde_json::{json, Value};
use std::path::PathBuf;

struct Fixture {
    directory: PathBuf,
    service: LimitedService,
}
impl Fixture {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "phase-mana-limited-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let cards: Vec<Value> = (0..30).map(|i|json!({"name":format!("Test Creature {i}"),"set_code":"TST","collector_number":i.to_string(),"rarity":"common","weight":1,"colors":["G"],"cmc":2,"type_line":"Legendary Creature"})).collect();
        let prints: Vec<Value> = (0..30).map(|i|json!({"print_id":i.to_string(),"name":format!("Test Creature {i}"),"set_code":"TST","collector_number":i.to_string(),"rarity":"common","booster_eligible":true})).collect();
        let pool = json!({"code":"TST","name":"Test set","release_date":null,
            "pack_variants":[{"weight":1,"contents":[{"slot":"common","count":15,"choices":[{"sheet":"common","weight":1}]}]}],
            "pack_variants_total_weight":1,"sheets":{"common":{"cards":cards,"total_weight":30,"foil":false,"balance_colors":false}},"prints":prints,"basic_lands":["Forest"]});
        std::fs::write(
            directory.join("TST.json"),
            serde_json::to_vec(&pool).unwrap(),
        )
        .unwrap();
        let service = LimitedService::new(Some(directory.clone()));
        Self { directory, service }
    }
    fn pool(&mut self) -> Value {
        self.service
            .invoke("limited_get_set_pool", json!({"setCode":"tst"}))
            .unwrap()
    }
    fn with_pool(code: &str, pool: Value) -> Self {
        let directory = std::env::temp_dir().join(format!(
            "phase-mana-limited-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(
            directory.join(format!("{code}.json")),
            serde_json::to_vec(&pool).unwrap(),
        )
        .unwrap();
        let service = LimitedService::new(Some(directory.clone()));
        Self { directory, service }
    }
    fn draft(&mut self, seats: u8) -> Value {
        let pool = self.pool();
        self.service
            .invoke(
                "limited_start_booster_draft",
                json!({"setup":{"pool":pool,"podSize":seats,"rounds":3,"seed":42}}),
            )
            .unwrap()
    }
    fn pick(&mut self, state: &Value) -> Value {
        let card = &state["currentPack"][0];
        self.service.invoke("limited_pick_card",json!({"sessionId":state["sessionId"],"cardName":card["name"],"setCode":card["setCode"],"cardNumber":card["cardNumber"]})).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

#[test]
fn drafts_complete_for_every_supported_pod_and_undo_replays_bots() {
    for seats in 2..=8 {
        let mut f = Fixture::new();
        let initial = f.draft(seats);
        assert_eq!(initial["currentPack"].as_array().unwrap().len(), 15);
        let first = f.pick(&initial);
        let restored = f
            .service
            .invoke(
                "limited_undo_pick",
                json!({"sessionId":initial["sessionId"]}),
            )
            .unwrap();
        assert_eq!(initial, restored);
        assert_eq!(first, f.pick(&restored));
        let mut state = first;
        for _ in 1..45 {
            state = f.pick(&state);
        }
        assert_eq!(state["isComplete"], true);
        assert_eq!(state["pickedPile"].as_array().unwrap().len(), 45);
        for seat in state["seatSummaries"].as_array().unwrap() {
            assert_eq!(seat["picksMade"], 45);
        }
        assert!(f.service.invoke("limited_pick_card",json!({"sessionId":state["sessionId"],"cardName":"bad","setCode":"TST","cardNumber":"0"})).is_err());
        let fetched = f
            .service
            .invoke(
                "limited_get_draft_state",
                json!({"sessionId":state["sessionId"]}),
            )
            .unwrap();
        assert_eq!(state, fetched);
        let cards = state["pickedPile"].as_array().unwrap();
        let g = f
            .service
            .invoke(
                "limited_start_gauntlet_from_draft",
                json!({
                    "sessionId": state["sessionId"], "rounds": seats - 1,
                    "main": &cards[..40], "sideboard": &cards[40..]
                }),
            )
            .unwrap();
        assert_eq!(g["kind"], "draft");
        assert_eq!(
            g["opponents"].as_array().unwrap().len(),
            usize::from(seats - 1)
        );
        let decks = f
            .service
            .invoke(
                "limited_get_gauntlet_match_decks",
                json!({"gauntletId":g["gauntletId"]}),
            )
            .unwrap();
        assert_eq!(decks["opponentMain"].as_array().unwrap().len(), 40);
    }
}
#[test]
fn sealed_six_packs_decks_validation_and_gauntlet_lifecycle() {
    let mut f = Fixture::new();
    let pool = f.pool();
    let sealed = f
        .service
        .invoke(
            "limited_start_sealed",
            json!({"setup":{"pool":pool,"poolType":"Full","numBoosters":6,"seed":1}}),
        )
        .unwrap();
    assert_eq!(sealed["cards"].as_array().unwrap().len(), 90);
    assert_eq!(sealed["aiDecks"].as_array().unwrap().len(), 7);
    for deck in sealed["aiDecks"].as_array().unwrap() {
        assert_eq!(deck["main"].as_array().unwrap().len(), 40);
    }
    let deck = &sealed["suggestedDeck"];
    let args = json!({"sessionId":sealed["sessionId"],"rounds":2,"main":deck["main"],"sideboard":deck["sideboard"]});
    let mut invalid = args.clone();
    invalid["main"][0]["name"] = json!("Not in pool");
    assert!(f
        .service
        .invoke("limited_start_gauntlet_from_sealed", invalid)
        .is_err());
    let g = f
        .service
        .invoke("limited_start_gauntlet_from_sealed", args)
        .unwrap();
    let id = &g["gauntletId"];
    assert!(f
        .service
        .invoke("limited_advance_gauntlet_round", json!({"gauntletId":id}))
        .is_err());
    let match_decks = f
        .service
        .invoke("limited_get_gauntlet_match_decks", json!({"gauntletId":id}))
        .unwrap();
    assert_eq!(match_decks["opponentMain"].as_array().unwrap().len(), 40);
    let outcome = json!({"gauntletId":id,"wonGame":true,"matchOver":true,"matchWon":true});
    let first = f
        .service
        .invoke("limited_record_gauntlet_outcome", outcome.clone())
        .unwrap();
    assert_eq!(first["outcome"], "advanceNextRound");
    assert!(f
        .service
        .invoke("limited_record_gauntlet_outcome", outcome.clone())
        .is_err());
    f.service
        .invoke("limited_advance_gauntlet_round", json!({"gauntletId":id}))
        .unwrap();
    let last = f
        .service
        .invoke("limited_record_gauntlet_outcome", outcome)
        .unwrap();
    assert_eq!(last["state"]["completed"], true);
    assert_eq!(last["state"]["wins"], 2);
}
#[test]
fn lists_only_loadable_valid_local_pools_and_reports_missing_resources() {
    let mut f = Fixture::new();
    let path = f.directory.join("TST.json");
    let mut data: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    data["code"] = json!("NEW");
    data["name"] = json!("New set");
    data["release_date"] = json!("2025-01-01");
    std::fs::write(f.directory.join("new.json"), serde_json::to_vec(&data).unwrap()).unwrap();
    std::fs::write(f.directory.join("BAD.json"), b"not json").unwrap();
    std::fs::write(f.directory.join("WRONG.json"), serde_json::to_vec(&data).unwrap()).unwrap();
    data["code"] = json!("BROKEN");
    data["sheets"] = json!({});
    std::fs::write(f.directory.join("BROKEN.json"), serde_json::to_vec(&data).unwrap()).unwrap();
    std::fs::write(f.directory.join("pending.json.tmp"), b"partial").unwrap();
    let sets = f.service.invoke("limited_list_sets", json!({})).unwrap();
    let sets = sets.as_array().unwrap();
    assert_eq!(sets.len(), 2);
    assert_eq!(sets[0]["code"], "new");
    assert_eq!(sets[0]["released_at"], "2025-01-01");
    assert_eq!(sets[1], json!({"object":"set", "id":"limited:tst", "code":"tst",
        "name":"Test set", "set_type":"local", "card_count":30, "digital":false, "icon_svg_uri":""}));
    for set in sets {
        assert!(f.service.invoke("limited_get_set_pool", json!({"setCode":set["code"]})).is_ok());
    }
    std::fs::remove_file(path).unwrap();
    std::fs::remove_file(f.directory.join("new.json")).unwrap();
    let error = f.service.invoke("limited_list_sets", json!({})).unwrap_err();
    assert!(error.contains("No playable local Limited pools"));
    assert!(error.contains("fetch-limited-pools.sh"));
    std::fs::remove_dir_all(&f.directory).unwrap();
    let error = f.service.invoke("limited_list_sets", json!({})).unwrap_err();
    assert!(error.contains("Cannot read local Limited pools"));
    assert!(error.contains("PHASE_MANA_DRAFT_POOLS"));
}

#[test]
fn refuses_resources_variants_custom_and_incomplete_collation() {
    let mut empty = LimitedService::new(Some(std::env::temp_dir().join(format!(
        "phase-mana-missing-{}", rand::random::<u64>()
    ))));
    assert!(empty
        .invoke("limited_get_set_pool", json!({"setCode":"TST"}))
        .unwrap_err()
        .contains("PHASE_MANA_DRAFT_POOLS"));
    let mut f = Fixture::new();
    let pool = f.pool();
    for option in [
        json!({"variant":"Commander"}),
        json!({"customPool":true}),
        json!({"picksPerPass":2}),
        json!({"rounds":4}),
        json!({"podSize":9}),
    ] {
        let mut setup = json!({"pool":pool,"podSize":8,"rounds":3});
        setup
            .as_object_mut()
            .unwrap()
            .extend(option.as_object().unwrap().clone());
        assert!(f
            .service
            .invoke("limited_start_booster_draft", json!({"setup":setup}))
            .is_err());
    }
    let mut altered = pool.clone();
    altered.as_array_mut().unwrap().pop();
    assert!(f
        .service
        .invoke(
            "limited_start_booster_draft",
            json!({"setup":{"pool":altered,"podSize":8,"rounds":3}})
        )
        .unwrap_err()
        .contains("Modified/custom"));
    let path = f.directory.join("TST.json");
    let mut data: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    data["sheets"]["common"]["cards"] = json!([]);
    std::fs::write(path, serde_json::to_vec(&data).unwrap()).unwrap();
    assert!(f
        .service
        .invoke("limited_get_set_pool", json!({"setCode":"TST"}))
        .unwrap_err()
        .contains("incomplete"));
    assert!(f
        .service
        .invoke("limited_start_winston", json!({}))
        .unwrap_err()
        .contains("setup"));
}

fn custom_pool(n: usize) -> Value {
    json!((0..n)
        .map(|i| json!({"id":format!("cube-{i}"),"name":format!("Cube Card {i}"),
            "setCode":"CUBE","cardNumber":i.to_string()}))
        .collect::<Vec<_>>())
}

fn write_second_set(f: &Fixture) {
    let path = f.directory.join("TST.json");
    let mut data: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    data["code"] = json!("TS2");
    data["name"] = json!("Second set");
    for card in data["sheets"]["common"]["cards"].as_array_mut().unwrap() {
        let i = card["collector_number"].as_str().unwrap().to_string();
        card["name"] = json!(format!("Second Creature {i}"));
    }
    for print in data["prints"].as_array_mut().unwrap() {
        let i = print["collector_number"].as_str().unwrap().to_string();
        print["name"] = json!(format!("Second Creature {i}"));
    }
    std::fs::write(
        f.directory.join("TS2.json"),
        serde_json::to_vec(&data).unwrap(),
    )
    .unwrap();
}

#[test]
fn winston_shared_stack_runs_to_completion_against_bots() {
    let mut f = Fixture::new();
    let pool = f.pool();
    let mut state = f
        .service
        .invoke(
            "limited_start_winston",
            json!({"setup":{"pool":pool,"poolPacks":6,"seed":7}}),
        )
        .unwrap();
    assert_eq!(state["piles"].as_array().unwrap().len(), 3);
    for _ in 0..2000 {
        if state["isComplete"] == true {
            break;
        }
        assert_eq!(state["awaitingHuman"], true, "bots must return control");
        let pile = state["currentPile"].as_u64().unwrap() as usize;
        let command = if state["piles"][pile].as_array().unwrap().is_empty() {
            "limited_winston_pass"
        } else {
            "limited_winston_take"
        };
        state = f
            .service
            .invoke(command, json!({"sessionId":state["sessionId"]}))
            .unwrap();
    }
    assert_eq!(state["isComplete"], true);
    assert!(!state["pickedPile"].as_array().unwrap().is_empty());
    assert!(state["aiPickCount"].as_u64().unwrap() > 0);
    let fetched = f
        .service
        .invoke(
            "limited_get_winston_state",
            json!({"sessionId":state["sessionId"]}),
        )
        .unwrap();
    assert_eq!(state, fetched);
    assert!(f
        .service
        .invoke(
            "limited_winston_pass",
            json!({"sessionId":state["sessionId"]}),
        )
        .is_err());
}

#[test]
fn custom_cube_pool_drafts_and_seals() {
    let mut f = Fixture::new();
    let draft = f
        .service
        .invoke(
            "limited_start_booster_draft",
            json!({"setup":{"pool":custom_pool(120),"podSize":2,"rounds":3,
                "seed":3,"customPool":true}}),
        )
        .unwrap();
    assert_eq!(draft["currentPack"].as_array().unwrap().len(), 15);
    let mut state = draft;
    for _ in 0..45 {
        state = f.pick(&state);
    }
    assert_eq!(state["isComplete"], true);
    assert_eq!(state["pickedPile"].as_array().unwrap().len(), 45);

    let sealed = f
        .service
        .invoke(
            "limited_start_sealed",
            json!({"setup":{"pool":custom_pool(180),"poolType":"Custom",
                "numBoosters":6,"seed":3,"singleton":true}}),
        )
        .unwrap();
    assert_eq!(sealed["cards"].as_array().unwrap().len(), 90);
    // 180 cards / (6 packs × 15) = two seats, so one AI opponent.
    assert_eq!(sealed["aiDecks"].as_array().unwrap().len(), 1);

    // Too small for even one seat is refused rather than padded.
    assert!(f
        .service
        .invoke(
            "limited_start_sealed",
            json!({"setup":{"pool":custom_pool(30),"poolType":"Custom","numBoosters":6}}),
        )
        .is_err());
}

#[test]
fn merged_set_pools_run_a_chaos_draft() {
    let mut f = Fixture::new();
    write_second_set(&f);
    let mut merged = f.pool().as_array().unwrap().clone();
    merged.extend(
        f.service
            .invoke("limited_get_set_pool", json!({"setCode":"TS2"}))
            .unwrap()
            .as_array()
            .unwrap()
            .clone(),
    );
    let mut state = f
        .service
        .invoke(
            "limited_start_booster_draft",
            json!({"setup":{"pool":merged,"podSize":2,"rounds":3,"seed":11}}),
        )
        .unwrap();
    assert_eq!(state["currentPack"].as_array().unwrap().len(), 15);
    let sets: std::collections::HashSet<String> = state["currentPack"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["setCode"].as_str().unwrap().to_string())
        .collect();
    assert!(sets.iter().all(|s| s == "TST" || s == "TS2"));
    for _ in 0..45 {
        state = f.pick(&state);
    }
    assert_eq!(state["isComplete"], true);
}

fn set_pack_size(f: &Fixture, count: u8) {
    let path = f.directory.join("TST.json");
    let mut data: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    data["pack_variants"][0]["contents"][0]["count"] = json!(count);
    std::fs::write(path, serde_json::to_vec(&data).unwrap()).unwrap();
}

#[test]
fn commander_draft_takes_two_per_step_and_pod_plays_a_commander_game() {
    let mut f = Fixture::new();
    // Commander packs are even-sized (Commander Legends boosters are 20), so a
    // 15-card test pack would leave a one-card step.
    set_pack_size(&f, 20);
    let pool = f.pool();
    let mut state = f
        .service
        .invoke(
            "limited_start_commander_draft",
            json!({"setup":{"pool":pool,"podSize":4,"seed":5}}),
        )
        .unwrap();
    assert_eq!(state["commanderDraft"], true);
    assert_eq!(state["picksPerPass"], 2);
    assert_eq!(state["seatSummaries"].as_array().unwrap().len(), 4);
    assert_eq!(state["currentPack"].as_array().unwrap().len(), 20);
    let mut steps = 0;
    while state["isComplete"] != true {
        assert_eq!(state["picksRemainingInPack"], 2, "step starts with two picks");
        for _ in 0..2 {
            let card = state["currentPack"][0].clone();
            state = f
                .service
                .invoke(
                    "limited_pick_card",
                    json!({"sessionId":state["sessionId"],"cardName":card["name"],
                        "setCode":card["setCode"],"cardNumber":card["cardNumber"]}),
                )
                .unwrap();
            if state["isComplete"] == true {
                break;
            }
        }
        steps += 1;
        assert!(steps < 200, "draft must terminate");
    }
    assert_eq!(state["pickedPile"].as_array().unwrap().len(), 60);
    let cards = state["pickedPile"].as_array().unwrap().clone();
    let commander = cards[0]["name"].clone();
    let info = f
        .service
        .invoke(
            "limited_commander_draft_info",
            json!({"sessionId":state["sessionId"]}),
        )
        .unwrap();
    assert_eq!(info["minDeckSize"], 60);
    assert!(info["commanders"]
        .as_array()
        .unwrap()
        .contains(&commander));
    // Inclusive convention: the commander is one of the 60 submitted main cards.
    let mut main: Vec<Value> = cards[..59].to_vec();
    main.push(json!({"id":"basic-forest-0","name":"Forest","setCode":"",
        "cardNumber":"basic-forest-0"}));
    let game = f
        .service
        .invoke(
            "limited_start_commander_game",
            json!({"sessionId":state["sessionId"],"main":main,"sideboard":cards[59..].to_vec(),
                "commander":commander}),
        )
        .unwrap();
    assert_eq!(game["humanCommanders"][0], commander);
    // The host wire format keeps the commander out of the library.
    assert_eq!(game["humanDeck"].as_array().unwrap().len(), 59);
    let opponents = game["opponents"].as_array().unwrap();
    assert_eq!(opponents.len(), 3);
    for opponent in opponents {
        assert_eq!(opponent["deck"].as_array().unwrap().len(), 59);
        assert_eq!(opponent["commanders"].as_array().unwrap().len(), 1);
    }
    // A card not in the pool is refused.
    let mut bad = main.clone();
    bad[0]["name"] = json!("Not Drafted");
    assert!(f
        .service
        .invoke(
            "limited_start_commander_game",
            json!({"sessionId":state["sessionId"],"main":bad,"sideboard":[],
                "commander":commander}),
        )
        .is_err());
}

/// CR 905.2 (Cogwork Librarian): the only draft effect in the local card data.
/// A pool whose only special pick is `additional_pick` must now load and draft,
/// the effect step must take two cards, and the Librarian must return to the pack.
#[test]
fn conspiracy_draft_effect_picks_two_and_returns_the_librarian() {
    let pool = json!({
        "code":"EFF","name":"Effect set","release_date":null,
        "pack_variants":[{"weight":1,"contents":[{"slot":"draft","count":3,"choices":[{"sheet":"draft","weight":1}]}]}],
        "pack_variants_total_weight":1,
        "sheets":{"draft":{"cards":[
            {"name":"Cogwork Librarian","set_code":"EFF","collector_number":"1","rarity":"common","weight":1,"colors":[],"cmc":4,"type_line":"Artifact Creature — Construct","draft_effect":"additional_pick"},
            {"name":"Filler Alpha","set_code":"EFF","collector_number":"2","rarity":"common","weight":1,"colors":[],"cmc":2,"type_line":"Creature"},
            {"name":"Filler Beta","set_code":"EFF","collector_number":"3","rarity":"common","weight":1,"colors":[],"cmc":3,"type_line":"Creature"}
        ],"total_weight":3,"foil":false,"balance_colors":false}},
        "prints":[
            {"print_id":"1","name":"Cogwork Librarian","set_code":"EFF","collector_number":"1","rarity":"common","booster_eligible":true},
            {"print_id":"2","name":"Filler Alpha","set_code":"EFF","collector_number":"2","rarity":"common","booster_eligible":true},
            {"print_id":"3","name":"Filler Beta","set_code":"EFF","collector_number":"3","rarity":"common","booster_eligible":true}
        ],
        "basic_lands":["Forest"]
    });
    let mut f = Fixture::with_pool("eff", pool);
    assert!(f.service.invoke("limited_list_sets", json!({})).is_ok(),
        "a set whose only special pick is additional_pick must load");
    let hooks = f.service.invoke("limited_list_conspiracy_hooks", json!({})).unwrap();
    assert_eq!(hooks[0]["cardName"], "Cogwork Librarian");

    let pool = f.service.invoke("limited_get_set_pool", json!({"setCode":"eff"})).unwrap();
    let mut state = f
        .service
        .invoke(
            "limited_start_booster_draft",
            json!({"setup":{"pool":pool,"podSize":2,"rounds":3,"seed":9}}),
        )
        .unwrap();
    assert_eq!(state["picksPerPass"], 1);
    assert!(state["humanConspiracies"].as_array().unwrap().is_empty());

    // Draft the Librarian first; the pack always holds all three distinct cards.
    state = f
        .service
        .invoke(
            "limited_pick_card",
            json!({"sessionId":state["sessionId"],"cardName":"Cogwork Librarian",
                "setCode":"EFF","cardNumber":"1"}),
        )
        .unwrap();
    assert!(state["humanConspiracies"].as_array().unwrap().is_empty(),
        "Cogwork Librarian is a creature, not a command-zone conspiracy");
    assert_eq!(state["picksPerPass"], 1, "the effect is optional");
    assert_eq!(state["draftEffectAvailable"], true);
    let librarian_id = state["pickedPile"][0]["id"].clone();
    let restored = state.clone();
    state = f.pick(&state);
    assert!(state["pickedPile"].as_array().unwrap().iter().any(|c| c["id"] == librarian_id),
        "ordinary pick retains the Librarian");
    state = f.service.invoke("limited_undo_pick", json!({"sessionId":state["sessionId"]})).unwrap();
    assert_eq!(state, restored);
    let before = state["pickedPile"].as_array().unwrap().len();

    // The first of two effect cards buffers; the second commits the effect pick.
    let first = state["currentPack"][0].clone();
    state = f
        .service
        .invoke(
            "limited_pick_card",
            json!({"sessionId":state["sessionId"],"useDraftEffect":true,"cardId":first["id"],"cardName":first["name"],
                "setCode":first["setCode"],"cardNumber":first["cardNumber"]}),
        )
        .unwrap();
    assert_eq!(state["picksRemainingInPack"], 1);
    assert_eq!(state["draftEffectActive"], true);
    assert_eq!(state["pickedPile"].as_array().unwrap().len(), before);
    let second = state["currentPack"][0].clone();
    state = f
        .service
        .invoke(
            "limited_pick_card",
            json!({"sessionId":state["sessionId"],"cardId":second["id"],"cardName":second["name"],
                "setCode":second["setCode"],"cardNumber":second["cardNumber"]}),
        )
        .unwrap();
    assert_eq!(state["pickedPile"].as_array().unwrap().len(), before + 1,
        "two drafted minus the returned Librarian is a net +1");
    assert!(!state["pickedPile"].as_array().unwrap().iter().any(|c| c["id"] == librarian_id));
    for card in [&first, &second] {
        assert!(state["pickedPile"].as_array().unwrap().iter().any(|c| c["id"] == card["id"]));
    }
    state = f.service.invoke("limited_undo_pick", json!({"sessionId":state["sessionId"]})).unwrap();
    assert_eq!(state, restored);

    // The effect does not break the draft: it still runs to completion.
    let mut steps = 0;
    while state["isComplete"] != true {
        let card = state["currentPack"][0].clone();
        state = f
            .service
            .invoke(
                "limited_pick_card",
                json!({"sessionId":state["sessionId"],"cardId":card["id"],"cardName":card["name"],
                    "setCode":card["setCode"],"cardNumber":card["cardNumber"]}),
            )
            .unwrap();
        steps += 1;
        assert!(steps < 200, "draft must terminate");
    }
}

/// The real Conspiracy (CNS) and Mystery Booster 2 (MB2) pools were previously
/// refused because they contain the CR 905.2 `additional_pick` card. They must
/// now pass `validate_pool`, appear in `limited_list_sets`, and collate a pack.
/// Skips when the (untracked) local booster data is not downloaded.
#[test]
fn conspiracy_and_mystery_booster_pools_load_and_collate() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/draft-pools");
    if !dir.join("CNS.json").exists() || !dir.join("MB2.json").exists() {
        eprintln!("skipping: local draft pools are not downloaded");
        return;
    }
    let mut service = LimitedService::new(Some(dir));
    let sets = service.invoke("limited_list_sets", json!({})).unwrap();
    for code in ["cns", "mb1", "mb2"] {
        assert!(
            sets.as_array().unwrap().iter().any(|set| set["code"] == code),
            "{code} must be listed now that additional_pick is supported"
        );
        let pool = service
            .invoke("limited_get_set_pool", json!({"setCode":code}))
            .unwrap();
        assert!(!pool.as_array().unwrap().is_empty());
        let draft = service
            .invoke(
                "limited_start_booster_draft",
                json!({"setup":{"pool":pool,"podSize":2,"rounds":3,"seed":4}}),
            )
            .unwrap();
        assert_eq!(draft["currentPack"].as_array().unwrap().len(), 15, "{code}");
    }
}
