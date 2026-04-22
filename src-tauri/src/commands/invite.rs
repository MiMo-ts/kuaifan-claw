use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// 获取机器指纹（同步版本）
fn get_machine_fingerprint_sync() -> String {
    fn try_run(cmd: &str, args: &[&str]) -> String {
        let mut c = std::process::Command::new(cmd);
        #[cfg(windows)]
        if cmd == "powershell" {
            c.creation_flags(0x08000000);
        }
        c.args(args)
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                } else {
                    None
                }
            })
            .unwrap_or_else(|| "unknown".to_string())
    }

    let parts = vec![
        try_run("powershell", &["-NoProfile", "-Command", "(Get-WmiObject Win32_Processor | Select -First 1).ProcessorId"]),
        try_run("powershell", &["-NoProfile", "-Command", "(Get-WmiObject Win32_BaseBoard | Select -First 1).SerialNumber"]),
        hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "host_unknown".to_string()),
        std::env::var("USERNAME").unwrap_or_else(|_| std::env::var("USER").unwrap_or_else(|_| "user_unknown".to_string())),
        std::env::var("COMPUTERNAME").unwrap_or_else(|_| "pc_unknown".to_string()),
    ];

    parts.join("|")
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateResult {
    pub valid: bool,
    pub already_bound: bool,
    pub device_count: i32,
    pub max_devices: i32,
    pub message: String,
}

/// 获取机器指纹
#[command]
pub async fn get_machine_fingerprint() -> Result<String, String> {
    Ok(tokio::task::spawn_blocking(|| get_machine_fingerprint_sync())
        .await
        .unwrap_or_else(|_| "fingerprint_fallback".to_string()))
}

/// 验证并绑定邀请码
#[command]
pub async fn validate_and_bind_invite_code(
    invite_code: String,
    api_url: String,
    data_dir: String,
) -> Result<ValidateResult, String> {
    let fingerprint = tokio::task::spawn_blocking(|| get_machine_fingerprint_sync())
        .await
        .unwrap_or_else(|_| "fingerprint_fallback".to_string());

    let client = reqwest::Client::new();

    let request_body = serde_json::json!({
        "code": invite_code,
        "platform": "desktop",
        "deviceFingerprint": fingerprint,
        "deviceName": hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "unknown".to_string()),
    });

    let response = client
        .post(format!("{}/api/invite-codes/validate", api_url))
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    let status = response.status();

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API响应失败: {} - {}", status, body));
    }

    let result: ValidateResult = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    // 如果验证成功，保存邀请码和设备指纹到本地
    if result.valid {
        let data_path = PathBuf::from(&data_dir);

        if let Err(e) = crate::services::invite_code::save_invite_code(&data_path, &invite_code) {
            tracing::error!("保存邀请码失败: {}", e);
        }

        if let Err(e) = crate::services::invite_code::save_device_fingerprint(&data_path, &fingerprint) {
            tracing::error!("保存设备指纹失败: {}", e);
        }
    }

    Ok(result)
}
