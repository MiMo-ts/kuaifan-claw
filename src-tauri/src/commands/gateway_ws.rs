//! 通过 WebSocket 调用 OpenClaw 网关 JSON-RPC（用量等接口未在 HTTP 上暴露，走 WS 才返回 JSON）。

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tokio_tungstenite::{
    connect_async, tungstenite::client::IntoClientRequest, tungstenite::Message,
};

const GATEWAY_PROTOCOL: i64 = 3;

/// 连接本机网关、完成 `connect` 握手后调用一条 `method`，返回成功时的 `payload`（JSON）。
pub async fn call_gateway_method(
    port: u16,
    token: &str,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let url = format!("ws://127.0.0.1:{}/", port);
    let mut req = url
        .into_client_request()
        .map_err(|e| format!("构建 WebSocket 请求失败: {}", e))?;
    req.headers_mut().insert(
        "Authorization",
        format!("Bearer {}", token)
            .parse()
            .map_err(|e| format!("Authorization 头无效: {}", e))?,
    );

    let (mut ws, _) = connect_async(req)
        .await
        .map_err(|e| format!("连接网关 WebSocket 失败: {}", e))?;

    // 首帧：event connect.challenge（忽略内容，仅消费）
    let _ = read_until_frame(&mut ws, |v| {
        v.get("type").and_then(|t| t.as_str()) == Some("event")
    })
    .await?;

    let connect_id = "mgr-connect-1";
    let connect_body = json!({
        "type": "req",
        "id": connect_id,
        "method": "connect",
        "params": {
            "minProtocol": GATEWAY_PROTOCOL,
            "maxProtocol": GATEWAY_PROTOCOL,
            "client": {
                "id": "cli",
                "version": env!("CARGO_PKG_VERSION"),
                "platform": std::env::consts::OS,
                "mode": "cli"
            },
            "role": "operator",
            "auth": { "token": token }
        }
    });
    send_text(&mut ws, &connect_body.to_string()).await?;

    let connect_res = read_response_payload(&mut ws, connect_id).await?;
    if !connect_res.ok {
        let err = connect_res
            .error
            .map(|e| e.to_string())
            .unwrap_or_else(|| "connect 失败".to_string());
        return Err(format!("网关握手失败: {}", err));
    }

    let call_id = "mgr-call-1";
    let call = if params.is_null() {
        json!({ "type": "req", "id": call_id, "method": method })
    } else {
        json!({ "type": "req", "id": call_id, "method": method, "params": params })
    };
    send_text(&mut ws, &call.to_string()).await?;

    let call_res = read_response_payload(&mut ws, call_id).await?;
    if !call_res.ok {
        let err = call_res
            .error
            .map(|e| e.to_string())
            .unwrap_or_else(|| "调用失败".to_string());
        return Err(format!("网关返回业务错误: {}", err));
    }
    call_res
        .payload
        .ok_or_else(|| "网关响应缺少 payload".to_string())
}

/// 从 chat event payload 的 message 对象中提取文本
fn extract_chat_text(payload: &Value) -> Option<&str> {
    payload.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_array())
        .and_then(|arr| arr.first()).and_then(|item| item.get("text")).and_then(|t| t.as_str())
}

