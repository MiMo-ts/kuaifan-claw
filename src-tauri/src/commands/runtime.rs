// 运行时管理 — 扫描 runtimes/ 目录，管理各模块的启动/停止/状态

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::Emitter;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tracing::{info, warn};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows: CREATE_NO_WINDOW flag to prevent CMD popup
#[cfg(windows)]
const NO_WINDOW: u32 = 0x08000000;
/// Windows: DETACHED_PROCESS - avoid inheriting/attaching a console
#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x00000008;

const HERMES_DESKTOP_SESSION_TOKEN: &str = "kfc-desk-3463b6e3f34d0f12fc416939e9a81fc395f40f4730cfc145";
const HERMES_BROWSER_BUNDLE_VERSION: &str = "3";
const HERMES_AGENT_VERSION: &str = "0.18.2-kfc.6";

fn hermes_agent_bundle_marker() -> String {
    format!("{}|kuaifanclaw-{}", HERMES_AGENT_VERSION, env!("CARGO_PKG_VERSION"))
}

fn hermes_agent_bundle_needs_refresh(runtime_dir: &std::path::Path, expected_marker: &str) -> bool {
    let entrypoint = runtime_dir.join("hermes_cli").join("main.py");
    let existing_marker = std::fs::read_to_string(runtime_dir.join(".bundle_version"))
        .unwrap_or_default();
    !entrypoint.is_file() || existing_marker.trim() != expected_marker
}

fn hermes_home_dir(data_base: &str) -> PathBuf {
    PathBuf::from(data_base).join("modules").join("hermes")
}

fn hermes_browser_executable_path(home: &std::path::Path) -> Option<PathBuf> {
    let browser_root = home.join("ms-playwright");
    let entries = std::fs::read_dir(browser_root).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if !name.starts_with("chromium_headless_shell-") && !name.starts_with("chromium-") {
            continue;
        }
        for relative in [
            "chrome-headless-shell-win64/chrome-headless-shell.exe",
            "chrome-win64/chrome.exe",
        ] {
            let candidate = entry.path().join(relative);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn hermes_browser_home_is_ready(home: &std::path::Path) -> bool {
    home.join("node").join("node.exe").is_file()
        && home.join("node_modules").join(".bin").join("agent-browser.cmd").is_file()
        && hermes_browser_executable_path(home).is_some()
}


fn ensure_hermes_git_bash(data_base: &str) -> Result<PathBuf, String> {
    if let Some(path) = resolve_git_bash(data_base) {
        return Ok(path);
    }

    #[cfg(windows)]
    {
        match install_portable_git_with_bash(data_base) {
            Ok(path) => {
                info!("installed PortableGit with bash for Hermes: {}", path.display());
                // Refresh process PATH so child tools can also see git/bash.
                let _ = ensure_managed_tool_path(data_base);
                return Ok(path);
            }
            Err(error) => {
                warn!("auto-install PortableGit for Hermes failed: {}", error);
            }
        }
    }

    Err(
        "未找到 Git Bash（bash.exe）。Hermes 终端工具依赖 Git for Windows / PortableGit，\
MinGit 精简包不包含 bash。请在环境安装中重新安装 Git（内置 PortableGit），\
或安装 Git for Windows 后重启 Hermes。"
            .to_string(),
    )
}

#[cfg(windows)]
fn portable_git_zip_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join("bundled-env").join(crate::mirror::PORTABLE_GIT_ZIP));
            out.push(dir.join("resources").join("bundled-env").join(crate::mirror::PORTABLE_GIT_ZIP));
            out.push(dir.join("..").join("bundled-env").join(crate::mirror::PORTABLE_GIT_ZIP));
        }
    }
    out.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bundled-env").join(crate::mirror::PORTABLE_GIT_ZIP));
    out
}

#[cfg(windows)]
fn install_portable_git_with_bash(data_base: &str) -> Result<PathBuf, String> {
    let env_dir = env_root(data_base);
    let dest = env_dir.join("git");
    let zip_path = portable_git_zip_candidates()
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| {
            format!(
                "missing offline PortableGit package ({})",
                crate::mirror::PORTABLE_GIT_ZIP
            )
        })?;

    info!("extracting PortableGit for Hermes bash: {} -> {}", zip_path.display(), dest.display());
    // Replace MinGit (no bash) with PortableGit (has bash).
    if dest.exists() {
        let _ = std::fs::remove_dir_all(&dest);
    }
    std::fs::create_dir_all(&dest).map_err(|e| format!("create git dir failed: {e}"))?;

    let data = std::fs::read(&zip_path).map_err(|e| format!("read PortableGit zip failed: {e}"))?;
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("open PortableGit zip failed: {e}"))?;
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("read PortableGit entry {i} failed: {e}"))?;
        let out_path = dest.join(file.mangled_name());
        if file.is_dir() {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| format!("create {} failed: {e}", out_path.display()))?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create {} failed: {e}", parent.display()))?;
        }
        let mut outfile = std::fs::File::create(&out_path)
            .map_err(|e| format!("create {} failed: {e}", out_path.display()))?;
        std::io::copy(&mut file, &mut outfile)
            .map_err(|e| format!("extract {} failed: {e}", out_path.display()))?;
    }

    let bash = resolve_git_bash(data_base)
        .ok_or_else(|| "PortableGit extracted but bash.exe still missing".to_string())?;
    Ok(bash)
}

fn configure_hermes_browser_environment(
    command: &mut Command,
    hermes_home: &std::path::Path,
    base_path: &str,
) -> Result<(), String> {
    let browser_bin_dir = hermes_home.join("node_modules").join(".bin");
    let node_dir = hermes_home.join("node");
    let existing_path = std::ffi::OsString::from(base_path);
    let path = std::env::join_paths(
        std::iter::once(node_dir)
            .chain(std::iter::once(browser_bin_dir))
            .chain(std::env::split_paths(&existing_path)),
    )
    .map_err(|error| format!("build Hermes browser PATH: {}", error))?;
    let browser_executable = hermes_browser_executable_path(hermes_home)
        .ok_or_else(|| "Hermes offline Chromium executable is missing".to_string())?;

    command
        .env("HERMES_HOME", hermes_home)
        .env("PATH", path)
        .env("PLAYWRIGHT_BROWSERS_PATH", hermes_home.join("ms-playwright"))
        .env("AGENT_BROWSER_EXECUTABLE_PATH", browser_executable)
        .env("HERMES_OFFLINE_BROWSER", "1");
    Ok(())
}

fn bundled_hermes_dir_candidates() -> [PathBuf; 3] {
    [
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bundled-hermes"),
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|parent| parent.join("bundled-hermes")))
            .unwrap_or_default(),
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|parent| parent.join("resources").join("bundled-hermes")))
            .unwrap_or_default(),
    ]
}

fn extract_hermes_bundle(zip_path: &std::path::Path, target_dir: &std::path::Path) -> Result<(), String> {
    let data = std::fs::read(zip_path)
        .map_err(|error| format!("read Hermes bundle {}: {}", zip_path.display(), error))?;
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|error| format!("open Hermes bundle {}: {}", zip_path.display(), error))?;
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("read Hermes bundle entry {}: {}", index, error))?;
        let path = target_dir.join(file.mangled_name());
        if file.is_dir() {
            std::fs::create_dir_all(&path)
                .map_err(|error| format!("create Hermes bundle directory {}: {}", path.display(), error))?;
            continue;
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("create Hermes bundle directory {}: {}", parent.display(), error))?;
        }
        let mut output = std::fs::File::create(&path)
            .map_err(|error| format!("create Hermes bundle file {}: {}", path.display(), error))?;
        std::io::copy(&mut file, &mut output)
            .map_err(|error| format!("extract Hermes bundle file {}: {}", path.display(), error))?;
    }
    Ok(())
}

fn refresh_hermes_agent_bundle(runtime_dir: &std::path::Path) -> Result<bool, String> {
    let expected_marker = hermes_agent_bundle_marker();
    if !hermes_agent_bundle_needs_refresh(runtime_dir, &expected_marker) {
        return Ok(false);
    }

    let bundle_path = bundled_hermes_dir_candidates()
        .into_iter()
        .map(|dir| dir.join("hermes-agent.zip"))
        .find(|path| path.is_file())
        .ok_or_else(|| "Hermes runtime bundle is missing: hermes-agent.zip".to_string())?;

    std::fs::create_dir_all(runtime_dir)
        .map_err(|error| format!("create Hermes runtime {}: {}", runtime_dir.display(), error))?;
    extract_hermes_bundle(&bundle_path, runtime_dir)?;
    std::fs::write(runtime_dir.join(".bundle_version"), format!("{}\n", expected_marker))
        .map_err(|error| format!("write Hermes runtime version marker: {}", error))?;
    Ok(true)
}


