use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenInfo {
    pub id: i32,
    pub name: String,
    pub key: String,
    pub status: i32,
    pub remain_quota: i32,
    pub unlimited_quota: bool,
    pub created_time: i64,
    pub accessed_time: i64,
    pub expired_time: i64,
    pub used_quota: i32,
    pub group: String,
}

fn data_dir_pb(data_dir: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(data_dir)
}

#[tauri::command]
pub fn list_tokens(api_url: String, data_dir: String) -> Result<Vec<TokenInfo>, String> {
    let resp = crate::services::auth::authed_get(&api_url, "/api/token/", &data_dir_pb(&data_dir))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP 请求失败: {}", resp.status()));
    }
    let body: serde_json::Value = resp.json().map_err(|e| format!("JSON 解析失败: {}", e))?;
    let tokens: Vec<TokenInfo> = serde_json::from_value(body.get("data").cloned().unwrap_or_default())
        .map_err(|e| format!("JSON 解析失败: {}", e))?;
    Ok(tokens)
}

#[tauri::command]
pub fn create_token(api_url: String, data_dir: String, name: String) -> Result<serde_json::Value, String> {
    let resp = crate::services::auth::authed_post(&api_url, "/api/token/", &data_dir_pb(&data_dir), serde_json::json!({
        "name": name,
        "remain_quota": 0,
        "unlimited_quota": true,
    }))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP 请求失败: {}", resp.status()));
    }
    resp.json::<serde_json::Value>().map_err(|e| format!("JSON 解析失败: {}", e))
}

#[tauri::command]
pub fn delete_token(api_url: String, data_dir: String, id: i32) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP 请求失败: {}", e))?;
    let session = crate::services::auth::load_session(&data_dir_pb(&data_dir))?.ok_or("not logged in")?;
    let resp = client
        .delete(format!("{}/api/token/{}", api_url, id))
        .header("Cookie", &session.session_cookie)
        .header("New-Api-User", session.user.id.to_string())
        .send()
        .map_err(|e| format!("请求失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP 请求失败: {}", resp.status()));
    }
    Ok(())
}

#[tauri::command]
pub fn reveal_token_key(api_url: String, data_dir: String, id: i32) -> Result<String, String> {
    let resp = crate::services::auth::authed_post(&api_url, &format!("/api/token/{}/key", id), &data_dir_pb(&data_dir), serde_json::json!({}))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP 请求失败: {}", resp.status()));
    }
    let body: serde_json::Value = resp.json().map_err(|e| format!("解析响应失败: {}", e))?;
    let key = body.get("data").and_then(|d| d.get("key")).and_then(|k| k.as_str()).ok_or("响应缺少 key 字段")?;
    Ok(key.to_string())
}

#[tauri::command]
pub fn auto_configure_api_key(api_url: String, data_dir: String) -> Result<String, String> {
    let dir = data_dir_pb(&data_dir);

    let resp = crate::services::auth::authed_get(&api_url, "/api/token/", &dir)?;
    let body: serde_json::Value = resp.json().map_err(|e| format!("解析 token 列表失败: {}", e))?;
    let tokens: Vec<serde_json::Value> = body.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default();

    let first_token = if tokens.is_empty() {
        let create_resp = crate::services::auth::authed_post(&api_url, "/api/token/", &dir, serde_json::json!({
            "name": "快泛Claw 默认密钥",
            "remain_quota": 0,
            "unlimited_quota": true,
        }))?;
        let cb: serde_json::Value = create_resp.json().map_err(|e| format!("解析创建响应失败: {}", e))?;
        cb.get("data").cloned().unwrap_or_default()
    } else {
        tokens[0].clone()
    };

    let token_id = first_token.get("id").and_then(|i| i.as_i64()).unwrap_or(0) as i32;
    let key = reveal_token_key(api_url.clone(), data_dir.clone(), token_id)?;

    let cfg = crate::commands::gateway::models_yaml_path(&data_dir);
    let content = std::fs::read_to_string(&cfg).unwrap_or_default();
    let mut doc: serde_yaml::Value = serde_yaml::from_str(&content).unwrap_or_default();
    if let Some(providers) = doc["providers"].as_mapping_mut() {
        let kf = providers.entry(serde_yaml::Value::String("kuaifan".into()))
            .or_insert(serde_yaml::Value::Mapping(serde_yaml::Mapping::new()));
        if let Some(m) = kf.as_mapping_mut() {
            m.insert("api_key".into(), serde_yaml::Value::String(key.clone()));
            m.insert("base_url".into(), serde_yaml::Value::String("https://kuaifanio.cn/v1".into()));
            m.insert("enabled".into(), serde_yaml::Value::Bool(true));
        }
    }
    let yaml_str = serde_yaml::to_string(&doc).map_err(|e| format!("YAML 序列化失败: {}", e))?;
    std::fs::write(&cfg, yaml_str).map_err(|e| format!("写入模型配置失败: {}", e))?;

    let rt = tokio::runtime::Runtime::new().map_err(|e| format!("runtime: {}", e))?;
    rt.block_on(async { crate::commands::gateway::sync_openclaw_config_from_manager(&data_dir).await })?;

    tracing::info!("auto_configure_api_key: token_id={}", token_id);
    Ok(key)
}
