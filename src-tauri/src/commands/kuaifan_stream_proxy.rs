use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_BODY_BYTES: usize = 64 * 1024 * 1024;

struct ProxyHandle {
    port: u16,
    upstream_base_url: String,
    shutdown: Arc<AtomicBool>,
}

static PROXY: OnceLock<Mutex<Option<ProxyHandle>>> = OnceLock::new();

pub fn start(upstream_base_url: &str) -> Result<String, String> {
    let upstream_base_url = upstream_base_url.trim().trim_end_matches('/').to_string();
    if upstream_base_url.is_empty() {
        return Err("Kuaifan provider base URL is empty".to_string());
    }
    let state = PROXY.get_or_init(|| Mutex::new(None));
    let mut state = state.lock().map_err(|_| "Kuaifan stream proxy lock poisoned".to_string())?;
    if let Some(handle) = state.as_ref() {
        if handle.upstream_base_url == upstream_base_url {
            return Ok(format!("http://127.0.0.1:{}/v1", handle.port));
        }
    }
    if let Some(previous) = state.take() {
        previous.shutdown.store(true, Ordering::SeqCst);
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("bind Kuaifan stream proxy: {error}"))?;
    let port = listener.local_addr().map_err(|error| format!("read Kuaifan stream proxy port: {error}"))?.port();
    let shutdown = Arc::new(AtomicBool::new(false));
    let thread_shutdown = shutdown.clone();
    let thread_upstream = upstream_base_url.clone();
    thread::Builder::new()
        .name("kuaifan-stream-proxy".into())
        .spawn(move || run_loop(listener, thread_upstream, thread_shutdown))
        .map_err(|error| format!("start Kuaifan stream proxy: {error}"))?;
    *state = Some(ProxyHandle { port, upstream_base_url, shutdown });
    Ok(format!("http://127.0.0.1:{port}/v1"))
}

pub fn configure_kuaifan_provider(config: &mut Value, proxy_base_url: &str) {
    let Some(provider) = config
        .get_mut("models")
        .and_then(Value::as_object_mut)
        .and_then(|models| models.get_mut("providers"))
        .and_then(Value::as_object_mut)
        .and_then(|providers| providers.get_mut("kuaifan"))
        .and_then(Value::as_object_mut)
    else {
        return;
    };
    provider.insert("baseUrl".to_string(), Value::String(proxy_base_url.to_string()));
}

pub fn configured_kuaifan_base_url(config: &Value) -> Option<String> {
    config
        .get("models")?
        .get("providers")?
        .get("kuaifan")?
        .get("baseUrl")?
        .as_str()
        .map(str::trim)
        .filter(|url| !url.is_empty() && !url.starts_with("http://127.0.0.1:"))
        .map(str::to_string)
}

fn run_loop(listener: TcpListener, upstream_base_url: String, shutdown: Arc<AtomicBool>) {
    for incoming in listener.incoming() {
        if shutdown.load(Ordering::SeqCst) { break; }
        let Ok(stream) = incoming else { continue; };
        let upstream = upstream_base_url.clone();
        thread::spawn(move || { let _ = handle_connection(stream, &upstream); });
    }
}

