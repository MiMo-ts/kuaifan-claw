// 统一插件框架 — 声明式配置 + API 驱动的快捷绑定
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::BufRead;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
#[cfg(windows)] use std::os::windows::process::CommandExt;
use tauri::{AppHandle, Emitter, Manager};

// ============================================================
// 数据模型
// ============================================================
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PluginProtocol { #[default] Http, Stream, WebSocket }
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AuthFlow { #[default] Manual, #[serde(alias = "device_code")] DeviceCode, #[serde(alias = "qrcode_scan")] QrCodeScan }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallConfig { pub command: String, pub args: Vec<String>, #[serde(default = "dt")] pub timeout_ms: u64 } fn dt() -> u64 { 120000 }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceAuthConfig { pub init_url: String, pub begin_url: String, pub poll_url: String, #[serde(default = "di")] pub poll_interval_ms: u64, #[serde(default = "db")] pub backoff_multiplier: f64, #[serde(default = "dm")] pub max_poll_attempts: u32 } fn di() -> u64 { 3000 } fn db() -> f64 { 2.0 } fn dm() -> u32 { 40 }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrCodeConfig { pub get_url: String, pub poll_url: String, #[serde(default = "di")] pub poll_interval_ms: u64, #[serde(default = "dq")] pub max_poll_attempts: u32 } fn dq() -> u32 { 60 }
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AuthConfig { #[serde(default)] pub flow: AuthFlow, #[serde(default)] pub device_auth: Option<DeviceAuthConfig>, #[serde(default)] pub qrcode: Option<QrCodeConfig> }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialDef { pub name: String, pub label: String, #[serde(rename = "type")] pub cred_type: String, #[serde(default = "dt2")] pub required: bool } fn dt2() -> bool { true }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayConfig { pub channel_id: String, #[serde(default)] pub single_account: bool }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest { pub id: String, pub name: String, pub version: String, pub icon: String, pub description: String, #[serde(default)] pub protocol: PluginProtocol, #[serde(default)] pub features: Vec<String>, pub install: InstallConfig, #[serde(default)] pub auth: AuthConfig, #[serde(default)] pub credentials: Vec<CredentialDef>, pub gateway: GatewayConfig }
#[derive(Debug, Clone, Serialize)] pub struct DeviceAuthStart { pub success: bool, pub qr_image_base64: String, pub device_code: String, pub expires_in: u64, pub interval_ms: u64, pub error: Option<String> }
#[derive(Debug, Clone, Serialize)] pub struct DeviceAuthResult { pub status: String, pub access_token: Option<String>, pub client_secret: Option<String>, pub message: Option<String>, pub error: Option<String> }
#[derive(Debug, Clone, Serialize)] pub struct QrCodeAuthStart { pub success: bool, pub qr_image_base64: String, pub qrcode_token: String, pub error: Option<String> }
#[derive(Debug, Clone, Serialize)] pub struct QrCodeAuthResult { pub status: String, pub bot_token: Option<String>, pub ilink_bot_id: Option<String>, pub error: Option<String> }
#[derive(Debug, Clone, Serialize)] pub struct ValidationResult { pub valid: bool, pub message: Option<String> }

// ============================================================
// QR 码生成
// ============================================================
pub(crate) fn generate_qr_base64(url: &str) -> Result<String, String> {
    use image::Luma; use qrcode::QrCode;
    let code = QrCode::new(url).map_err(|e| format!("QR: {}", e))?;
    let img = code.render::<Luma<u8>>().min_dimensions(300, 300).build();
    let mut buf = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png).map_err(|e| format!("QR编码: {}", e))?;
    Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buf))
}

// ============================================================
// 清单加载
// ============================================================
fn load_manifests_from_dir(dir: &std::path::Path) -> Result<Vec<PluginManifest>, String> {
    if !dir.is_dir() { return Ok(vec![]); }
    let mut manifests = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| format!("读取目录: {}", e))?.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "yaml" || e == "yml").unwrap_or(false) {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(m) = serde_yaml::from_str::<PluginManifest>(&content) { manifests.push(m); }
            }
        }
    }
    Ok(manifests)
}

pub fn load_manifest_by_id(app: &AppHandle, data_dir: &str, plugin_id: &str) -> Result<PluginManifest, String> {
    let user_path = PathBuf::from(data_dir).join("config").join("plugin_manifests").join(format!("{}.yaml", plugin_id));
    if user_path.exists() { if let Ok(c) = std::fs::read_to_string(&user_path) { if let Ok(m) = serde_yaml::from_str(&c) { return Ok(m); } } }
    if let Ok(rd) = app.path().resource_dir() {
        let bp = rd.join("data").join("config").join("plugin_manifests").join(format!("{}.yaml", plugin_id));
        if bp.is_file() { let c = std::fs::read_to_string(&bp).map_err(|e| format!("读取: {}", e))?; return serde_yaml::from_str(&c).map_err(|e| format!("解析: {}", e)); }
    }
    if let Ok(ep) = std::env::current_exe() {
        let pp = ep.parent().unwrap_or(&ep).join("resources").join("data").join("config").join("plugin_manifests").join(format!("{}.yaml", plugin_id));
        if pp.is_file() { let c = std::fs::read_to_string(&pp).map_err(|e| format!("读取: {}", e))?; return serde_yaml::from_str(&c).map_err(|e| format!("解析: {}", e)); }
    }
    Err(format!("未找到插件清单: {}", plugin_id))
}

fn load_all_manifests(app: &AppHandle, data_dir: &str) -> Vec<PluginManifest> {
    let paths = [
        PathBuf::from(data_dir).join("config").join("plugin_manifests"),
        app.path().resource_dir().map(|r| r.join("data").join("config").join("plugin_manifests")).unwrap_or_default(),
        std::env::current_exe().map(|e| e.parent().unwrap_or(&e).join("resources").join("data").join("config").join("plugin_manifests")).unwrap_or_default(),
    ];
    for p in &paths { if let Ok(m) = load_manifests_from_dir(p) { if !m.is_empty() { return m; } } }
    vec![]
}

