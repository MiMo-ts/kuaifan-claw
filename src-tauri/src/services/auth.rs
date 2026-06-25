use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::info;

const SESSION_FILE: &str = "auth_session.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UserInfo {
    pub id: i32,
    pub username: String,
    pub display_name: String,
    pub role: i32,
    pub status: i32,
    pub group: String,
    #[serde(default)] pub quota: i32,
    #[serde(default)] pub used_quota: i32,
    #[serde(default)] pub request_count: i32,
    #[serde(default)] pub email: Option<String>,
    #[serde(default)] pub aff_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSession {
    pub user: UserInfo,
    pub session_cookie: String,
    pub api_key: String,
    pub saved_at: i64,
}

fn session_path(data_dir: &PathBuf) -> PathBuf { data_dir.join(SESSION_FILE) }

pub fn save_session(data_dir: &PathBuf, s: &AuthSession) -> Result<(), String> {
    let json = serde_json::to_string(s).map_err(|e| format!("json: {}", e))?;
    std::fs::write(session_path(data_dir), json).map_err(|e| format!("write: {}", e))
}

pub fn load_session(data_dir: &PathBuf) -> Result<Option<AuthSession>, String> {
    let path = session_path(data_dir);
    if !path.exists() { return Ok(None); }
    let c = std::fs::read_to_string(&path).map_err(|e| format!("read: {}", e))?;
    if c.trim().is_empty() { return Ok(None); }
    Ok(Some(serde_json::from_str(&c).map_err(|e| format!("parse: {}", e))?))
}

pub fn clear_session(data_dir: &PathBuf) -> Result<(), String> {
    let path = session_path(data_dir);
    if path.exists() { std::fs::remove_file(&path).map_err(|e| format!("rm: {}", e))?; }
    Ok(())
}

fn build_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .connect_timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("HTTP: {}", e))
}

/// Auth using session cookie + New-Api-User header
pub fn authed_get(api_url: &str, ep: &str, data_dir: &PathBuf) -> Result<reqwest::blocking::Response, String> {
    let s = load_session(data_dir)?.ok_or("未登录")?;
    build_client()?
        .get(format!("{}{}", api_url, ep))
        .header("Cookie", &s.session_cookie)
        .header("New-Api-User", s.user.id.to_string())
        .send()
        .map_err(|e| format!("GET {}: {}", ep, e))
}

pub fn authed_post(api_url: &str, ep: &str, data_dir: &PathBuf, body: serde_json::Value) -> Result<reqwest::blocking::Response, String> {
    let s = load_session(data_dir)?.ok_or("未登录")?;
    build_client()?
        .post(format!("{}{}", api_url, ep))
        .header("Cookie", &s.session_cookie)
        .header("New-Api-User", s.user.id.to_string())
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| format!("POST {}: {}", ep, e))
}

/// 将 API 返回的英文错误消息映射为中文
pub(crate) fn map_api_error(msg: &str) -> String {
    match msg {
        "Username or password is incorrect, or user has been banned" => "用户名或密码错误，或账号已被禁用".to_string(),
        "Username already exists or has been deleted" => "用户名已存在或已被删除".to_string(),
        "Invalid parameters" => "参数无效".to_string(),
        _ => msg.to_string(),
    }
}

fn extract_cookie(resp: &reqwest::blocking::Response) -> String {
    resp.headers().get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .filter_map(|s| s.split(';').next().map(|p| p.trim().to_string()))
        .collect::<Vec<_>>()
        .join("; ")
}