// Write a real agent-browser.cmd shim that delegates to the bundled Python
// + tools/cdp_browser_cli.py. The relative path keeps cmd.exe from
// mis-decoding a Chinese installation path written by Rust as UTF-8.
fn write_agent_browser_shim(runtime_dir: &std::path::Path, home: &std::path::Path) -> std::io::Result<()> {
    let shim_dir = home.join("node_modules").join(".bin");
    std::fs::create_dir_all(&shim_dir)?;
    let shim_path = shim_dir.join("agent-browser.cmd");
    let py = runtime_dir.join("python").join("python.exe");
    let cli = runtime_dir.join("tools").join("cdp_browser_cli.py");
    if !py.is_file() || !cli.is_file() {
        return Ok(()); // runtime not extracted yet; will retry next install
    }
    let body = "@ECHO off\r\nREM kuaifanclaw Hermes bundled agent-browser shim.\r\nREM Resolve the sibling runtime from this file so Chinese install paths\r\nREM never need to be encoded into the batch source.\r\nset \"KFC_HERMES_RUNTIME=%~dp0..\\..\\..\\..\\runtimes\\hermes\"\r\n\"%KFC_HERMES_RUNTIME%\\python\\python.exe\" \"%KFC_HERMES_RUNTIME%\\tools\\cdp_browser_cli.py\" %*\r\nexit /b %ERRORLEVEL%\r\n";
    std::fs::write(&shim_path, body)
}

fn ensure_hermes_browser_home(data_base: &str) -> Result<PathBuf, String> {
    let home = hermes_home_dir(data_base);
    let runtime_dir = std::path::PathBuf::from(data_base).join("runtimes").join("hermes");
    let marker_path = home.join(".browser_bundle_version");
    let installed_version = std::fs::read_to_string(&marker_path)
        .unwrap_or_default()
        .trim()
        .to_string();
    if installed_version == HERMES_BROWSER_BUNDLE_VERSION && hermes_browser_home_is_ready(&home) {
        write_agent_browser_shim(&runtime_dir, &home)
            .map_err(|error| format!("refresh Hermes browser shim: {}", error))?;
        return Ok(home);
    }

    let bundle_path = bundled_hermes_dir_candidates()
        .into_iter()
        .map(|dir| dir.join("hermes-browser.zip"))
        .find(|path| path.is_file())
        .ok_or_else(|| "Hermes offline browser bundle is missing: hermes-browser.zip".to_string())?;
    std::fs::create_dir_all(&home)
        .map_err(|error| format!("create Hermes home {}: {}", home.display(), error))?;
    extract_hermes_bundle(&bundle_path, &home)?;
    if !hermes_browser_home_is_ready(&home) {
        return Err("Hermes offline browser bundle is incomplete after extraction".to_string());
    }
    std::fs::write(&marker_path, format!("{}\n", HERMES_BROWSER_BUNDLE_VERSION))
        .map_err(|error| format!("write Hermes browser version marker: {}", error))?;
    write_agent_browser_shim(&runtime_dir, &home)
        .map_err(|error| format!("write Hermes browser shim: {}", error))?;
    Ok(home)
}

fn hermes_provider_api_key_env_var(provider: &str) -> Option<&'static str> {
    match provider.to_ascii_lowercase().as_str() {
        "openai" => Some("OPENAI_API_KEY"),
        "anthropic" => Some("ANTHROPIC_API_KEY"),
        "google" => Some("GEMINI_API_KEY"),
        "openrouter" => Some("OPENROUTER_API_KEY"),
        "deepseek" => Some("DEEPSEEK_API_KEY"),
        "minimax" => Some("MINIMAX_API_KEY"),
        "minimax-cn" => Some("MINIMAX_CN_API_KEY"),
        "dashscope" => Some("DASHSCOPE_API_KEY"),
        "siliconflow" => Some("SILICONFLOW_API_KEY"),
        "kuaifan" => Some("KUAIFAN_API_KEY"),
        _ => None,
    }
}

fn hermes_models_document(data_dir: &str) -> Option<serde_yaml::Value> {
    let path = PathBuf::from(data_dir).join("config").join("models.yaml");
    let raw = crate::commands::gateway::read_models_yaml_raw_utf8_or_utf16(&path)?;
    serde_yaml::from_str(raw.strip_prefix('\u{feff}').unwrap_or(&raw)).ok()
}

fn hermes_default_model_provider(data_dir: &str) -> Option<String> {
    hermes_models_document(data_dir)?
        .get("default_model")?
        .get("provider")?
        .as_str()
        .map(str::to_string)
}

fn hermes_default_model_api_key(data_dir: &str) -> Option<String> {
    let document = hermes_models_document(data_dir)?;
    let provider = document
        .get("default_model")?
        .get("provider")?
        .as_str()?;
    let raw_key = document
        .get("providers")?
        .get(provider)?
        .get("api_key")?
        .as_str()?;
    if !raw_key.starts_with("enc:") {
        return Some(raw_key.to_string());
    }
    let cipher_key = crate::services::cipher::get_or_create_cipher_key_sync(data_dir).ok()?;
    crate::services::cipher::decrypt_credential(raw_key, &cipher_key)
}

/// 运行时的 GUI 类型
#[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeGuiConfig {
    #[serde(rename = "type", alias = "gui_type")]
    gui_type: String,
    #[serde(alias = "url_template")]
    url_template: String,
    #[serde(default, alias = "default_gui_port")]
    default_gui_port: u16,
}

/// 端口配置
#[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
pub struct RuntimePortConfig {
    default: u16,
    #[serde(default)]
    env: String,
    /// 可选端口扫描上限（兼容旧 manifest 的 range 字段）
    #[serde(default)]
    range: Option<Vec<u16>>,
}

/// 运行时配置
#[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
pub struct RuntimePortsConfig {
    gui: RuntimePortConfig,
    gateway: RuntimePortConfig,
}

/// 启动配置
#[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
pub struct RuntimeLaunchConfig {
    command: String,
    args: Vec<String>,
    #[serde(rename = "cwd")]
    _cwd: String,
    #[serde(rename = "healthUrl")]
    health_url: String,
    #[serde(rename = "readyTimeoutMs")]
    ready_timeout_ms: u64,
    #[serde(default)]
    env: HashMap<String, String>,
}

/// runtime.json 完整结构
#[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeManifest {
    id: String,
    name: String,
    description: String,
    version: String,
    category: String,
    icon: String,
    launch: RuntimeLaunchConfig,
    gui: RuntimeGuiConfig,
    ports: RuntimePortsConfig,
    capabilities: Vec<String>,
    #[serde(default)]
    dependencies: HashMap<String, String>,
    #[serde(default)]
    requires: Option<RuntimeRequires>,
}

fn parse_runtime_manifest(content: &str) -> Result<RuntimeManifest, serde_json::Error> {
    serde_json::from_str(content.strip_prefix('\u{feff}').unwrap_or(content))
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
struct RuntimeRequires {
    #[serde(default)]
    python: Option<RuntimePythonRequirement>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
struct RuntimePythonRequirement {
    bundled: String,
    min_version: String,
    #[serde(default)]
    check: String,
}

/// 运行时实例状态
#[derive(Clone, serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInstance {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub icon: String,
    pub category: String,
    pub capabilities: Vec<String>,
    pub gui_type: String,
    pub gui_url: String,
    pub gui_port: u16,
    pub gateway_port: u16,
    pub running: bool,
    pub pid: Option<u32>,
    pub started_at: Option<u64>,
}

/// 全局运行时状态
struct RuntimeState {
    instances: HashMap<String, RuntimeInstance>,
    processes: HashMap<String, Child>,
    sidecar_processes: HashMap<String, Child>,
    /// 模块指定端口 (由前端设置)
    module_ports: HashMap<String, (u16, u16)>, // id -> (gui_port, gateway_port)
}

static RUNTIME_STATE: Mutex<Option<RuntimeState>> = Mutex::new(None);

fn is_hermes_dashboard_command(command_line: &str, runtime_dir: &std::path::Path) -> bool {
    let normalize = |value: &str| value.replace('\\', "/").to_ascii_lowercase();
    let command_line = normalize(command_line);
    let runtime_dir = normalize(&runtime_dir.to_string_lossy());
    let root_candidate = runtime_dir.split("/target/").next().unwrap_or(&runtime_dir);
    let project_root = root_candidate
        .strip_suffix("/runtimes/hermes")
        .unwrap_or(root_candidate);
    let hermes_runtime_prefix = format!("{}/runtimes/hermes/", project_root.trim_end_matches('/'));

    command_line.contains("hermes_cli.main dashboard")
        && command_line.contains(&hermes_runtime_prefix)
}

#[cfg(windows)]
fn clear_stale_hermes_dashboard_listener(
    runtime_dir: &std::path::Path,
    port: u16,
) -> Result<(), String> {
    let script = format!(
        "$owners = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($owner in $owners) {{ $process = Get-CimInstance Win32_Process -Filter \"ProcessId=$owner\" -ErrorAction SilentlyContinue; if ($null -ne $process) {{ Write-Output (\"$($process.ProcessId)`t$($process.CommandLine)\") }} }}"
    );
    let output = crate::commands::hidden_cmd::powershell()
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
        .output()
        .map_err(|error| format!("检查 Hermes 端口占用失败: {}", error))?;

    let listeners = String::from_utf8_lossy(&output.stdout);
    let mut pids = Vec::new();
    for line in listeners.lines() {
        let Some((pid, command_line)) = line.split_once('\t') else {
            continue;
        };
        let pid = pid.trim().parse::<u32>().ok();
        if let Some(pid) = pid {
            if is_hermes_dashboard_command(command_line, runtime_dir) {
                pids.push(pid);
            } else {
                return Err(format!(
                    "端口 {} 已被非 Hermes 进程占用，已取消启动以避免误结束其它程序。",
                    port
                ));
            }
        }
    }

    if pids.is_empty() {
        return Err(format!("端口 {} 已被占用，但无法识别监听进程。", port));
    }

    for pid in pids {
        let status = crate::commands::hidden_cmd::cmd()
            .args(["/C", &format!("taskkill /PID {} /F /T", pid)])
            .status()
            .map_err(|error| format!("结束遗留 Hermes 进程失败: {}", error))?;
        if !status.success() {
            return Err(format!("结束遗留 Hermes 进程 {} 失败。", pid));
        }
    }

    for _ in 0..20 {
        if std::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port)).is_err() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(250));
    }

    Err(format!("遗留 Hermes 进程退出后端口 {} 仍未释放。", port))
}

