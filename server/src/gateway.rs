//! Optional loopback-only native desktop gateway. No shell commands or download jobs.
use axum::{
    body::{to_bytes, Body},
    extract::{Request, State},
    http::{Method, StatusCode},
    response::{IntoResponse, Response},
    Router,
};
use serde_json::{json, Value};
use std::{
    path::{Component, Path, PathBuf},
    sync::Arc,
};
use tokio::sync::Mutex;

pub struct Config {
    pub web: PathBuf,
    pub state: PathBuf,
    pub port: u16,
}
impl Config {
    pub fn from_env() -> Result<Option<Self>, Box<dyn std::error::Error>> {
        let Some(web) = std::env::var_os("PHASE_MANA_WEB_ROOT") else {
            return Ok(None);
        };
        let state = std::env::var_os("PHASE_MANA_STATE_DIR")
            .filter(|s| !s.is_empty())
            .ok_or("PHASE_MANA_STATE_DIR required with PHASE_MANA_WEB_ROOT")?;
        let web = std::fs::canonicalize(web)?;
        if !web.is_dir() {
            return Err("PHASE_MANA_WEB_ROOT must be a directory".into());
        }
        std::fs::create_dir_all(&state)?;
        let port = std::env::var("PHASE_MANA_CLIENT_PORT")
            .unwrap_or_else(|_| "1420".into())
            .parse()?;
        Ok(Some(Self {
            web,
            state: std::fs::canonicalize(state)?,
            port,
        }))
    }
}
struct Gateway {
    web: PathBuf,
    config: PathBuf,
    images: Mutex<PathBuf>,
    pinned: bool,
    port: u16,
    backend: u16,
    client: reqwest::Client,
}
pub fn router(config: Config, port: u16, backend: u16) -> Result<Router, reqwest::Error> {
    let file = config.state.join("card-images.config.json");
    let env = std::env::var_os("PHASE_MANA_CARD_IMAGES");
    let saved = std::fs::read(&file)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| {
            v["dir"]
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .map(PathBuf::from)
        });
    let images = env
        .clone()
        .map(PathBuf::from)
        .or(saved)
        .unwrap_or(config.state.join("card-images"));
    let images = std::path::absolute(images).unwrap();
    let state = Gateway {
        web: config.web,
        config: file,
        images: Mutex::new(images),
        pinned: env.is_some(),
        port,
        backend,
        client: reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("phase-mana/0.1.0")
            .timeout(std::time::Duration::from_secs(60))
            .build()?,
    };
    Ok(Router::new().fallback(handle).with_state(Arc::new(state)))
}
fn error(code: StatusCode, message: &str) -> Response {
    (code, axum::Json(json!({"error":message}))).into_response()
}
fn allowed_request(req: &Request, port: u16) -> bool {
    let host = req
        .headers()
        .get("host")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if host != format!("127.0.0.1:{port}") && host != format!("localhost:{port}") {
        return false;
    }
    if let Some(origin) = req.headers().get("origin") {
        if origin.to_str().ok() != Some(format!("http://{host}").as_str()) {
            return false;
        }
    }
    !req.headers()
        .get("sec-fetch-site")
        .is_some_and(|v| v == "cross-site")
}
async fn handle(State(g): State<Arc<Gateway>>, req: Request) -> Response {
    if !allowed_request(&req, g.port) {
        return error(StatusCode::FORBIDDEN, "Cross-origin or invalid Host");
    }
    let path = req.uri().path().to_owned();
    let query = req.uri().query().unwrap_or("").to_owned();
    if path == "/api" || path.starts_with("/api/") {
        return proxy(
            &g,
            req,
            format!("http://127.0.0.1:{}{}", g.backend, path),
            &query,
        )
        .await;
    }
    if let Some(sub) = path.strip_prefix("/hub-api/api/scryfall/") {
        return proxy(&g, req, format!("https://api.scryfall.com/{sub}"), &query).await;
    }
    if let Some(sub) = path.strip_prefix("/scryfall-symbols/") {
        return proxy(
            &g,
            req,
            format!("https://svgs.scryfall.io/card-symbols/{sub}"),
            &query,
        )
        .await;
    }
    if path == "/card-images-config" || path == "/card-images-config/browse" || path == "/browse" {
        return config_request(&g, req, path != "/card-images-config").await;
    }
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return error(StatusCode::METHOD_NOT_ALLOWED, "GET required");
    }
    let head = req.method() == Method::HEAD;
    if let Some(relative) = path.strip_prefix("/card-images/") {
        let params: Vec<(String, String)> =
            reqwest::Url::parse(&format!("http://localhost/?{query}"))
                .unwrap()
                .query_pairs()
                .into_owned()
                .collect();
        let root = g.images.lock().await.clone();
        let mut candidates = vec![relative.to_owned()];
        candidates.extend(
            params
                .iter()
                .filter(|(k, _)| k == "alt")
                .filter_map(|(_, v)| v.strip_prefix("/card-images/").map(str::to_owned)),
        );
        for candidate in candidates {
            if let Some(file) = contained(&root, &candidate).await {
                return serve_file(file, head).await;
            }
        }
        let fallback = params
            .iter()
            .find(|(k, _)| k == "fallback")
            .map(|(_, v)| v.clone());
        let location = if fallback.is_some() {
            fallback
        } else if let Some((_, name)) = params.iter().find(|(k, _)| k == "name") {
            match g
                .client
                .get("https://api.scryfall.com/cards/named")
                .query(&[("exact", name)])
                .header("Accept", "application/json")
                .send()
                .await
            {
                Ok(res) if res.status().is_success() => {
                    res.json::<Value>().await.ok().and_then(|v| {
                        v.pointer("/image_uris/normal")
                            .or_else(|| v.pointer("/card_faces/0/image_uris/normal"))
                            .and_then(Value::as_str)
                            .map(str::to_owned)
                    })
                }
                _ => None,
            }
        } else {
            None
        };
        if let Some(url) = location.filter(|u| allowed_art(u)) {
            return (
                StatusCode::FOUND,
                [("location", url), ("referrer-policy", "no-referrer".into())],
            )
                .into_response();
        }
        return StatusCode::NOT_FOUND.into_response();
    }
    let relative = if path == "/" {
        "index.html"
    } else {
        path.trim_start_matches('/')
    };
    match contained(&g.web, relative).await {
        Some(file) => serve_file(file, head).await,
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
fn allowed_art(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https"
            && u.username().is_empty()
            && u.password().is_none()
            && u.port_or_known_default() == Some(443)
            && matches!(
                u.host_str(),
                Some("cards.scryfall.io" | "backs.scryfall.io")
            )
    })
}
async fn contained(root: &Path, relative: &str) -> Option<PathBuf> {
    let decoded = percent_encoding::percent_decode_str(relative)
        .decode_utf8()
        .ok()?;
    if decoded.contains(['\\', ':', '\0'])
        || Path::new(decoded.as_ref())
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return None;
    }
    let root = tokio::fs::canonicalize(root).await.ok()?;
    let file = tokio::fs::canonicalize(root.join(decoded.as_ref()))
        .await
        .ok()?;
    if !file.starts_with(&root) || !tokio::fs::metadata(&file).await.ok()?.is_file() {
        return None;
    }
    Some(file)
}
async fn serve_file(path: PathBuf, head: bool) -> Response {
    match tokio::fs::File::open(&path).await {
        Ok(file) => {
            let mime = mime_guess::from_path(path)
                .first_or_octet_stream()
                .to_string();
            (
                [
                    ("content-type", mime),
                    ("cache-control", "no-store".into()),
                    ("x-content-type-options", "nosniff".into()),
                ],
                if head {
                    Body::empty()
                } else {
                    Body::from_stream(tokio_util::io::ReaderStream::new(file))
                },
            )
                .into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}
async fn proxy(g: &Gateway, req: Request, target: String, query: &str) -> Response {
    if !matches!(
        *req.method(),
        Method::GET
            | Method::HEAD
            | Method::POST
            | Method::PUT
            | Method::PATCH
            | Method::DELETE
            | Method::OPTIONS
    ) {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    let mut url = match reqwest::Url::parse(&target) {
        Ok(u) => u,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    url.set_query(if query.is_empty() { None } else { Some(query) });
    let mut outgoing = g.client.request(req.method().clone(), url);
    // Deliberate allowlist: never forward cookies, Authorization, Origin, or Host.
    for name in [
        "content-type",
        "accept",
        "if-none-match",
        "if-modified-since",
        "range",
    ] {
        if let Some(value) = req.headers().get(name) {
            outgoing = outgoing.header(name, value);
        }
    }
    let body = match to_bytes(req.into_body(), 8 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
    };
    match outgoing.body(body).send().await {
        Ok(upstream) => {
            let mut response = Response::builder().status(upstream.status());
            for name in [
                "content-type",
                "cache-control",
                "etag",
                "last-modified",
                "content-range",
                "accept-ranges",
            ] {
                if let Some(value) = upstream.headers().get(name) {
                    response = response.header(name, value);
                }
            }
            response
                .header("x-content-type-options", "nosniff")
                .body(Body::from_stream(upstream.bytes_stream()))
                .unwrap()
        }
        Err(_) => error(StatusCode::BAD_GATEWAY, "Upstream unavailable"),
    }
}
fn status(dir: &Path, pinned: bool) -> Value {
    fn count(dir: &Path) -> usize {
        std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .map(|entry| match entry.file_type() {
                Ok(t) if t.is_dir() => count(&entry.path()),
                Ok(t) if t.is_file() => usize::from(
                    entry
                        .path()
                        .extension()
                        .and_then(|s| s.to_str())
                        .is_some_and(|s| {
                            matches!(
                                s.to_ascii_lowercase().as_str(),
                                "webp" | "jpg" | "jpeg" | "png"
                            )
                        }),
                ),
                _ => 0,
            })
            .sum()
    }
    json!({"dir":dir,"exists":dir.is_dir(),"count":count(dir),"fromEnv":pinned})
}
async fn config_request(g: &Gateway, req: Request, browse: bool) -> Response {
    if !browse && matches!(*req.method(), Method::GET | Method::HEAD) {
        let dir = g.images.lock().await.clone();
        let pinned = g.pinned;
        return match tokio::task::spawn_blocking(move || status(&dir, pinned)).await {
            Ok(v) => ([("cache-control", "no-store")], axum::Json(v)).into_response(),
            Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        };
    }
    if req.method() != Method::POST {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    if !req
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok())
        .is_some_and(|h| h.split(';').next() == Some("application/json"))
    {
        return StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response();
    }
    if g.pinned {
        return error(StatusCode::CONFLICT, "Pinned by PHASE_MANA_CARD_IMAGES");
    }
    if browse {
        // Construct on each blocking thread, so platform dialog initialization is per request.
        return match tokio::task::spawn_blocking(|| {
            rfd::FileDialog::new()
                .set_title("Select the card image library")
                .pick_folder()
        })
        .await
        {
            Ok(Some(dir)) => axum::Json(json!({"dir":dir})).into_response(),
            Ok(None) => axum::Json(json!({"cancelled":true})).into_response(),
            Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "picker_failed"),
        };
    }
    let body = match to_bytes(req.into_body(), 16384).await {
        Ok(b) => b,
        Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
    };
    let dir = serde_json::from_slice::<Value>(&body).ok().and_then(|v| {
        v["dir"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .map(|s| PathBuf::from(s.trim()))
    });
    let Some(dir) = dir else {
        return error(StatusCode::BAD_REQUEST, "dir required");
    };
    let dir = match tokio::fs::canonicalize(dir).await {
        Ok(d) if d.is_dir() => d,
        _ => return error(StatusCode::BAD_REQUEST, "folder_missing"),
    };
    let mut current = g.images.lock().await;
    let tmp = g.config.with_extension("json.tmp");
    if tokio::fs::write(&tmp, serde_json::to_vec(&json!({"dir":dir})).unwrap())
        .await
        .is_err()
        || tokio::fs::rename(&tmp, &g.config).await.is_err()
    {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "save_failed");
    }
    *current = dir.clone();
    drop(current);
    match tokio::task::spawn_blocking(move || status(&dir, false)).await {
        Ok(v) => axum::Json(v).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn proxy_preserves_post_body_without_credentials() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let upstream = Router::new().fallback(|req: Request| async move {
            assert!(req.headers().get("authorization").is_none());
            assert!(req.headers().get("cookie").is_none());
            assert_eq!(req.method(), Method::POST);
            assert_eq!(req.uri().query(), Some("q=test"));
            to_bytes(req.into_body(), 1024).await.unwrap()
        });
        let task = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
        let g = Gateway {
            web: PathBuf::new(),
            config: PathBuf::new(),
            images: Mutex::new(PathBuf::new()),
            pinned: false,
            port: 1420,
            backend: port,
            client: reqwest::Client::builder().no_proxy().build().unwrap(),
        };
        let req = Request::builder()
            .method("POST")
            .header("authorization", "secret")
            .header("cookie", "secret")
            .body(Body::from("{\"hello\":1}"))
            .unwrap();
        let response = proxy(
            &g,
            req,
            format!("http://127.0.0.1:{port}/api/test"),
            "q=test",
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            to_bytes(response.into_body(), 1024).await.unwrap(),
            "{\"hello\":1}"
        );
        task.abort();
    }
    #[test]
    fn origin_and_host_guards() {
        for (host, origin, ok) in [
            ("127.0.0.1:1420", "http://127.0.0.1:1420", true),
            ("evil.test:1420", "http://evil.test:1420", false),
            ("localhost:1420", "null", false),
            ("localhost:1420", "http://localhost:1421", false),
        ] {
            let req = Request::builder()
                .header("host", host)
                .header("origin", origin)
                .body(Body::empty())
                .unwrap();
            assert_eq!(allowed_request(&req, 1420), ok);
        }
    }
    #[test]
    fn art_hosts() {
        assert!(allowed_art("https://cards.scryfall.io/normal/a.jpg"));
        for u in [
            "http://cards.scryfall.io/a",
            "https://cards.scryfall.io.evil.test/a",
            "https://user:pass@cards.scryfall.io/a",
            "https://backs.scryfall.io:444/a",
        ] {
            assert!(!allowed_art(u));
        }
    }
    #[tokio::test]
    async fn traversal_and_missing_assets() {
        let root = std::env::temp_dir().join(format!("gateway-{}", rand::random::<u64>()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        tokio::fs::write(root.join("index.html"), "ok")
            .await
            .unwrap();
        assert!(contained(&root, "index.html").await.is_some());
        for p in [
            "../index.html",
            "%2e%2e/index.html",
            "/index.html",
            "a%5c..%5cindex.html",
            "C:/index.html",
            "missing.json",
        ] {
            assert!(contained(&root, p).await.is_none());
        }
        tokio::fs::remove_dir_all(root).await.unwrap();
    }
}