/// 通过 WebSocket 发送 chat 消息到网关 agent，经过完整 agent 管线
pub async fn call_gateway_chat(
    port: u16, token: &str, message: &str, session_key: Option<&str>, model: Option<&str>,
    attachments: Option<&serde_json::Value>,
) -> Result<String, String> {
    let url = format!("ws://127.0.0.1:{}/", port);
    let mut req = url.into_client_request().map_err(|e| format!("构建 WS 请求失败: {}", e))?;
    req.headers_mut().insert("Authorization", format!("Bearer {}", token).parse().map_err(|e| format!("Authorization 头无效: {}", e))?);
    let (mut ws, _) = connect_async(req).await.map_err(|e| format!("连接网关 WS 失败: {}", e))?;
    let _ = read_until_frame(&mut ws, |v| v.get("type").and_then(|t| t.as_str()) == Some("event")).await?;
    let connect_body = json!({"type":"req","id":"mgr-connect-1","method":"connect","params":{"minProtocol":3,"maxProtocol":3,"client":{"id":"cli","version":env!("CARGO_PKG_VERSION"),"platform":std::env::consts::OS,"mode":"cli"},"role":"operator","auth":{"token":token}}});
    send_text(&mut ws, &connect_body.to_string()).await?;
    let connect_res = read_response_payload(&mut ws, "mgr-connect-1").await?;
    if !connect_res.ok { return Err(format!("握手失败: {}", connect_res.error.map(|e| e.to_string()).unwrap_or_default())); }
    let sk = session_key.map(|s| s.to_string()).unwrap_or_else(|| format!("kuaifan-{}", uuid::Uuid::new_v4()));
    if let Some(m) = model {
        let (provider, model_name) = if let Some(idx) = m.find('/') { (&m[..idx], &m[idx+1..]) } else { ("kuaifan", m) };
        let patch = json!({"type":"req","id":"mgr-patch","method":"sessions.patch","params":{"key":sk,"model":format!("{}/{}",provider,model_name)}});
        send_text(&mut ws, &patch.to_string()).await?;
        let _ = read_response_payload(&mut ws, "mgr-patch").await?;
    }
    let mut chat_params = json!({"message":message,"sessionKey":sk,"deliver":false,"idempotencyKey":format!("mgr-{}",uuid::Uuid::new_v4())});
    if let Some(atts) = attachments { if let Some(arr) = atts.as_array() { if !arr.is_empty() { chat_params["attachments"] = atts.clone(); } } }
    send_text(&mut ws, &json!({"type":"req","id":"mgr-chat","method":"chat.send","params":chat_params}).to_string()).await?;
    let chat_res = read_response_payload(&mut ws, "mgr-chat").await?;
    if !chat_res.ok { return Err(format!("chat.send: {}", chat_res.error.map(|e| e.to_string()).unwrap_or_default())); }
    let mut content = String::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(180);
    loop {
        let v = tokio::time::timeout(Duration::from_secs(60), next_json_value(&mut ws)).await.map_err(|_| "等待响应超时".to_string())??;
        if std::time::Instant::now() > deadline { break; }
        if v.get("type").and_then(|t| t.as_str()) != Some("event") { continue; }
        if v.get("event").and_then(|e| e.as_str()) != Some("chat") { continue; }
        let payload = match v.get("payload") { Some(p) => p, None => continue };
        match payload.get("state").and_then(|s| s.as_str()).unwrap_or("delta") {
            "delta" => { if let Some(t) = extract_chat_text(payload) { content.push_str(t); } }
            "final" => { if let Some(t) = extract_chat_text(payload) { content = t.to_string(); } break; }
            "error" => { return Err(payload.get("errorMessage").and_then(|m| m.as_str()).unwrap_or("agent 错误").to_string()); }
            "aborted" => break,
            _ => {}
        }
    }
    Ok(serde_json::json!({"choices":[{"message":{"role":"assistant","content":content}}],"model":model.unwrap_or("")}).to_string())
}

struct ParsedRes {
    ok: bool,
    payload: Option<Value>,
    error: Option<Value>,
}

async fn send_text(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    text: &str,
) -> Result<(), String> {
    ws.send(Message::Text(text.into()))
        .await
        .map_err(|e| format!("发送 WS 消息失败: {}", e))
}

async fn read_until_frame<F>(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    pred: F,
) -> Result<Value, String>
where
    F: Fn(&Value) -> bool,
{
    loop {
        let v = next_json_value(ws).await?;
        if pred(&v) {
            return Ok(v);
        }
    }
}

async fn read_response_payload(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    expect_id: &str,
) -> Result<ParsedRes, String> {
    loop {
        let v = next_json_value(ws).await?;
        let ty = v.get("type").and_then(|t| t.as_str());
        if ty != Some("res") {
            continue;
        }
        let id_match = v
            .get("id")
            .and_then(|i| i.as_str())
            .map(|s| s == expect_id)
            .unwrap_or(false);
        if !id_match {
            continue;
        }
        let ok = v.get("ok").and_then(|b| b.as_bool()).unwrap_or(false);
        let payload = v.get("payload").cloned();
        let error = v.get("error").cloned();
        return Ok(ParsedRes { ok, payload, error });
    }
}

async fn next_json_value(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Result<Value, String> {
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(45), ws.next())
            .await
            .map_err(|_| "读取网关 WebSocket 超时".to_string())?
            .ok_or_else(|| "网关 WebSocket 已关闭".to_string())?
            .map_err(|e| format!("读取 WS 失败: {}", e))?;

        match msg {
            Message::Text(t) => {
                let s = t.to_string();
                return serde_json::from_str(&s).map_err(|e| {
                    format!(
                        "解析网关 WS 消息失败: {} (前 200 字: {})",
                        e,
                        s.chars().take(200).collect::<String>()
                    )
                });
            }
            Message::Ping(p) => {
                ws.send(Message::Pong(p))
                    .await
                    .map_err(|e| format!("回复 Ping 失败: {}", e))?;
            }
            Message::Close(f) => {
                let reason = f.map(|c| c.to_string()).unwrap_or_default();
                return Err(format!("网关关闭 WebSocket: {}", reason));
            }
            Message::Binary(_) | Message::Pong(_) | Message::Frame(_) => {}
        }
    }
}