#[cfg(test)]
mod hermes_runtime_tests {
    use super::*;

    #[test]
    fn recognizes_only_hermes_dashboard_processes_in_its_runtime_directory() {
        let runtime_dir = PathBuf::from("D:/kuaifanclaw/src-tauri/runtimes/hermes");

        assert!(is_hermes_dashboard_command(
            "\"D:\\kuaifanclaw\\src-tauri\\runtimes\\hermes\\python\\python.exe\" -m hermes_cli.main dashboard --port 5174",
            &runtime_dir,
        ));
        assert!(is_hermes_dashboard_command(
            "\"D:\\kuaifanclaw\\src-tauri\\runtimes\\hermes\\python\\python.exe\" -m hermes_cli.main dashboard --port 5174",
            &PathBuf::from("D:/kuaifanclaw/src-tauri/target/debug/runtimes/hermes"),
        ));
        assert!(!is_hermes_dashboard_command(
            "C:\\Python\\python.exe -m http.server 5174",
            &runtime_dir,
        ));
        assert!(!is_hermes_dashboard_command(
            "\"D:\\other\\python.exe\" -m hermes_cli.main dashboard --port 5174",
            &runtime_dir,
        ));
    }

    #[test]
    fn parses_manifest_with_utf8_bom() {
        let manifest = parse_runtime_manifest("\u{feff}{\"id\":\"hermes\",\"name\":\"Hermes\",\"description\":\"\",\"version\":\"0\",\"category\":\"agent\",\"icon\":\"\",\"launch\":{\"command\":\"\",\"args\":[],\"cwd\":\".\",\"healthUrl\":\"\",\"readyTimeoutMs\":0},\"gui\":{\"type\":\"web\",\"urlTemplate\":\"\",\"defaultGuiPort\":5174},\"ports\":{\"gui\":{\"default\":5174,\"env\":\"\"},\"gateway\":{\"default\":5174,\"env\":\"\"}},\"capabilities\":[]}")
            .expect("UTF-8 BOM should not prevent runtime discovery");

        assert_eq!(manifest.id, "hermes");
    }

    #[test]
    fn refreshes_hermes_agent_when_the_bundle_marker_is_stale_or_entrypoint_is_missing() {
        let temp = tempfile::tempdir().expect("temporary Hermes runtime");
        let runtime_dir = temp.path().join("hermes");
        let entrypoint = runtime_dir.join("hermes_cli").join("main.py");
        std::fs::create_dir_all(entrypoint.parent().expect("entrypoint parent"))
            .expect("create Hermes entrypoint directory");
        std::fs::write(&entrypoint, b"dashboard").expect("write Hermes entrypoint");
        std::fs::write(
            runtime_dir.join(".bundle_version"),
            "0.18.2|kuaifanclaw-1.0.61\n",
        )
        .expect("write stale marker");

        let expected = "0.18.2|kuaifanclaw-test";
        assert!(hermes_agent_bundle_needs_refresh(&runtime_dir, expected));

        std::fs::write(runtime_dir.join(".bundle_version"), format!("{}\n", expected))
            .expect("write current marker");
        assert!(!hermes_agent_bundle_needs_refresh(&runtime_dir, expected));

        std::fs::remove_file(&entrypoint).expect("remove Hermes entrypoint");
        assert!(hermes_agent_bundle_needs_refresh(&runtime_dir, expected));
    }

    #[test]
    fn refreshes_the_previous_kuaifan_hermes_bundle_revision() {
        let temp = tempfile::tempdir().expect("temporary Hermes runtime");
        let runtime_dir = temp.path().join("hermes");
        let entrypoint = runtime_dir.join("hermes_cli").join("main.py");
        std::fs::create_dir_all(entrypoint.parent().expect("entrypoint parent"))
            .expect("create Hermes entrypoint directory");
        std::fs::write(&entrypoint, b"dashboard").expect("write Hermes entrypoint");

        let previous_marker = format!(
            "0.18.2-kfc.4|kuaifanclaw-{}\n",
            env!("CARGO_PKG_VERSION")
        );
        std::fs::write(runtime_dir.join(".bundle_version"), previous_marker)
            .expect("write previous marker");

        assert!(hermes_agent_bundle_needs_refresh(
            &runtime_dir,
            &hermes_agent_bundle_marker()
        ));
    }

    #[test]
    fn refreshes_a_stale_runtime_from_the_bundled_agent_archive() {
        let temp = tempfile::tempdir().expect("temporary Hermes runtime");
        let runtime_dir = temp.path().join("hermes");
        std::fs::create_dir_all(&runtime_dir).expect("create Hermes runtime");
        std::fs::write(
            runtime_dir.join(".bundle_version"),
            "0.18.2|kuaifanclaw-1.0.61\n",
        )
        .expect("write stale marker");

        assert!(refresh_hermes_agent_bundle(&runtime_dir).expect("refresh bundled Hermes runtime"));
        assert_eq!(
            std::fs::read_to_string(runtime_dir.join(".bundle_version"))
                .expect("read refreshed marker")
                .trim(),
            hermes_agent_bundle_marker()
        );
        assert!(runtime_dir.join("hermes_cli").join("main.py").is_file());
        assert!(
            runtime_dir
                .join("tools")
                .join("cdp_browser_cli.py")
                .is_file()
        );
    }

    #[test]
    fn desktop_dashboard_token_is_stable_when_runtime_manifest_is_legacy() {
        assert_eq!(
            HERMES_DESKTOP_SESSION_TOKEN,
            "kfc-desk-3463b6e3f34d0f12fc416939e9a81fc395f40f4730cfc145"
        );
    }

    #[test]
    fn recognizes_a_complete_offline_hermes_browser_home() {
        let temp = tempfile::tempdir().expect("temporary Hermes home");
        let home = temp.path();
        assert!(!hermes_browser_home_is_ready(home));

        std::fs::create_dir_all(home.join("node_modules").join(".bin"))
            .expect("agent-browser bin directory");
        std::fs::create_dir_all(
            home.join("ms-playwright")
                .join("chromium_headless_shell-1228")
                .join("chrome-headless-shell-win64"),
        )
        .expect("Chromium directory");
        std::fs::create_dir_all(home.join("node")).expect("Node directory");
        std::fs::write(home.join("node").join("node.exe"), b"node")
            .expect("Node executable marker");
        std::fs::write(
            home.join("node_modules").join(".bin").join("agent-browser.cmd"),
            b"agent-browser",
        )
        .expect("agent-browser command marker");
        std::fs::write(
            home.join("ms-playwright")
                .join("chromium_headless_shell-1228")
                .join("chrome-headless-shell-win64")
                .join("chrome-headless-shell.exe"),
            b"chromium",
        )
        .expect("Chromium executable marker");

        assert!(hermes_browser_home_is_ready(home));
    }

    #[test]
    fn refreshes_the_browser_shim_for_an_existing_offline_home() {
        let temp = tempfile::tempdir().expect("temporary data directory");
        let data_base = temp.path();
        let home = hermes_home_dir(data_base.to_str().expect("UTF-8 data path"));
        let shim_path = home.join("node_modules").join(".bin").join("agent-browser.cmd");
        let chromium = home
            .join("ms-playwright")
            .join("chromium-1228")
            .join("chrome-win64")
            .join("chrome.exe");
        let runtime_dir = data_base.join("runtimes").join("hermes");

        std::fs::create_dir_all(shim_path.parent().expect("shim parent"))
            .expect("browser shim directory");
        std::fs::create_dir_all(chromium.parent().expect("Chromium parent"))
            .expect("Chromium directory");
        std::fs::create_dir_all(home.join("node")).expect("Node directory");
        std::fs::create_dir_all(runtime_dir.join("python")).expect("Python directory");
        std::fs::create_dir_all(runtime_dir.join("tools")).expect("tools directory");
        std::fs::write(home.join("node").join("node.exe"), b"node")
            .expect("Node executable marker");
        std::fs::write(&chromium, b"chromium").expect("Chromium executable marker");
        std::fs::write(&shim_path, b"@echo off\r\nexit /b 0\r\n")
            .expect("stale browser shim");
        std::fs::write(
            runtime_dir.join("python").join("python.exe"),
            b"python",
        )
        .expect("Python executable marker");
        std::fs::write(
            runtime_dir.join("tools").join("cdp_browser_cli.py"),
            b"cdp",
        )
        .expect("CDP CLI marker");
        std::fs::write(
            home.join(".browser_bundle_version"),
            format!("{}\n", HERMES_BROWSER_BUNDLE_VERSION),
        )
        .expect("browser version marker");

        ensure_hermes_browser_home(data_base.to_str().expect("UTF-8 data path"))
            .expect("existing browser home should be reused");

        let shim = std::fs::read_to_string(&shim_path).expect("read refreshed shim");
        assert!(shim.contains("%~dp0"));
        assert!(shim.contains("cdp_browser_cli.py"));
    }

