use super::*;

fn database() -> CardDatabase {
    CardDatabase::from_mtgjson(
        &std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../phase/data/mtgjson/test_fixture.json"),
    )
    .unwrap()
}

/// Start a plain two-player game with the given difficulty label and return the
/// difficulty the session resolved for every AI seat.
fn session_difficulty(difficulty: Option<&str>) -> AiDifficulty {
    let mut request = serde_json::json!({
        "format": "standard", "seed": 42,
        "humanDeck": vec!["Plains"; 40], "aiDeck": vec!["Plains"; 40],
    });
    if let Some(label) = difficulty {
        request["difficulty"] = serde_json::Value::String(label.into());
    }
    let mut host = Host::new(database());
    host.start(serde_json::from_value(request).unwrap())
        .unwrap();
    host.session.as_ref().unwrap().ai_config.difficulty
}

#[test]
fn start_request_difficulty_reaches_the_ai_config() {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(|| {
            assert_eq!(session_difficulty(Some("VeryHard")), AiDifficulty::VeryHard);
            assert_eq!(session_difficulty(Some("cedh")), AiDifficulty::CEDH);
            // Omitted or unknown labels keep the host default rather than
            // refusing the start request.
            assert_eq!(session_difficulty(None), AiDifficulty::Medium);
            assert_eq!(
                session_difficulty(Some("not-a-level")),
                AiDifficulty::Medium
            );
        })
        .unwrap()
        .join()
        .unwrap();
}