// ============================================================
// Tauri 命令
// ============================================================
#[tauri::command] pub fn get_plugin_manifests(app: AppHandle, data_dir: tauri::State<'_, crate::AppState>) -> Result<Vec<PluginManifest>, String> { Ok(load_all_manifests(&app, &data_dir.inner().get_data_dir())) }
#[tauri::command] pub fn get_plugin_manifest(app: AppHandle, data_dir: tauri::State<'_, crate::AppState>, plugin_id: String) -> Result<Option<PluginManifest>, String> { let dd = data_dir.inner().get_data_dir(); match load_manifest_by_id(&app, &dd, &plugin_id) { Ok(m) => Ok(Some(m)), Err(_) => Ok(None) } }
#[tauri::command] pub fn get_plugin_auth_config(app: AppHandle, data_dir: tauri::State<'_, crate::AppState>, plugin_id: String) -> Result<Option<AuthConfig>, String> { let dd = data_dir.inner().get_data_dir(); Ok(load_manifest_by_id(&app, &dd, &plugin_id).ok().map(|m| m.auth)) }
#[tauri::command] pub fn get_plugin_credentials(app: AppHandle, data_dir: tauri::State<'_, crate::AppState>, plugin_id: String) -> Result<Vec<CredentialDef>, String> { let dd = data_dir.inner().get_data_dir(); load_manifest_by_id(&app, &dd, &plugin_id).map(|m| m.credentials).map_err(|e| e) }
#[tauri::command] pub fn validate_plugin_credentials(app: AppHandle, data_dir: tauri::State<'_, crate::AppState>, plugin_id: String, credentials: HashMap<String,String>) -> Result<ValidationResult, String> { let dd = data_dir.inner().get_data_dir(); let m = load_manifest_by_id(&app,&dd,&plugin_id)?; let missing: Vec<_> = m.credentials.iter().filter(|c| c.required && credentials.get(&c.name).map_or(true, |s| s.trim().is_empty())).map(|c| c.label.clone()).collect(); if missing.is_empty() { Ok(ValidationResult{valid:true,message:Some("通过".into())}) } else { Ok(ValidationResult{valid:false,message:Some(format!("缺少: {}",missing.join(", ")))}) } }

#[tauri::command]
pub async fn install_plugin_cli(app: AppHandle, data_dir: tauri::State<'_, crate::AppState>, plugin_id: String) -> Result<String, String> {
    let dd = data_dir.inner().get_data_dir();
    let m = load_manifest_by_id(&app, &dd, &plugin_id)?;
    let stage = format!("plugin-install-{}", plugin_id);
    let _ = app.emit("install-progress", crate::mirror::InstallProgressEvent::started(&stage, &format!("正在安装 {}…", m.name)));
    let mut c = Command::new(&m.install.command);
    c.args(&m.install.args).current_dir(&dd);
    #[cfg(windows)] { let _ = c.creation_flags(0x08000000); }
    let output = c.output().map_err(|e| { let msg = format!("执行失败: {}", e); let _ = app.emit("install-progress", crate::mirror::InstallProgressEvent::failed(&stage, &msg)); msg })?;
    if output.status.success() {
        let _ = app.emit("install-progress", crate::mirror::InstallProgressEvent::finished(&stage, &format!("{} 安装成功", m.name)));
        let _ = crate::commands::plugin::sync_plugins_load_paths(&dd).await;
        let _ = crate::commands::gateway::sync_openclaw_config_from_manager(&dd).await;
        Ok(format!("{} 安装成功", plugin_id))
    } else { let e = String::from_utf8_lossy(&output.stderr); Err(format!("安装失败: {}", &e[..std::cmp::min(300, e.len())])) }
}

#[tauri::command]
pub async fn start_device_auth(app: AppHandle, data_dir: tauri::State<'_, crate::AppState>, plugin_id: String) -> Result<DeviceAuthStart, String> {
    let dd = data_dir.inner().get_data_dir();
    let m = load_manifest_by_id(&app, &dd, &plugin_id)?;
    let da = m.auth.device_auth.ok_or("不支持DeviceAuth".to_string())?;
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30)).build().map_err(|e| format!("HTTP:{}",e))?;
    let init: serde_json::Value = client.post(&da.init_url).json(&serde_json::json!({"clientName":"快泛Claw","clientId":"DING_DWS_CLAW","scope":"openid corpid"})).send().await.map_err(|e| format!("init:{}",e))?.json().await.map_err(|e| format!("解析:{}",e))?;
    let nonce = init.get("nonce").and_then(|v| v.as_str()).ok_or(format!("无nonce:{}",init))?.to_string();
    let begin: serde_json::Value = client.post(&da.begin_url).json(&serde_json::json!({"nonce":nonce,"clientId":"DING_DWS_CLAW"})).send().await.map_err(|e| format!("begin:{}",e))?.json().await.map_err(|e| format!("解析:{}",e))?;
    let dc = begin.get("device_code").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let qr = begin.get("verification_uri_complete").or(begin.get("verification_uri")).and_then(|v| v.as_str()).unwrap_or("").to_string();
    if qr.is_empty() { return Ok(DeviceAuthStart{success:false,qr_image_base64:String::new(),device_code:dc,expires_in:0,interval_ms:0,error:Some("无QR".into())}); }
    let b64 = generate_qr_base64(&qr)?;
    Ok(DeviceAuthStart{success:true,qr_image_base64:b64,device_code:dc,expires_in:7200,interval_ms:da.poll_interval_ms,error:None})
}

#[tauri::command]
pub async fn poll_device_auth(app: AppHandle, data_dir: tauri::State<'_, crate::AppState>, plugin_id: String, device_code: String) -> Result<DeviceAuthResult, String> {
    let dd = data_dir.inner().get_data_dir();
    let m = load_manifest_by_id(&app, &dd, &plugin_id)?;
    let da = m.auth.device_auth.ok_or("不支持DeviceAuth".to_string())?;
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(120)).build().map_err(|e| format!("HTTP:{}",e))?;
    let resp: serde_json::Value = match client.post(&da.poll_url).json(&serde_json::json!({"device_code":device_code})).send().await {
        Ok(r) => r.json().await.map_err(|e| format!("解析:{}",e))?,
        Err(e) if e.is_timeout() => return Ok(DeviceAuthResult{status:"waiting".into(),access_token:None,client_secret:None,message:Some("等待扫码…".into()),error:None}),
        Err(e) => return Err(format!("poll:{}",e)),
    };
    let st = resp.get("status").and_then(|v| v.as_str()).unwrap_or("");
    tracing::info!("[pf] dingtalk poll resp: {:?}", resp);
    match st {
        "SUCCESS" => {
            let cid = resp.get("clientId").or_else(|| resp.get("client_id")).or_else(|| resp.get("appId")).or_else(|| resp.get("app_id")).or_else(|| resp.get("accessToken")).and_then(|v| v.as_str()).map(|s| s.to_string());
            let csec = resp.get("clientSecret").or_else(|| resp.get("client_secret")).or_else(|| resp.get("appSecret")).or_else(|| resp.get("app_secret")).and_then(|v| v.as_str()).map(|s| s.to_string());
            tracing::info!("[pf] dingtalk SUCCESS: cid={:?}, csec_len={}", cid, csec.as_ref().map(|s|s.len()).unwrap_or(0));
            Ok(DeviceAuthResult{status:"success".into(),access_token:cid,client_secret:csec,message:Some("成功".into()),error:None})
        },
        "WAITING"|"SCANNED" => {
            let msg: Option<String> = Some(if st=="SCANNED"{"已扫码…"}else{"等待扫码…"}.to_string());
            Ok(DeviceAuthResult{status:"waiting".into(),access_token:None,client_secret:None,message:msg,error:None})
        },
        "EXPIRED"|"expired" => Ok(DeviceAuthResult{status:"expired".into(),access_token:None,client_secret:None,message:Some("已过期".into()),error:None}),
        "DENIED"|"denied" => Ok(DeviceAuthResult{status:"denied".into(),access_token:None,client_secret:None,message:Some("已拒绝".into()),error:None}),
        _ if resp.get("errcode").and_then(|v|v.as_i64())!=Some(0) => { let em = resp.get("errmsg").and_then(|v|v.as_str()).unwrap_or("未知"); Ok(DeviceAuthResult{status:"error".into(),access_token:None,client_secret:None,message:None,error:Some(format!("{}",em))}) }
        _ => Ok(DeviceAuthResult{status:"waiting".into(),access_token:None,client_secret:None,message:Some(format!("{}…",st)),error:None}),
    }
}