    #[test]
    fn bundled_hermes_archive_is_readable_by_the_runtime_zip_library() {
        let source_driver = std::fs::read(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("runtimes")
                .join("hermes")
                .join("tools")
                .join("cdp_browser_cli.py"),
        )
        .expect("offline browser driver source should exist");
        let zip_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("bundled-hermes")
            .join("hermes-agent.zip");
        let data = std::fs::read(&zip_path).expect("bundled Hermes archive should exist");
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data))
            .expect("bundled Hermes archive should open");
        let mut packaged_driver = None;
        let mut packaged_feishu_sdk = false;
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).expect("entry should open");
            let entry_name = entry.name().to_string();
            let mut contents = Vec::new();
            std::io::copy(&mut entry, &mut contents)
                .unwrap_or_else(|error| panic!("invalid Hermes archive entry {}: {}", entry.name(), error));
            if entry_name.replace('\\', "/") == "tools/cdp_browser_cli.py" {
                packaged_driver = Some(contents);
            }
            if entry_name.replace('\\', "/") == "lark_oapi/__init__.py" {
                packaged_feishu_sdk = true;
            }
        }
        let packaged_driver = packaged_driver.expect(
            "bundled Hermes archive must include the offline browser driver"
        );
        assert_eq!(
            packaged_driver,
            source_driver,
            "bundled offline browser driver must match the runtime source"
        );
        assert!(
            packaged_feishu_sdk,
            "Hermes agent bundle must include the offline Feishu SDK"
        );
    }

    #[cfg(windows)]
    #[test]
    fn hermes_gateway_sidecar_receives_the_bundled_browser_environment() {
        let temp = tempfile::tempdir().expect("temporary sidecar directory");
        let data_base = temp.path().join("data");
        let hermes_home = hermes_home_dir(data_base.to_str().expect("UTF-8 data path"));
        let browser_bin_dir = hermes_home.join("node_modules").join(".bin");
        let chromium = hermes_home
            .join("ms-playwright")
            .join("chromium-1228")
            .join("chrome-win64")
            .join("chrome.exe");
        std::fs::create_dir_all(&browser_bin_dir).expect("browser shim directory");
        std::fs::create_dir_all(chromium.parent().expect("Chromium directory"))
            .expect("Chromium directory");
        std::fs::create_dir_all(hermes_home.join("node")).expect("Node directory");
        std::fs::write(hermes_home.join("node").join("node.exe"), b"node")
            .expect("Node executable marker");
        std::fs::write(browser_bin_dir.join("agent-browser.cmd"), b"@echo off\r\n")
            .expect("agent-browser shim");
        std::fs::write(&chromium, b"chromium").expect("Chromium executable marker");

        let command = build_hermes_gateway_sidecar_command(
            "python",
            temp.path(),
            data_base.to_str().expect("UTF-8 data path"),
        )
        .expect("sidecar command should be built");
        let values: HashMap<_, _> = command
            .get_envs()
            .filter_map(|(key, value)| {
                value.map(|value| (key.to_string_lossy().into_owned(), value.to_string_lossy().into_owned()))
            })
            .collect();
        assert_eq!(
            values.get("HERMES_HOME").map(String::as_str),
            Some(hermes_home.to_string_lossy().as_ref())
        );
        assert_eq!(
            values.get("PLAYWRIGHT_BROWSERS_PATH").map(String::as_str),
            Some(hermes_home.join("ms-playwright").to_string_lossy().as_ref())
        );
        assert_eq!(
            values
                .get("AGENT_BROWSER_EXECUTABLE_PATH")
                .map(PathBuf::from),
            Some(chromium)
        );
        assert_eq!(values.get("HERMES_OFFLINE_BROWSER").map(String::as_str), Some("1"));
        let path_entries = std::env::split_paths(std::ffi::OsStr::new(
            values.get("PATH").expect("sidecar PATH should be configured"),
        ))
        .collect::<Vec<_>>();
        assert!(path_entries.iter().any(|entry| entry == &browser_bin_dir));
        assert!(path_entries.iter().any(|entry| entry == &hermes_home.join("node")));
    }
}

fn build_hermes_gateway_sidecar_command(
    launch_cmd: &str,
    cwd: &std::path::Path,
    data_base: &str,
) -> Result<Command, String> {
    let mut command = Command::new(launch_cmd);
    command
        .args(["-m", "hermes_cli.main", "gateway", "run", "--force", "--accept-hooks"])
        .current_dir(cwd)
        .stdin(Stdio::null());
    let managed_path = build_deps_env_path(data_base);
    configure_hermes_browser_environment(&mut command, &hermes_home_dir(data_base), &managed_path)?;
    if let Ok(bash) = ensure_hermes_git_bash(data_base) {
        command.env("HERMES_GIT_BASH_PATH", bash);
    }
    command.env("PATH", &managed_path);
    Ok(command)
}

fn spawn_hermes_gateway_sidecar(
    launch_cmd: &str,
    cwd: &std::path::Path,
    data_base: &str,
    log_path: &std::path::Path,
) -> Result<Child, String> {
    let log_file = std::fs::File::create(log_path)
        .map_err(|error| format!("create Hermes gateway log: {}", error))?;
    let log_file_err = log_file
        .try_clone()
        .map_err(|error| format!("clone Hermes gateway log: {}", error))?;
    let mut command = build_hermes_gateway_sidecar_command(launch_cmd, cwd, data_base)?;
    command
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_err));
    #[cfg(windows)]
    command.creation_flags(NO_WINDOW | DETACHED_PROCESS);
    command
        .spawn()
        .map_err(|error| format!("start Hermes platform gateway: {}", error))
}

fn get_state() -> std::sync::MutexGuard<'static, Option<RuntimeState>> {
    RUNTIME_STATE.lock().unwrap_or_else(|e| e.into_inner())
}

fn ensure_state() {
    let mut state = get_state();
    if state.is_none() {
        *state = Some(RuntimeState {
            instances: HashMap::new(),
            processes: HashMap::new(),
            sidecar_processes: HashMap::new(),
            module_ports: HashMap::new(),
        });
    }
}

/// 获取 runtimes/ 目录路径
fn runtimes_dir(data_dir: &str) -> PathBuf {
    // 1. 优先：data_dir/runtimes（安装向导解压的真实路径，有完整二进制文件）
    let data_path = PathBuf::from(data_dir).join("runtimes");
    if data_path.join("hermes").join("python").join("python.exe").exists() {
        info!("找到 runtimes (data_dir): {}", data_path.display());
        return data_path;
    }

    // 2. exe 同级目录（Tauri 打包后资源放这里）
    if let Ok(exe) = std::env::current_exe() {
        let beside = exe.parent().map(|p| p.join("runtimes"));
        if let Some(ref p) = beside {
            if p.exists() {
                info!("找到 runtimes (beside exe): {}", p.display());
                return p.clone();
            }
        }
    }

    // 3. 开发模式：搜索祖先目录
    let candidates: Vec<PathBuf> = (0..6)
        .filter_map(|i| {
            std::env::current_exe().ok()?.parent()?.ancestors().nth(i).map(|p| p.join("runtimes"))
        })
        .collect();
    for c in &candidates {
        if c.exists() {
            info!("找到 runtimes (ancestor): {}", c.display());
            return c.clone();
        }
    }

    // 4. 回退到 data_dir
    info!("使用回退 runtimes: {}", data_path.display());
    data_path
}

pub(crate) fn runtime_log_path(data_dir: &str, runtime_id: &str) -> PathBuf {
    // Hermes: 返回实际网关日志路径
    if runtime_id == "hermes" {
        if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
            let real_log = PathBuf::from(&local_appdata)
                .join("hermes").join("logs").join("gateway-stdio.log");
            if real_log.exists() {
                return real_log;
            }
        }
    }
    runtimes_dir(data_dir).join(runtime_id).join(format!("{}_runtime.log", runtime_id))
}

/// 探测运行时是否已在外部启动（端口 + 版本校验）
///
/// 在 Tauri 应用重启时，原有内存状态已清空，但 runtime 进程可能仍在监听端口。
/// 通过 TCP 连接 + /api/status 版本校验，可识别并复用这些进程，避免重复启动。
async fn probe_existing_runtime(manifest: &RuntimeManifest, gui_port: u16) -> Option<(u32, u64)> {
    info!("probe: 开始探测 {} 端口 {}", manifest.id, gui_port);
    // 1. TCP 端口快速探测
    let addr: std::net::SocketAddr = format!("127.0.0.1:{}", gui_port).parse().ok()?;
    if std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_err() {
        info!("probe: TCP 端口 {} 连接失败", gui_port);
        return None;
    }

    // 2. /api/status 健康校验 + 版本匹配
    let health_url = manifest
        .launch
        .health_url
        .replace("{guiPort}", &gui_port.to_string());
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return None,
    };
    let resp = match client.get(&health_url).send().await {
        Ok(r) => r,
        Err(e) => {
            info!("probe: /api/status 请求失败: {}", e);
            return None;
        },
    };
    if !resp.status().is_success() {
        info!("probe: /api/status 状态码非 2xx: {}", resp.status());
        return None;
    }
    let body: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => {
            info!("probe: /api/status JSON 解析失败: {}", e);
            return None;
        },
    };
    let remote_version = body.get("version").and_then(|v| v.as_str()).unwrap_or("");
    if remote_version.is_empty() {
        return None;
    }
    if remote_version != manifest.version {
        warn!(
            "{} 端口 {} 上的服务版本不匹配 (本地={}, 远端={})",
            manifest.id, gui_port, manifest.version, remote_version
        );
        return None;
    }

    // 3. 通过 PowerShell 查找监听该端口的进程 PID
    let pid = match find_listener_pid(gui_port) {
        Some(p) => p,
        None => {
            info!("probe: 未找到监听端口 {} 的进程 PID", gui_port);
            return None;
        },
    };
    let started_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    info!(
        "{} 已在外部运行，端口={} pid={}",
        manifest.id, gui_port, pid
    );
    Some((pid, started_at))
}

