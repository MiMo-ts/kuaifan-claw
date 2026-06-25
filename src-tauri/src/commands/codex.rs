use std::path::PathBuf;
use serde::{Deserialize, Serialize};

/// Codex 安装状态
#[derive(Serialize, Deserialize, Clone)]
pub struct CodexStatus {
    pub desktop_installed: bool,
    pub desktop_exe: Option<String>,
    pub desktop_version: Option<String>,
    pub plusplus_installed: bool,
    pub plusplus_exe: Option<String>,
    pub plusplus_manager_exe: Option<String>,
    pub cli_installed: bool,
    pub cli_exe: Option<String>,
    pub config_exists: bool,
    pub tweaks_dir_exists: bool,
}

/// Codex 配置信息（解析自 config.toml）
#[derive(Serialize, Deserialize)]
pub struct CodexConfigInfo {
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub approval_mode: Option<String>,
    pub wire_api: Option<String>,
    pub context_window: Option<u32>,
    pub auto_compress: Option<bool>,
    pub raw: String,
}

// ========== 辅助函数 ==========

fn find_codex_desktop(store_apps: &PathBuf) -> (Option<PathBuf>, Option<String>) {
    if !store_apps.exists() {
        return (None, None);
    }
    if let Ok(entries) = std::fs::read_dir(store_apps) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let app_dir = entry.path().join("app");
                let codex_exe = app_dir.join("Codex.exe");
                if codex_exe.exists() {
                    let version = entry.file_name().to_string_lossy().to_string();
                    let version = extract_version(&version);
                    return (Some(codex_exe), Some(version));
                }
            }
        }
    }
    (None, None)
}

fn extract_version(dir_name: &str) -> String {
    for part in dir_name.split('_') {
        if part.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
            return part.to_string();
        }
    }
    dir_name.to_string()
}

fn find_codex_plusplus_exe() -> Option<PathBuf> {
    let candidates = [
        r"D:\codex\Codex++\codex-plus-plus.exe",
    ];
    for c in &candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
        let p = PathBuf::from(local_app).join("Codex++").join("codex-plus-plus.exe");
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(program_files) = std::env::var("PROGRAMFILES") {
        let p = PathBuf::from(program_files).join("Codex++").join("codex-plus-plus.exe");
        if p.exists() {
            return Some(p);
        }
    }
    None
}