#[tauri::command]
pub async fn start_qrcode_auth(app: AppHandle, data_dir: tauri::State<'_, crate::AppState>, plugin_id: String) -> Result<QrCodeAuthStart, String> {
    let dd = data_dir.inner().get_data_dir();
    let m = load_manifest_by_id(&app, &dd, &plugin_id)?;
    let qc = m.auth.qrcode.ok_or("不支持QR".to_string())?;
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30)).build().map_err(|e| format!("HTTP:{}",e))?;
    let resp: serde_json::Value = client.get(&qc.get_url).send().await.map_err(|e| format!("获取:{}",e))?.json().await.map_err(|e| format!("解析:{}",e))?;
    let url = resp.get("qrcode_img_content").and_then(|v|v.as_str()).unwrap_or("").to_string();
    let token = resp.get("qrcode").and_then(|v|v.as_str()).unwrap_or("").to_string();
    if url.is_empty() { return Ok(QrCodeAuthStart{success:false,qr_image_base64:String::new(),qrcode_token:token,error:Some("无QR URL".into())}); }
    Ok(QrCodeAuthStart{success:true,qr_image_base64:generate_qr_base64(&url)?,qrcode_token:token,error:None})
}

#[tauri::command]
pub async fn poll_qrcode_auth(app: AppHandle, data_dir: tauri::State<'_, crate::AppState>, plugin_id: String, qrcode_token: String) -> Result<QrCodeAuthResult, String> {
    let dd = data_dir.inner().get_data_dir();
    let _m = load_manifest_by_id(&app, &dd, &plugin_id)?;
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30)).build().map_err(|e| format!("HTTP:{}",e))?;
    let url = format!("https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode={}", qrcode_token);
    let resp: serde_json::Value = client.get(&url).send().await.map_err(|e| format!("poll:{}",e))?.json().await.map_err(|e| format!("解析:{}",e))?;
    let ret = resp.get("ret").and_then(|v|v.as_i64()).unwrap_or(-1);
    let st = resp.get("status").and_then(|v|v.as_str()).unwrap_or("");
    match (ret, st) {
        (0, "confirmed") => Ok(QrCodeAuthResult{status:"confirmed".into(),bot_token:resp.get("bot_token").and_then(|v|v.as_str()).map(|s|s.to_string()),ilink_bot_id:None,error:None}),
        (0, "scanned") => Ok(QrCodeAuthResult{status:"scanned".into(),bot_token:None,ilink_bot_id:None,error:None}),
        (0, "wait") => Ok(QrCodeAuthResult{status:"wait".into(),bot_token:None,ilink_bot_id:None,error:None}),
        (0, "expired") => Ok(QrCodeAuthResult{status:"expired".into(),bot_token:None,ilink_bot_id:None,error:Some("已过期".into())}),
        _ => Ok(QrCodeAuthResult{status:"error".into(),bot_token:None,ilink_bot_id:None,error:Some(format!("ret={} st={}",ret,st))}),
    }
}

// ============================================================
// WeChat CLI 快捷绑定（后台执行，不弹窗）
// ============================================================
static ACTIVE_WECHAT_QR: Mutex<Option<(String, String, String)>> = Mutex::new(None);

#[tauri::command]
pub async fn start_wechat_cli_bind(data_dir: tauri::State<'_, crate::AppState>, module_id: Option<String>) -> Result<DeviceAuthStart, String> {
    let dd = data_dir.inner().get_data_dir();
    let mid = module_id.unwrap_or_else(|| "openclaw".to_string());
    tracing::info!("[pf] start_wechat_cli_bind: dd={} module={}", dd, mid);
    // 先清旧状态
    if let Ok(mut g) = ACTIVE_WECHAT_QR.lock() { *g = None; }

    // CLI 与 HTTP API 并行取二维码。两条路径各自 spawn 到独立 task，
    // 结果经 oneshot channel 传回，select! borrow receiver 无取消问题。
    let dd_cli = dd.clone();
    let (cli_tx, mut cli_rx) = tokio::sync::oneshot::channel::<Option<String>>();
    let (api_tx, mut api_rx) = tokio::sync::oneshot::channel::<Option<(String, String)>>();

    // CLI 路径（后台 task，8s 超时）
    tokio::spawn(async move {
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(8),
            try_cli_qr(&dd_cli),
        ).await.ok().flatten();
        let _ = cli_tx.send(result);
    });

    // HTTP API 路径（后台 task，10s 超时）
    tokio::spawn(async move {
        let result = async {
            let client = match reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .danger_accept_invalid_certs(false)
                .build() {
                Ok(c) => c,
                Err(e) => { tracing::warn!("[pf] wechat qr client build failed: {}", e); return None; }
            };
            let resp = match client
                .get("https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3")
                .header("User-Agent", "Mozilla/5.0")
                .send().await {
                Ok(r) => r,
                Err(e) => { tracing::warn!("[pf] wechat qr HTTP failed: {}", e); return None; }
            };
            let status = resp.status();
            let body = match resp.text().await {
                Ok(b) => b,
                Err(e) => { tracing::warn!("[pf] wechat qr read body failed: {}", e); return None; }
            };
            let v: serde_json::Value = match serde_json::from_str(&body) {
                Ok(v) => v,
                Err(e) => { tracing::warn!("[pf] wechat qr json parse failed: {} body={}", e, &body[..body.len().min(200)]); return None; }
            };
            let url = v.get("qrcode_img_content").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let tk = v.get("qrcode").and_then(|x| x.as_str()).unwrap_or("").to_string();
            tracing::info!("[pf] wechat qr API: status={} url_len={} tk_len={}", status, url.len(), tk.len());
            if url.is_empty() { None } else { Some((url, tk)) }
        }.await;
        let _ = api_tx.send(result);
    });

    // 競速：取先返回的有效结果。borrow receiver 不 move，输方可继续 await。
    let result: Option<(String, String)> = tokio::select! {
        cli_res = &mut cli_rx => {
            if let Ok(Some(qr_url)) = cli_res {
                let t = qr_url.split("qrcode=").nth(1).and_then(|s| s.split('&').next()).unwrap_or("").to_string();
                if !t.is_empty() {
                    if let Ok(mut g) = ACTIVE_WECHAT_QR.lock() { *g = Some((t.clone(), dd.clone(), mid.clone())); }
                    return Ok(DeviceAuthStart { success: true, qr_image_base64: generate_qr_base64(&qr_url)?, device_code: t, expires_in: 120, interval_ms: 2000, error: None });
                }
            }
            // CLI 未产生有效结果，等 API 侧结果
            api_rx.await.unwrap_or(None)
        }
        api_res = &mut api_rx => {
            api_res.unwrap_or(None)
        }
    };

    match result {
        Some((url, tk)) => {
            if let Ok(mut g) = ACTIVE_WECHAT_QR.lock() { *g = Some((tk.clone(), dd.clone(), mid.clone())); }
            Ok(DeviceAuthStart { success: true, qr_image_base64: generate_qr_base64(&url)?, device_code: tk, expires_in: 120, interval_ms: 2000, error: None })
        }
        None => Ok(DeviceAuthStart { success: false, qr_image_base64: String::new(), device_code: String::new(), expires_in: 0, interval_ms: 2000, error: Some("无法获取二维码，请检查网络后重试".into()) }),
    }
}