#[cfg(windows)]
fn find_listener_pid(port: u16) -> Option<u32> {
    let script = format!(
        "$owners = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($owner in $owners) {{ Write-Output $owner }}"
    );
    let output = crate::commands::hidden_cmd::powershell()
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let trimmed = line.trim();
        if let Ok(pid) = trimmed.parse::<u32>() {
            if pid > 0 {
                return Some(pid);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn find_listener_pid(_port: u16) -> Option<u32> {
    None
}

/// 扫描 runtimes/ 目录下所有 runtime.json
#[tauri::command]
pub async fn scan_runtimes(data_dir: tauri::State<'_, crate::AppState>) -> Result<Vec<RuntimeInstance>, String> {
    let data_base = data_dir.inner().get_data_dir();
    let dir = runtimes_dir(&data_base);
    info!("扫描运行时目录: {}", dir.display());

    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建 runtimes 目录失败: {}", e))?;
    }

    let mut instances = Vec::new();

    let entries = std::fs::read_dir(&dir).map_err(|e| format!("读取 runtimes 目录失败: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("runtime.json");
        if !manifest_path.exists() {
            continue;
        }

        let content = match std::fs::read_to_string(&manifest_path) {
            Ok(c) => c,
            Err(e) => {
                warn!("读取 {} 失败: {}", manifest_path.display(), e);
                continue;
            }
        };

        let manifest: RuntimeManifest = match parse_runtime_manifest(&content) {
            Ok(m) => m,
            Err(e) => {
                warn!("解析 {} 失败: {}", manifest_path.display(), e);
                continue;
            }
        };

        let gui_port = manifest.ports.gui.default;
        let gateway_port = manifest.ports.gateway.default;

        // 探测端口/版本，识别已外部启动的 runtime
        let (running, pid, started_at) = match probe_existing_runtime(&manifest, gui_port).await {
            Some((p, t)) => (true, Some(p), Some(t)),
            None => (false, None, None),
        };

        let instance = RuntimeInstance {
            id: manifest.id.clone(),
            name: manifest.name,
            description: manifest.description,
            version: manifest.version,
            icon: manifest.icon,
            category: manifest.category,
            capabilities: manifest.capabilities,
            gui_type: manifest.gui.gui_type,
            gui_url: manifest.gui.url_template.replace("{guiPort}", &gui_port.to_string()),
            gui_port,
            gateway_port,
            running,
            pid,
            started_at,
        };

        instances.push(instance);
    }

    // 同步到全局状态
    ensure_state();
    let mut state = get_state();
    if let Some(ref mut s) = *state {
        for inst in &instances {
            s.instances
                .entry(inst.id.clone())
                .or_insert_with(|| inst.clone());
        }
    }

    Ok(instances)
}

/// 获取所有运行时及其运行状态
#[tauri::command]
pub async fn get_runtime_list(data_dir: tauri::State<'_, crate::AppState>) -> Result<Vec<RuntimeInstance>, String> {
    let mut instances = scan_runtimes(data_dir).await?;

    // 同步运行状态
    ensure_state();
    let state = get_state();
    if let Some(ref s) = *state {
        for inst in &mut instances {
            if let Some(existing) = s.instances.get(&inst.id) {
                inst.running = existing.running;
                inst.pid = existing.pid;
                inst.started_at = existing.started_at;
                inst.gui_port = existing.gui_port;
                inst.gateway_port = existing.gateway_port;
                inst.gui_url = existing.gui_url.clone();
            }
        }
    }

    Ok(instances)
}

/// 启动指定运行时模块
#[tauri::command]
pub async fn start_runtime(
    data_dir: tauri::State<'_, crate::AppState>,
    runtime_id: String,
) -> Result<RuntimeInstance, String> {
    let data_base = data_dir.inner().get_data_dir();
    let dir = runtimes_dir(&data_base);
    let runtime_dir = dir.join(&runtime_id);
    let manifest_path = runtime_dir.join("runtime.json");

    if !manifest_path.exists() {
        return Err(format!("运行时 '{}' 不存在", runtime_id));
    }

    let content =
        std::fs::read_to_string(&manifest_path).map_err(|e| format!("读取 runtime.json 失败: {}", e))?;
    let mut manifest = parse_runtime_manifest(&content)
        .map_err(|e| format!("解析 runtime.json 失败: {}", e))?;

    if runtime_id == "infinite_canvas" {
        crate::commands::infinite_canvas::ensure_infinite_canvas_runtime(&data_base)?;
        // ensure 会重写 runtime.json（含 launch.command 绝对路径），需重新加载。
        let refreshed = std::fs::read_to_string(&manifest_path)
            .map_err(|e| format!("读取刷新后的无限画布 runtime.json 失败: {}", e))?;
        manifest = parse_runtime_manifest(&refreshed)
            .map_err(|e| format!("解析刷新后的无限画布 runtime.json 失败: {}", e))?;
    }
    if matches!(runtime_id.as_str(), "openclaw" | "hermes" | "infinite_canvas") {
        crate::commands::module::sync_module_configuration(&runtime_id, &data_base).await?;
    }
    if runtime_id == "hermes" {
        crate::commands::module::sync_hermes_platform_credentials(&data_base).await;
    }

    // 分配端口
    let (gui_port, gateway_port) = allocate_ports(&runtime_id, &manifest)?;

    // 检查端口冲突：Hermes 在应用重启后可能留下未被内存状态跟踪的 dashboard 进程。
    let addr = format!("127.0.0.1:{}", gui_port);
    if std::net::TcpStream::connect(&addr).is_ok() {
        if runtime_id == "hermes" {
            #[cfg(windows)]
            clear_stale_hermes_dashboard_listener(&runtime_dir, gui_port)?;
            #[cfg(not(windows))]
            return Err(format!("Hermes 端口 {} 已被占用，请先停止现有 Hermes 进程。", gui_port));
        } else {
            warn!("端口 {} 已被占用，清理旧进程并释放端口", gui_port);
            ensure_state();
            {
                let mut state = get_state();
                if let Some(ref mut s) = *state {
                    if let Some(mut old_child) = s.processes.remove(&runtime_id) {
                        let _ = old_child.kill();
                        let _ = old_child.wait();
                    }
                    s.module_ports.remove(&runtime_id);
                    if let Some(inst) = s.instances.get_mut(&runtime_id) {
                        inst.running = false;
                        inst.pid = None;
                    }
                }
            }
            for _ in 0..20 {
                if std::net::TcpStream::connect(&addr).is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }

    if runtime_id == "hermes" {
        if refresh_hermes_agent_bundle(&runtime_dir)? {
            info!(
                "refreshed Hermes runtime bundle at {} to {}",
                runtime_dir.display(),
                hermes_agent_bundle_marker()
            );
            let refreshed_content = std::fs::read_to_string(&manifest_path)
                .map_err(|error| format!("read refreshed Hermes runtime.json: {}", error))?;
            manifest = parse_runtime_manifest(&refreshed_content)
                .map_err(|error| format!("parse refreshed Hermes runtime.json: {}", error))?;
        }
        ensure_hermes_browser_home(&data_base)?;
    }

    if let Err(error) = ensure_managed_tool_path(&data_base) {
        warn!("同步托管工具 PATH 失败（非致命）: {}", error);
    }

    let gui_url = manifest.gui.url_template.replace("{guiPort}", &gui_port.to_string());

    info!(
        "启动运行时 {}: GUI={} Gateway={}",
        runtime_id, gui_port, gateway_port
    );

    // 检查并解压内置 Python 环境（Hermes 运行时）
    if let Some(ref python_req) = manifest.requires.as_ref().and_then(|r| r.python.as_ref()) {
        let python_dir = runtime_dir.join("python");
        let python_exe = python_dir.join("python.exe");
        if !python_exe.exists() {
            info!("Hermes Python 环境未找到，从内置包解压...");
            let _ = std::fs::create_dir_all(&python_dir);
            // 查找内置 python.zip
            let zip_candidates = [
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bundled-hermes").join(&python_req.bundled),
                std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join("bundled-hermes").join(&python_req.bundled))).unwrap_or_default(),
                std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join("resources").join("bundled-hermes").join(&python_req.bundled))).unwrap_or_default(),
            ];
            if let Some(zip_path) = zip_candidates.iter().find(|p| p.is_file()) {
                info!("解压内置 Python: {}", zip_path.display());
                let zip_data = std::fs::read(zip_path).map_err(|e| format!("读取 python.zip 失败: {}", e))?;
                let cursor = std::io::Cursor::new(zip_data);
                let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("打开 python.zip: {}", e))?;
                archive.extract(&python_dir).map_err(|e| format!("解压 python.zip: {}", e))?;
                info!("Python 环境解压完成: {}", python_dir.display());
                if let Err(error) = ensure_managed_tool_path(&data_base) {
                    warn!("写入 Hermes Python 到系统 PATH 失败（非致命）: {}", error);
                }
            } else {
                // 无内置包，检查系统 Python
                let check = if cfg!(windows) {
                    std::process::Command::new("cmd").args(["/c", "where", "python"]).output().map(|o| o.status.success()).unwrap_or(false)
                } else {
                    std::process::Command::new("which").arg("python").output().map(|o| o.status.success()).unwrap_or(false)
                };
                if !check {
                    return Err(format!("未找到 Python 环境。Hermes 需要 Python {}+。请先安装 Python 或通过安装向导自动配置。", python_req.min_version));
                }
            }
        }
    }

    // 构建启动命令。
    // 1) 支持 {runtimeDir} 绝对路径占位符（Hermes）。
    // 2) 相对路径命令（如 python/python.exe）相对 runtime 目录解析，
    //    避免安装完成后仍因进程 cwd 不是 runtime 目录而误报“未找到命令”。
    let launch_cmd_raw = manifest
        .launch
        .command
        .replace("{runtimeDir}", &runtime_dir.to_string_lossy());
    let launch_path = {
        let candidate = PathBuf::from(&launch_cmd_raw);
        if candidate.is_absolute() {
            candidate
        } else {
            runtime_dir.join(&candidate)
        }
    };
    let launch_cmd = if launch_path.is_file() {
        launch_path.to_string_lossy().to_string()
    } else {
        launch_cmd_raw
    };
    let cwd = if manifest.launch._cwd == "." {
        runtime_dir.clone()
    } else {
        runtime_dir.join(&manifest.launch._cwd)
    };

    // 替换参数中的端口占位符
    let gui_port_str = gui_port.to_string();
    let gw_port_str = gateway_port.to_string();
    let resolved_args: Vec<String> = manifest
        .launch
        .args
        .iter()
        .map(|a| {
            a.replace("{guiPort}", &gui_port_str)
                .replace("{gatewayPort}", &gw_port_str)
        })
        .collect();

    // 创建日志文件用于诊断
    let log_path = runtime_log_path(&data_base, &runtime_id);
    let log_file = std::fs::File::create(&log_path)
        .unwrap_or_else(|_| std::fs::File::create("nul").unwrap());
    let log_file_err = log_file.try_clone().unwrap_or_else(|_| {
        std::fs::File::create("nul").unwrap()
    });

    // 检查命令是否可用：优先按 runtime 相对路径 / 绝对路径判断，再回退 PATH。
    let cmd_check = PathBuf::from(&launch_cmd).is_file() || if cfg!(windows) {
        Command::new("cmd").args(["/c", "where", &launch_cmd]).output().map(|o| o.status.success()).unwrap_or(false)
    } else {
        Command::new("which").arg(&launch_cmd).output().map(|o| o.status.success()).unwrap_or(false)
    };
    if !cmd_check {
        let hint = if runtime_id == "hermes" && launch_cmd.to_ascii_lowercase().contains("python") {
            "\n\nHermes 需要 Python 3.11+ 环境。请安装 Python 后重试: https://www.python.org/downloads/"
        } else if runtime_id == "infinite_canvas" && launch_cmd.to_ascii_lowercase().contains("python") {
            "\n\n无限画布运行时 Python 未就绪。请重新安装无限画布模块，或确认 data/runtimes/infinite_canvas/python/python.exe 存在。"
        } else {
            ""
        };
        return Err(format!("未找到 {} 命令，请确认已安装{hint}", launch_cmd));
    }

    
    // 无限画布：优先 pythonw.exe，避免桌面弹出控制台窗口
    let mut launch_cmd = launch_cmd;
    if runtime_id == "infinite_canvas" {
        let p = PathBuf::from(&launch_cmd);
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_ascii_lowercase();
        if name == "python.exe" {
            let pythonw = p.with_file_name("pythonw.exe");
            if pythonw.is_file() {
                launch_cmd = pythonw.to_string_lossy().to_string();
                info!("infinite_canvas silent launch via pythonw: {}", launch_cmd);
            }
        }
    }
    // prefer_pythonw_for_silent

    let mut cmd = Command::new(&launch_cmd);
    cmd.args(&resolved_args)
        .current_dir(&cwd)
        .env(&manifest.ports.gui.env, gui_port.to_string())
        .env(&manifest.ports.gateway.env, gateway_port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_err));

    // Inject managed tool PATH for all runtimes (python/git/bash/node).
    let managed_path = build_deps_env_path(&data_base);
    cmd.env("PATH", &managed_path);

    if runtime_id == "hermes" {
        let hermes_home = ensure_hermes_browser_home(&data_base)?;
        configure_hermes_browser_environment(&mut cmd, &hermes_home, &managed_path)?;
        // Hermes terminal tools require an explicit bash path on Windows.
        // PATH alone is not enough: tools/environments/local.py reads HERMES_GIT_BASH_PATH first.
        let bash = ensure_hermes_git_bash(&data_base)?;
        info!("Hermes Git Bash: {}", bash.display());
        cmd.env("HERMES_GIT_BASH_PATH", &bash);
        // Older installed runtime.json files lack this value. The desktop GUI
        // authenticates its REST and WebSocket calls with the same token, so it
        // must be supplied by the launcher rather than the runtime manifest.
        cmd.env("HERMES_DASHBOARD_SESSION_TOKEN", HERMES_DESKTOP_SESSION_TOKEN);
    }

    // 设置额外环境变量，相对路径相对于 runtime_dir 解析，并替换端口占位符
    for (key, val) in &manifest.launch.env {
        let resolved_val = if val.starts_with("bin/") || val.starts_with("gui/") {
            runtime_dir.join(val).to_string_lossy().to_string()
        } else {
            val.replace("{guiPort}", &gui_port_str)
                .replace("{gatewayPort}", &gw_port_str)
        };
        cmd.env(key, &resolved_val);
    }

    // 注入 models.yaml 中的 API Key 为环境变量
    let models_path = PathBuf::from(&data_base).join("config").join("models.yaml");
    if models_path.exists() {
        if let Some(raw) = crate::commands::gateway::read_models_yaml_raw_utf8_or_utf16(&models_path) {
            let raw = raw.strip_prefix('\u{feff}').unwrap_or(raw.as_str());
            if let Ok(doc) = serde_yaml::from_str::<serde_yaml::Value>(raw) {
                let cipher_key = crate::services::cipher::get_or_create_cipher_key_sync(&data_base).ok();
                // 遍历所有 providers，提取 api_key，设置为对应的环境变量
                if let Some(providers) = doc.get("providers").and_then(|v| v.as_mapping()) {
                    for (provider_key, provider_val) in providers {
                        let pid = provider_key.as_str().unwrap_or("");
                        if let Some(api_key) = provider_val.get("api_key").and_then(|v| v.as_str()) {
                            let key = if api_key.starts_with("enc:") {
                                if let Some(ref ck) = cipher_key {
                                    crate::services::cipher::decrypt_credential(api_key, ck)
                                        .unwrap_or_else(|| api_key.to_string())
                                } else {
                                    api_key.to_string()
                                }
                            } else {
                                api_key.to_string()
                            };
                            if !key.is_empty() {
                                if let Some(env_name) = hermes_provider_api_key_env_var(pid) {
                                    cmd.env(env_name, &key);
                                }
                            }
                        }
                    }
                }
                // 同时设置默认模型的 key
                if let Some(key) = hermes_default_model_api_key(&data_base) {
                    if let Some(provider) = hermes_default_model_provider(&data_base) {
                        if let Some(env_name) = hermes_provider_api_key_env_var(&provider) {
                            cmd.env(env_name, &key);
                        }
                    }
                }
            }
        }
    }

    // 无限画布: 使用模块私有数据目录 + 共享 models 投影结果
    if runtime_id == "infinite_canvas" {
        let module_root = PathBuf::from(&data_base).join("modules").join("infinite_canvas");
        cmd.env("INFINITE_CANVAS_HOME", &module_root);
        cmd.env("INFINITE_CANVAS_DATA", module_root.join("data"));
        cmd.env("INFINITE_CANVAS_ASSETS", module_root.join("assets"));
        cmd.env("INFINITE_CANVAS_API_ENV", module_root.join("API").join(".env"));
        cmd.env(
            "INFINITE_CANVAS_ROUTES_FILE",
            module_root.join("config").join("model_routes.json"),
        );
        // 兼容原项目部分读取路径
        cmd.env("API_PROVIDERS_FILE", module_root.join("config").join("api_providers.json"));
        if let Ok(env_content) = std::fs::read_to_string(module_root.join("API").join(".env")) {
            for line in env_content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((key, val)) = line.split_once('=') {
                    let key = key.trim();
                    let val = val.trim().trim_matches('"').trim_matches('\'');
                    // 端口由启动器统一分配，禁止被模块 .env 覆盖。
                    if key.eq_ignore_ascii_case("PORT")
                        || key.eq_ignore_ascii_case("INFINITE_CANVAS_PORT")
                    {
                        continue;
                    }
                    if !key.is_empty() && !val.is_empty() {
                        cmd.env(key, val);
                    }
                }
            }
        }
        // 最后强制写入分配端口，确保监听正确端口且不抢占其他服务
        cmd.env("INFINITE_CANVAS_PORT", gui_port.to_string());
        cmd.env("PORT", gui_port.to_string());
    }

    // Hermes: 注入 .env 环境变量（渠道凭证等）
    if runtime_id == "hermes" {
        let env_path = PathBuf::from(&data_base).join("modules").join("hermes").join(".env");
        if let Ok(env_content) = std::fs::read_to_string(&env_path) {
            for line in env_content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') { continue; }
                if let Some((key, val)) = line.split_once('=') {
                    let key = key.trim();
                    let val = val.trim().trim_matches('"').trim_matches('\'');
                    if !key.is_empty() && !val.is_empty() {
                        cmd.env(key, val);
                        info!("hermes env from .env: {}=<set>", key);
                    }
                }
            }
        }
    }

    // Windows: prevent CMD/console window popup for python.exe and similar CUI binaries.
    // CREATE_NO_WINDOW alone still flashes a console on some Python builds; combine with DETACHED_PROCESS.
    #[cfg(windows)]
    {
        cmd.creation_flags(NO_WINDOW | DETACHED_PROCESS);
    }

    let mut child = cmd.spawn().map_err(|e| {
        let msg = format!("spawn failed: cmd={} cwd={:?} err={}",
            manifest.launch.command, cwd, e);
        let _ = std::fs::write(&log_path, &msg);
        msg
    })?;
    let pid = child.id();
    info!("spawned PID {} log={}", pid, log_path.display());

    // 等待健康检查就绪
    let health_url = manifest
        .launch
        .health_url
        .replace("{guiPort}", &gui_port.to_string());
    let timeout = Duration::from_millis(manifest.launch.ready_timeout_ms);

    let ready = wait_for_health(&health_url, timeout).await;

    if !ready {
        // Health check failed: kill child, log diagnostics, return error
        warn!("health check failed for {}, killing child PID {}", runtime_id, pid);
        if let Ok(log_content) = std::fs::read_to_string(&log_path) {
            warn!("hermes log ({}B): {}", log_content.len(),
                  if log_content.len() > 500 { &log_content[..500] } else { &log_content });
        }
        match child.try_wait() {
            Ok(Some(status)) => warn!("process already exited: {}", status),
            Ok(None) => {
                warn!("process still alive, killing...");
                let _ = child.kill();
                let _ = child.wait();
            }
            Err(e) => warn!("process status err: {}", e),
        }
        return Err(format!(
            "启动失败：健康检查超时 ({}s)。请查看日志 {}",
            manifest.launch.ready_timeout_ms / 1000,
            log_path.display()
        ));
    }

    let hermes_gateway = if runtime_id == "hermes" {
        let gateway_log_path = runtime_log_path(&data_base, "hermes")
            .parent()
            .map(|parent| parent.join("gateway-run.log"))
            .unwrap_or_else(|| PathBuf::from(&data_base).join("logs").join("gateway-run.log"));
        match spawn_hermes_gateway_sidecar(&launch_cmd, &cwd, &data_base, &gateway_log_path) {
            Ok(child) => {
                info!("spawned Hermes platform gateway PID {} log={}", child.id(), gateway_log_path.display());
                Some(child)
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        }
    } else {
        None
    };

    // Health check passed: save process to state
    let pid = child.id();
    ensure_state();
    {
        let mut state = get_state();
        if let Some(ref mut s) = *state {
            s.processes.insert(runtime_id.clone(), child);
            if let Some(gateway) = hermes_gateway {
                s.sidecar_processes.insert(runtime_id.clone(), gateway);
            }
            s.module_ports
                .insert(runtime_id.clone(), (gui_port, gateway_port));
        }
    }

    let instance = RuntimeInstance {
        id: runtime_id.clone(),
        name: manifest.name,
        description: manifest.description,
        version: manifest.version,
        icon: manifest.icon,
        category: manifest.category,
        capabilities: manifest.capabilities,
        gui_type: manifest.gui.gui_type,
        gui_url,
        gui_port,
        gateway_port,
        running: true,
        pid: Some(pid),
        started_at: Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        ),
    };

    // Update state
    {
        let mut state = get_state();
        if let Some(ref mut s) = *state {
            s.instances.insert(runtime_id.clone(), instance.clone());
        }
    }

    Ok(instance)
}

