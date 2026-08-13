//! 内置 control-ui 代理服务器
//!
//! OpenClaw 网关在 /control-ui 响应头里同时带 `X-Frame-Options: DENY` 和
//! `Content-Security-Policy: frame-ancestors 'none'`，导致 manager 主页的
//! `<iframe src="http://127.0.0.1:18789/control-ui?token=...">` 被浏览器拒绝。
//! 本模块起一个本地代理服务器：
//!   - 静态资源（control-ui 页面 + assets）从 `{data_dir}/openclaw/dist/control-ui/` 直接读
//!   - 其他请求（/api/*、/__openclaw__/*、/avatar/* 等）透明代理到网关端口
//!   - 不发送 X-Frame-Options / CSP frame-ancestors，iframe 嵌入不再被拒
//!   - WS 不走代理：控制台内 `effectiveUrl` = `ws://{hostname}:18789`，直接连网关

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_BODY_BYTES: usize = 64 * 1024 * 1024;
const CONTROL_UI_ENHANCER_PATH: &str = "/__kuaifan__/control-ui-enhancer.js";
const CONTROL_UI_ENHANCER: &str = include_str!("../../resources/control-ui-enhancer.js");
/// 普通 HTTP 代理的读超时：30s 够用。
const READ_TIMEOUT: Duration = Duration::from_secs(30);
/// WebSocket 长连接读超时：模型「思考」常见 >30s，故用 1h 兜底，正常空闲时 TCP keepalive 会清理死链。
const WS_READ_TIMEOUT: Duration = Duration::from_secs(3600);

struct ProxyHandle {
    port: u16,
    shutdown: Arc<AtomicBool>,
    #[allow(dead_code)]
    control_ui_dir: PathBuf,
    #[allow(dead_code)]
    gateway_port: u16,
}

static PROXY: OnceLock<Mutex<Option<ProxyHandle>>> = OnceLock::new();

#[cfg(test)]
static PROXY_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[cfg(test)]
fn lock_proxy_test() -> std::sync::MutexGuard<'static, ()> {
    PROXY_TEST_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("control-ui proxy test lock")
}