fn find_codex_plusplus_manager_exe() -> Option<PathBuf> {
    let candidates = [
        r"D:\codex\Codex++\codex-plus-plus-manager.exe",
    ];
    for c in &candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

fn find_codex_cli(home: &PathBuf) -> Option<PathBuf> {
    let local_appdata = home.join("AppData/Local/OpenAI/Codex/bin");
    if local_appdata.exists() {
        if let Ok(entries) = std::fs::read_dir(&local_appdata) {
            for entry in entries.flatten() {
                let codex_exe = entry.path().join("codex.exe");
                if codex_exe.exists() {
                    return Some(codex_exe);
                }
            }
        }
    }
    None
}

// ========== 命令 ==========

/// 检测 Codex 全部组件的安装状态
#[tauri::command]
pub fn check_codex_installed() -> CodexStatus {
    let home = std::env::var("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_default();

    let store_apps = home.join("AppData/Local/codex-plusplus/store-apps");
    let (desktop_exe, desktop_version) = find_codex_desktop(&store_apps);

    let plusplus_exe = find_codex_plusplus_exe();
    let plusplus_manager_exe = find_codex_plusplus_manager_exe();

    let cli_exe = find_codex_cli(&home);

    let config_path = home.join(".codex/config.toml");
    let tweaks_dir = home.join("AppData/Roaming/codex-plusplus/tweaks");

    CodexStatus {
        desktop_installed: desktop_exe.is_some(),
        desktop_exe: desktop_exe.as_ref().map(|p| p.to_string_lossy().to_string()),
        desktop_version,
        plusplus_installed: plusplus_exe.is_some(),
        plusplus_exe: plusplus_exe.as_ref().map(|p| p.to_string_lossy().to_string()),
        plusplus_manager_exe: plusplus_manager_exe.as_ref().map(|p| p.to_string_lossy().to_string()),
        cli_installed: cli_exe.is_some(),
        cli_exe: cli_exe.as_ref().map(|p| p.to_string_lossy().to_string()),
        config_exists: config_path.exists(),
        tweaks_dir_exists: tweaks_dir.exists(),
    }
}

/// 启动 Codex 指定组件
/// app_type: "desktop" | "plusplus" | "plusplus-manager" | "cli"
#[tauri::command]
pub fn launch_codex(app_type: String) -> Result<String, String> {
    let status = check_codex_installed();
    let exe_path = match app_type.as_str() {
        "desktop" => status.desktop_exe.ok_or("Codex 桌面版未安装，请先安装")?,
        "plusplus" => status.plusplus_exe.ok_or("Codex++ 未安装，请先安装")?,
        "plusplus-manager" => status.plusplus_manager_exe.ok_or("Codex++ 管理器未安装")?,
        "cli" => status.cli_exe.ok_or("Codex CLI 未安装，请先安装")?,
        _ => return Err(format!("未知的应用类型: {}", app_type)),
    };
    std::process::Command::new(&exe_path)
        .spawn()
        .map_err(|e| format!("启动失败: {}", e))?;
    Ok(exe_path)
}

/// 读取 Codex config.toml 内容
#[tauri::command]
pub fn read_codex_config() -> Result<CodexConfigInfo, String> {
    let home = std::env::var("USERPROFILE").map_err(|e| e.to_string())?;
    let config_path = std::path::Path::new(&home).join(".codex/config.toml");
    let raw = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("读取配置失败: {}", e))?;

    let mut model = None;
    let mut base_url = None;
    let mut approval_mode = None;
    let mut wire_api = None;
    let mut context_window: Option<u32> = None;
    let mut auto_compress: Option<bool> = None;
    let mut current_section: Option<String> = None;

    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            current_section = Some(line.to_string());
            continue;
        }
        let in_features = current_section.as_deref() == Some("[features]");
        if in_features {
            if let Some(v) = line.strip_prefix("compact_responses = ") {
                auto_compress = match v.trim() {
                    "true" => Some(true),
                    "false" => Some(false),
                    _ => None,
                };
                continue;
            }
        }
        if current_section.is_none() {
            if let Some(v) = line.strip_prefix("model_context_window = ") {
                context_window = v.trim().parse().ok();
                continue;
            }
            if let Some(v) = line.strip_prefix("model = ") {
                model = Some(v.trim_matches('"').to_string());
            }
            if let Some(v) = line.strip_prefix("wire_api = ") {
                wire_api = Some(v.trim_matches('"').to_string());
            }
            if let Some(v) = line.strip_prefix("base_url = ") {
                base_url = Some(v.trim_matches('"').to_string());
            }
            if line == "mode = \"full-access\"" {
                approval_mode = Some("full-access".to_string());
            } else if line == "mode = \"on-request\"" {
                approval_mode = Some("on-request".to_string());
            } else if line == "mode = \"suggest-only\"" {
                approval_mode = Some("suggest-only".to_string());
            }
        }
    }

    Ok(CodexConfigInfo {
        model,
        base_url,
        approval_mode,
        wire_api,
        context_window,
        auto_compress,
        raw,
    })
}