/// 停止指定运行时模块
#[tauri::command]
pub async fn stop_runtime(
    _data_dir: tauri::State<'_, crate::AppState>,
    runtime_id: String,
) -> Result<(), String> {
    ensure_state();
    let mut external_pid: Option<u32> = None;
    {
        let mut state = get_state();
        if let Some(ref mut s) = *state {
            if let Some(mut child) = s.processes.remove(&runtime_id) {
                info!("停止运行时: {} (本进程)", runtime_id);
                let _ = child.kill();
                let _ = child.wait();
            } else if let Some(inst) = s.instances.get(&runtime_id) {
                // 外部启动的 runtime：按 PID 终止
                if let Some(pid) = inst.pid {
                    external_pid = Some(pid);
                }
            }
            if let Some(mut child) = s.sidecar_processes.remove(&runtime_id) {
                info!("stopping runtime sidecar {}", runtime_id);
                let _ = child.kill();
                let _ = child.wait();
            }
            s.module_ports.remove(&runtime_id);
            if let Some(inst) = s.instances.get_mut(&runtime_id) {
                inst.running = false;
                inst.pid = None;
                inst.started_at = None;
            }
        }
    }
    if let Some(pid) = external_pid {
        info!("停止运行时: {} (外部进程 PID={})", runtime_id, pid);
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .output();
    }
    Ok(())
}

