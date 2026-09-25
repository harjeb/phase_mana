use super::*;

fn database() -> CardDatabase {
    CardDatabase::from_mtgjson(
        &std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../phase/data/mtgjson/test_fixture.json"),
    )
    .unwrap()
}

fn on_engine_stack(test: fn()) {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(test)
        .unwrap()
        .join()
        .unwrap();
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
    on_engine_stack(|| {
        assert_eq!(session_difficulty(Some("VeryHard")), AiDifficulty::VeryHard);
        assert_eq!(session_difficulty(Some("cedh")), AiDifficulty::CEDH);
        // Omitted or unknown labels keep the host default rather than refusing
        // the start request.
        assert_eq!(session_difficulty(None), AiDifficulty::Medium);
        assert_eq!(session_difficulty(Some("not-a-level")), AiDifficulty::Medium);
    });
}

/// An enabled LLM seat pointing at an unreachable endpoint must still start and
/// play: every failed request falls back to the built-in AI, so a misconfigured
/// endpoint degrades the opponent rather than breaking the game.
#[test]
fn an_unreachable_llm_endpoint_falls_back_to_the_built_in_ai() {
    on_engine_stack(|| {
        let mut request = StartRequest::default();
        request.llm = Some(
            serde_json::from_value(serde_json::json!({
                "enabled": true,
                // Port 9 is the discard port: the connection is refused immediately.
                "baseUrl": "http://127.0.0.1:9/v1",
                "model": "test-model",
            }))
            .unwrap(),
        );
        let mut host = Host::new(database());
        let started = host
            .start(request)
            .expect("start with an unreachable endpoint");
        assert!(
            host.session.as_ref().unwrap().llm.is_some(),
            "the LLM seat is configured"
        );
        assert!(
            started.ai_actions > 0,
            "a dead endpoint must fall back to the built-in AI"
        );
    });
}

/// A minimal OpenAI-compatible endpoint that answers every chat completion with
/// the same valid choice, so a test can prove the whole LLM path (prompt build
/// → HTTP → parse → contract-checked apply) without a real provider.
mod fake_endpoint {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc,
        },
        thread::JoinHandle,
        time::Duration,
    };

    pub struct FakeOpenAi {
        pub base_url: String,
        pub requests: Arc<AtomicUsize>,
        stop: Arc<AtomicBool>,
        handle: Option<JoinHandle<()>>,
    }

    impl FakeOpenAi {
        pub fn start() -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind fake endpoint");
            let port = listener.local_addr().unwrap().port();
            listener.set_nonblocking(true).unwrap();
            let requests = Arc::new(AtomicUsize::new(0));
            let stop = Arc::new(AtomicBool::new(false));
            let counter = Arc::clone(&requests);
            let halt = Arc::clone(&stop);
            let handle = std::thread::spawn(move || {
                while !halt.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
                            let _ = read_http_request(&mut stream);
                            counter.fetch_add(1, Ordering::Relaxed);
                            let _ = stream.write_all(&openai_reply());
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(Duration::from_millis(5));
                        }
                        Err(_) => break,
                    }
                }
            });
            Self {
                base_url: format!("http://127.0.0.1:{port}/v1"),
                requests,
                stop,
                handle: Some(handle),
            }
        }
    }

    impl Drop for FakeOpenAi {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Relaxed);
            if let Some(handle) = self.handle.take() {
                let _ = handle.join();
            }
        }
    }

    fn read_http_request(stream: &mut std::net::TcpStream) -> std::io::Result<()> {
        let mut buffer = Vec::new();
        let mut chunk = [0u8; 1024];
        loop {
            let read = stream.read(&mut chunk)?;
            if read == 0 {
                return Ok(());
            }
            buffer.extend_from_slice(&chunk[..read]);
            let Some(headers_end) = find(&buffer, b"\r\n\r\n") else {
                continue;
            };
            let head = String::from_utf8_lossy(&buffer[..headers_end]).to_string();
            let content_length = head
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|value| value.trim().parse::<usize>().unwrap_or(0))
                })
                .unwrap_or(0);
            if buffer.len() >= headers_end + 4 + content_length {
                return Ok(());
            }
        }
    }

    fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack.windows(needle.len()).position(|window| window == needle)
    }

    fn openai_reply() -> Vec<u8> {
        let completion = serde_json::json!({ "choice": 0, "reason": "test" }).to_string();
        let body = serde_json::json!({
            "choices": [{ "message": { "role": "assistant", "content": completion } }]
        })
        .to_string();
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .into_bytes()
    }
}

/// With a reachable OpenAI-compatible endpoint, an AI seat is driven by it: the
/// endpoint receives the engine-authored decision request while the game runs.
#[test]
fn an_openai_compatible_endpoint_drives_the_ai_seat() {
    use manabrew_compat::{MulliganOutput, PromptOutput};
    on_engine_stack(|| {
        let endpoint = fake_endpoint::FakeOpenAi::start();
        let mut request = StartRequest::default();
        request.llm = Some(
            serde_json::from_value(serde_json::json!({
                "enabled": true,
                "baseUrl": endpoint.base_url,
                "apiKey": "test-key",
                "model": "test-model",
                "temperature": 0.2,
            }))
            .unwrap(),
        );
        let mut host = Host::new(database());
        let started = host.start(request).expect("start with a live endpoint");
        assert!(
            host.session.as_ref().unwrap().llm.is_some(),
            "the LLM seat is configured"
        );

        let prompt_id = |snapshot: &Snapshot| snapshot.prompt["promptId"].as_u64().unwrap() as u32;
        let mut current = host
            .respond(ClientToServerMessage::Response {
                prompt_id: prompt_id(&started),
                action: PromptOutput::Mulligan(MulliganOutput::MulliganDecision { keep: true }),
            })
            .expect("human keeps");
        for _ in 0..80 {
            if endpoint.requests.load(std::sync::atomic::Ordering::Relaxed) > 0 {
                break;
            }
            if current.state["gameView"]["turn"].as_u64().unwrap() >= 3 {
                break;
            }
            let response: ClientToServerMessage = serde_json::from_value(serde_json::json!({
                "kind": "response", "promptId": prompt_id(&current),
                "action": {"type": "chooseAction", "output": {"type": "pass"}}
            }))
            .unwrap();
            current = host.respond(response).expect("pass priority through the AI loop");
        }
        let _ = &current;
        assert!(
            endpoint.requests.load(std::sync::atomic::Ordering::Relaxed) > 0,
            "the endpoint must receive at least one decision request"
        );
    });
}
