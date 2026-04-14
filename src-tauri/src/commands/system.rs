// 系统命令

use crate::models::SystemInfo;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Command;

/// 在系统默认浏览器中打开 URL（供其他模块复用，避免重复平台分支）
pub(crate) fn open_url_in_default_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()
            .map_err(|e| format!("打开链接失败: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("打开链接失败: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("打开链接失败: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_folder(path: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    }

    Ok(format!("已打开: {}", path))
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<String, String> {
    open_url_in_default_browser(&url)?;
    Ok(format!("已打开: {}", url))
}

#[tauri::command]
pub async fn open_openclaw_config(
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let openclaw_dir = format!("{}/openclaw-cn", data_dir);
    let config_path = format!("{}/openclaw.json", openclaw_dir);

    // 保证目录存在
    tokio::fs::create_dir_all(&openclaw_dir)
        .await
        .map_err(|e| format!("创建目录失败: {}", e))?;

    crate::commands::gateway::sync_openclaw_config_from_manager(&data_dir)
        .await
        .map_err(|e| format!("同步 OpenClaw 配置失败: {}", e))?;

    // 若文件不存在，写入最小合法 JSON
    if !std::path::Path::new(&config_path).exists() {
        tokio::fs::write(&config_path, "{}")
            .await
            .map_err(|e| format!("写入空配置失败: {}", e))?;
    }

    // 用默认程序打开文件（Windows: start；macOS: open；Linux: xdg-open）
    #[cfg(windows)]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &config_path])
            .spawn()
            .map_err(|e| format!("打开文件失败: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&config_path)
            .spawn()
            .map_err(|e| format!("打开文件失败: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&config_path)
            .spawn()
            .map_err(|e| format!("打开文件失败: {}", e))?;
    }

    Ok(format!("已打开: {}", config_path))
}

#[tauri::command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "Unknown".to_string());

    #[cfg(windows)]
    {
        let output = Command::new("cmd")
            .args(["/C", "systeminfo"])
            .output();

        let (total_memory, available_memory) = if let Ok(out) = output {
            let info = String::from_utf8_lossy(&out.stdout);
            let total = info
                .lines()
                .find(|l| l.contains("Total Physical Memory"))
                .map(|l| {
                    let num: String = l.chars().filter(|c| c.is_ascii_digit()).collect();
                    num.parse::<u64>().unwrap_or(0) / 1024
                })
                .unwrap_or(0);
            let avail = info
                .lines()
                .find(|l| l.contains("Available Physical Memory"))
                .map(|l| {
                    let num: String = l.chars().filter(|c| c.is_ascii_digit()).collect();
                    num.parse::<u64>().unwrap_or(0) / 1024
                })
                .unwrap_or(0);
            (total, avail)
        } else {
            (0, 0)
        };

        Ok(SystemInfo {
            os: "Windows".to_string(),
            arch: std::env::consts::ARCH.to_string(),
            cpu_count: num_cpus::get(),
            total_memory_mb: total_memory,
            available_memory_mb: available_memory,
            hostname,
        })
    }

    #[cfg(not(windows))]
    {
        Ok(SystemInfo {
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            cpu_count: num_cpus::get(),
            total_memory_mb: 0,
            available_memory_mb: 0,
            hostname,
        })
    }
}