pub fn login(api_url: &str, username: &str, password: &str, data_dir: &PathBuf) -> Result<UserInfo, String> {
    let client = build_client()?;

    let r = client
        .post(format!("{}/api/user/login", api_url))
        .json(&serde_json::json!({"username":username,"password":password}))
        .send()
        .map_err(|e| format!("登录失败: {}", e))?;

    if !r.status().is_success() {
        let b: serde_json::Value = r.json().unwrap_or_default();
        let msg = b.get("message").and_then(|m| m.as_str()).unwrap_or("登录失败");
        return Err(map_api_error(msg));
    }

    let cookie = extract_cookie(&r);
    let body: serde_json::Value = r.json().map_err(|e| format!("解析登录响应失败: {}", e))?;

    // 检查 JSON 中的 success 字段（API 始终返回 HTTP 200）
    if body.get("success").and_then(|v| v.as_bool()) != Some(true) {
        let msg = body.get("message").and_then(|m| m.as_str()).unwrap_or("登录失败");
        return Err(map_api_error(msg));
    }

    let user: UserInfo = if let Some(d) = body.get("data") {
        serde_json::from_value(d.clone()).unwrap_or_default()
    } else {
        return Err("响应缺少 data 字段".to_string());
    };
    info!("login: user={} id={} cookie_len={}", user.username, user.id, cookie.len());

    // Get full info (quota) using session cookie
    let s = AuthSession { user: user.clone(), session_cookie: cookie, api_key: String::new(), saved_at: chrono::Utc::now().timestamp() };
    save_session(data_dir, &s)?;

    let full = get_self(api_url, data_dir).unwrap_or(user);
    let s = AuthSession { user: full.clone(), session_cookie: s.session_cookie, api_key: s.api_key, saved_at: chrono::Utc::now().timestamp() };
    save_session(data_dir, &s)?;
    info!("login OK: {} quota={}", username, full.quota);
    Ok(full)
}

pub fn register(api_url: &str, username: &str, password: &str, display_name: &str, data_dir: &PathBuf) -> Result<UserInfo, String> {
    let r = build_client()?
        .post(format!("{}/api/user/register", api_url))
        .json(&serde_json::json!({"username":username,"password":password,"confirm_password":password,"display_name":display_name}))
        .send().map_err(|e| format!("register: {}", e))?;
    if !r.status().is_success() {
        let b: serde_json::Value = r.json().unwrap_or_default();
        let msg = b.get("message").and_then(|m| m.as_str()).unwrap_or("注册失败");
        return Err(map_api_error(msg));
    }
    // 检查 JSON 中的 success 字段
    let body: serde_json::Value = r.json().map_err(|e| format!("解析注册响应失败: {}", e))?;
    if body.get("success").and_then(|v| v.as_bool()) != Some(true) {
        let msg = body.get("message").and_then(|m| m.as_str()).unwrap_or("注册失败");
        return Err(map_api_error(msg));
    }
    login(api_url, username, password, data_dir)
}

pub fn logout(api_url: &str, data_dir: &PathBuf) -> Result<(), String> {
    if let Ok(Some(s)) = load_session(data_dir) {
        let _ = build_client()?
            .get(format!("{}/api/user/logout", api_url))
            .header("Cookie", &s.session_cookie)
            .header("New-Api-User", s.user.id.to_string())
            .send();
    }
    clear_session(data_dir)
}

pub fn get_self(api_url: &str, data_dir: &PathBuf) -> Result<UserInfo, String> {
    let r = authed_get(api_url, "/api/user/self", data_dir)?;
    let status = r.status().as_u16();
    if status == 401 { let _ = clear_session(data_dir); return Err("登录已过期".into()); }
    if !r.status().is_success() {
        let b = r.text().unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, b.chars().take(200).collect::<String>()));
    }
    let body: serde_json::Value = r.json().map_err(|e| format!("json: {}", e))?;
    let data = body.get("data").ok_or("no data")?;
    let user: UserInfo = serde_json::from_value(data.clone()).map_err(|e| format!("user: {}", e))?;
    info!("self: {} quota={}", user.username, user.quota);
    if let Ok(Some(mut s)) = load_session(data_dir) { s.user = user.clone(); s.saved_at = chrono::Utc::now().timestamp(); let _ = save_session(data_dir, &s); }
    Ok(user)
}