/// 前端轮询：异步查询微信扫码状态
#[tauri::command]
pub async fn poll_wechat_cli_bind() -> Result<QrCodeAuthResult, String> {
    let (token, dd, module_id) = {
        let g = ACTIVE_WECHAT_QR.lock().map_err(|e| format!("锁失败: {}", e))?;
        match g.as_ref() {
            Some(v) => v.clone(),
            None => {
                tracing::warn!("[pf] poll_wechat: ACTIVE_WECHAT_QR 为空");
                return Ok(QrCodeAuthResult{status:"wait".into(),bot_token:None,ilink_bot_id:None,error:Some("等待二维码生成…".into())});
            }
        }
    };
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(10)).build().map_err(|e| format!("HTTP:{}",e))?;
    let url = format!("https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode={}", token);
    match client.get(&url).send().await {
        Ok(r) => {
            if let Ok(d) = r.json::<serde_json::Value>().await {
                let ret = d.get("ret").and_then(|v|v.as_i64()).unwrap_or(-1);
                let st = d.get("status").and_then(|v|v.as_str()).unwrap_or("");
                tracing::info!("[pf] poll_wechat: ret={} status={}", ret, st);
                if ret == 0 && st == "confirmed" {
                    if let Some(bt) = d.get("bot_token").and_then(|v|v.as_str()) {
                        let _ = save_wechat_bot_token_inner(&dd, bt, &module_id).await;
                        if let Ok(mut g) = ACTIVE_WECHAT_QR.lock() { *g = None; }
                    }
                    return Ok(QrCodeAuthResult{status:"confirmed".into(),bot_token:d.get("bot_token").and_then(|v|v.as_str()).map(|s|s.to_string()),ilink_bot_id:None,error:None});
                }
                if st == "expired" || st == "denied" {
                    if let Ok(mut g) = ACTIVE_WECHAT_QR.lock() { *g = None; }
                    return Ok(QrCodeAuthResult{status:"expired".into(),bot_token:None,ilink_bot_id:None,error:Some(if st=="expired"{"已过期"}else{"已拒绝"}.into())});
                }
                return Ok(QrCodeAuthResult{status:st.to_string(),bot_token:None,ilink_bot_id:None,error:None});
            }
            Ok(QrCodeAuthResult{status:"wait".into(),bot_token:None,ilink_bot_id:None,error:None})
        }
        Err(e) => {
            tracing::warn!("[pf] poll_wechat 请求失败: {}", e);
            Ok(QrCodeAuthResult{status:"wait".into(),bot_token:None,ilink_bot_id:None,error:None})
        }
    }
}

#[tauri::command]
pub fn cancel_wechat_cli_bind() -> Result<String, String> {
    if let Ok(mut g) = ACTIVE_WECHAT_QR.lock() { *g = None; }
    Ok("已取消".into())
}

async fn try_cli_qr(data_dir: &str) -> Option<String> {
    // 使用内置 Node.js 环境（避免系统 PATH 中无 npx/node）
    let (node_exe, _) = crate::env_paths::resolve_node(data_dir);
    let npx_cmd = node_exe.parent().map(|p| p.join("npx.cmd")).filter(|p| p.exists());
    let node_cmd = Some(node_exe.clone());

    let mut cmds: Vec<(String, PathBuf)> = Vec::new();
    if let Some(npx) = npx_cmd { cmds.push(("npx.cmd".into(), npx)); }
    cmds.push(("node".into(), node_cmd.unwrap_or(node_exe)));

    for (label, cmd_path) in &cmds {
        let mut c = Command::new(cmd_path);
        if label == "npx.cmd" {
            c.args(["-y", "@tencent-weixin/openclaw-weixin-cli@1.0.3", "install"]);
        } else {
            let npm_cli = cmd_path.parent().map(|p| p.join("node_modules").join("npm").join("bin").join("npm-cli.js")).filter(|p| p.exists());
            if let Some(npm) = npm_cli {
                c.arg(&npm).arg("exec").arg("-y").arg("@tencent-weixin/openclaw-weixin-cli").arg("install");
            } else {
                continue;
            }
        }
        c.current_dir(data_dir).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)] { let _ = c.creation_flags(0x08000000); }
        match c.spawn() {
            Ok(mut child) => {
                if let Some(o) = child.stdout.as_mut() { for line in std::io::BufReader::new(o).lines().flatten() { let t = line.trim(); if t.starts_with("https://") && t.contains("qrcode=") && t.len() > 40 { tracing::info!("[pf] CLI QR: {}", t); return Some(t.to_string()); } } }
                if let Some(e) = child.stderr.as_mut() { for line in std::io::BufReader::new(e).lines().flatten() { let t = line.trim(); if t.starts_with("https://") && t.contains("qrcode=") && t.len() > 40 { tracing::info!("[pf] CLI stderr QR: {}", t); return Some(t.to_string()); } } }
                let _ = child.kill();
            }
            Err(e) => tracing::warn!("[pf] CLI {} 失败: {}", label, e),
        }
    }
    None
}