/// 获取单个运行时状态
#[tauri::command]
pub fn get_runtime_status(
    _data_dir: tauri::State<'_, crate::AppState>,
    runtime_id: String,
) -> Result<RuntimeInstance, String> {
    get_runtime_status_by_id(&runtime_id)
}

pub fn get_runtime_status_by_id(runtime_id: &str) -> Result<RuntimeInstance, String> {
    ensure_state();
    let state = get_state();
    if let Some(ref s) = *state {
        if let Some(inst) = s.instances.get(runtime_id) {
            return Ok(inst.clone());
        }
    }
    Err(format!("运行时 '{}' 未注册", runtime_id))
}

// ── 内部辅助函数 ──

fn is_port_free(port: u16) -> bool {
    if port == 0 {
        return true;
    }
    // 能 bind 说明当前空闲；连不上也可能是被占用但拒绝连接，这里以 bind 为准。
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn port_owned_by_other_module(runtime_id: &str, port: u16) -> bool {
    if port == 0 {
        return false;
    }
    ensure_state();
    let state = get_state();
    if let Some(ref s) = *state {
        for (id, (gui, gw)) in &s.module_ports {
            if id != runtime_id && (*gui == port || *gw == port) {
                return true;
            }
        }
        for (id, inst) in &s.instances {
            if id != runtime_id && inst.running && (inst.gui_port == port || inst.gateway_port == port) {
                return true;
            }
        }
    }
    false
}

fn pick_free_port(runtime_id: &str, preferred: u16, range_end: u16) -> Result<u16, String> {
    if preferred == 0 {
        return Ok(0);
    }
    let end = range_end.max(preferred);
    for port in preferred..=end {
        if port_owned_by_other_module(runtime_id, port) {
            continue;
        }
        if is_port_free(port) {
            return Ok(port);
        }
    }
    Err(format!(
        "模块 {} 在端口区间 {}-{} 内无可用端口",
        runtime_id, preferred, end
    ))
}

fn allocate_ports(runtime_id: &str, manifest: &RuntimeManifest) -> Result<(u16, u16), String> {
    // 优先复用本模块已分配且仍可用的端口，避免启动后端口漂移。
    ensure_state();
    {
        let state = get_state();
        if let Some(ref s) = *state {
            if let Some((gui, gw)) = s.module_ports.get(runtime_id) {
                let gui_ok = *gui == 0 || (!port_owned_by_other_module(runtime_id, *gui) && is_port_free(*gui));
                let _gw_ok = *gw == 0 || (!port_owned_by_other_module(runtime_id, *gw) && is_port_free(*gw));
                // 若端口仍被本模块旧进程占用，后续 start 流程会清理；这里直接复用固定端口。
                if *gui == manifest.ports.gui.default || gui_ok {
                    return Ok((*gui, *gw));
                }
            }
        }
    }

    // 各模块使用自身默认端口，不再按“已启动模块数”整体偏移，避免无限画布抢到 Hermes/OpenClaw 端口。
    let base_gui = manifest.ports.gui.default;
    let base_gw = manifest.ports.gateway.default;
    let gui_end = manifest
        .ports
        .gui
        .range
        .as_ref()
        .and_then(|r| r.get(1).copied())
        .unwrap_or_else(|| base_gui.saturating_add(20));
    let gw_end = if base_gw == 0 {
        0
    } else {
        manifest
            .ports
            .gateway
            .range
            .as_ref()
            .and_then(|r| r.get(1).copied())
            .unwrap_or_else(|| base_gw.saturating_add(20))
    };

    let gui_port = pick_free_port(runtime_id, base_gui, gui_end)?;
    let gateway_port = if base_gw == 0 {
        0
    } else {
        // gateway 不能与 gui 撞车
        let mut chosen = None;
        for port in base_gw..=gw_end {
            if port == gui_port || port_owned_by_other_module(runtime_id, port) {
                continue;
            }
            if is_port_free(port) {
                chosen = Some(port);
                break;
            }
        }
        chosen.ok_or_else(|| {
            format!(
                "模块 {} 的 gateway 端口区间 {}-{} 内无可用端口",
                runtime_id, base_gw, gw_end
            )
        })?
    };

    Ok((gui_port, gateway_port))
}

async fn wait_for_health(url: &str, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;

    info!("health check HTTP: {} timeout={}s", url, timeout.as_secs());

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            warn!("failed to build http client: {}", e);
            return false;
        }
    };

    while Instant::now() < deadline {
        match client.get(url).send().await {
            Ok(resp) => {
                // Any HTTP response means the server is truly serving
                info!("health check PASSED: {} status={}", url, resp.status().as_u16());
                return true;
            }
            Err(e) => {
                let err_str = e.to_string();
                let is_connection_refused = err_str.contains("Connection refused")
                    || err_str.contains("connection refused")
                    || err_str.contains("tcp connect error");
                if !is_connection_refused {
                    // Log unexpected errors but keep retrying
                    warn!("health check attempt error: {} — {}", url, err_str);
                }
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining > Duration::from_millis(500) {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                } else if remaining > Duration::ZERO {
                    tokio::time::sleep(remaining).await;
                } else {
                    break;
                }
            }
        }
    }
    warn!("health check TIMEOUT: {}", url);
    false
}

