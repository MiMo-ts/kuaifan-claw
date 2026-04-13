// 日志命令

use crate::models::{LogEntry, RuntimeLogsTail};
use tracing::info;

pub const OPENCLAW_GATEWAY_LOG: &str = "openclaw-gateway.log";

#[tauri::command]
pub async fn read_logs(
    data_dir: tauri::State<'_, crate::AppState>,
    lines: Option<usize>,
) -> Result<Vec<LogEntry>, String> {
    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let log_path = format!("{}/logs/app.log", data_dir);

    let content = tokio::fs::read_to_string(&log_path)
        .await
        .unwrap_or_default();

    let all_lines: Vec<&str> = content.lines().collect();
    let start = if lines.map(|l| l > all_lines.len()).unwrap_or(false) {
        0
    } else {
        all_lines.len().saturating_sub(lines.unwrap_or(100))
    };

    let entries: Vec<LogEntry> = all_lines[start..]
        .iter()
        .map(|line| {
            let parts: Vec<&str> = line.splitn(4, ' ').collect();
            LogEntry {
                timestamp: parts.get(0).unwrap_or(&"").to_string(),
                level: parts.get(1).unwrap_or(&"INFO").to_string(),
                message: parts.get(3).unwrap_or(&"").to_string(),
                target: None,
            }
        })
        .collect();

    Ok(entries)
}

#[tauri::command]
pub async fn clear_logs(data_dir: tauri::State<'_, crate::AppState>) -> Result<String, String> {
    info!("清理日志...");

    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let log_path = format!("{}/logs/app.log", data_dir);

    tokio::fs::write(&log_path, "")
        .await
        .map_err(|e| format!("清理日志失败: {}", e))?;

    Ok("日志已清理".to_string())
}

fn tail_lines(content: &str, max_lines: usize) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].join("\n")
}

/// 读取 OpenClaw 网关进程日志与管理端 app.log 尾部（供设置页轮询展示）
#[tauri::command]
pub async fn read_runtime_logs_tail(
    data_dir: tauri::State<'_, crate::AppState>,
    lines: Option<usize>,
) -> Result<RuntimeLogsTail, String> {
    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let n = lines.unwrap_or(400).min(3000).max(50);

    let gateway_path = format!("{}/logs/{}", data_dir, OPENCLAW_GATEWAY_LOG);
    let manager_path = format!("{}/logs/app.log", data_dir);

    let gateway = tokio::fs::read_to_string(&gateway_path)
        .await
        .unwrap_or_default();
    let manager = tokio::fs::read_to_string(&manager_path)
        .await
        .unwrap_or_default();

    Ok(RuntimeLogsTail {
        gateway: tail_lines(&gateway, n),
        manager: tail_lines(&manager, n),
    })
}

/// 清空网关进程日志文件（不影响管理端 app.log）
#[tauri::command]
pub async fn clear_openclaw_gateway_log(
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let path = format!("{}/logs/{}", data_dir, OPENCLAW_GATEWAY_LOG);
    tokio::fs::write(&path, "")
        .await
        .map_err(|e| format!("清空网关日志失败: {}", e))?;
    Ok("OpenClaw 网关日志已清空".to_string())
}