#[allow(dead_code)]
async fn poll_wechat_scan_bg(data_dir: &str, qrcode: &str) {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30)).build().ok();
    let Some(cl) = client else { return };
    tracing::info!("[pf] 后台轮询扫码: qrcode={}", qrcode);
    for i in 0..90 {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        match cl.get(format!("https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode={}", qrcode)).send().await {
            Ok(r) => if let Ok(d) = r.json::<serde_json::Value>().await {
                let ret = d.get("ret").and_then(|v|v.as_i64()).unwrap_or(-1);
                let st = d.get("status").and_then(|v|v.as_str()).unwrap_or("");
                tracing::info!("[pf] poll[{}/90]: ret={} status={}", i+1, ret, st);
                if ret == 0 && st == "confirmed" {
                    if let Some(bt) = d.get("bot_token").and_then(|v|v.as_str()) { let _ = save_wechat_bot_token_inner(data_dir, bt, "openclaw").await; }
                    break;
                }
                if st == "expired" || st == "denied" { break; }
            },
            Err(e) => tracing::warn!("[pf] poll错误: {}", e),
        }
    }
}

/// 写入 bot_token 到 instances.yaml + openclaw.json
pub async fn save_wechat_bot_token_inner(data_dir: &str, bot_token: &str, module_id: &str) -> Result<(), String> {
    let token = bot_token.trim();
    if token.is_empty() { return Err("token为空".into()); }
    tracing::info!("[pf] save_wechat_bot_token: dd={} module={} token={}..", data_dir, module_id, &token[..std::cmp::min(20,token.len())]);

    let inst_path = PathBuf::from(data_dir).join("config").join("instances.yaml");
    if inst_path.exists() {
        let content = tokio::fs::read_to_string(&inst_path).await.map_err(|e| format!("读取:{}",e))?;
        let mut doc: serde_yaml::Value = serde_yaml::from_str(&content).map_err(|e| format!("解析:{}",e))?;
        if let Some(instances) = doc.get_mut("instances").and_then(|i| i.as_sequence_mut()) {
            for inst in instances.iter_mut() {
                if inst.get("channel_type").and_then(|v|v.as_str()) == Some("wechat_clawbot") && inst.get("enabled").and_then(|v|v.as_bool()) == Some(true) {
                    if let Some(cc) = inst.get_mut("channel_config").and_then(|c|c.as_mapping_mut()) {
                        cc.insert(serde_yaml::Value::String("authCode".into()), serde_yaml::Value::String(token.to_string()));
                        let h = "# 实例配置\n# 实例 = 机器人 + 聊天通道 + 模型\n\n";
                        let b = serde_yaml::to_string(&doc).map_err(|e| format!("序列化:{}",e))?;
                        tokio::fs::write(&inst_path, format!("{}{}", h, b)).await.map_err(|e| format!("写入:{}",e))?;
                        break;
                    }
                }
            }
        }
    }
    // OpenClaw 专用：写入 openclaw.json + 插件凭证文件
    if module_id == "openclaw" {
        let oc_path = PathBuf::from(data_dir).join("openclaw").join("openclaw.json");
        if oc_path.exists() {
            let content = tokio::fs::read_to_string(&oc_path).await.map_err(|e| format!("读取:{}",e))?;
            let mut gw: serde_json::Value = serde_json::from_str(&content).map_err(|e| format!("解析:{}",e))?;
            if let Some(ch) = gw.get_mut("channels").and_then(|c|c.as_object_mut()) {
                if let Some(wx) = ch.get_mut("openclaw-weixin").and_then(|c|c.as_object_mut()) {
                    wx.insert("botToken".into(), serde_json::json!(token));
                    if let Some(accts) = wx.get_mut("accounts").and_then(|a|a.as_object_mut()) {
                        for a in accts.values_mut() { if let Some(o) = a.as_object_mut() { o.insert("botToken".into(), serde_json::json!(token)); } }
                    }
                }
            }
            tokio::fs::write(&oc_path, serde_json::to_string_pretty(&gw).unwrap_or_default()).await.map_err(|e| format!("写入:{}",e))?;
        }
        // 写入 wechat 插件需要的 credentials 文件
        let cred_dir = PathBuf::from(data_dir).join("openclaw").join("openclaw-weixin");
        let accounts_dir = cred_dir.join("accounts");
        tokio::fs::create_dir_all(&accounts_dir).await.map_err(|e| format!("创建凭证目录:{}", e))?;
        let index_file = cred_dir.join("accounts.json");
        let index_json = serde_json::json!(["default"]);
        tokio::fs::write(&index_file, serde_json::to_string(&index_json).unwrap_or_default()).await.map_err(|e| format!("写入账户索引:{}", e))?;
        let acct_file = accounts_dir.join("default.json");
        let acct_json = serde_json::json!({"token": token});
        tokio::fs::write(&acct_file, serde_json::to_string(&acct_json).unwrap_or_default()).await.map_err(|e| format!("写入账户凭证:{}", e))?;
        let cred_file = cred_dir.join("credentials.json");
        let cred_json = serde_json::json!({"token": token});
        tokio::fs::write(&cred_file, serde_json::to_string(&cred_json).unwrap_or_default()).await.map_err(|e| format!("写入凭证文件:{}", e))?;
        tracing::info!("[pf] wechat credentials written to {}", cred_file.display());

        // 后台异步重启网关
        let dd = data_dir.to_string();
        tokio::spawn(async move {
            let _ = crate::commands::gateway::restart_gateway_if_running_for_wechat_config(&dd).await;
        });
    }

    // Hermes 专用：写环境变量到 .env，同时写 OpenClaw weixin 凭证（复用已验证的插件）
    if module_id == "hermes" {
        // 1. Write to Hermes .env
        let hermes_dir = PathBuf::from(data_dir).join("modules").join("hermes");
        tokio::fs::create_dir_all(&hermes_dir).await.ok();
        let env_path = hermes_dir.join(".env");
        let mut env_content = tokio::fs::read_to_string(&env_path).await.unwrap_or_default();
        let updates = [("WEIXIN_TOKEN", token.to_string())];
        for (key, val) in &updates {
            if let Some(line_start) = env_content.find(&format!("{}=", key)) {
                let line_end = env_content[line_start..].find('\n').map(|i| line_start + i).unwrap_or(env_content.len());
                env_content.replace_range(line_start..line_end, &format!("{}={}", key, val));
            } else {
                if !env_content.is_empty() && !env_content.ends_with('\n') { env_content.push('\n'); }
                env_content.push_str(&format!("{}={}\n", key, val));
            }
        }
        tokio::fs::write(&env_path, &env_content).await
            .map_err(|e| tracing::warn!("[pf] Hermes .env write failed: {}", e)).ok();
        tracing::info!("[pf] hermes wechat env vars written to {}", env_path.display());

        // 2. Also write OpenClaw weixin plugin credentials
        //    The OpenClaw @tencent-weixin/openclaw-weixin npm plugin handles iLink session
        //    management reliably. By sharing credentials, Hermes instances get WeChat
        //    connectivity through the proven OpenClaw plugin path.
        let oc_weixin_dir = PathBuf::from(data_dir).join("openclaw").join("openclaw-weixin");
        let accounts_dir = oc_weixin_dir.join("accounts");
        tokio::fs::create_dir_all(&accounts_dir).await.map_err(|e| tracing::warn!("[pf] OpenClaw weixin dir create failed: {}", e)).ok();
        if accounts_dir.exists() {
            // Write account index
            tokio::fs::write(
                oc_weixin_dir.join("accounts.json"),
                serde_json::to_string(&serde_json::json!(["default"])).unwrap_or_default(),
            ).await.map_err(|e| tracing::warn!("[pf] weixin accounts.json write failed: {}", e)).ok();
            // Write per-account token
            tokio::fs::write(
                accounts_dir.join("default.json"),
                serde_json::to_string(&serde_json::json!({"token": token})).unwrap_or_default(),
            ).await.map_err(|e| tracing::warn!("[pf] weixin account token write failed: {}", e)).ok();
            // Write legacy credentials.json
            tokio::fs::write(
                oc_weixin_dir.join("credentials.json"),
                serde_json::to_string(&serde_json::json!({"token": token})).unwrap_or_default(),
            ).await.map_err(|e| tracing::warn!("[pf] weixin credentials.json write failed: {}", e)).ok();
            tracing::info!("[pf] hermes wechat token also written to OpenClaw weixin plugin dir");
        }

        // 3. Also write to openclaw.json channels.weixin section for gateway
        let oc_json_path = PathBuf::from(data_dir).join("openclaw").join("openclaw.json");
        if oc_json_path.exists() {
            if let Ok(content) = tokio::fs::read_to_string(&oc_json_path).await {
                if let Ok(mut gw) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(ch) = gw.get_mut("channels").and_then(|c| c.as_object_mut()) {
                        if !ch.contains_key("openclaw-weixin") {
                            ch.insert("openclaw-weixin".into(), serde_json::json!({"enabled": true, "botToken": token}));
                        } else if let Some(wx) = ch.get_mut("openclaw-weixin").and_then(|c| c.as_object_mut()) {
                            wx.insert("enabled".into(), serde_json::json!(true));
                            wx.insert("botToken".into(), serde_json::json!(token));
                        }
                    }
                    if let Ok(pretty) = serde_json::to_string_pretty(&gw) {
                        let _ = tokio::fs::write(&oc_json_path, pretty).await;
                        tracing::info!("[pf] hermes wechat token synced to openclaw.json");
                    }
                }
            }
        }

        let _ = crate::commands::module::sync_module_configuration("hermes", data_dir).await;

        // Restart OpenClaw gateway if running (so it picks up the new weixin config)
        let dd = data_dir.to_string();
        tokio::spawn(async move {
            let _ = crate::commands::gateway::restart_gateway_if_running_for_wechat_config(&dd).await;
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn save_wechat_bot_token(data_dir: tauri::State<'_, crate::AppState>, bot_token: String, module_id: Option<String>) -> Result<String, String> {
    let dd = data_dir.inner().get_data_dir();
    let mid = module_id.unwrap_or_else(|| "openclaw".to_string());
    save_wechat_bot_token_inner(&dd, &bot_token, &mid).await?;
    Ok("微信 bot_token 已写入配置文件".into())
}

#[tauri::command]
pub async fn uninstall_plugin_fw(data_dir: tauri::State<'_, crate::AppState>, plugin_id: String) -> Result<String, String> {
    let dd = data_dir.inner().get_data_dir();
    let pp = PathBuf::from(&dd).join("plugins").join(&plugin_id);
    if pp.is_dir() { tokio::fs::remove_dir_all(&pp).await.map_err(|e| format!("删除:{}",e))?; }
    let _ = crate::commands::plugin::sync_plugins_load_paths(&dd).await;
    let _ = crate::commands::gateway::sync_openclaw_config_from_manager(&dd).await;
    Ok(format!("{} 卸载完成", plugin_id))
}

// ============================================================
// 飞书 Device Authorization Grant (RFC 8628) 快捷绑定
// ============================================================
static ACTIVE_FEISHU_QR: Mutex<Option<(String, String, String)>> = Mutex::new(None);

/// 飞书快捷绑定 — 启动设备注册流程，返回 QR 码
/// 使用飞书 OAuth Device Registration 端点: POST /oauth/v1/app/registration
#[tauri::command]
pub async fn start_feishu_quick_bind(
    data_dir: tauri::State<'_, crate::AppState>,
    module_id: Option<String>,
) -> Result<DeviceAuthStart, String> {
    let dd = data_dir.inner().get_data_dir();
    let mid = module_id.unwrap_or_else(|| "openclaw".to_string());
    tracing::info!("[pf] start_feishu_quick_bind: dd={} module={}", dd, mid);
    if let Ok(mut g) = ACTIVE_FEISHU_QR.lock() { *g = None; }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP:{}", e))?;

    // 飞书设备注册端点: POST https://accounts.feishu.cn/oauth/v1/app/registration
    // 请求体为 form-urlencoded
    let params = [
        ("action", "begin"),
        ("archetype", "PersonalAgent"),
        ("auth_method", "client_secret"),
        ("request_user_info", "open_id"),
    ];

    let resp: serde_json::Value = client
        .post("https://accounts.feishu.cn/oauth/v1/app/registration")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&params)
        .send()
        .await
        .map_err(|e| {
            tracing::warn!("[pf] feishu device begin failed: {}", e);
            format!("飞书设备注册请求失败: {}", e)
        })?
        .json()
        .await
        .map_err(|e| format!("解析响应: {}", e))?;

    tracing::info!("[pf] feishu begin resp: {:?}", resp);

    let verification_uri = resp
        .get("verification_uri_complete")
        .or(resp.get("verification_uri"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let device_code = resp
        .get("device_code")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if verification_uri.is_empty() || device_code.is_empty() {
        let err_msg = resp
            .get("error_description")
            .or(resp.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("飞书服务返回空 QR URL");
        tracing::warn!("[pf] feishu begin empty: {}", err_msg);
        return Ok(DeviceAuthStart {
            success: false,
            qr_image_base64: String::new(),
            device_code,
            expires_in: 0,
            interval_ms: 0,
            error: Some(err_msg.to_string()),
        });
    }

    let expires_in = resp.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(600);
    let interval = resp.get("interval").and_then(|v| v.as_u64()).unwrap_or(5);

    let b64 = generate_qr_base64(&verification_uri)?;

    if let Ok(mut g) = ACTIVE_FEISHU_QR.lock() {
        *g = Some((device_code.clone(), dd.clone(), mid.clone()));
    }

    Ok(DeviceAuthStart {
        success: true,
        qr_image_base64: b64,
        device_code,
        expires_in,
        interval_ms: interval * 1000,
        error: None,
    })
}

/// 飞书快捷绑定 — 轮询设备注册状态，成功后返回 app_id + app_secret + 自动配置白名单
#[tauri::command]
pub async fn poll_feishu_quick_bind(
    device_code: String,
) -> Result<DeviceAuthResult, String> {
    let (stored_code, dd, module_id) = {
        let g = ACTIVE_FEISHU_QR.lock().map_err(|e| format!("锁:{}", e))?;
        match g.as_ref() {
            Some(v) => v.clone(),
            None => {
                return Ok(DeviceAuthResult {
                    status: "expired".into(),
                    access_token: None,
                    client_secret: None,
                    message: Some("会话已过期，请重新发起绑定".into()),
                    error: None,
                });
            }
        }
    };

    let effective_code = if device_code.is_empty() { &stored_code } else { &device_code };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP:{}", e))?;

    // 轮询飞书设备注册端点
    let params = [
        ("action", "poll"),
        ("device_code", effective_code),
    ];

    let resp: serde_json::Value = client
        .post("https://accounts.feishu.cn/oauth/v1/app/registration")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("poll:{}", e))?
        .json()
        .await
        .map_err(|e| format!("解析:{}", e))?;

    tracing::info!("[pf] feishu poll resp: {:?}", resp);

    // 成功 — 获取到 app 凭证 + 用户信息
    if let (Some(cid), Some(csec)) = (
        resp.get("client_id").and_then(|v| v.as_str()),
        resp.get("client_secret").and_then(|v| v.as_str()),
    ) {
        let app_id = cid.to_string();
        let app_secret = csec.to_string();

        // 提取用户 open_id 用于自动白名单
        let user_open_id = resp
            .get("user_info")
            .and_then(|u| u.get("open_id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // 保存凭证到配置文件（按模块写入对应配置）
        let _ = save_feishu_credentials_inner(&dd, &app_id, &app_secret, user_open_id.as_deref(), &module_id).await;

        if let Ok(mut g) = ACTIVE_FEISHU_QR.lock() { *g = None; }

        return Ok(DeviceAuthResult {
            status: "success".into(),
            access_token: Some(app_id),
            client_secret: Some(app_secret),
            message: Some(if user_open_id.is_some() { "授权成功，白名单已自动配置" } else { "授权成功" }.into()),
            error: None,
        });
    }

    // 错误处理
    if let Some(error) = resp.get("error").and_then(|v| v.as_str()) {
        match error {
            "authorization_pending" => Ok(DeviceAuthResult {
                status: "waiting".into(),
                access_token: None,
                client_secret: None,
                message: Some("等待扫码授权…".into()),
                error: None,
            }),
            "slow_down" => Ok(DeviceAuthResult {
                status: "waiting".into(),
                access_token: None,
                client_secret: None,
                message: Some("轮询过快，请稍等…".into()),
                error: None,
            }),
            "expired_token" | "expired" => {
                if let Ok(mut g) = ACTIVE_FEISHU_QR.lock() { *g = None; }
                Ok(DeviceAuthResult {
                    status: "expired".into(),
                    access_token: None,
                    client_secret: None,
                    message: Some("QR码已过期".into()),
                    error: None,
                })
            }
            "access_denied" => {
                if let Ok(mut g) = ACTIVE_FEISHU_QR.lock() { *g = None; }
                Ok(DeviceAuthResult {
                    status: "denied".into(),
                    access_token: None,
                    client_secret: None,
                    message: Some("用户拒绝授权".into()),
                    error: None,
                })
            }
            _ => Ok(DeviceAuthResult {
                status: "error".into(),
                access_token: None,
                client_secret: None,
                message: None,
                error: Some(error.to_string()),
            }),
        }
    } else {
        Ok(DeviceAuthResult {
            status: "waiting".into(),
            access_token: None,
            client_secret: None,
            message: Some("等待中…".into()),
            error: None,
        })
    }
}

/// 保存飞书凭证 + 自动配置白名单（用户 open_id）
async fn save_feishu_credentials_inner(
    data_dir: &str,
    app_id: &str,
    app_secret: &str,
    user_open_id: Option<&str>,
    module_id: &str,
) -> Result<(), String> {
    tracing::info!("[pf] save_feishu_creds: dd={} app_id={} module={} open_id={:?}", data_dir, app_id, module_id, user_open_id);

    // 写入 instances.yaml
    let inst_path = PathBuf::from(data_dir).join("config").join("instances.yaml");
    if inst_path.exists() {
        let content = tokio::fs::read_to_string(&inst_path).await.map_err(|e| format!("读取:{}", e))?;
        let mut doc: serde_yaml::Value = serde_yaml::from_str(&content).map_err(|e| format!("解析:{}", e))?;
        if let Some(instances) = doc.get_mut("instances").and_then(|i| i.as_sequence_mut()) {
            // 只写入第一个未配置凭证的 feishu 实例（避免覆盖已有独立凭证的实例）
            for inst in instances.iter_mut() {
                if inst.get("channel_type").and_then(|v| v.as_str()) != Some("feishu") {
                    continue;
                }
                if inst.get("enabled").and_then(|v| v.as_bool()) != Some(true) {
                    continue;
                }
                let has_creds = inst
                    .get("channel_config")
                    .and_then(|c| c.get("appId"))
                    .and_then(|v| v.as_str())
                    .map(|s| !s.is_empty())
                    .unwrap_or(false);
                if has_creds {
                    continue; // 已有凭证，跳过（保留独立绑定）
                }
                if let Some(cc) = inst.get_mut("channel_config").and_then(|c| c.as_mapping_mut()) {
                    cc.insert(
                        serde_yaml::Value::String("appId".into()),
                        serde_yaml::Value::String(app_id.to_string()),
                    );
                    cc.insert(
                        serde_yaml::Value::String("appSecret".into()),
                        serde_yaml::Value::String(app_secret.to_string()),
                    );
                    // 自动白名单（写入 YAML 数组格式）
                    if let Some(oid) = user_open_id {
                        if !oid.is_empty() {
                            let current_allow: Vec<String> = cc
                                .get(&serde_yaml::Value::String("allowFrom".into()))
                                .and_then(|v| v.as_sequence())
                                .map(|s| s.iter().filter_map(|v| v.as_str().map(|x| x.to_string())).collect())
                                .unwrap_or_default();
                            let mut users = current_allow.clone();
                            if !users.contains(&oid.to_string()) {
                                users.push(oid.to_string());
                                cc.insert(
                                    serde_yaml::Value::String("allowFrom".into()),
                                    serde_yaml::Value::Sequence(
                                        users.iter().map(|u| serde_yaml::Value::String(u.clone())).collect()
                                    ),
                                );
                                tracing::info!("[pf] feishu whitelist auto-added: open_id={}", oid);
                            }
                        }
                    }
                }
                let h = "# 实例配置\n# 实例 = 机器人 + 聊天通道 + 模型\n\n";
                let b = serde_yaml::to_string(&doc).map_err(|e| format!("序列化:{}", e))?;
                tokio::fs::write(&inst_path, format!("{}{}", h, b)).await.map_err(|e| format!("写入:{}", e))?;
                break;
            }
        }
    }

    // 写入 openclaw.json（仅 OpenClaw 模块）
    if module_id == "openclaw" {
    let oc_path = PathBuf::from(data_dir).join("openclaw").join("openclaw.json");
    if oc_path.exists() {
        let content = tokio::fs::read_to_string(&oc_path).await.map_err(|e| format!("读取:{}", e))?;
        let mut gw: serde_json::Value = serde_json::from_str(&content).map_err(|e| format!("解析:{}", e))?;
        if let Some(ch) = gw.get_mut("channels").and_then(|c| c.as_object_mut()) {
            if !ch.contains_key("feishu") {
                ch.insert("feishu".into(), serde_json::json!({
                    "enabled": true,
                    "accounts": {},
                }));
            }
            if let Some(fs) = ch.get_mut("feishu").and_then(|c| c.as_object_mut()) {
                fs.insert("enabled".into(), serde_json::json!(true));
                // 读 instances.yaml 找到刚写入的实例 ID，写入独立 account 条目
                let mut wrote_account = false;
                if let Ok(inst_content) = tokio::fs::read_to_string(&inst_path).await {
                    if let Ok(inst_doc) = serde_yaml::from_str::<serde_yaml::Value>(&inst_content) {
                        if let Some(inst_list) = inst_doc.get("instances").and_then(|i| i.as_sequence()) {
                            for inst in inst_list {
                                let ct = inst.get("channel_type").and_then(|v| v.as_str()).unwrap_or("");
                                if ct != "feishu" { continue; }
                                let inst_app_id = inst.get("channel_config").and_then(|c| c.get("appId")).and_then(|v| v.as_str()).unwrap_or("");
                                if inst_app_id != app_id { continue; }
                                let inst_id = inst.get("id").and_then(|v| v.as_str()).unwrap_or("");
                                if inst_id.is_empty() { continue; }
                                if let Some(accts) = fs.get_mut("accounts").and_then(|a| a.as_object_mut()) {
                                    if !accts.contains_key(inst_id) {
                                        let mut entry = serde_json::Map::new();
                                        entry.insert("appId".into(), serde_json::json!(app_id));
                                        entry.insert("appSecret".into(), serde_json::json!(app_secret));
                                        if let Some(oid) = user_open_id.filter(|s| !s.is_empty()) {
                                            entry.insert("allowFrom".into(), serde_json::json!(vec![oid]));
                                        }
                                        accts.insert(inst_id.to_string(), serde_json::json!(entry));
                                        tracing::info!("[pf] feishu account {} written to openclaw.json", inst_id);
                                        wrote_account = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
                // 兜底：实例尚未创建时，写入独立暂存 account（不覆盖已有实例的全局凭证）
                if !wrote_account {
                    // 检查是否已有全局凭证（说明已有实例在用），如有则不要覆盖
                    let has_existing_global = fs.get("appId").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
                    if !has_existing_global || fs.get("accounts").and_then(|a| a.as_object()).map(|a| a.is_empty()).unwrap_or(true) {
                        // 无已有实例 → 存全局兜底
                        fs.insert("appId".into(), serde_json::json!(app_id));
                        fs.insert("appSecret".into(), serde_json::json!(app_secret));
                        // 扫码绑定后默认开放所有用户（避免手动配对码），用户可事后在飞书开放平台限制
                        fs.insert("allowFrom".into(), serde_json::json!(vec!["*"]));
                        fs.insert("dmPolicy".into(), serde_json::json!("open"));
                    }
                    // 无论全局如何，都创建独立 pending account 条目
                    if let Some(accts) = fs.get_mut("accounts").and_then(|a| a.as_object_mut()) {
                        let pending_key = format!("pending_{}", app_id.chars().take(10).collect::<String>());
                        if !accts.contains_key(&pending_key) {
                            let mut entry = serde_json::Map::new();
                            entry.insert("appId".into(), serde_json::json!(app_id));
                            entry.insert("appSecret".into(), serde_json::json!(app_secret));
                            entry.insert("allowFrom".into(), serde_json::json!(vec!["*"]));
                            entry.insert("dmPolicy".into(), serde_json::json!("open"));
                            accts.insert(pending_key, serde_json::json!(entry));
                        }
                    }
                }
            }
        }
        tokio::fs::write(&oc_path, serde_json::to_string_pretty(&gw).unwrap_or_default())
            .await
            .map_err(|e| format!("写入:{}", e))?;
    }
    } // end openclaw-specific block

    // Hermes: 写环境变量到 .env（Hermes 通过环境变量读取渠道凭证）
    if module_id == "hermes" {
        let hermes_dir = PathBuf::from(data_dir).join("modules").join("hermes");
        tokio::fs::create_dir_all(&hermes_dir).await.ok();
        let env_path = hermes_dir.join(".env");
        let mut env_content = tokio::fs::read_to_string(&env_path).await.unwrap_or_default();
        // 追加/更新飞书环境变量
        let updates = [
            ("FEISHU_APP_ID", app_id.to_string()),
            ("FEISHU_APP_SECRET", app_secret.to_string()),
        ];
        for (key, val) in &updates {
            if let Some(line_start) = env_content.find(&format!("{}=", key)) {
                // 替换已有行
                let line_end = env_content[line_start..].find('\n').map(|i| line_start + i).unwrap_or(env_content.len());
                env_content.replace_range(line_start..line_end, &format!("{}={}", key, val));
            } else {
                // 追加新行
                if !env_content.is_empty() && !env_content.ends_with('\n') {
                    env_content.push('\n');
                }
                env_content.push_str(&format!("{}={}\n", key, val));
            }
        }
        // 如果有白名单 open_id，也写入
        if let Some(oid) = user_open_id.filter(|s| !s.is_empty()) {
            let key = "FEISHU_ALLOWED_USERS";
            if let Some(line_start) = env_content.find(&format!("{}=", key)) {
                let line_end = env_content[line_start..].find('\n').map(|i| line_start + i).unwrap_or(env_content.len());
                env_content.replace_range(line_start..line_end, &format!("{}={}", key, oid));
            } else {
                if !env_content.is_empty() && !env_content.ends_with('\n') { env_content.push('\n'); }
                env_content.push_str(&format!("{}={}\n", key, oid));
            }
        }
        tokio::fs::write(&env_path, &env_content).await
            .map_err(|e| tracing::warn!("[pf] Hermes .env write failed: {}", e)).ok();
        tracing::info!("[pf] hermes feishu env vars written to {}", env_path.display());

        // 同步 Hermes 模块配置
        let _ = crate::commands::module::sync_module_configuration("hermes", data_dir).await;
    }

    // 若 OpenClaw 网关运行中则重启
    if module_id == "openclaw" {
        let _ = crate::commands::gateway::restart_gateway_if_running_for_wechat_config(data_dir).await;
    }
    Ok(())
}
