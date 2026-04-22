// 系统命令

use crate::commands::hidden_cmd;
use crate::models::SystemInfo;
use std::process::Command;

/// 在系统默认浏览器中打开 URL（供其他模块复用，避免重复平台分支）
pub(crate) fn open_url_in_default_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        hidden_cmd::cmd()
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

/// 打开管理端配置目录（data/config）
#[tauri::command]
pub async fn open_manager_config_dir(
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let config_path = std::path::PathBuf::from(&data_dir).join("config");

    // 确保目录存在
    tokio::fs::create_dir_all(&config_path)
        .await
        .map_err(|e| format!("创建配置目录失败: {}", e))?;

    #[cfg(windows)]
    {
        // 使用 cmd /c start 打开目录更可靠
        hidden_cmd::cmd()
            .args(["/C", "start", "", &config_path.display().to_string()])
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&config_path)
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&config_path)
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    }
    Ok(format!("已打开: {}", config_path.display()))
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
        hidden_cmd::cmd()
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
pub async fn download_update(url: String) -> Result<String, String> {
    use hidden_cmd::cmd;

    // 获取临时下载目录
    let temp_dir = std::env::temp_dir();
    let file_name = url.split('/').last().unwrap_or("update.exe");
    let temp_path = temp_dir.join(file_name);

    // 使用 curl 下载文件
    #[cfg(windows)]
    {
        cmd()
            .args(["/C", "curl", "-L", "-o", &temp_path.display().to_string(), &url])
            .spawn()
            .map_err(|e| format!("下载失败: {}", e))?;
    }

    Ok(format!("下载完成: {}", temp_path.display()))
}

#[tauri::command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "Unknown".to_string());

    #[cfg(windows)]
    {
        let output = hidden_cmd::cmd()
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