fn handle_connection(mut stream: TcpStream, upstream_base_url: &str) -> Result<(), String> {
    stream.set_read_timeout(Some(Duration::from_secs(30))).map_err(|error| error.to_string())?;
    let mut request = Vec::new();
    let mut buffer = [0u8; 4096];
    let header_end = loop {
        let count = stream.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 { return Ok(()); }
        request.extend_from_slice(&buffer[..count]);
        if let Some(index) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") { break index + 4; }
        if request.len() > MAX_HEADER_BYTES { return Err("request headers too large".to_string()); }
    };
    let header = std::str::from_utf8(&request[..header_end]).map_err(|_| "invalid request headers".to_string())?;
    let mut lines = header.split("\r\n");
    let mut request_parts = lines.next().unwrap_or_default().split_whitespace();
    let method = request_parts.next().unwrap_or_default();
    let raw_path = request_parts.next().unwrap_or_default();
    if method.is_empty() || raw_path.is_empty() { return Err("invalid request line".to_string()); }
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') { headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string()); }
    }
    let content_length = headers.get("content-length").and_then(|value| value.parse::<usize>().ok()).unwrap_or(0);
    if content_length > MAX_BODY_BYTES { return Err("request body too large".to_string()); }
    let mut body = request[header_end..].to_vec();
    while body.len() < content_length {
        let count = stream.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 { break; }
        body.extend_from_slice(&buffer[..count]);
    }
    body.truncate(content_length);

    let mut forwarded = HeaderMap::new();
    for (name, value) in headers {
        if matches!(name.as_str(), "host" | "content-length" | "connection" | "transfer-encoding" | "accept-encoding") { continue; }
        if let (Ok(name), Ok(value)) = (HeaderName::from_bytes(name.as_bytes()), HeaderValue::from_str(&value)) { forwarded.insert(name, value); }
    }
    let (path, query) = raw_path.split_once('?').map_or((raw_path, None), |(path, query)| (path, Some(query)));
    let suffix = path.strip_prefix("/v1").unwrap_or(path);
    let upstream_url = format!("{}{}{}", upstream_base_url.trim_end_matches('/'), suffix, query.map(|query| format!("?{query}")).unwrap_or_default());
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|error| error.to_string())?;
    let response = Client::builder().timeout(Duration::from_secs(3600)).build().map_err(|error| error.to_string())?
        .request(method, upstream_url).headers(forwarded).body(body).send().map_err(|error| error.to_string())?;
    let is_sse = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|value| value.to_str().ok()).is_some_and(|value| value.contains("text/event-stream"));
    let content_type = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|value| value.to_str().ok()).unwrap_or("application/octet-stream").to_string();
    write!(stream, "HTTP/1.1 {}\r\nContent-Type: {}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n", response.status(), content_type).map_err(|error| error.to_string())?;
    if is_sse { copy_normalized_sse(response, &mut stream)?; } else { copy_chunked(response, &mut stream)?; }
    stream.write_all(b"0\r\n\r\n").map_err(|error| error.to_string())?;
    Ok(())
}

fn write_chunk(stream: &mut TcpStream, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() { return Ok(()); }
    write!(stream, "{:X}\r\n", bytes.len()).map_err(|error| error.to_string())?;
    stream.write_all(bytes).map_err(|error| error.to_string())?;
    stream.write_all(b"\r\n").map_err(|error| error.to_string())
}

fn copy_chunked(mut response: reqwest::blocking::Response, stream: &mut TcpStream) -> Result<(), String> {
    let mut buffer = [0u8; 8192];
    loop { let count = response.read(&mut buffer).map_err(|error| error.to_string())?; if count == 0 { return Ok(()); } write_chunk(stream, &buffer[..count])?; }
}

fn copy_normalized_sse(response: reqwest::blocking::Response, stream: &mut TcpStream) -> Result<(), String> {
    let mut reader = BufReader::new(response);
    let mut event = Vec::new();
    let mut normalizer = SseNormalizer::default();
    loop {
        let mut line = Vec::new();
        let count = reader.read_until(b'\n', &mut line).map_err(|error| error.to_string())?;
        if count == 0 { break; }
        event.extend_from_slice(&line);
        if line == b"\n" || line == b"\r\n" {
            let normalized = std::str::from_utf8(&event).map(|event| normalizer.normalize_event(event)).unwrap_or_else(|_| String::from_utf8_lossy(&event).into_owned());
            write_chunk(stream, normalized.as_bytes())?;
            event.clear();
        }
    }
    if !event.is_empty() { write_chunk(stream, &event)?; }
    Ok(())
}

/// Kuaifan's OpenAI-compatible stream ends with a `message.content` that
/// duplicates the earlier `delta.content`. OpenClaw accumulates both fields,
/// so remove only that redundant terminal content while preserving every
/// other part of the SSE event.
pub fn normalize_sse_event(event: &str) -> String {
    SseNormalizer::default().normalize_event(event)
}

