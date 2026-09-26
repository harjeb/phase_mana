//! Synchronized pre-game room. Native gameplay is forwarded byte-for-byte on /ws.
use engine::types::format::FormatConfig;
use rand::Rng;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io,
    net::{Shutdown, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, SyncSender},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

pub fn capability() -> String {
    rand::rng()
        .random::<[u8; 32]>()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn event(kind: &str, data: Value) -> Value {
    json!({"type":kind,"data":data})
}

struct Member {
    id: String,
    token: String,
    name: String,
    seat: Option<u8>,
    ready: bool,
    deck: Option<Value>,
    deck_name: Option<String>,
    connection: Option<u64>,
    sender: Option<SyncSender<Value>>,
    attached: bool,
}
struct Room {
    key: String,
    code: String,
    password: String,
    host: String,
    phase: &'static str,
    format: String,
    capacity: u8,
    members: Vec<Member>,
    starting: Option<Instant>,
    game_created: bool,
    start_sent: bool,
    creator: Option<usize>,
    game: Option<(String, String)>,
    next_seat: u8,
}
impl Room {
    fn new(key: String) -> Self {
        Self {
            key,
            code: capability()[..6].to_uppercase(),
            password: capability()[..32].into(),
            host: String::new(),
            phase: "waiting",
            format: "standard".into(),
            capacity: 2,
            members: vec![],
            starting: None,
            game_created: false,
            start_sent: false,
            creator: None,
            game: None,
            next_seat: 0,
        }
    }
    fn public(&self) -> Value {
        json!({"code":self.code,"hostId":self.host,"phase":self.phase,"format":self.format,"capacity":self.capacity,"members":self.members.iter().map(|m| json!({"id":m.id,"name":m.name,"seat":m.seat,"ready":m.ready,"connected":m.connection.is_some(),"deckName":m.deck_name})).collect::<Vec<_>>()})
    }
    fn send(&self, index: usize, kind: &str, data: Value) {
        if let Some(tx) = &self.members[index].sender {
            let _ = tx.try_send(event(kind, data));
        }
    }
    fn broadcast(&self) {
        let state = self.public();
        for i in 0..self.members.len() {
            self.send(i, "RoomState", state.clone());
        }
    }
    fn reset(&mut self) {
        self.phase = "waiting";
        self.starting = None;
        self.game_created = false;
        self.start_sent = false;
        self.creator = None;
        self.game = None;
        self.next_seat = 0;
        for m in &mut self.members {
            m.ready = false;
            m.attached = false;
        }
    }
    fn disconnect(&mut self, connection: u64) {
        if let Some(m) = self
            .members
            .iter_mut()
            .find(|m| m.connection == Some(connection))
        {
            m.connection = None;
            m.sender = None;
            m.ready = false;
            if self.phase == "starting" {
                self.reset();
            }
            self.broadcast();
        }
    }
    fn tick(&mut self) {
        if self
            .starting
            .is_some_and(|t| t.elapsed() > Duration::from_secs(90))
        {
            self.reset();
            for i in 0..self.members.len() {
                self.send(
                    i,
                    "RoomError",
                    json!({"message":"Game launch timed out. Ready again to retry."}),
                );
            }
            self.broadcast();
        }
    }
    fn handle(
        &mut self,
        connection: u64,
        local: bool,
        tx: &SyncSender<Value>,
        message: Value,
    ) -> Result<(), String> {
        let kind = message["type"].as_str().ok_or("Missing message type")?;
        let data = &message["data"];
        if matches!(kind, "RoomCreate" | "RoomJoin" | "RoomReconnect") {
            if self
                .members
                .iter()
                .any(|m| m.connection == Some(connection))
            {
                return Err("Already attached to this room".into());
            }
            let index;
            if kind == "RoomReconnect" {
                let id = text(data, "memberId", 128)?;
                let token = text(data, "token", 128)?;
                index = self
                    .members
                    .iter()
                    .position(|m| m.id == id && m.token == token)
                    .ok_or("Invalid reconnect credentials")?;
                self.members[index].ready = false;
                if self.phase == "starting" {
                    self.reset();
                }
            } else {
                if self.phase != "waiting" {
                    return Err("Room is no longer waiting".into());
                }
                if kind == "RoomCreate" {
                    if !local || data["roomKey"].as_str() != Some(self.key.as_str()) {
                        return Err("Room creation requires the local host capability".into());
                    }
                    if !self.host.is_empty() {
                        return Err("A room already exists. Reconnect instead.".into());
                    }
                } else {
                    if self.host.is_empty() {
                        return Err("The host has not created a room yet".into());
                    }
                    if data["code"].as_str().map(str::to_uppercase).as_deref()
                        != Some(self.code.as_str())
                        || data["password"].as_str() != Some(self.password.as_str())
                    {
                        return Err("Invalid room code or password".into());
                    }
                }
                if self.members.len() >= 32 {
                    return Err("Room member limit reached".into());
                }
                let name = text(data, "displayName", 80)?.to_owned();
                let id = capability();
                if kind == "RoomCreate" {
                    self.host = id.clone();
                }
                index = self.members.len();
                self.members.push(Member {
                    id,
                    token: capability(),
                    name,
                    seat: None,
                    ready: false,
                    deck: None,
                    deck_name: None,
                    connection: None,
                    sender: None,
                    attached: false,
                });
            }
            let m = &mut self.members[index];
            m.connection = Some(connection);
            m.sender = Some(tx.clone());
            let mut attached = json!({"memberId":m.id,"token":m.token,"code":self.code});
            if m.id == self.host {
                attached["password"] = self.password.clone().into();
            }
            self.send(index, "RoomAttached", attached);
            self.broadcast();
            return Ok(());
        }
        let i = self
            .members
            .iter()
            .position(|m| m.connection == Some(connection))
            .ok_or("Attach to the room first")?;
        let host = self.members[i].id == self.host;
        if kind == "RoomLeave" {
            if host { return Err("The host must close the room instead".into()); }
            if self.phase != "waiting" { return Err("Room is not waiting".into()); }
            self.members.remove(i);
            self.broadcast();
            return Ok(());
        }
        if matches!(kind, "RoomSettings" | "RoomStart") && !host {
            return Err("Only the host can perform this action".into());
        }
        if matches!(kind, "RoomCreatedGame" | "RoomPlaying") && self.creator != Some(i) {
            return Err("Only the game creator can perform this action".into());
        }
        if matches!(
            kind,
            "RoomSit" | "RoomDeck" | "RoomSettings" | "RoomReady" | "RoomStart"
        ) && self.phase != "waiting"
        {
            return Err("Room is not waiting".into());
        }
        match kind {
            "RoomSit" => {
                let seat = if data.get("seat") == Some(&Value::Null) {
                    None
                } else {
                    Some(
                        data["seat"]
                            .as_u64()
                            .filter(|n| *n < self.capacity as u64)
                            .ok_or("Seat is out of range")? as u8,
                    )
                };
                if seat.is_some()
                    && self
                        .members
                        .iter()
                        .enumerate()
                        .any(|(j, m)| j != i && m.seat == seat)
                {
                    return Err("Seat is already occupied".into());
                }
                self.members[i].seat = seat;
                self.members[i].ready = false;
            }
            "RoomDeck" => {
                if self.members[i].seat.is_none() || self.members[i].ready {
                    return Err("Sit down and unready before changing your deck".into());
                }
                let name = text(data, "deckName", 120)?.to_owned();
                validate_deck(&data["deck"])?;
                self.members[i].deck = Some(data["deck"].clone());
                self.members[i].deck_name = Some(name);
            }
            "RoomSettings" => {
                let format = text(data, "format", 40)?.to_owned();
                let capacity = data["capacity"]
                    .as_u64()
                    .filter(|n| (2..=4).contains(n))
                    .ok_or("Capacity must be between 2 and 4")?
                    as u8;
                format_config(&format)?.validate_for_player_count(capacity)?;
                if self
                    .members
                    .iter()
                    .any(|m| m.seat.is_some_and(|s| s >= capacity))
                {
                    return Err("An occupied seat would be removed".into());
                }
                if self.format != format || self.capacity != capacity {
                    self.format = format;
                    self.capacity = capacity;
                    for m in &mut self.members {
                        m.ready = false;
                    }
                }
            }
            "RoomReady" => {
                let ready = data["ready"].as_bool().ok_or("ready must be a boolean")?;
                if ready {
                    if self.members[i].seat.is_none() {
                        return Err("Sit down before readying".into());
                    }
                    validate_deck(
                        self.members[i]
                            .deck
                            .as_ref()
                            .ok_or("Choose a deck before readying")?,
                    )?;
                }
                self.members[i].ready = ready;
            }
            "RoomStart" => {
                if self.members[i].seat.is_none()
                    || (0..self.capacity).any(|s| {
                        !self.members.iter().any(|m| {
                            m.seat == Some(s)
                                && m.ready
                                && m.connection.is_some()
                                && m.deck.is_some()
                        })
                    })
                {
                    return Err("Every seat must be occupied, connected and ready".into());
                }
                let config = format_config(&self.format)?;
                config.validate_for_player_count(self.capacity)?;
                self.phase = "starting";
                self.starting = Some(Instant::now());
                let creator = self.members.iter().position(|m| m.seat == Some(0)).unwrap();
                self.creator = Some(creator);
                self.next_seat = 0;
                self.send(creator,"RoomLaunch",json!({"deck":self.members[creator].deck,"formatConfig":config,"capacity":self.capacity,"displayName":self.members[creator].name}));
            }
            "RoomCreatedGame" => {
                if self.phase != "starting" || self.game_created {
                    return Err("No game creation is pending".into());
                }
                let code = text(data, "gameCode", 128)?;
                let password = text(data, "password", 256)?;
                self.game_created = true;
                self.game = Some((code.to_owned(), password.to_owned()));
            }
            "RoomGameAttached" => {
                if self.phase != "starting"
                    || self.members[i].seat != Some(self.next_seat)
                    || !self.game_created
                {
                    return Err("No game attachment is pending".into());
                }
                self.members[i].attached = true;
                self.next_seat += 1;
                if self.next_seat < self.capacity {
                    let next = self
                        .members
                        .iter()
                        .position(|m| m.seat == Some(self.next_seat))
                        .unwrap();
                    let (code, password) = self.game.as_ref().unwrap();
                    self.send(next,"RoomLaunchJoin",json!({"gameCode":code,"password":password,"deck":self.members[next].deck,"displayName":self.members[next].name}));
                }
            }
            "RoomPlaying" => {
                if self.phase != "starting" || !self.start_sent {
                    return Err("All players must attach before playing".into());
                }
                self.phase = "playing";
                self.starting = None;
            }
            "RoomLaunchFailed" => {
                if self.phase != "starting" || self.members[i].seat.is_none() {
                    return Err("No launch is pending".into());
                }
                let message = text(data, "message", 500)?.to_owned();
                self.reset();
                for j in 0..self.members.len() {
                    self.send(
                        j,
                        "RoomError",
                        json!({"message":format!("Game launch failed: {message}")}),
                    );
                }
            }
            _ => return Err("Unknown room message".into()),
        }
        if self.phase == "starting"
            && self.game_created
            && !self.start_sent
            && self
                .members
                .iter()
                .filter(|m| m.seat.is_some())
                .all(|m| m.attached && m.connection.is_some())
        {
            self.start_sent = true;
            let h = self.creator.unwrap();
            self.send(h, "RoomStartEngine", json!({}));
        }
        self.broadcast();
        Ok(())
    }
}
fn text<'a>(data: &'a Value, key: &str, max: usize) -> Result<&'a str, String> {
    data[key]
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.len() <= max)
        .ok_or_else(|| format!("{key} must be nonempty and at most {max} bytes"))
}
fn validate_deck(deck: &Value) -> Result<(), String> {
    let mut total = 0;
    let mut counts = HashMap::new();
    for key in ["main_deck", "sideboard", "commander"] {
        let cards = deck[key]
            .as_array()
            .ok_or("Deck must contain main_deck, sideboard and commander arrays")?;
        if key == "main_deck" && cards.is_empty() {
            return Err("Main deck cannot be empty".into());
        }
        total += cards.len();
        if total > 500 {
            return Err("Deck cannot contain more than 500 cards".into());
        }
        for card in cards {
            let name = card
                .as_str()
                .filter(|s| !s.trim().is_empty() && s.len() <= 200)
                .ok_or("Invalid card name")?;
            let count = counts.entry(name).or_insert(0);
            *count += 1;
            if *count > 250 {
                return Err("At most 250 copies of a card are allowed".into());
            }
        }
    }
    Ok(())
}
fn format_config(name: &str) -> Result<FormatConfig, String> {
    Ok(match name {
        "standard" => FormatConfig::standard(),
        "modern" => FormatConfig::modern(),
        "legacy" => FormatConfig::legacy(),
        "vintage" => FormatConfig::vintage(),
        "pioneer" => FormatConfig::pioneer(),
        "pauper" => FormatConfig::pauper(),
        "commander" => FormatConfig::commander(),
        "two_headed_giant" => FormatConfig::two_headed_giant(),
        _ => return Err("Unknown format".into()),
    })
}