/// 启动代理（同网关端口已在跑则直接返回该端口，避免每次点启动都换端口）。返回代理监听的本地端口。
pub fn start(data_dir: &str, gateway_port: u16) -> Result<u16, String> {
    if let Some(p) = current_port_for_gateway(gateway_port) {
        tracing::debug!("control-ui 代理已为网关端口 {} 运行，复用端口 {} 不重启", gateway_port, p);
        return Ok(p);
    }
    stop();

    let control_ui_dir = PathBuf::from(data_dir)
        .join("openclaw")
        .join("dist")
        .join("control-ui");
    if !control_ui_dir.is_dir() {
        return Err(format!(
            "control-ui dist 目录不存在: {}（网关未正确安装？）",
            control_ui_dir.display()
        ));
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("绑定代理端口失败: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("读取代理端口失败: {}", e))?
        .port();

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();
    let dir_clone = control_ui_dir.clone();
    let gw_port = gateway_port;

    thread::Builder::new()
        .name("control-ui-proxy".into())
        .spawn(move || {
            run_loop(listener, dir_clone, gw_port, shutdown_clone);
        })
        .map_err(|e| format!("启动代理线程失败: {}", e))?;

    let m = PROXY.get_or_init(|| Mutex::new(None));
    *m.lock().unwrap() = Some(ProxyHandle {
        port,
        shutdown,
        control_ui_dir,
        gateway_port,
    });
    tracing::info!(
        "control-ui 代理已启动: http://127.0.0.1:{} -> 127.0.0.1:{}",
        port,
        gateway_port
    );
    Ok(port)
}

/// 停止代理（多次调用安全）。
pub fn stop() {
    let Some(m) = PROXY.get() else { return };
    let mut g = m.lock().unwrap();
    if let Some(h) = g.take() {
        h.shutdown.store(true, Ordering::SeqCst);
        tracing::info!("control-ui 代理已停止 (port={})", h.port);
    }
}

/// 当前代理的 URL（未启动时返回 None）。
pub fn current_url() -> Option<String> {
    let m = PROXY.get()?;
    let g = m.lock().unwrap();
    g.as_ref().map(|h| format!("http://127.0.0.1:{}", h.port))
}

/// 若代理正在为指定网关端口转发，返回代理本身的本地端口；否则 None。
/// 用于 start() 复用判断，避免前端每次「启动」都换一个代理端口。
pub fn current_port_for_gateway(gateway_port: u16) -> Option<u16> {
    let m = PROXY.get()?;
    let g = m.lock().unwrap();
    g.as_ref().filter(|h| h.gateway_port == gateway_port).map(|h| h.port)
}

fn run_loop(
    listener: TcpListener,
    control_ui_dir: PathBuf,
    gateway_port: u16,
    shutdown: Arc<AtomicBool>,
) {
    for stream in listener.incoming() {
        if shutdown.load(Ordering::SeqCst) {
            break;
        }
        match stream {
            Ok(s) => {
                let dir = control_ui_dir.clone();
                thread::spawn(move || {
                    let _ = s.set_read_timeout(Some(READ_TIMEOUT));
                    let _ = s.set_write_timeout(Some(READ_TIMEOUT));
                    handle_connection(s, dir, gateway_port);
                });
            }
            Err(e) => {
                if shutdown.load(Ordering::SeqCst) {
                    break;
                }
                tracing::warn!("control-ui 代理 accept 失败: {}", e);
            }
        }
    }
}

fn handle_connection(mut stream: TcpStream, control_ui_dir: PathBuf, gateway_port: u16) {
    // 1) 读 request headers
    let mut buf: Vec<u8> = Vec::with_capacity(4096);
    let mut tmp = [0u8; 4096];
    let header_end = loop {
        match stream.read(&mut tmp) {
            Ok(0) => return,
            Ok(n) => {
                buf.extend_from_slice(&tmp[..n]);
                if let Some(p) = find_header_end(&buf) {
                    break p;
                }
                if buf.len() > MAX_HEADER_BYTES {
                    write_400(&mut stream, "headers too large");
                    return;
                }
            }
            Err(_) => return,
        }
    };
    let (header_bytes, body_so_far) = buf.split_at(header_end);

    let request_str = match std::str::from_utf8(header_bytes) {
        Ok(s) => s,
        Err(_) => {
            write_400(&mut stream, "bad utf-8 in headers");
            return;
        }
    };

    let mut lines = request_str.split("\r\n");
    let request_line = match lines.next() {
        Some(l) => l,
        None => {
            write_400(&mut stream, "empty request");
            return;
        }
    };
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let raw_uri = parts.next().unwrap_or("").to_string();
    if method.is_empty() || raw_uri.is_empty() {
        write_400(&mut stream, "bad request line");
        return;
    }

    let (path, query) = match raw_uri.find('?') {
        Some(i) => (raw_uri[..i].to_string(), Some(raw_uri[i + 1..].to_string())),
        None => (raw_uri, None),
    };

    let mut headers: HashMap<String, String> = HashMap::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some(idx) = line.find(':') {
            let k = line[..idx].trim().to_ascii_lowercase();
            let v = line[idx + 1..].trim().to_string();
            if !k.is_empty() {
                headers.insert(k, v);
            }
        }
    }
    let content_length: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    // 2) 读 body（如有）
    let mut body: Vec<u8> = body_so_far.to_vec();
    while body.len() < content_length {
        let need = content_length - body.len();
        if need > MAX_BODY_BYTES {
            write_413(&mut stream);
            return;
        }
        let mut tmp2 = vec![0u8; need.min(8192)];
        match stream.read(&mut tmp2) {
            Ok(0) => break,
            Ok(n) => body.extend_from_slice(&tmp2[..n]),
            Err(_) => return,
        }
    }
    body.truncate(content_length);

    // 3) WebSocket 升级：直接转发原始 header 给网关（body 几乎总为空），后续双向转发帧
    if is_websocket_upgrade(&headers) {
        proxy_websocket_to_gateway(stream, header_bytes, &body, gateway_port);
        return;
    }

    // 4) GET/HEAD 优先尝试静态文件
    if method == "GET" || method == "HEAD" {
        if let Some(resp) = try_serve_static(&method, &path, &control_ui_dir) {
            let _ = stream.write_all(&resp);
            return;
        }
    }

    // 5) 其他走 HTTP 代理
    proxy_to_gateway(
        &mut stream,
        &method,
        &path,
        query.as_deref(),
        &headers,
        &body,
        gateway_port,
    );
}

fn try_serve_static(method: &str, path: &str, root: &Path) -> Option<Vec<u8>> {
    if path.contains("..") {
        return None;
    }
    if path == CONTROL_UI_ENHANCER_PATH {
        return static_response(method, "application/javascript; charset=utf-8", CONTROL_UI_ENHANCER.as_bytes());
    }
    let requested = path.trim_start_matches('/');
    let p = if requested.is_empty() {
        "index.html"
    } else if root.join(requested).is_file() {
        requested
    } else if is_control_ui_spa_route(path) {
        "index.html"
    } else {
        return None;
    };
    let full = root.join(p);
    let bytes = std::fs::read(&full).ok()?;
    let served = if p.eq_ignore_ascii_case("index.html") {
        std::str::from_utf8(&bytes)
            .map(inject_control_ui_enhancer)
            .unwrap_or_else(|_| bytes.clone())
    } else {
        bytes
    };
    static_response(method, guess_mime(p), &served)
}

fn is_control_ui_spa_route(path: &str) -> bool {
    let normalized = path.trim_end_matches('/');
    matches!(
        normalized,
        "/chat"
            | "/overview"
            | "/activity"
            | "/workboard"
            | "/instances"
            | "/sessions"
            | "/usage"
            | "/cron"
            | "/agents"
            | "/skills"
            | "/nodes"
            | "/dreaming"
            | "/config"
            | "/debug"
            | "/logs"
    ) || normalized.starts_with("/skills/")
        || normalized.starts_with("/agents/")
        || normalized.starts_with("/sessions/")
        || normalized.starts_with("/instances/")
}

fn inject_control_ui_enhancer(html: &str) -> Vec<u8> {
    if html.contains(CONTROL_UI_ENHANCER_PATH) {
        return html.as_bytes().to_vec();
    }
    let tag = format!(r#"<script src="{}"></script>"#, CONTROL_UI_ENHANCER_PATH);
    if let Some(position) = html.rfind("</head>") {
        let mut output = String::with_capacity(html.len() + tag.len());
        output.push_str(&html[..position]);
        output.push_str(&tag);
        output.push_str(&html[position..]);
        return output.into_bytes();
    }
    if let Some(position) = html.rfind("</body>") {
        let mut output = String::with_capacity(html.len() + tag.len());
        output.push_str(&html[..position]);
        output.push_str(&tag);
        output.push_str(&html[position..]);
        return output.into_bytes();
    }
    format!("{}{}", html, tag).into_bytes()
}

fn static_response(method: &str, mime: &str, bytes: &[u8]) -> Option<Vec<u8>> {
    let len = bytes.len();
    let header = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
        mime, len
    );
    if method == "HEAD" {
        Some(header.into_bytes())
    } else {
        let mut v = header.into_bytes();
        v.extend_from_slice(bytes);
        Some(v)
    }
}

fn guess_mime(p: &str) -> &'static str {
    let ext = std::path::Path::new(p)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    match ext.to_ascii_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "webmanifest" => "application/manifest+json",
        "map" => "application/json",
        "txt" => "text/plain; charset=utf-8",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn proxy_to_gateway(
    stream: &mut TcpStream,
    method: &str,
    path: &str,
    query: Option<&str>,
    headers: &HashMap<String, String>,
    body: &[u8],
    gateway_port: u16,
) {
    let mut upstream = match TcpStream::connect(("127.0.0.1", gateway_port)) {
        Ok(s) => s,
        Err(e) => {
            write_502(stream, &format!("upstream connect: {}", e));
            return;
        }
    };
    let _ = upstream.set_read_timeout(Some(READ_TIMEOUT));
    let _ = upstream.set_write_timeout(Some(READ_TIMEOUT));

    let path_and_query = match query {
        Some(q) => format!("{}?{}", path, q),
        None => path.to_string(),
    };
    let mut req = format!("{} {} HTTP/1.1\r\n", method, path_and_query);
    req.push_str(&format!("Host: 127.0.0.1:{}\r\n", gateway_port));
    let passthrough = [
        "authorization",
        "cookie",
        "accept",
        "accept-language",
        "content-type",
        "user-agent",
        "x-openclaw",
        "x-requested-with",
    ];
    for k in passthrough {
        if let Some(v) = headers.get(k) {
            req.push_str(&format!("{}: {}\r\n", k, v));
        }
    }
    if !body.is_empty() {
        req.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    req.push_str("Connection: close\r\n\r\n");

    if upstream.write_all(req.as_bytes()).is_err() {
        write_502(stream, "upstream write header");
        return;
    }
    if !body.is_empty() && upstream.write_all(body).is_err() {
        write_502(stream, "upstream write body");
        return;
    }

    let mut resp_buf: Vec<u8> = Vec::with_capacity(8192);
    let mut tmp = [0u8; 8192];
    loop {
        match upstream.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => resp_buf.extend_from_slice(&tmp[..n]),
            Err(_) => break,
        }
        if resp_buf.len() > MAX_BODY_BYTES {
            break;
        }
    }
    if resp_buf.is_empty() {
        write_502(stream, "empty upstream response");
        return;
    }

    let up_header_end = find_header_end(&resp_buf).unwrap_or(resp_buf.len());
    let up_header = String::from_utf8_lossy(&resp_buf[..up_header_end]);
    let up_body = &resp_buf[up_header_end..];
    let mut new_resp = Vec::with_capacity(resp_buf.len());
    let mut split = up_header.split("\r\n");
    if let Some(status) = split.next() {
        new_resp.extend_from_slice(status.as_bytes());
        new_resp.extend_from_slice(b"\r\n");
        for line in split {
            if line.is_empty() {
                break;
            }
            if let Some(idx) = line.find(':') {
                let k = line[..idx].trim().to_ascii_lowercase();
                if matches!(
                    k.as_str(),
                    "transfer-encoding"
                        | "connection"
                        | "keep-alive"
                        | "proxy-authenticate"
                        | "proxy-authorization"
                        | "te"
                        | "trailers"
                        | "upgrade"
                        | "x-frame-options"
                ) {
                    continue;
                }
                if k == "content-security-policy" {
                    // CSP 只剥 frame-ancestors 指令，其它指令保留
                    let v = line[idx + 1..].trim();
                    let filtered: String = v.split(';')
                        .map(|d| d.trim())
                        .filter(|d| !d.is_empty() && !d.to_ascii_lowercase().starts_with("frame-ancestors"))
                        .collect::<Vec<_>>()
                        .join("; ");
                    if filtered.is_empty() {
                        continue;
                    }
                    let new_line = format!("Content-Security-Policy: {}", filtered);
                    new_resp.extend_from_slice(new_line.as_bytes());
                    new_resp.extend_from_slice(b"\r\n");
                    continue;
                }
            }
            new_resp.extend_from_slice(line.as_bytes());
            new_resp.extend_from_slice(b"\r\n");
        }
        new_resp.extend_from_slice(b"\r\n");
    }
    new_resp.extend_from_slice(up_body);
    let _ = stream.write_all(&new_resp);
    let _ = stream.flush();
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n").map(|p| p + 4)
}

fn write_400(stream: &mut TcpStream, msg: &str) {
    let body = format!("{{\"error\":\"{}\"}}", msg);
    let resp = format!(
        "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
}

fn write_413(stream: &mut TcpStream) {
    let resp = "HTTP/1.1 413 Payload Too Large\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    let _ = stream.write_all(resp.as_bytes());
}

fn write_502(stream: &mut TcpStream, msg: &str) {
    let body = format!("upstream error: {}", msg);
    let resp = format!(
        "HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
}


#[cfg(test)]
mod smoke_tests {
    //! 端到端烟雾测试：control-ui 代理
    //!
    //! 验证：
    //! 1. 静态文件（index.html、assets/）能正确从代理返回
    //! 2. 响应头里没有 `X-Frame-Options: DENY` 也没有 `frame-ancestors 'none'`
    //! 3. 代理不可达的上游返回 502 而不是 404
    //! 4. start/stop/current_url 行为正确

    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::path::Path;
    use std::time::Duration;

    use super::*;

    fn temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn write_file(path: &Path, content: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    fn http_get(host: &str, port: u16, path: &str) -> (String, Vec<u8>) {
        let mut s = TcpStream::connect((host, port)).expect("connect to proxy");
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        s.set_write_timeout(Some(Duration::from_secs(5))).unwrap();
        let req = format!(
            "GET {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
            path, port
        );
        s.write_all(req.as_bytes()).unwrap();
        let mut buf = Vec::new();
        match s.read_to_end(&mut buf) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => {}
            Err(error) => panic!("read proxy response: {error}"),
        }
        let mut header_end = 0;
        for i in 0..buf.len().saturating_sub(3) {
            if &buf[i..i + 4] == b"\r\n\r\n" {
                header_end = i + 4;
                break;
            }
        }
        let headers = String::from_utf8_lossy(&buf[..header_end]).to_string();
        let body = buf[header_end..].to_vec();
        (headers, body)
    }

    fn setup_dist() -> tempfile::TempDir {
        let dir = temp_dir();
        let ui = dir.path().join("openclaw").join("dist").join("control-ui");
        write_file(&ui.join("index.html"), "<!doctype html><html><body>hi</body></html>");
        write_file(
            &ui.join("assets").join("index.js"),
            "console.log(\"hello\");",
        );
        dir
    }

    #[test]
    fn serves_static_index_without_deny_headers() {
        let _guard = lock_proxy_test();
        let dir = setup_dist();
        let port = start(dir.path().to_str().unwrap(), 1).expect("start proxy");

        let (headers, body) = http_get("127.0.0.1", port, "/");
        let lowered = headers.to_ascii_lowercase();
        assert!(
            !lowered.contains("x-frame-options: deny"),
            "proxy must not emit X-Frame-Options: DENY, got:\n{}",
            headers
        );
        assert!(
            !lowered.contains("frame-ancestors 'none'") && !lowered.contains("frame-ancestors none"),
            "proxy must not emit frame-ancestors 'none', got:\n{}",
            headers
        );
        assert!(headers.starts_with("HTTP/1.1 200 OK"), "got: {}", headers);
        assert!(body.starts_with(b"<!doctype html>"), "got body: {:?}", body);

        stop();
    }

    #[test]
    fn serves_static_assets_with_correct_mime() {
        let _guard = lock_proxy_test();
        let dir = setup_dist();
        let port = start(dir.path().to_str().unwrap(), 1).expect("start proxy");

        let (headers, body) = http_get("127.0.0.1", port, "/assets/index.js");
        assert!(headers.starts_with("HTTP/1.1 200 OK"), "got {}", headers);
        assert!(
            headers.to_ascii_lowercase().contains("content-type: application/javascript"),
            "expected JS mime, got: {}",
            headers
        );
        assert_eq!(body, b"console.log(\"hello\");");

        stop();
    }

    #[test]
    fn injects_the_application_owned_presentation_enhancer_once() {
        let _guard = lock_proxy_test();
        let dir = setup_dist();
        let port = start(dir.path().to_str().unwrap(), 1).expect("start proxy");

        let (_headers, body) = http_get("127.0.0.1", port, "/");
        let html = String::from_utf8(body).expect("HTML response");
        assert_eq!(
            html.matches("/__kuaifan__/control-ui-enhancer.js").count(),
            1,
            "the embedded UI must receive one presentation enhancer: {html}",
        );
        assert!(
            html.contains(r#"<script src="/__kuaifan__/control-ui-enhancer.js"></script>"#),
            "the injected script tag must be valid HTML: {html}",
        );

        stop();
    }

    #[test]
    fn serves_enhanced_index_for_spa_chat_route() {
        let _guard = lock_proxy_test();
        let dir = setup_dist();
        let port = start(dir.path().to_str().unwrap(), 1).expect("start proxy");

        let (headers, body) = http_get(
            "127.0.0.1",
            port,
            "/chat?session=agent%3Amain%3Amain",
        );
        let html = String::from_utf8(body).expect("HTML response");
        assert!(headers.starts_with("HTTP/1.1 200 OK"), "got {headers}");
        assert_eq!(
            html.matches("/__kuaifan__/control-ui-enhancer.js").count(),
            1,
            "SPA chat routes must receive the enhanced index: {html}",
        );

        stop();
    }

    #[test]
    fn serves_the_application_owned_presentation_enhancer() {
        let _guard = lock_proxy_test();
        let dir = setup_dist();
        let port = start(dir.path().to_str().unwrap(), 1).expect("start proxy");

        let (headers, body) = http_get(
            "127.0.0.1",
            port,
            "/__kuaifan__/control-ui-enhancer.js",
        );
        assert!(headers.starts_with("HTTP/1.1 200 OK"), "got {headers}");
        assert!(
            headers
                .to_ascii_lowercase()
                .contains("content-type: application/javascript"),
            "expected JavaScript MIME, got: {headers}",
        );
        assert!(
            String::from_utf8(body)
                .expect("enhancer source")
                .contains("KuaifanControlUiPresentation"),
        );

        stop();
    }

    #[test]
    fn returns_502_when_upstream_unreachable() {
        let _guard = lock_proxy_test();
        let dir = setup_dist();
        // 端口 1 一定不会有服务
        let port = start(dir.path().to_str().unwrap(), 1).expect("start proxy");

        let (headers, _body) = http_get("127.0.0.1", port, "/api/v1/whatever");
        assert!(
            headers.starts_with("HTTP/1.1 502"),
            "expected 502 from unreachable upstream, got: {}",
            headers
        );

        stop();
    }

    #[test]
    fn current_url_reports_listening_port() {
        let _guard = lock_proxy_test();
        let dir = setup_dist();

        // 之前可能跑过别的测试，先确保初始为 None
        stop();
        assert!(current_url().is_none(), "should be None before start");

        let port = start(dir.path().to_str().unwrap(), 1).expect("start");
        let url = current_url().expect("url after start");
        assert_eq!(url, format!("http://127.0.0.1:{}", port));

        stop();
        assert!(current_url().is_none(), "should be None after stop");
    }

    #[test]
    fn blocks_path_traversal() {
        let _guard = lock_proxy_test();
        let dir = setup_dist();
        let port = start(dir.path().to_str().unwrap(), 1).expect("start proxy");

        // 试图逃出 root → 静态文件找不到 → 走代理 → 502
        let (headers, _body) = http_get("127.0.0.1", port, "/../../../../etc/passwd");
        assert!(
            headers.starts_with("HTTP/1.1 502"),
            "expected 502 for traversal, got: {}",
            headers
        );

        stop();
    }
}



fn is_websocket_upgrade(headers: &HashMap<String, String>) -> bool {
    // RFC 6455: 必须同时包含 Upgrade: websocket 和 Connection: Upgrade（后者常含 "keep-alive, Upgrade"）
    let upgrade_is_ws = headers
        .get("upgrade")
        .map(|s| s.to_ascii_lowercase().split(',').any(|p| p.trim() == "websocket"))
        .unwrap_or(false);
    let connection_has_upgrade = headers
        .get("connection")
        .map(|s| s.to_ascii_lowercase().split(',').any(|p| p.trim() == "upgrade"))
        .unwrap_or(false);
    upgrade_is_ws && connection_has_upgrade
}

/// WebSocket 透明代理：把客户端的 Upgrade 请求原样转给网关，再把 101 响应回给客户端，
/// 之后双向转发二进制帧（不解析 WebSocket 帧头，只做 TCP 透传）。
fn proxy_websocket_to_gateway(
    mut client: TcpStream,
    header_bytes: &[u8],
    body: &[u8],
    gateway_port: u16,
) {
    let mut upstream = match TcpStream::connect(("127.0.0.1", gateway_port)) {
        Ok(s) => s,
        Err(e) => {
            write_502(&mut client, &format!("upstream connect: {}", e));
            return;
        }
    };
    let _ = upstream.set_read_timeout(Some(READ_TIMEOUT));
    let _ = upstream.set_write_timeout(Some(READ_TIMEOUT));

    if upstream.write_all(header_bytes).is_err() {
        return;
    }
    if !body.is_empty() && upstream.write_all(body).is_err() {
        return;
    }

    // 1) 把网关的 101 响应原样回给客户端：循环读取直到 \r\n\r\n，把整段 header 转发过去
    let mut resp_buf: Vec<u8> = Vec::with_capacity(8192);
    let mut tmp = [0u8; 8192];
    let mut header_done = false;
    while !header_done {
        match upstream.read(&mut tmp) {
            Ok(0) => return,
            Ok(n) => {
                resp_buf.extend_from_slice(&tmp[..n]);
                if let Some(p) = find_header_end(&resp_buf) {
                    if client.write_all(&resp_buf[..p]).is_err() {
                        return;
                    }
                    if p < resp_buf.len() {
                        let _ = client.write_all(&resp_buf[p..]);
                    }
                    header_done = true;
                } else if resp_buf.len() > MAX_HEADER_BYTES {
                    return;
                }
            }
            Err(_) => return,
        }
    }

    // 2) 升级成功，开始双向透明转发（不解 WebSocket 帧）
    let mut client_to_upstream = match client.try_clone() { Ok(s) => s, Err(_) => return };
    let mut upstream_to_client = match upstream.try_clone() { Ok(s) => s, Err(_) => return };
    // WS 长连接必须用更长的读超时，否则模型思考时（>30s 无字节）一端 read 会超时断开
    let _ = client_to_upstream.set_read_timeout(Some(WS_READ_TIMEOUT));
    let _ = client_to_upstream.set_write_timeout(Some(WS_READ_TIMEOUT));
    let _ = upstream_to_client.set_read_timeout(Some(WS_READ_TIMEOUT));
    let _ = upstream_to_client.set_write_timeout(Some(WS_READ_TIMEOUT));

    let t1 = std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match client_to_upstream.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if upstream.write_all(&buf[..n]).is_err() { break; }
                }
            }
        }
    });

    let mut buf = [0u8; 8192];
    loop {
        match upstream_to_client.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if client.write_all(&buf[..n]).is_err() { break; }
            }
        }
    }
    let _ = t1.join();
}



#[cfg(test)]
mod idempotency_tests {
    use super::*;

    /// 同一网关端口连续 start() 必须返回同一代理端口（避免前端每次点启动都换端口导致 iframe 重载）。
    #[test]
    fn start_is_idempotent_for_same_gateway_port() {
        let _guard = lock_proxy_test();
        let tmp = std::env::temp_dir().join("kuaifanclaw_proxy_test");
        let _ = std::fs::create_dir_all(&tmp);
        let openclaw_root = tmp.join("openclaw").join("dist").join("control-ui");
        let _ = std::fs::create_dir_all(&openclaw_root);
        let data_dir = tmp.to_string_lossy().to_string();

        let p1 = start(&data_dir, 19876).expect("first start");
        let p2 = start(&data_dir, 19876).expect("second start (should reuse)");
        let p3 = start(&data_dir, 19876).expect("third start (should reuse)");
        assert_eq!(p1, p2, "port should be stable across start() calls for same gateway port");
        assert_eq!(p2, p3, "port should remain stable");
        assert_eq!(current_port_for_gateway(19876), Some(p1), "helper should return same port");
        assert_eq!(current_port_for_gateway(19877), None, "different gateway port should not match");

        stop();
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
