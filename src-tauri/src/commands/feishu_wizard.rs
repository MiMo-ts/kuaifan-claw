// 飞书自动化配置向导 — Rust 后端命令
// 提供飞书凭证探测、WebSocket 端点查询等需要后端能力的功能

use serde::{Deserialize, Serialize};
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeResult {
    pub success: bool,
    pub app_id: Option<String>,
    pub app_secret: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ws_endpoint: Option<String>,
}

/// 获取飞书向导步骤指引（纯元数据，前端渲染使用）
#[tauri::command]
pub fn get_feishu_wizard_guide() -> serde_json::Value {
    serde_json::json!({
        "title": "飞书自动化配置向导",
        "steps": [
            {
                "step": 1,
                "title": "创建自建应用",
                "description": "打开飞书开放平台，创建自建应用，填写应用名称和描述。创建完成后，在「凭证与基础信息」中复制 App ID 和 App Secret。",
                "url": "https://open.feishu.cn/app",
                "urlLabel": "打开飞书开放平台",
                "checkLabel": "已创建自建应用并获取 App ID"
            },
            {
                "step": 2,
                "title": "配置权限",
                "description": "在应用后台的「权限管理」中，开通以下权限：im:message（获取与发送消息）、im:message.receive_v1（接收消息事件）、im:chat（获取群信息）。",
                "url": "https://open.feishu.cn/app",
                "urlLabel": "打开飞书开放平台",
                "checkLabel": "已开通所需权限"
            },
            {
                "step": 3,
                "title": "配置事件订阅",
                "description": "在「事件订阅」中添加事件：接收消息（im.message.receive_v1），并填写请求地址。系统将自动提供 WebSocket 接入点地址。",
                "url": "https://open.feishu.cn/app",
                "urlLabel": "打开飞书开放平台",
                "checkLabel": "已配置事件订阅"
            },
            {
                "step": 4,
                "title": "发布应用",
                "description": "在「版本管理与发布」中创建版本并提交审核。审核通过后，应用即可接收飞书消息。",
                "url": "https://open.feishu.cn/app",
                "urlLabel": "打开飞书开放平台",
                "checkLabel": "已完成发布"
            }
        ]
    })
}

/// 打开飞书开发者后台 URL
#[tauri::command]
pub fn open_feishu_url() -> Result<String, String> {
    Ok("https://open.feishu.cn/app".to_string())
}

/// 探测飞书凭证（app_id + app_secret）是否有效
/// 通过飞书 OAuth API 验证 app_id/app_secret 是否可获取 tenant_access_token
#[tauri::command]
pub async fn probe_feishu(
    app_id: String,
    app_secret: String,
) -> Result<ProbeResult, String> {
    info!("探测飞书凭证: {}", app_id);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    // 飞书获取 tenant_access_token 接口
    let resp = client
        .post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "app_id": app_id,
            "app_secret": app_secret
        }))
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    if body.get("code").and_then(|c| c.as_i64()).unwrap_or(-1) == 0 {
        let ws_port = crate::commands::gateway::resolve_gateway_http_port(
            &std::env::var("OPENCLAW_CN_DATA_DIR")
                .or_else(|_| std::env::var("APPDATA").map(|a| format!("{}/OpenClaw-CN Manager", a)))
                .unwrap_or_else(|_| ".".to_string()),
        );
        let ws_endpoint = format!("ws://127.0.0.1:{}/ws", ws_port);

        Ok(ProbeResult {
            success: true,
            app_id: Some(app_id),
            app_secret: None,
            error: None,
            ws_endpoint: Some(ws_endpoint),
        })
    } else {
        let msg = body.get("msg").and_then(|m| m.as_str()).unwrap_or("凭证验证失败");
        Ok(ProbeResult {
            success: false,
            app_id: Some(app_id),
            app_secret: None,
            error: Some(msg.to_string()),
            ws_endpoint: None,
        })
    }
}

/// 获取网关 WebSocket 端点信息（供飞书向导第三步使用）
#[tauri::command]
pub fn get_feishu_ws_info() -> Result<serde_json::Value, String> {
    let data_dir = std::env::var("OPENCLAW_CN_DATA_DIR")
        .or_else(|_| std::env::var("APPDATA").map(|a| format!("{}/OpenClaw-CN Manager", a)))
        .unwrap_or_else(|_| ".".to_string());

    let port = crate::commands::gateway::resolve_gateway_http_port(&data_dir);
    let ws_endpoint = format!("ws://127.0.0.1:{}/ws", port);
    let http_endpoint = format!("http://127.0.0.1:{}", port);

    Ok(serde_json::json!({
        "ws_endpoint": ws_endpoint,
        "http_endpoint": http_endpoint,
        "note": "网关需要处于运行状态才能接收飞书事件推送"
    }))
}