#[derive(Default)]
pub struct SseNormalizer {
    streamed_content: HashMap<usize, String>,
}

impl SseNormalizer {
    pub fn normalize_event(&mut self, event: &str) -> String {
        event
            .split_inclusive('\n')
            .map(|line| self.normalize_line(line))
            .collect()
    }

    fn normalize_line(&mut self, line: &str) -> String {
    let (body, newline) = if let Some(body) = line.strip_suffix("\r\n") {
        (body, "\r\n")
    } else if let Some(body) = line.strip_suffix('\n') {
        (body, "\n")
    } else {
        (line, "")
    };
    let Some(data) = body.strip_prefix("data:") else {
        return line.to_string();
    };
    let Ok(mut payload) = serde_json::from_str::<Value>(data.trim()) else {
        return line.to_string();
    };

        remove_redundant_terminal_content(&mut payload, &mut self.streamed_content);
        format!("data: {}{}", payload, newline)
    }
}

fn remove_redundant_terminal_content(payload: &mut Value, streamed_content: &mut HashMap<usize, String>) {
    let Some(choices) = payload.get_mut("choices").and_then(Value::as_array_mut) else {
        return;
    };
    for (position, choice) in choices.iter_mut().enumerate() {
        let Some(choice) = choice.as_object_mut() else {
            continue;
        };
        let index = choice.get("index").and_then(Value::as_u64).map(|value| value as usize).unwrap_or(position);
        if let Some(delta_content) = choice
            .get("delta")
            .and_then(Value::as_object)
            .and_then(|delta| delta.get("content"))
            .and_then(Value::as_str)
            .filter(|content| !content.is_empty())
        {
            streamed_content.entry(index).or_default().push_str(delta_content);
        }
        let is_duplicate_terminal_message = choice
            .get("message")
            .and_then(Value::as_object)
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .zip(streamed_content.get(&index))
            .is_some_and(|(message, streamed)| !message.is_empty() && message == streamed);
        if !is_duplicate_terminal_message {
            continue;
        }
        let remove_empty_message = choice
            .get_mut("message")
            .and_then(Value::as_object_mut)
            .map(|message| {
                message.remove("content");
                message.is_empty()
            })
            .unwrap_or(false);
        if remove_empty_message {
            choice.remove("message");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{configure_kuaifan_provider, normalize_sse_event, SseNormalizer};
    use serde_json::json;

    #[test]
    fn removes_terminal_message_content_without_changing_delta_content() {
        let input = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"done\"},",
            "\"message\":{\"content\":\"done\"},\"finish_reason\":\"stop\"}]}\n\n"
        );

        let output = normalize_sse_event(input);

        assert!(output.contains(r#""delta":{"content":"done"}"#));
        assert!(!output.contains(r#""message""#));
    }

    #[test]
    fn routes_only_kuaifan_chat_to_the_managed_normalizer() {
        let mut config = json!({
            "models": {
                "providers": {
                    "kuaifan": { "baseUrl": "https://kuaifanio.cn/v1" },
                    "other": { "baseUrl": "https://example.test/v1" }
                }
            }
        });

        configure_kuaifan_provider(&mut config, "http://127.0.0.1:45678/v1");

        assert_eq!(
            config["models"]["providers"]["kuaifan"]["baseUrl"],
            "http://127.0.0.1:45678/v1"
        );
        assert_eq!(
            config["models"]["providers"]["other"]["baseUrl"],
            "https://example.test/v1"
        );
    }

    #[test]
    fn removes_a_terminal_message_that_repeats_an_earlier_delta_event() {
        let mut normalizer = SseNormalizer::default();
        let delta = "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"done\"},\"finish_reason\":\"stop\"}]}\n\n";
        let terminal = "data: {\"choices\":[{\"index\":0,\"message\":{\"content\":\"done\"},\"finish_reason\":\"stop\"}]}\n\n";

        assert!(normalizer.normalize_event(delta).contains(r#""content":"done""#));
        assert!(!normalizer.normalize_event(terminal).contains(r#""message""#));
    }
}
