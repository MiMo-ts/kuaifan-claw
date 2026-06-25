use crate::services::auth::map_api_error;

fn data_dir_pb(data_dir: &str) -> std::path::PathBuf { std::path::PathBuf::from(data_dir) }

#[tauri::command]
pub fn get_quota_info(api_url: String, data_dir: String) -> Result<serde_json::Value, String> {
    let resp = crate::services::auth::authed_get(&api_url, "/api/user/self", &data_dir_pb(&data_dir))?;
    let status = resp.status().as_u16();
    if !resp.status().is_success() {
        let b = resp.text().unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, b.chars().take(200).collect::<String>()));
    }
    let body: serde_json::Value = resp.json().map_err(|e| format!("json: {}", e))?;
    let data = body.get("data").ok_or("no data")?.clone();
    tracing::info!("quota: {}", data.get("quota").and_then(|q| q.as_i64()).unwrap_or(0));
    Ok(data)
}

#[tauri::command]
pub fn get_usage_logs(api_url: String, data_dir: String, page: Option<i32>, size: Option<i32>, start_ts: Option<i64>, end_ts: Option<i64>) -> Result<serde_json::Value, String> {
    let p = page.unwrap_or(0); let s = size.unwrap_or(20);
    let mut url = format!("/api/log/self?type=2&p={}&size={}", p, s);
    if let Some(ts) = start_ts { url.push_str(&format!("&start_timestamp={}", ts)); }
    if let Some(ts) = end_ts { url.push_str(&format!("&end_timestamp={}", ts)); }
    let resp = crate::services::auth::authed_get(&api_url, &url, &data_dir_pb(&data_dir))?;
    if !resp.status().is_success() { return Err(format!("HTTP {}", resp.status())); }
    resp.json::<serde_json::Value>().map_err(|e| format!("json: {}", e))
}

#[tauri::command]
pub fn get_quota_stats(api_url: String, data_dir: String) -> Result<serde_json::Value, String> {
    let resp = crate::services::auth::authed_get(&api_url, "/api/data/self", &data_dir_pb(&data_dir))?;
    if !resp.status().is_success() { return Err(format!("HTTP {}", resp.status())); }
    resp.json::<serde_json::Value>().map_err(|e| format!("json: {}", e))
}

#[tauri::command]
pub fn daily_checkin(api_url: String, data_dir: String) -> Result<serde_json::Value, String> {
    let resp = crate::services::auth::authed_post(&api_url, "/api/user/checkin", &data_dir_pb(&data_dir), serde_json::json!({}))?;
    if !resp.status().is_success() {
        let body: serde_json::Value = resp.json().unwrap_or_default();
        let msg = body.get("message").and_then(|m| m.as_str()).unwrap_or("签到失败");
        return Err(map_api_error(msg));
    }
    resp.json::<serde_json::Value>().map_err(|e| format!("json: {}", e))
}

#[tauri::command]
pub fn get_topup_info(api_url: String, data_dir: String) -> Result<serde_json::Value, String> {
    let resp = crate::services::auth::authed_get(&api_url, "/api/user/topup/info", &data_dir_pb(&data_dir))?;
    if !resp.status().is_success() { return Err(format!("HTTP {}", resp.status())); }
    resp.json::<serde_json::Value>().map_err(|e| format!("json: {}", e))
}

#[tauri::command]
pub fn create_pay_order(api_url: String, data_dir: String, amount: f64, method: String) -> Result<String, String> {
    let resp = crate::services::auth::authed_post(&api_url, "/api/user/pay", &data_dir_pb(&data_dir), serde_json::json!({"amount":amount,"payment_method":method}))?;
    if !resp.status().is_success() { return Err(format!("HTTP {}", resp.status())); }
    Ok(resp.json::<serde_json::Value>().map_err(|e| format!("json: {}", e))?.get("data").and_then(|d| d.as_str()).unwrap_or("").to_string())
}

#[tauri::command]
pub fn redeem_code(api_url: String, data_dir: String, code: String) -> Result<String, String> {
    let resp = crate::services::auth::authed_post(&api_url, "/api/user/topup", &data_dir_pb(&data_dir), serde_json::json!({"key":code}))?;
    if !resp.status().is_success() {
        let b: serde_json::Value = resp.json().unwrap_or_default();
        let msg = b.get("message").and_then(|m| m.as_str()).unwrap_or("兑换失败");
        return Err(map_api_error(msg));
    }
    let body: serde_json::Value = resp.json().map_err(|e| format!("解析响应失败: {}", e))?;
    Ok(body.get("message").and_then(|m| m.as_str()).unwrap_or("兑换成功").to_string())
}

#[tauri::command]
pub fn get_topup_history(api_url: String, data_dir: String) -> Result<serde_json::Value, String> {
    let resp = crate::services::auth::authed_get(&api_url, "/api/user/topup/self", &data_dir_pb(&data_dir))?;
    if !resp.status().is_success() { return Err(format!("HTTP {}", resp.status())); }
    resp.json::<serde_json::Value>().map_err(|e| format!("json: {}", e))
}