/// 递归复制目录（用于从已有安装复制 Hermes 运行环境）
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    if !dst.exists() {
        std::fs::create_dir_all(dst)?;
    }
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

/// Hermes 运行时安装：从内置包解压到数据目录（带进度事件）
#[tauri::command]
pub async fn install_hermes_runtime(
    app: tauri::AppHandle,
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    let data_base = data_dir.inner().get_data_dir();
    let runtime_dir = std::path::PathBuf::from(&data_base).join("runtimes").join("hermes");
    let _ = std::fs::create_dir_all(&runtime_dir);

    let emit = |stage: &str, status: &str, percent: Option<f64>, msg: &str| {
        let _ = app.emit("install-progress", crate::mirror::InstallProgressEvent {
            stage: stage.to_string(),
            status: status.to_string(),
            percent,
            message: msg.to_string(),
        });
    };

    // 查找内置包（或从已有安装复制）
    let zip_candidates = [
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bundled-hermes"),
        std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join("bundled-hermes"))).unwrap_or_default(),
        std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join("resources").join("bundled-hermes"))).unwrap_or_default(),
    ];

    // 若无内置包，尝试从已有安装目录复制（开发模式常用）
    if !zip_candidates.iter().any(|p| p.is_dir()) {
        // 搜索可能的已有 Hermes 安装（项目源树、发布版数据目录、生产安装）
        let exe_dir = std::env::current_exe().ok()
            .and_then(|e| e.parent().map(|p| p.to_path_buf()))
            .unwrap_or_default();
        let existing_hermes = exe_dir.ancestors()
            .find_map(|a| {
                // src-tauri/runtimes/hermes (源 树) 或 target/.../data/runtimes/hermes (发布版)
                for sub in &["runtimes", "data/runtimes"] {
                    let candidate = a.join(sub).join("hermes");
                    if candidate.join("python").join("python.exe").exists()
                        && candidate.join("hermes_cli").join("main.py").exists()
                    { return Some(candidate); }
                }
                None
            });
        // Also check common production install paths
        let prod_candidates = [
            std::path::PathBuf::from(r"D:\快泛claw\data\runtimes\hermes"),
            std::path::PathBuf::from(r"D:\快泛claw\runtimes\hermes"),
        ];
        let prod_source = prod_candidates.iter().find(|p|
            p.join("python").join("python.exe").exists()
            && p.join("hermes_cli").join("main.py").exists()
        );
        let source = existing_hermes.as_ref()
            .or(prod_source);

        if let Some(src) = source {
            emit("hermes", "started", Some(5.0), "从已有安装复制 Hermes 运行环境...");
            copy_dir_recursive(src, &runtime_dir)
                .map_err(|e| format!("复制 Hermes 运行环境失败: {}", e))?;
            emit("hermes", "finished", Some(100.0), "Hermes Agent 已从已有安装复制完成！");
            return Ok(format!("从已有安装复制完成: {}", runtime_dir.display()));
        }
        emit("hermes", "failed", None, "未找到内置包目录且无已有安装可复制");
        return Err("未找到内置包目录 bundled-hermes，且无已有 Hermes 安装可复制。请先通过安装包安装一次。".to_string());
    }

    let bundled_dir = zip_candidates.iter().find(|p| p.is_dir()).unwrap();

    emit("hermes", "started", Some(0.0), "开始安装 Hermes Agent ...");

    // Step 1: 解压 python.zip (~54MB, ~6500 files)
    let python_zip = bundled_dir.join("python.zip");
    let python_dir = runtime_dir.join("python");
    if python_zip.is_file() {
        if !python_dir.join("python.exe").exists() {
            emit("hermes-python", "started", Some(5.0), "正在解压 Python 3.11.9 环境 (54MB)...");
            let data = std::fs::read(&python_zip).map_err(|e| format!("读取 python.zip: {}", e))?;
            let cursor = std::io::Cursor::new(data);
            let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("打开 python.zip: {}", e))?;
            let total = archive.len();
            for i in 0..total {
                let mut file = archive.by_index(i).map_err(|e| format!("读取 python.zip[{}]: {}", i, e))?;
                let path = python_dir.join(file.mangled_name());
                if file.is_dir() {
                    let _ = std::fs::create_dir_all(&path);
                } else {
                    if let Some(p) = path.parent() { let _ = std::fs::create_dir_all(p); }
                    let mut out = std::fs::File::create(&path).map_err(|e| format!("创建 {}: {}", path.display(), e))?;
                    std::io::copy(&mut file, &mut out).map_err(|e| format!("写入 {}: {}", path.display(), e))?;
                }
                if i % 500 == 0 {
                    let pct = 5.0 + (i as f64 / total as f64) * 40.0;
                    emit("hermes-python", "progress", Some(pct), &format!("Python: {}/{} 文件", i, total));
                }
            }
            emit("hermes-python", "finished", Some(45.0), "Python 3.11.9 解压完成");
        } else {
            emit("hermes-python", "finished", Some(45.0), "Python 已存在，跳过解压");
        }
    }

    // Step 2: 解压 hermes-agent.zip (~12MB)
    let hermes_zip = bundled_dir.join("hermes-agent.zip");
    if hermes_zip.is_file() {
        let version_marker = runtime_dir.join(".bundle_version");
        let existing_version = if version_marker.is_file() {
            std::fs::read_to_string(&version_marker).unwrap_or_default().trim().to_string()
        } else { String::new() };
        let expected_marker = hermes_agent_bundle_marker();
            let needs_extract = !runtime_dir.join("hermes_cli").join("main.py").exists()
                || existing_version.trim() != expected_marker;
        if needs_extract {
            emit("hermes-agent", "started", Some(50.0), "正在解压 Hermes Agent v0.18.2 (12MB)...");
            let data = std::fs::read(&hermes_zip).map_err(|e| format!("读取 hermes-agent.zip: {}", e))?;
            let cursor = std::io::Cursor::new(data);
            let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("打开 hermes-agent.zip: {}", e))?;
            let total = archive.len();
            for i in 0..total {
                let mut file = archive.by_index(i).map_err(|e| format!("读取 hermes-agent.zip[{}]: {}", i, e))?;
                let path = runtime_dir.join(file.mangled_name());
                if file.is_dir() {
                    let _ = std::fs::create_dir_all(&path);
                } else {
                    if let Some(p) = path.parent() { let _ = std::fs::create_dir_all(p); }
                    let mut out = std::fs::File::create(&path).map_err(|e| format!("创建 {}: {}", path.display(), e))?;
                    std::io::copy(&mut file, &mut out).map_err(|e| format!("写入 {}: {}", path.display(), e))?;
                }
                if i % 300 == 0 {
                    let pct = 50.0 + (i as f64 / total as f64) * 45.0;
                    emit("hermes-agent", "progress", Some(pct), &format!("Hermes: {}/{} 文件", i, total));
                }
            }
            emit("hermes-agent", "finished", Some(95.0), "Hermes Agent 解压完成");

            // 写入版本标记：下次安装若标记与本版本一致且 main.py 仍在则跳过解压。
            let _ = std::fs::write(&version_marker, format!("{}\n", expected_marker));
        } else {
            emit("hermes-agent", "finished", Some(95.0), "Hermes Agent 已存在，跳过解压");
        }
    }

    emit("hermes", "finished", Some(100.0), "Hermes Agent 安装完成！可在首页启动");

    ensure_hermes_browser_home(&data_base)?;
    Ok(format!("安装完成: {}", runtime_dir.display()))
}use crate::env_paths::{build_deps_env_path, ensure_managed_tool_path, env_root, resolve_git_bash};