/// 应用上下文与自动压缩设置到 config.toml 文本。
/// - 在顶层写入或更新 `model_context_window = <value>`
/// - 确保存在 [features] 段落并写入或更新 `compact_responses = <bool>`
fn apply_context_settings(content: &str, context_window: u32, auto_compress: bool) -> String {
    let mut result: Vec<String> = Vec::new();
    let mut current_section: Option<String> = None;
    let mut context_window_updated = false;
    let mut compact_updated = false;
    let mut features_section_seen = false;
    let mut any_section_seen = false;
    let ctx_key = "model_context_window";
    let cmp_key = "compact_responses";

    for line in content.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            if let Some(sec) = &current_section {
                if sec == "[features]" && !compact_updated {
                    result.push(format!("{} = {}", cmp_key, auto_compress));
                    compact_updated = true;
                }
            }
            current_section = Some(trimmed.to_string());
            if trimmed == "[features]" {
                features_section_seen = true;
            }
            any_section_seen = true;
            result.push(line.to_string());
            continue;
        }

        if current_section.is_none()
            && !context_window_updated
            && trimmed.starts_with(ctx_key)
            && (trimmed.starts_with(&format!("{} ", ctx_key))
                || trimmed.starts_with(&format!("{}=", ctx_key)))
        {
            result.push(format!("{} = {}", ctx_key, context_window));
            context_window_updated = true;
            continue;
        }

        if current_section.as_deref() == Some("[features]")
            && !compact_updated
            && trimmed.starts_with(cmp_key)
            && (trimmed.starts_with(&format!("{} ", cmp_key))
                || trimmed.starts_with(&format!("{}=", cmp_key)))
        {
            result.push(format!("{} = {}", cmp_key, auto_compress));
            compact_updated = true;
            continue;
        }

        result.push(line.to_string());
    }

    if let Some(sec) = &current_section {
        if sec == "[features]" && !compact_updated {
            result.push(format!("{} = {}", cmp_key, auto_compress));
        }
    }

    if !context_window_updated {
        if any_section_seen {
            let mut insert_idx = result.len();
            for (i, l) in result.iter().enumerate() {
                if l.trim_start().starts_with('[') {
                    insert_idx = i;
                    break;
                }
            }
            result.insert(insert_idx, format!("{} = {}", ctx_key, context_window));
        } else {
            if !result.is_empty()
                && !result.last().map(|s| s.is_empty()).unwrap_or(false)
            {
                result.push(String::new());
            }
            result.push(format!("{} = {}", ctx_key, context_window));
        }
    }

    if !features_section_seen {
        if !result.is_empty()
            && !result.last().map(|s| s.is_empty()).unwrap_or(false)
        {
            result.push(String::new());
        }
        result.push("[features]".to_string());
        result.push(format!("{} = {}", cmp_key, auto_compress));
    }

    result.join("\n")
}

/// 更新 Codex 上下文窗口与自动压缩设置，写回 ~/.codex/config.toml
#[tauri::command]
pub fn update_codex_context_config(
    context_window: u32,
    auto_compress: bool,
) -> Result<CodexConfigInfo, String> {
    let home = std::env::var("USERPROFILE").map_err(|e| e.to_string())?;
    let config_path = std::path::Path::new(&home).join(".codex/config.toml");

    let raw = if config_path.exists() {
        std::fs::read_to_string(&config_path)
            .map_err(|e| format!("读取配置失败: {}", e))?
    } else {
        String::new()
    };

    let updated = apply_context_settings(&raw, context_window, auto_compress);
    let mut final_text = updated;
    if !final_text.ends_with('\n') {
        final_text.push('\n');
    }

    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建配置目录失败: {}", e))?;
    }
    std::fs::write(&config_path, final_text)
        .map_err(|e| format!("写入配置失败: {}", e))?;

    read_codex_config()
}

/// 用系统默认程序打开指定路径
/// path_type: "config" | "tweaks" | "data" | "codex-data"
#[tauri::command]
pub fn open_codex_path(path_type: String) -> Result<String, String> {
    use std::process::Command;

    let home = std::env::var("USERPROFILE").map_err(|e| e.to_string())?;
    let path = match path_type.as_str() {
        "config" => format!("{}/.codex/config.toml", home),
        "tweaks" => format!("{}/AppData/Roaming/codex-plusplus/tweaks", home),
        "data" => format!("{}/AppData/Roaming/codex-plusplus", home),
        "codex-data" => format!("{}/AppData/Roaming/Codex", home),
        _ => return Err(format!("未知路径类型: {}", path_type)),
    };

    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("路径不存在: {}", path));
    }

    if p.is_dir() {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开文件夹失败: {}", e))?;
    } else {
        Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("打开文件失败: {}", e))?;
    }
    Ok(path)
}