/// Owns the listener and every accepted/native socket. Dropping closes them all.
pub struct Listener {
    stop: Arc<AtomicBool>,
    sockets: Arc<Mutex<HashMap<u64, Vec<TcpStream>>>>,
    worker: Option<thread::JoinHandle<()>>,
}
impl Listener {
    pub fn start(listener: TcpListener, native_port: u16, key: String) -> io::Result<Self> {
        listener.set_nonblocking(true)?;
        let stop = Arc::new(AtomicBool::new(false));
        let sockets = Arc::new(Mutex::new(HashMap::<u64, Vec<TcpStream>>::new()));
        let room = Arc::new(Mutex::new(Room::new(key)));
        let ids = AtomicU64::new(1);
        let halt = stop.clone();
        let registry = sockets.clone();
        let worker = thread::spawn(move || {
            while !halt.load(Ordering::Relaxed) {
                room.lock().unwrap().tick();
                match listener.accept() {
                    Ok((stream, peer)) => {
                        let id = ids.fetch_add(1, Ordering::Relaxed);
                        let mut entries = registry.lock().unwrap();
                        if entries.len() >= 128 {
                            continue;
                        }
                        let Ok(clone) = stream.try_clone() else {
                            continue;
                        };
                        entries.insert(id, vec![clone]);
                        drop(entries);
                        let state = room.clone();
                        let all = registry.clone();
                        let stopped = halt.clone();
                        thread::spawn(move || {
                            let _ = serve(
                                stream,
                                peer.ip().is_loopback(),
                                id,
                                native_port,
                                &state,
                                &all,
                                &stopped,
                            );
                            state.lock().unwrap().disconnect(id);
                            if let Some(streams) = all.lock().unwrap().remove(&id) {
                                for s in streams {
                                    let _ = s.shutdown(Shutdown::Both);
                                }
                            }
                        });
                    }
                    Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(20))
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            stop,
            sockets,
            worker: Some(worker),
        })
    }
}
impl Drop for Listener {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        for streams in self.sockets.lock().unwrap().values() {
            for stream in streams {
                let _ = stream.shutdown(Shutdown::Both);
            }
        }
    }
}
fn serve(
    mut stream: TcpStream,
    local: bool,
    id: u64,
    native_port: u16,
    room: &Arc<Mutex<Room>>,
    registry: &Arc<Mutex<HashMap<u64, Vec<TcpStream>>>>,
    stop: &AtomicBool,
) -> Result<(), Box<dyn std::error::Error>> {
    // Windows accepted sockets inherit the listener's nonblocking mode. The
    // handshake and byte-copy proxy require blocking streams with timeouts.
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut head = [0u8; 4096];
    let path = loop {
        let n = stream.peek(&mut head)?;
        if n == 0 {
            return Ok(());
        }
        if let Some(end) = head[..n].windows(2).position(|w| w == b"\r\n") {
            break std::str::from_utf8(&head[..end])?
                .split_whitespace()
                .nth(1)
                .unwrap_or("")
                .to_owned();
        }
        if n == head.len() || Instant::now() > deadline || stop.load(Ordering::Relaxed) {
            return Err("Invalid HTTP request".into());
        }
        thread::sleep(Duration::from_millis(5));
    };
    if path == "/ws" {
        let mut upstream = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, native_port))?;
        if stop.load(Ordering::Relaxed) {
            return Ok(());
        }
        registry
            .lock()
            .unwrap()
            .get_mut(&id)
            .ok_or("Connection closed")?
            .push(upstream.try_clone()?);
        stream.set_read_timeout(None)?;
        upstream.set_read_timeout(None)?;
        upstream.set_write_timeout(Some(Duration::from_secs(5)))?;
        let mut client_copy = stream.try_clone()?;
        let mut upstream_copy = upstream.try_clone()?;
        let forward = thread::spawn(move || {
            let _ = io::copy(&mut client_copy, &mut upstream_copy);
            let _ = upstream_copy.shutdown(Shutdown::Both);
            let _ = client_copy.shutdown(Shutdown::Both);
        });
        let _ = io::copy(&mut upstream, &mut stream);
        let _ = stream.shutdown(Shutdown::Both);
        let _ = upstream.shutdown(Shutdown::Both);
        let _ = forward.join();
        return Ok(());
    }
    if path != "/room" {
        return Err("Unknown WebSocket endpoint".into());
    }
    let config = tungstenite::protocol::WebSocketConfig::default()
        .max_message_size(Some(256 * 1024))
        .max_frame_size(Some(256 * 1024));
    let mut ws = tungstenite::accept_with_config(stream, Some(config))?;
    ws.get_mut()
        .set_read_timeout(Some(Duration::from_millis(50)))?;
    ws.send(tungstenite::Message::text(
        event("RoomHello", json!({"version":1})).to_string(),
    ))?;
    let (tx, rx) = mpsc::sync_channel::<Value>(128);
    let opened = Instant::now();
    let mut last_seen = Instant::now();
    let mut last_ping = Instant::now();
    while !stop.load(Ordering::Relaxed) {
        for message in rx.try_iter() {
            ws.send(tungstenite::Message::text(message.to_string()))?;
        }
        if last_seen.elapsed() > Duration::from_secs(60) {
            break;
        }
        if opened.elapsed() > Duration::from_secs(15)
            && !room
                .lock()
                .unwrap()
                .members
                .iter()
                .any(|m| m.connection == Some(id))
        {
            break;
        }
        if last_ping.elapsed() > Duration::from_secs(20) {
            ws.send(tungstenite::Message::Ping(Vec::new().into()))?;
            last_ping = Instant::now();
        }
        match ws.read() {
            Ok(tungstenite::Message::Text(s)) => {
                last_seen = Instant::now();
                let result = serde_json::from_str(&s)
                    .map_err(|_| "Invalid JSON message".to_owned())
                    .and_then(|v| room.lock().unwrap().handle(id, local, &tx, v));
                if let Err(message) = result {
                    ws.send(tungstenite::Message::text(
                        event("RoomError", json!({"message":message})).to_string(),
                    ))?;
                }
            }
            Ok(tungstenite::Message::Close(_)) => break,
            Ok(_) => {
                last_seen = Instant::now();
                ws.flush()?;
            }
            Err(tungstenite::Error::Io(e))
                if matches!(
                    e.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                ()
            }
            Err(e) => return Err(e.into()),
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "waiting_room_tests.rs"]
mod tests;
