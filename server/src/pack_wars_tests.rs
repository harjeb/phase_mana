use super::*;
use engine::types::Supertype;

fn database() -> CardDatabase {
    CardDatabase::from_mtgjson(
        &std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../phase/data/mtgjson/test_fixture.json"),
    )
    .unwrap()
}

/// A Mini-Master deck: one 15-card pack plus three of each basic (30 total).
fn pack_wars_deck() -> Vec<String> {
    let mut deck = vec!["Grizzly Bears".to_string(); 15];
    deck.extend(vec!["Plains".to_string(); 15]);
    deck
}

fn request(game_mode: &str) -> StartRequest {
    serde_json::from_value(serde_json::json!({
        "humanDeck": pack_wars_deck(),
        "aiDeck": pack_wars_deck(),
        "format": "sealed",
        "gameMode": game_mode,
    }))
    .unwrap()
}

fn is_basic_land(object: &engine::game::game_object::GameObject) -> bool {
    object.card_types.core_types.contains(&CoreType::Land)
        && object.card_types.supertypes.contains(&Supertype::Basic)
}

/// The guide's Mini-Master deck is 30 cards, below limited's usual 40-card
/// floor, so the host must widen the deck-size rule for this game mode.
#[test]
fn pack_wars_accepts_a_thirty_card_deck() {
    let mut host = Host::new(database());
    host.start(request("pack_wars"))
        .expect("a 30-card Mini-Master deck should start");
    let game = &host.session.as_ref().unwrap().game;
    for player in &game.players {
        assert_eq!(player.hand.len() + player.library.len(), 30);
    }
}

/// Pack Wars "整包作为手牌": the whole pack becomes the opening hand and the
/// fifteen basics become the library, so the player draws one land a turn.
#[test]
fn whole_pack_hand_moves_the_pack_to_hand_and_basics_to_library() {
    let mut host = Host::new(database());
    host.start(request("pack_wars_hand"))
        .expect("pack-in-hand should start");
    let game = &host.session.as_ref().unwrap().game;
    for player in &game.players {
        assert_eq!(player.hand.len(), 15, "the whole pack should be in hand");
        assert_eq!(player.library.len(), 15, "the basics should form the library");
        assert!(
            player.hand.iter().all(|id| !is_basic_land(&game.objects[id])),
            "the hand must hold only pack cards"
        );
        assert!(
            player.library.iter().all(|id| is_basic_land(&game.objects[id])),
            "the library must hold only basics"
        );
        assert!(!player.drew_from_empty_library);
    }
}
