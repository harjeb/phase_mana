use super::*;
use std::sync::mpsc::Receiver;
fn command(
    room: &mut Room,
    conn: u64,
    tx: &SyncSender<Value>,
    kind: &str,
    data: Value,
) -> Result<(), String> {
    room.handle(conn, true, tx, event(kind, data))
}
fn pair() -> (
    Room,
    SyncSender<Value>,
    Receiver<Value>,
    SyncSender<Value>,
    Receiver<Value>,
) {
    let mut room = Room::new("local-key".into());
    let (a, ar) = mpsc::sync_channel(128);
    let (b, br) = mpsc::sync_channel(128);
    command(
        &mut room,
        1,
        &a,
        "RoomCreate",
        json!({"roomKey":"local-key","displayName":"Host"}),
    )
    .unwrap();
    let join = json!({"code":room.code,"password":room.password,"displayName":"Guest"});
    command(&mut room, 2, &b, "RoomJoin", join).unwrap();
    (room, a, ar, b, br)
}
fn deck() -> Value {
    json!({"deckName":"Private deck","deck":{"main_deck":["Forest"],"sideboard":[],"commander":[]}})
}
fn prepare(room: &mut Room, a: &SyncSender<Value>, b: &SyncSender<Value>) {
    // The room owner deliberately sits second, so native creation must belong to the guest.
    for (conn, tx, seat) in [(1, a, 1), (2, b, 0)] {
        command(room, conn, tx, "RoomSit", json!({"seat":seat})).unwrap();
        command(room, conn, tx, "RoomDeck", deck()).unwrap();
        command(room, conn, tx, "RoomReady", json!({"ready":true})).unwrap();
    }
}
#[test]
fn create_and_join_are_unseated_and_deckless() {
    let (room, _, ar, _, _) = pair();
    assert_eq!(room.code.len(), 6);
    assert!(room
        .members
        .iter()
        .all(|m| m.seat.is_none() && m.deck.is_none() && !m.ready));
    assert!(ar.try_iter().any(|e| e["type"] == "RoomAttached"));
}
#[test]
fn create_requires_local_capability_and_join_requires_password() {
    let mut room = Room::new("local-key".into());
    let (tx, _) = mpsc::sync_channel(10);
    assert!(room
        .handle(
            1,
            false,
            &tx,
            event(
                "RoomCreate",
                json!({"roomKey":"local-key","displayName":"Host"})
            )
        )
        .is_err());
    assert!(command(
        &mut room,
        1,
        &tx,
        "RoomCreate",
        json!({"roomKey":"wrong","displayName":"Host"})
    )
    .is_err());
    let (mut room, a, _, _, _) = pair();
    let code = room.code.clone();
    assert!(command(
        &mut room,
        3,
        &a,
        "RoomJoin",
        json!({"code":code,"password":"wrong","displayName":"Intruder"})
    )
    .is_err());
}
#[test]
fn seat_claims_are_exclusive_and_guests_cannot_change_settings_or_start() {
    let (mut room, a, _, b, _) = pair();
    command(&mut room, 1, &a, "RoomSit", json!({"seat":0})).unwrap();
    assert!(command(&mut room, 2, &b, "RoomSit", json!({"seat":0})).is_err());
    assert!(command(
        &mut room,
        2,
        &b,
        "RoomSettings",
        json!({"format":"modern","capacity":2})
    )
    .is_err());
    assert!(command(&mut room, 2, &b, "RoomStart", json!({})).is_err());
}
#[test]
fn readiness_requires_a_deck_and_settings_clear_readiness() {
    let (mut room, a, _, b, _) = pair();
    assert!(command(&mut room, 1, &a, "RoomReady", json!({"ready":true})).is_err());
    prepare(&mut room, &a, &b);
    command(
        &mut room,
        1,
        &a,
        "RoomSettings",
        json!({"format":"modern","capacity":2}),
    )
    .unwrap();
    assert!(room.members.iter().all(|m| !m.ready));
    assert!(command(&mut room, 1, &a, "RoomStart", json!({})).is_err());
}
#[test]
fn public_state_never_contains_cards_credentials_or_invitation_password() {
    let (mut room, a, _, b, _) = pair();
    prepare(&mut room, &a, &b);
    let state = room.public().to_string();
    for secret in [&room.password, &room.key, &room.members[0].token] {
        assert!(!state.contains(secret));
    }
    assert!(!state.contains("Forest"));
    assert!(!state.contains("main_deck"));
    assert!(state.contains("Private deck"));
}
#[test]
fn native_launch_preserves_selected_seats_and_waits_for_every_attachment() {
    let (mut room, a, ar, b, br) = pair();
    prepare(&mut room, &a, &b);
    ar.try_iter().for_each(drop);
    br.try_iter().for_each(drop);
    command(&mut room, 1, &a, "RoomStart", json!({})).unwrap();
    assert!(br.try_iter().any(|e| e["type"] == "RoomLaunch"));
    assert!(!ar.try_iter().any(|e| e["type"] == "RoomLaunch"));
    assert!(command(
        &mut room,
        1,
        &a,
        "RoomCreatedGame",
        json!({"gameCode":"GAME12","password":"secret"})
    )
    .is_err());
    command(
        &mut room,
        2,
        &b,
        "RoomCreatedGame",
        json!({"gameCode":"GAME12","password":"secret"}),
    )
    .unwrap();
    assert!(!ar.try_iter().any(|e| e["type"] == "RoomLaunchJoin"));
    command(&mut room, 2, &b, "RoomGameAttached", json!({})).unwrap();
    assert!(ar.try_iter().any(|e| e["type"] == "RoomLaunchJoin"));
    assert!(!br.try_iter().any(|e| e["type"] == "RoomStartEngine"));
    command(&mut room, 1, &a, "RoomGameAttached", json!({})).unwrap();
    assert!(br.try_iter().any(|e| e["type"] == "RoomStartEngine"));
    command(&mut room, 2, &b, "RoomPlaying", json!({})).unwrap();
    assert_eq!(room.phase, "playing");
}
#[test]
fn failed_launch_returns_same_room_to_editing_with_decks_retained() {
    let (mut room, a, _, b, _) = pair();
    prepare(&mut room, &a, &b);
    command(&mut room, 1, &a, "RoomStart", json!({})).unwrap();
    command(
        &mut room,
        2,
        &b,
        "RoomLaunchFailed",
        json!({"message":"Invalid deck"}),
    )
    .unwrap();
    assert_eq!(room.phase, "waiting");
    assert!(room.members.iter().all(|m| !m.ready && m.deck.is_some()));
}
#[test]
fn reconnect_replaces_connection_and_old_disconnect_does_not_vacate_seat() {
    let (mut room, a, _, b, _) = pair();
    prepare(&mut room, &a, &b);
    let login = json!({"memberId":room.members[1].id,"token":room.members[1].token});
    command(&mut room, 3, &b, "RoomReconnect", login).unwrap();
    room.disconnect(2);
    assert_eq!(room.members[1].connection, Some(3));
    assert_eq!(room.members[1].seat, Some(0));
    assert!(!room.members[1].ready);
}
#[test]
fn disconnect_during_launch_cancels_start() {
    let (mut room, a, _, b, _) = pair();
    prepare(&mut room, &a, &b);
    command(&mut room, 1, &a, "RoomStart", json!({})).unwrap();
    room.disconnect(2);
    assert_eq!(room.phase, "waiting");
    assert!(room.members.iter().all(|m| !m.ready));
}
#[test]
fn live_socket_creates_room_without_native_engine_game() {
    let tcp = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = tcp.local_addr().unwrap().port();
    let _server = Listener::start(tcp, 1, "local-key".into()).unwrap();
    let (mut ws, _) = tungstenite::connect(format!("ws://127.0.0.1:{port}/room")).unwrap();
    let hello: Value = serde_json::from_str(ws.read().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(hello["type"], "RoomHello");
    ws.send(tungstenite::Message::text(
        event(
            "RoomCreate",
            json!({"roomKey":"local-key","displayName":"Host"}),
        )
        .to_string(),
    ))
    .unwrap();
    let attached: Value = serde_json::from_str(ws.read().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(attached["type"], "RoomAttached");
    let state: Value = serde_json::from_str(ws.read().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(state["data"]["members"][0]["seat"], Value::Null);
    let _ = ws.close(None);
}

#[test]
fn native_proxy_preserves_websocket_frames_after_idle() {
    let native = TcpListener::bind("127.0.0.1:0").unwrap();
    let native_port = native.local_addr().unwrap().port();
    let upstream = thread::spawn(move || {
        let (stream, _) = native.accept().unwrap();
        let mut ws = tungstenite::accept(stream).unwrap();
        thread::sleep(Duration::from_millis(100));
        ws.send(tungstenite::Message::text("native hello")).unwrap();
        assert_eq!(ws.read().unwrap().to_text().unwrap(), "client response");
    });
    let tcp = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = tcp.local_addr().unwrap().port();
    let _server = Listener::start(tcp, native_port, "key".into()).unwrap();
    let (mut ws, _) = tungstenite::connect(format!("ws://127.0.0.1:{port}/ws")).unwrap();
    assert_eq!(ws.read().unwrap().to_text().unwrap(), "native hello");
    ws.send(tungstenite::Message::text("client response")).unwrap();
    upstream.join().unwrap();
}
