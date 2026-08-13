use serde::{Deserialize, Serialize};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use toml_edit::{value, DocumentMut, Item, Table};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub const KUAIFAN_UPSTREAM: &str = "https://kuaifanio.cn/v1";
pub const CODEX_PROXY_BASE: &str = "http://127.0.0.1:57321/v1";
const KUAIFAN_PROFILE_ID: &str = "kuaifan";
const KUAIFAN_RUNTIME_DEFAULTS_VERSION: i64 = 4;
const BUNDLED_MARKETPLACE: &str = "openai-bundled";
/// Required control plugins that must appear in the rebuilt marketplace.
const REQUIRED_BUNDLED_MARKETPLACE_PLUGINS: &[&str] = &["browser", "chrome", "computer-use"];
/// Optional plugins included when present in the local Codex cache.
const OPTIONAL_BUNDLED_MARKETPLACE_PLUGINS: &[&str] = &["latex", "visualize"];
const CONTROL_PLUGINS: &[&str] = &[
    "browser@openai-bundled",
    "chrome@openai-bundled",
    "computer-use@openai-bundled",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexKuaifanRequest {
    pub api_key: String,
    pub model: String,
    #[serde(default)]
    pub model_list: Vec<String>,
}

impl CodexKuaifanRequest {
    fn validate(&self) -> Result<(), String> {
        if self.api_key.trim().is_empty() {
            return Err("请先填写快泛 API Key".to_string());
        }
        if self.model.trim().is_empty() {
            return Err("请先选择 Codex 默认模型".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexRuntimeStatus {
    pub runtime_available: bool,
    pub runtime_path: Option<String>,
    pub runtime_running: bool,
    pub launch_requested: bool,
    pub launch_error: Option<String>,
    pub configured: bool,
    pub configured_model: Option<String>,
    pub config_path: String,
    pub settings_path: String,
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexManagerPreferences {
    pub provider_sync_enabled: bool,
    pub enhancements_enabled: bool,
    pub computer_use_guard_enabled: bool,
    pub codex_app_plugin_marketplace_unlock: bool,
    pub codex_app_plugin_auto_expand: bool,
    pub codex_app_model_whitelist_unlock: bool,
    pub codex_app_service_tier_controls: bool,
    pub codex_app_session_delete: bool,
    pub codex_app_markdown_export: bool,
    pub codex_app_paste_fix: bool,
    pub codex_app_project_move: bool,
    pub codex_app_thread_id_badge: bool,
    pub codex_app_conversation_view: bool,
    pub codex_app_thread_scroll_restore: bool,
    pub codex_app_zed_remote_open: bool,
    pub zed_remote_project_registry_enabled: bool,
    pub zed_remote_sync_to_zed_settings: bool,
    pub codex_app_upstream_worktree_create: bool,
    pub codex_app_force_chinese_locale: bool,
    pub codex_app_fast_startup: bool,
    pub codex_app_native_menu_placement: bool,
    pub codex_app_native_menu_localization: bool,
    pub codex_extra_args: Vec<String>,
}

impl Default for CodexManagerPreferences {
    fn default() -> Self {
        Self {
            provider_sync_enabled: false,
            enhancements_enabled: true,
            computer_use_guard_enabled: false,
            codex_app_plugin_marketplace_unlock: true,
            codex_app_plugin_auto_expand: true,
            codex_app_model_whitelist_unlock: true,
            codex_app_service_tier_controls: false,
            codex_app_session_delete: true,
            codex_app_markdown_export: true,
            codex_app_paste_fix: false,
            codex_app_project_move: true,
            codex_app_thread_id_badge: false,
            codex_app_conversation_view: false,
            codex_app_thread_scroll_restore: true,
            codex_app_zed_remote_open: true,
            zed_remote_project_registry_enabled: true,
            zed_remote_sync_to_zed_settings: false,
            codex_app_upstream_worktree_create: true,
            codex_app_force_chinese_locale: true,
            codex_app_fast_startup: false,
            codex_app_native_menu_placement: true,
            codex_app_native_menu_localization: true,
            codex_extra_args: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
struct CodexRuntimePaths {
    config_path: PathBuf,
    auth_path: PathBuf,
    settings_path: PathBuf,
    runtime_path: Option<PathBuf>,
}

impl CodexRuntimePaths {
    fn discover() -> Self {
        let codex_home = std::env::var_os("CODEX_HOME")
            .map(PathBuf::from)
            .or_else(|| dirs::home_dir().map(|home| home.join(".codex")))
            .unwrap_or_else(|| PathBuf::from(".codex"));
        let settings_path = dirs::home_dir()
            .map(|home| home.join(".codex-session-delete").join("settings.json"))
            .unwrap_or_else(|| PathBuf::from(".codex-session-delete").join("settings.json"));
        Self {
            config_path: codex_home.join("config.toml"),
            auth_path: codex_home.join("auth.json"),
            settings_path,
            runtime_path: first_existing_runtime(&runtime_candidates()),
        }
    }
}

#[derive(Debug)]
struct BackupSnapshot {
    directory: PathBuf,
    files: Vec<(PathBuf, Option<Vec<u8>>)>,
}

impl BackupSnapshot {
    fn restore(&self) -> Result<(), String> {
        for (path, contents) in &self.files {
            match contents {
                Some(contents) => atomic_write(path, contents)?,
                None => match fs::remove_file(path) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(format!("恢复 {} 失败: {error}", path.display())),
                },
            }
        }
        Ok(())
    }
}

#[tauri::command]
pub fn get_codex_runtime_status() -> CodexRuntimeStatus {
    runtime_status(&CodexRuntimePaths::discover(), false, None, None)
}

#[tauri::command]
pub fn get_codex_manager_preferences() -> Result<CodexManagerPreferences, String> {
    let paths = CodexRuntimePaths::discover();
    manager_preferences_from_value(&read_optional_json(&paths.settings_path)?)
}

#[tauri::command]
pub fn save_codex_manager_preferences(
    request: CodexManagerPreferences,
) -> Result<CodexManagerPreferences, String> {
    let paths = CodexRuntimePaths::discover();
    let existing = read_optional_json(&paths.settings_path)?;
    // Manager saves must also keep Kuaifan Chinese defaults and --lang=zh-CN.
    let updated = ensure_kuaifan_runtime_settings(merge_manager_preferences(existing, &request)?)?;
    let snapshot = backup_live_files(&paths)?;
    let contents = serde_json::to_vec_pretty(&updated)
        .map_err(|error| format!("序列化 Codex++ 管理设置失败: {error}"))?;

    if let Err(error) = atomic_write(&paths.settings_path, &contents) {
        let restore_error = snapshot.restore().err();
        return Err(match restore_error {
            Some(restore_error) => format!("{error}；配置回滚失败: {restore_error}"),
            None => error,
        });
    }

    manager_preferences_from_value(&updated)
}

#[tauri::command]
pub fn save_and_launch_codex_kuaifan(
    request: CodexKuaifanRequest,
) -> Result<CodexRuntimeStatus, String> {
    request.validate()?;
    let paths = CodexRuntimePaths::discover();
    let runtime = paths
        .runtime_path
        .as_ref()
        .ok_or_else(|| "未检测到 codex-plus-plus.exe，请先安装 Codex++".to_string())?;

    let current_config = read_optional_text(&paths.config_path)?;
    let current_auth = read_optional_text(&paths.auth_path)?;
    let current_settings = read_optional_json(&paths.settings_path)?;
    let config = prepare_kuaifan_control_config(
        &merge_codex_config(&current_config, request.model.trim())?,
        paths.config_path.parent().unwrap_or_else(|| Path::new(".")),
    )?;
    let auth = merge_codex_auth(&current_auth, request.api_key.trim())?;
    let model_list = normalized_model_list(&request.model_list, request.model.trim());
    let settings = ensure_kuaifan_runtime_settings(with_profile_files(
        upsert_kuaifan_profile(
            current_settings,
            request.api_key.trim(),
            request.model.trim(),
            &model_list,
        )?,
        &config,
        &auth,
    )?)?;
    let snapshot = backup_live_files(&paths)?;

    let write_result = (|| {
        atomic_write(&paths.config_path, config.as_bytes())?;
        atomic_write(&paths.auth_path, auth.as_bytes())?;
        let settings_json = serde_json::to_vec_pretty(&settings)
            .map_err(|error| format!("序列化 Codex++ 配置失败: {error}"))?;
        atomic_write(&paths.settings_path, &settings_json)?;
        Ok(())
    })();

    if let Err(error) = write_result {
        let restore_error = snapshot.restore().err();
        return Err(match restore_error {
            Some(restore_error) => format!("{error}；配置回滚失败: {restore_error}"),
            None => error,
        });
    }

    // Launch/restart Codex++ off the Tauri command thread so the UI stays responsive.
    // Configuration has already been written; elevated UAC prompts or process stop waits
    // must not freeze kuaifanclaw.
    let runtime_path = runtime.clone();
    let runtime_was_running = is_runtime_running();
    std::thread::spawn(move || {
        if let Err(error) = restart_runtime(&runtime_path, runtime_was_running) {
            eprintln!("[codex] background launch failed: {error}");
        }
    });

    Ok(runtime_status(
        &paths,
        true,
        Some(snapshot.directory.to_string_lossy().to_string()),
        None,
    ))
}

fn runtime_status(
    paths: &CodexRuntimePaths,
    launch_requested: bool,
    backup_path: Option<String>,
    launch_error: Option<String>,
) -> CodexRuntimeStatus {
    let configured_model = configured_model(&paths.config_path);
    CodexRuntimeStatus {
        runtime_available: paths.runtime_path.is_some(),
        runtime_path: paths
            .runtime_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        runtime_running: is_runtime_running(),
        launch_requested,
        launch_error,
        configured: is_codex_configured(&paths.config_path, &paths.auth_path),
        configured_model,
        config_path: paths.config_path.to_string_lossy().to_string(),
        settings_path: paths.settings_path.to_string_lossy().to_string(),
        backup_path,
    }
}


fn ensure_chinese_launch_args(root: &mut Map<String, Value>) {
    let mut args: Vec<String> = root
        .get("codexExtraArgs")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    // Drop previous language switches so we always pin zh-CN for Kuaifan launches.
    args.retain(|arg| {
        let lower = arg.to_ascii_lowercase();
        !(lower == "--lang" || lower.starts_with("--lang=") || lower.starts_with("--lang "))
    });
    args.insert(0, "--lang=zh-CN".to_string());

    // Keep a single --lang entry and preserve other managed extra args.
    let mut seen = HashSet::new();
    args = args
        .into_iter()
        .filter(|arg| seen.insert(arg.clone()))
        .collect();

    root.insert(
        "codexExtraArgs".to_string(),
        Value::Array(args.into_iter().map(Value::String).collect()),
    );
}

fn runtime_candidates() -> Vec<PathBuf> {
    let application = std::env::current_exe().ok();
    runtime_candidates_for(application.as_deref())
}

fn runtime_candidates_for(application: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    // Optional override for packaging tests only. Do not fall back to independent
    // D:\Codex++ installs — those are a separate product from 快泛claw's bundled runtime.
    if let Some(path) = std::env::var_os("KUAIFAN_CODEX_PLUS_PLUS_PATH") {
        candidates.push(PathBuf::from(path));
    }
    if let Some(executable) = application {
        if let Some(parent) = executable.parent() {
            // Installer layouts: resource beside exe, or under resources/.
            candidates.push(parent.join("bundled-codex").join("codex-plus-plus.exe"));
            candidates.push(
                parent
                    .join("resources")
                    .join("bundled-codex")
                    .join("codex-plus-plus.exe"),
            );
            candidates.push(parent.join("resources").join("codex-plus-plus.exe"));
            candidates.push(parent.join("resources").join("codex-plus-plus").join("codex-plus-plus.exe"));
            candidates.push(parent.join("codex-plus-plus.exe"));
            // cargo run --release from src-tauri/target/release
            candidates.push(
                parent
                    .join("..")
                    .join("..")
                    .join("bundled-codex")
                    .join("codex-plus-plus.exe"),
            );
            // cargo run from src-tauri/target/debug
            candidates.push(
                parent
                    .join("..")
                    .join("..")
                    .join("..")
                    .join("bundled-codex")
                    .join("codex-plus-plus.exe"),
            );
        }
    }
    candidates
}

pub fn first_existing_runtime(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.is_file()).cloned()
}

fn merge_codex_config(existing: &str, model: &str) -> Result<String, String> {
    let mut document = existing
        .trim_start_matches('\u{feff}')
        .parse::<DocumentMut>()
        .map_err(|error| format!("Codex config.toml 格式错误，未写入: {error}"))?;
    document["model"] = value(model);
    document["model_provider"] = value("custom");

    if document.get("model_providers").is_none() {
        document["model_providers"] = toml_edit::table();
    }
    let providers = document["model_providers"]
        .as_table_mut()
        .ok_or_else(|| "Codex config.toml 的 model_providers 必须是表".to_string())?;
    if !providers.contains_key("custom") {
        providers.insert("custom", Item::Table(toml_edit::Table::new()));
    }
    let custom = providers["custom"]
        .as_table_mut()
        .ok_or_else(|| "Codex config.toml 的 model_providers.custom 必须是表".to_string())?;
    custom["name"] = value("custom");
    custom["wire_api"] = value("responses");
    custom["requires_openai_auth"] = value(true);
    custom["base_url"] = value(CODEX_PROXY_BASE);
    ensure_control_plugin_configuration(&mut document)?;

    Ok(ensure_newline(document.to_string()))
}

fn prepare_kuaifan_control_config(config: &str, codex_home: &Path) -> Result<String, String> {
    let mut document = config
        .trim_start_matches('\u{feff}')
        .parse::<DocumentMut>()
        .map_err(|error| format!("Codex config.toml 格式错误，未写入: {error}"))?;
    ensure_control_plugin_configuration(&mut document)?;
    if let Some(marketplace_path) = ensure_openai_bundled_marketplace(&document, codex_home)? {
        ensure_openai_bundled_marketplace_config(&mut document, &marketplace_path)?;
    }
    Ok(ensure_newline(document.to_string()))
}

fn ensure_control_plugin_configuration(document: &mut DocumentMut) -> Result<(), String> {
    let features = toml_table_mut_or_insert(document, "features")?;
    features["js_repl"] = value(true);

    for plugin in CONTROL_PLUGINS {
        let plugins = toml_table_mut_or_insert(document, "plugins")?;
        if plugins.get(plugin).and_then(Item::as_table).is_none() {
            plugins[plugin] = toml_edit::table();
        }
        plugins[plugin]["enabled"] = value(true);
    }
    Ok(())
}

fn toml_table_mut_or_insert<'a>(
    document: &'a mut DocumentMut,
    key: &str,
) -> Result<&'a mut Table, String> {
    if document.get(key).and_then(Item::as_table).is_none() {
        document[key] = toml_edit::table();
    }
    document
        .get_mut(key)
        .and_then(Item::as_table_mut)
        .ok_or_else(|| format!("Codex config.toml 的 {key} 必须是表"))
}

fn ensure_openai_bundled_marketplace(
    document: &DocumentMut,
    codex_home: &Path,
) -> Result<Option<PathBuf>, String> {
    if let Some(configured) = configured_openai_bundled_marketplace(document) {
        if is_complete_openai_bundled_marketplace(&configured) {
            return Ok(Some(configured));
        }
    }

    let active = codex_home
        .join(".tmp")
        .join("bundled-marketplaces")
        .join(BUNDLED_MARKETPLACE);
    if is_complete_openai_bundled_marketplace(&active) {
        return Ok(Some(active));
    }
    if !cached_openai_bundled_marketplace_is_complete(codex_home) {
        return Ok(None);
    }

    let parent = active
        .parent()
        .ok_or_else(|| "Codex 内置插件市场路径无效".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("创建 Codex 内置插件市场目录失败: {error}"))?;
    let staging = parent.join(format!(
        "{BUNDLED_MARKETPLACE}.kuaifan-staging-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("创建插件市场时间戳失败: {error}"))?
            .as_millis()
    ));
    build_openai_bundled_marketplace_from_cache(codex_home, &staging)?;

    if active.exists() {
        let backup = active.with_file_name(format!(
            "{BUNDLED_MARKETPLACE}.kuaifan-backup-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|error| format!("创建插件市场时间戳失败: {error}"))?
                .as_millis()
        ));
        if fs::rename(&active, &backup).is_err() {
            return Ok(Some(staging));
        }
    }
    fs::rename(&staging, &active)
        .map_err(|error| format!("激活 Codex 内置插件市场失败: {error}"))?;
    Ok(Some(active))
}

fn configured_openai_bundled_marketplace(document: &DocumentMut) -> Option<PathBuf> {
    let source = document
        .get("marketplaces")?
        .as_table()?
        .get(BUNDLED_MARKETPLACE)?
        .as_table()?
        .get("source")?
        .as_str()?;
    Some(PathBuf::from(source.strip_prefix(r"\\?\").unwrap_or(source)))
}

fn is_complete_openai_bundled_marketplace(path: &Path) -> bool {
    path.join(".agents")
        .join("plugins")
        .join("marketplace.json")
        .is_file()
        && REQUIRED_BUNDLED_MARKETPLACE_PLUGINS.iter().all(|plugin| {
            path.join("plugins")
                .join(plugin)
                .join(".codex-plugin")
                .join("plugin.json")
                .is_file()
        })
}

fn cached_openai_bundled_marketplace_is_complete(codex_home: &Path) -> bool {
    REQUIRED_BUNDLED_MARKETPLACE_PLUGINS
        .iter()
        .all(|plugin| latest_cached_plugin_version(codex_home, plugin).is_some())
}

fn latest_cached_plugin_version(codex_home: &Path, plugin: &str) -> Option<PathBuf> {
    let root = codex_home
        .join("plugins")
        .join("cache")
        .join(BUNDLED_MARKETPLACE);
    if !root.is_dir() {
        return None;
    }

    let mut candidates = Vec::new();
    collect_cached_plugin_versions(&root, plugin, 0, &mut candidates);
    candidates.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    candidates.into_iter().map(|(path, _)| path).next()
}

fn collect_cached_plugin_versions(
    directory: &Path,
    plugin: &str,
    depth: usize,
    candidates: &mut Vec<(PathBuf, String)>,
) {
    if depth > 6 {
        return;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();

        // Nested install layout: .../plugin-install-xxx/browser/<version>
        if name == plugin {
            let mut version_dirs = fs::read_dir(&path)
                .ok()
                .into_iter()
                .flatten()
                .flatten()
                .map(|entry| entry.path())
                .filter(|candidate| candidate.join(".codex-plugin").join("plugin.json").is_file())
                .collect::<Vec<_>>();
            if version_dirs.is_empty() && path.join(".codex-plugin").join("plugin.json").is_file() {
                version_dirs.push(path.clone());
            }
            for version_dir in version_dirs {
                let version = version_dir
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_string();
                candidates.push((version_dir, version));
            }
        }

        // Direct layout: .../browser/<version>
        if path.join(".codex-plugin").join("plugin.json").is_file() {
            let parent_name = path
                .parent()
                .and_then(|parent| parent.file_name())
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if parent_name == plugin {
                let version = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_string();
                candidates.push((path.clone(), version));
            }
        }

        collect_cached_plugin_versions(&path, plugin, depth + 1, candidates);
    }
}

fn available_bundled_marketplace_plugins(codex_home: &Path) -> Vec<&'static str> {
    let mut plugins = Vec::new();
    for plugin in REQUIRED_BUNDLED_MARKETPLACE_PLUGINS
        .iter()
        .chain(OPTIONAL_BUNDLED_MARKETPLACE_PLUGINS.iter())
    {
        if latest_cached_plugin_version(codex_home, plugin).is_some() {
            plugins.push(*plugin);
        }
    }
    plugins
}

fn build_openai_bundled_marketplace_from_cache(
    codex_home: &Path,
    staging: &Path,
) -> Result<(), String> {
    let plugins = available_bundled_marketplace_plugins(codex_home);
    for plugin in REQUIRED_BUNDLED_MARKETPLACE_PLUGINS {
        if !plugins.contains(plugin) {
            return Err(format!("missing Codex bundled plugin cache: {plugin}"));
        }
    }

    let plugins_directory = staging.join("plugins");
    fs::create_dir_all(staging.join(".agents").join("plugins"))
        .map_err(|error| format!("create Codex marketplace directory failed: {error}"))?;
    fs::create_dir_all(&plugins_directory)
        .map_err(|error| format!("create Codex plugins directory failed: {error}"))?;
    let marketplace = json!({
        "name": BUNDLED_MARKETPLACE,
        "interface": { "displayName": "OpenAI Bundled" },
        "plugins": plugins.iter().map(|name| json!({
            "name": name,
            "source": { "source": "local", "path": format!("./plugins/{name}") },
            "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" }
        })).collect::<Vec<_>>()
    });
    let contents = serde_json::to_vec_pretty(&marketplace)
        .map_err(|error| format!("serialize Codex marketplace failed: {error}"))?;
    fs::write(
        staging.join(".agents").join("plugins").join("marketplace.json"),
        contents,
    )
    .map_err(|error| format!("write Codex marketplace failed: {error}"))?;

    for plugin in plugins {
        let source = latest_cached_plugin_version(codex_home, plugin)
            .ok_or_else(|| format!("missing Codex bundled plugin cache: {plugin}"))?;
        copy_directory_recursively(&source, &plugins_directory.join(plugin))?;
    }
    Ok(())
}


fn copy_directory_recursively(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("创建 Codex 插件复制目录失败: {error}"))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("读取 Codex 插件缓存失败: {error}"))?
        .flatten()
    {
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_directory_recursively(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path)
                .map_err(|error| format!("复制 Codex 插件文件失败: {error}"))?;
        }
    }
    Ok(())
}

fn ensure_openai_bundled_marketplace_config(
    document: &mut DocumentMut,
    marketplace_path: &Path,
) -> Result<(), String> {
    let marketplaces = toml_table_mut_or_insert(document, "marketplaces")?;
    if marketplaces
        .get(BUNDLED_MARKETPLACE)
        .and_then(Item::as_table)
        .is_none()
    {
        marketplaces[BUNDLED_MARKETPLACE] = toml_edit::table();
    }
    marketplaces[BUNDLED_MARKETPLACE]["source_type"] = value("local");
    marketplaces[BUNDLED_MARKETPLACE]["source"] = value(windows_extended_path(marketplace_path));
    Ok(())
}

fn windows_extended_path(path: &Path) -> String {
    let path = path.to_string_lossy();
    if path.starts_with(r"\\?\") {
        path.into_owned()
    } else {
        format!(r"\\?\{path}")
    }
}

fn merge_codex_auth(existing: &str, api_key: &str) -> Result<String, String> {
    let mut auth = if existing.trim().is_empty() {
        Value::Object(Map::new())
    } else {
        serde_json::from_str(existing)
            .map_err(|error| format!("Codex auth.json 格式错误，未写入: {error}"))?
    };
    let object = auth
        .as_object_mut()
        .ok_or_else(|| "Codex auth.json 必须是 JSON 对象".to_string())?;
    object.insert("OPENAI_API_KEY".to_string(), Value::String(api_key.to_string()));
    serde_json::to_string_pretty(&auth)
        .map(ensure_newline)
        .map_err(|error| format!("序列化 Codex auth.json 失败: {error}"))
}

fn normalized_model_list(models: &[String], selected_model: &str) -> String {
    let mut seen = HashSet::new();
    std::iter::once(selected_model)
        .chain(models.iter().map(String::as_str))
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .filter(|model| seen.insert((*model).to_string()))
        .collect::<Vec<_>>()
        .join("\n")
}

fn upsert_kuaifan_profile(
    mut settings: Value,
    api_key: &str,
    model: &str,
    model_list: &str,
) -> Result<Value, String> {
    if settings.is_null() {
        settings = Value::Object(Map::new());
    }
    let root = settings
        .as_object_mut()
        .ok_or_else(|| "Codex++ settings.json 必须是 JSON 对象".to_string())?;
    root.insert("launchMode".to_string(), Value::String("relay".to_string()));
    root.insert("relayProfilesEnabled".to_string(), Value::Bool(true));
    root.insert("activeRelayId".to_string(), Value::String(KUAIFAN_PROFILE_ID.to_string()));
    root.insert("relayTestModel".to_string(), Value::String(model.to_string()));
    if !root.contains_key("relayProfiles") {
        root.insert("relayProfiles".to_string(), Value::Array(Vec::new()));
    }
    let profiles = root
        .get_mut("relayProfiles")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Codex++ settings.json 的 relayProfiles 必须是数组".to_string())?;
    let profile_index = profiles.iter().position(|profile| {
        profile
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| id == KUAIFAN_PROFILE_ID)
    });
    if profile_index.is_none() {
        profiles.push(Value::Object(Map::new()));
    }
    let profile_index = profile_index.unwrap_or_else(|| profiles.len() - 1);
    let profile = profiles[profile_index]
        .as_object_mut()
        .ok_or_else(|| "Codex++ 的 kuaifan 配置档必须是 JSON 对象".to_string())?;
    profile.insert("id".to_string(), Value::String(KUAIFAN_PROFILE_ID.to_string()));
    profile.insert("name".to_string(), Value::String("快泛 API".to_string()));
    profile.insert("upstreamBaseUrl".to_string(), Value::String(KUAIFAN_UPSTREAM.to_string()));
    profile.insert("apiKey".to_string(), Value::String(api_key.to_string()));
    profile.insert("protocol".to_string(), Value::String("chatCompletions".to_string()));
    profile.insert("relayMode".to_string(), Value::String("pureApi".to_string()));
    profile.insert("officialMixApiKey".to_string(), Value::Bool(false));
    profile.insert("testModel".to_string(), Value::String(model.to_string()));
    profile.insert("model".to_string(), Value::String(model.to_string()));
    profile.insert("modelList".to_string(), Value::String(model_list.to_string()));
    Ok(settings)
}

fn ensure_kuaifan_runtime_settings(mut settings: Value) -> Result<Value, String> {
    if settings.is_null() {
        settings = Value::Object(Map::new());
    }
    let root = settings
        .as_object_mut()
        .ok_or_else(|| "Codex++ settings.json must be a JSON object".to_string())?;
    let current_version = root
        .get("kuaifanRuntimeDefaultsVersion")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let migration_required = current_version < KUAIFAN_RUNTIME_DEFAULTS_VERSION;

    // Always ensure Chinese locale and marketplace unlocks for Kuaifan launches.
    let always_defaults = [
        ("enhancementsEnabled", true),
        ("codexAppPluginMarketplaceUnlock", true),
        ("codexAppPluginAutoExpand", true),
        ("codexAppForceChineseLocale", true),
        ("codexAppNativeMenuLocalization", true),
    ];
    for (key, enabled) in always_defaults {
        root.insert(key.to_string(), Value::Bool(enabled));
    }

    // Force Chromium/Electron language before renderer bootstrap. Post-load
    // localeOverride alone is not enough for Codex shell chrome on some builds.
    ensure_chinese_launch_args(root);

    // Computer-use guard is only force-enabled on first migration to avoid
    // clobbering an explicit later manager preference.
    if migration_required || !root.contains_key("computerUseGuardEnabled") {
        root.insert("computerUseGuardEnabled".to_string(), Value::Bool(true));
    }

    root.insert(
        "kuaifanRuntimeDefaultsVersion".to_string(),
        Value::Number(KUAIFAN_RUNTIME_DEFAULTS_VERSION.into()),
    );
    Ok(settings)
}

fn manager_preferences_from_value(settings: &Value) -> Result<CodexManagerPreferences, String> {
    let object = settings
        .as_object()
        .ok_or_else(|| "Codex++ settings.json 必须是 JSON 对象".to_string())?;
    let mut preferences = CodexManagerPreferences::default();

    macro_rules! load_bool {
        ($field:ident, $key:literal) => {
            if let Some(value) = object.get($key).and_then(Value::as_bool) {
                preferences.$field = value;
            }
        };
    }

    load_bool!(provider_sync_enabled, "providerSyncEnabled");
    load_bool!(enhancements_enabled, "enhancementsEnabled");
    load_bool!(computer_use_guard_enabled, "computerUseGuardEnabled");
    load_bool!(codex_app_plugin_marketplace_unlock, "codexAppPluginMarketplaceUnlock");
    load_bool!(codex_app_plugin_auto_expand, "codexAppPluginAutoExpand");
    load_bool!(codex_app_model_whitelist_unlock, "codexAppModelWhitelistUnlock");
    load_bool!(codex_app_service_tier_controls, "codexAppServiceTierControls");
    load_bool!(codex_app_session_delete, "codexAppSessionDelete");
    load_bool!(codex_app_markdown_export, "codexAppMarkdownExport");
    load_bool!(codex_app_paste_fix, "codexAppPasteFix");
    load_bool!(codex_app_project_move, "codexAppProjectMove");
    load_bool!(codex_app_thread_id_badge, "codexAppThreadIdBadge");
    load_bool!(codex_app_conversation_view, "codexAppConversationView");
    load_bool!(codex_app_thread_scroll_restore, "codexAppThreadScrollRestore");
    load_bool!(codex_app_zed_remote_open, "codexAppZedRemoteOpen");
    load_bool!(zed_remote_project_registry_enabled, "zedRemoteProjectRegistryEnabled");
    load_bool!(zed_remote_sync_to_zed_settings, "zedRemoteSyncToZedSettings");
    load_bool!(codex_app_upstream_worktree_create, "codexAppUpstreamWorktreeCreate");
    load_bool!(codex_app_force_chinese_locale, "codexAppForceChineseLocale");
    load_bool!(codex_app_fast_startup, "codexAppFastStartup");
    load_bool!(codex_app_native_menu_placement, "codexAppNativeMenuPlacement");
    load_bool!(codex_app_native_menu_localization, "codexAppNativeMenuLocalization");
    preferences.codex_extra_args = object
        .get("codexExtraArgs")
        .and_then(Value::as_array)
        .map(|args| {
            args.iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|arg| !arg.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    Ok(preferences)
}

fn merge_manager_preferences(
    mut settings: Value,
    preferences: &CodexManagerPreferences,
) -> Result<Value, String> {
    if settings.is_null() {
        settings = Value::Object(Map::new());
    }
    let object = settings
        .as_object_mut()
        .ok_or_else(|| "Codex++ settings.json 必须是 JSON 对象".to_string())?;

    macro_rules! save_bool {
        ($field:ident, $key:literal) => {
            object.insert($key.to_string(), Value::Bool(preferences.$field));
        };
    }

    save_bool!(provider_sync_enabled, "providerSyncEnabled");
    save_bool!(enhancements_enabled, "enhancementsEnabled");
    save_bool!(computer_use_guard_enabled, "computerUseGuardEnabled");
    save_bool!(codex_app_plugin_marketplace_unlock, "codexAppPluginMarketplaceUnlock");
    save_bool!(codex_app_plugin_auto_expand, "codexAppPluginAutoExpand");
    save_bool!(codex_app_model_whitelist_unlock, "codexAppModelWhitelistUnlock");
    save_bool!(codex_app_service_tier_controls, "codexAppServiceTierControls");
    save_bool!(codex_app_session_delete, "codexAppSessionDelete");
    save_bool!(codex_app_markdown_export, "codexAppMarkdownExport");
    save_bool!(codex_app_paste_fix, "codexAppPasteFix");
    save_bool!(codex_app_project_move, "codexAppProjectMove");
    save_bool!(codex_app_thread_id_badge, "codexAppThreadIdBadge");
    save_bool!(codex_app_conversation_view, "codexAppConversationView");
    save_bool!(codex_app_thread_scroll_restore, "codexAppThreadScrollRestore");
    save_bool!(codex_app_zed_remote_open, "codexAppZedRemoteOpen");
    save_bool!(zed_remote_project_registry_enabled, "zedRemoteProjectRegistryEnabled");
    save_bool!(zed_remote_sync_to_zed_settings, "zedRemoteSyncToZedSettings");
    save_bool!(codex_app_upstream_worktree_create, "codexAppUpstreamWorktreeCreate");
    save_bool!(codex_app_force_chinese_locale, "codexAppForceChineseLocale");
    save_bool!(codex_app_fast_startup, "codexAppFastStartup");
    save_bool!(codex_app_native_menu_placement, "codexAppNativeMenuPlacement");
    save_bool!(codex_app_native_menu_localization, "codexAppNativeMenuLocalization");
    object.insert(
        "codexExtraArgs".to_string(),
        Value::Array(
            normalized_string_list(&preferences.codex_extra_args)
                .into_iter()
                .map(Value::String)
                .collect(),
        ),
    );
    object.insert(
        "kuaifanRuntimeDefaultsVersion".to_string(),
        Value::Number(KUAIFAN_RUNTIME_DEFAULTS_VERSION.into()),
    );

    Ok(settings)
}

fn normalized_string_list(values: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .iter()
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter(|value| seen.insert((*value).to_string()))
        .map(str::to_string)
        .collect()
}

fn with_profile_files(mut settings: Value, config: &str, auth: &str) -> Result<Value, String> {
    let profiles = settings
        .get_mut("relayProfiles")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Codex++ 的 kuaifan 配置档未创建".to_string())?;
    let profile = profiles
        .iter_mut()
        .find(|profile| profile.get("id").and_then(Value::as_str) == Some(KUAIFAN_PROFILE_ID))
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "Codex++ 的 kuaifan 配置档未创建".to_string())?;
    profile.insert("configContents".to_string(), Value::String(config.to_string()));
    profile.insert("authContents".to_string(), Value::String(auth.to_string()));
    Ok(settings)
}

fn backup_live_files(paths: &CodexRuntimePaths) -> Result<BackupSnapshot, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("创建备份时间戳失败: {error}"))?
        .as_millis();
    let directory = paths
        .config_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("backups")
        .join(format!("kuaifanclaw-{timestamp}"));
    fs::create_dir_all(&directory).map_err(|error| format!("创建 Codex 备份目录失败: {error}"))?;
    let mut files = Vec::new();
    for (path, name) in [
        (&paths.config_path, "config.toml"),
        (&paths.auth_path, "auth.json"),
        (&paths.settings_path, "codex-plus-settings.json"),
    ] {
        let contents = read_optional_bytes(path)?;
        if let Some(contents) = &contents {
            fs::write(directory.join(name), contents)
                .map_err(|error| format!("写入 Codex 备份失败: {error}"))?;
        }
        files.push((path.clone(), contents));
    }
    Ok(BackupSnapshot { directory, files })
}

fn read_optional_text(path: &Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(contents) => Ok(contents),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(format!("读取 {} 失败: {error}", path.display())),
    }
}

fn read_optional_json(path: &Path) -> Result<Value, String> {
    let contents = read_optional_text(path)?;
    if contents.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(&contents)
        .map_err(|error| format!("Codex++ settings.json 格式错误，未写入: {error}"))
}

fn read_optional_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::read(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("读取 {} 失败: {error}", path.display())),
    }
}

fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).map_err(|error| format!("创建 {} 失败: {error}", parent.display()))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("生成临时文件名失败: {error}"))?
        .as_nanos();
    let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("config");
    let temporary = parent.join(format!(".{file_name}.kuaifanclaw-{timestamp}.tmp"));
    fs::write(&temporary, contents).map_err(|error| format!("写入 {} 失败: {error}", path.display()))?;
    fs::rename(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("替换 {} 失败: {error}", path.display())
    })
}

fn launch_runtime(runtime: &Path) -> Result<(), String> {
    let mut command = Command::new(runtime);
    configure_hidden_command(&mut command);
    match command.spawn() {
        Ok(_) => Ok(()),
        Err(error) if error.raw_os_error() == Some(740) => launch_runtime_elevated(runtime),
        Err(error) => Err(format!("启动 {} 失败: {error}", runtime.display())),
    }
}

fn restart_runtime(runtime: &Path, runtime_running: bool) -> Result<bool, String> {
    match restart_runtime_with(runtime_running, stop_runtime, || launch_runtime(runtime)) {
        Ok(started) => Ok(started),
        Err(error) if runtime_running && is_runtime_running() => run_elevated_powershell(&elevated_restart_script(runtime))
            .map(|_| true)
            .map_err(|restart_error| format!("{error}；管理员重启 Codex++ 失败: {restart_error}")),
        Err(error) => Err(error),
    }
}

fn restart_runtime_with<Stop, Launch>(
    runtime_running: bool,
    mut stop: Stop,
    mut launch: Launch,
) -> Result<bool, String>
where
    Stop: FnMut() -> Result<(), String>,
    Launch: FnMut() -> Result<(), String>,
{
    if runtime_running {
        stop()?;
    }
    launch()?;
    Ok(true)
}

fn stop_runtime() -> Result<(), String> {
    let script = "$ErrorActionPreference = 'Stop'; $running = @(Get-Process -Name 'codex-plus-plus' -ErrorAction SilentlyContinue); if ($running.Count -eq 0) { exit 0 }; $running | Stop-Process -Force -ErrorAction Stop; $deadline = (Get-Date).AddSeconds(10); while (@(Get-Process -Name 'codex-plus-plus' -ErrorAction SilentlyContinue).Count -gt 0) { if ((Get-Date) -ge $deadline) { throw '等待 Codex++ 退出超时' }; Start-Sleep -Milliseconds 100 }";
    let mut command = Command::new("powershell.exe");
    command.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    configure_hidden_command(&mut command);
    let output = command.output().map_err(|error| format!("关闭 Codex++ 失败: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if detail.is_empty() {
        "关闭 Codex++ 失败".to_string()
    } else {
        format!("关闭 Codex++ 失败: {detail}")
    })
}

fn launch_runtime_elevated(runtime: &Path) -> Result<(), String> {
    run_elevated_powershell(&elevated_launch_script(runtime))
}

fn elevated_launch_script(runtime: &Path) -> String {
    format!(
        "$ErrorActionPreference = 'Stop'; Start-Process -FilePath {}",
        powershell_quote(runtime)
    )
}

fn elevated_restart_script(runtime: &Path) -> String {
    format!(
        "$ErrorActionPreference = 'Stop'; $running = @(Get-Process -Name 'codex-plus-plus' -ErrorAction SilentlyContinue); if ($running.Count -gt 0) {{ $running | Stop-Process -Force -ErrorAction Stop }}; $deadline = (Get-Date).AddSeconds(10); while (@(Get-Process -Name 'codex-plus-plus' -ErrorAction SilentlyContinue).Count -gt 0) {{ if ((Get-Date) -ge $deadline) {{ throw '等待 Codex++ 退出超时' }}; Start-Sleep -Milliseconds 100 }}; Start-Process -FilePath {}",
        powershell_quote(runtime)
    )
}

fn run_elevated_powershell(script: &str) -> Result<(), String> {
    let encoded = STANDARD.encode(script.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<_>>());
    let launcher = elevated_powershell_launcher_script(&encoded);
    let mut command = Command::new("powershell.exe");
    command.args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &launcher]);
    configure_hidden_command(&mut command);
    // Spawn only: elevation/UAC must not block the Codex command path.
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("request elevated Codex++ launch failed: {error}"))
}

fn elevated_powershell_launcher_script(encoded: &str) -> String {
    // Do not -Wait: UAC consent and elevated restart can take a long time and would freeze kuaifanclaw.
    format!(
        "$ErrorActionPreference = 'Stop'; Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand','{encoded}') -Verb RunAs -WindowStyle Hidden | Out-Null"
    )
}

fn powershell_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "''"))
}

fn configure_hidden_command(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
}

fn is_runtime_running() -> bool {
    let mut command = Command::new("powershell.exe");
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-Process -Name 'codex-plus-plus' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id",
    ]);
    configure_hidden_command(&mut command);
    command
        .output()
        .ok()
        .is_some_and(|output| output.status.success() && !String::from_utf8_lossy(&output.stdout).trim().is_empty())
}

fn is_codex_configured(config_path: &Path, auth_path: &Path) -> bool {
    let Ok(config) = read_optional_text(config_path) else { return false; };
    let Ok(document) = config.parse::<DocumentMut>() else { return false; };
    let provider_ok = document
        .get("model_provider")
        .and_then(Item::as_str)
        == Some("custom");
    let base_url_ok = document
        .get("model_providers")
        .and_then(Item::as_table)
        .and_then(|providers| providers.get("custom"))
        .and_then(Item::as_table)
        .and_then(|provider| provider.get("base_url"))
        .and_then(Item::as_str)
        == Some(CODEX_PROXY_BASE);
    let auth_ok = read_optional_text(auth_path)
        .ok()
        .and_then(|contents| serde_json::from_str::<Value>(&contents).ok())
        .and_then(|auth| auth.get("OPENAI_API_KEY").and_then(Value::as_str).map(str::trim).map(str::to_string))
        .is_some_and(|key| !key.is_empty());
    provider_ok && base_url_ok && auth_ok
}

fn configured_model(config_path: &Path) -> Option<String> {
    read_optional_text(config_path)
        .ok()
        .and_then(|contents| contents.parse::<DocumentMut>().ok())
        .and_then(|document| document.get("model").and_then(Item::as_str).map(str::to_string))
}

fn ensure_newline(mut contents: String) -> String {
    if !contents.ends_with('\n') {
        contents.push('\n');
    }
    contents
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn merge_codex_config_preserves_unmanaged_sections() {
        let merged = merge_codex_config("model = \"old\"\n\n[plugins]\n", "gpt-5.6-sol").unwrap();

        assert!(merged.contains("model = \"gpt-5.6-sol\""));
        assert!(merged.contains("[plugins]"));
        assert!(merged.contains("base_url = \"http://127.0.0.1:57321/v1\""));
    }

    #[test]
    fn merge_codex_config_enables_openai_bundled_control_plugins() {
        let merged = merge_codex_config(
            "[features]\njs_repl = false\n\n[plugins.\"computer-use@openai-bundled\"]\nenabled = false\n",
            "gpt-5.6-sol",
        )
        .unwrap();
        let parsed = merged.parse::<DocumentMut>().unwrap();

        assert_eq!(parsed["features"]["js_repl"].as_bool(), Some(true));
        for plugin in [
            "browser@openai-bundled",
            "chrome@openai-bundled",
            "computer-use@openai-bundled",
        ] {
            assert_eq!(parsed["plugins"][plugin]["enabled"].as_bool(), Some(true));
        }
    }

    #[test]
    fn discovers_nested_browser_plugin_cache() {
        let temp = tempfile::tempdir().unwrap();
        let browser = temp
            .path()
            .join("plugins")
            .join("cache")
            .join("openai-bundled")
            .join("plugin-install-nested")
            .join("browser")
            .join("26.707.72221");
        std::fs::create_dir_all(browser.join(".codex-plugin")).unwrap();
        std::fs::write(browser.join(".codex-plugin").join("plugin.json"), "{}").unwrap();

        let found = latest_cached_plugin_version(temp.path(), "browser").unwrap();
        assert_eq!(found, browser);
    }

    #[test]
    fn control_plugin_marketplace_is_rebuilt_from_the_cached_plugins() {
        let temp = tempfile::tempdir().unwrap();
        for plugin in ["chrome", "computer-use"] {
            let plugin_root = temp
                .path()
                .join("plugins")
                .join("cache")
                .join("openai-bundled")
                .join(plugin)
                .join("26.715.72359");
            std::fs::create_dir_all(plugin_root.join(".codex-plugin")).unwrap();
            std::fs::write(plugin_root.join(".codex-plugin").join("plugin.json"), "{}").unwrap();
        }
        let browser_root = temp
            .path()
            .join("plugins")
            .join("cache")
            .join("openai-bundled")
            .join("plugin-install-nested")
            .join("browser")
            .join("26.707.72221");
        std::fs::create_dir_all(browser_root.join(".codex-plugin")).unwrap();
        std::fs::write(browser_root.join(".codex-plugin").join("plugin.json"), "{}").unwrap();

        let prepared = prepare_kuaifan_control_config("model = \"gpt-5.6-sol\"\n", temp.path())
            .unwrap();
        let parsed = prepared.parse::<DocumentMut>().unwrap();
        let active = temp
            .path()
            .join(".tmp")
            .join("bundled-marketplaces")
            .join("openai-bundled");
        let marketplace = std::fs::read_to_string(
            active.join(".agents").join("plugins").join("marketplace.json"),
        )
        .unwrap();

        assert_eq!(
            parsed["marketplaces"]["openai-bundled"]["source_type"].as_str(),
            Some("local")
        );
        assert_eq!(
            parsed["marketplaces"]["openai-bundled"]["source"].as_str(),
            Some(format!(r"\\?\{}", active.display()).as_str())
        );
        assert!(marketplace.contains("\"name\": \"browser\""));
        assert!(marketplace.contains("\"name\": \"chrome\""));
        assert!(marketplace.contains("\"name\": \"computer-use\""));
        assert!(active
            .join("plugins")
            .join("browser")
            .join(".codex-plugin")
            .join("plugin.json")
            .is_file());
        assert!(active
            .join("plugins")
            .join("chrome")
            .join(".codex-plugin")
            .join("plugin.json")
            .is_file());
        assert!(active
            .join("plugins")
            .join("computer-use")
            .join(".codex-plugin")
            .join("plugin.json")
            .is_file());
    }

    #[test]
    fn kuaifan_runtime_settings_migrate_control_and_locale_defaults_once() {
        let updated = ensure_kuaifan_runtime_settings(json!({
            "computerUseGuardEnabled": false,
            "codexAppForceChineseLocale": false,
            "codexAppPluginMarketplaceUnlock": false,
            "codexAppPluginAutoExpand": false
        }))
        .unwrap();

        assert_eq!(updated["computerUseGuardEnabled"], true);
        assert_eq!(updated["codexAppForceChineseLocale"], true);
        assert_eq!(updated["codexAppPluginMarketplaceUnlock"], true);
        assert_eq!(updated["codexAppPluginAutoExpand"], true);
        assert_eq!(updated["kuaifanRuntimeDefaultsVersion"], 4);
    }

    #[test]
    fn saved_manager_preferences_are_not_overwritten_when_launching() {
        let preferences = CodexManagerPreferences {
            computer_use_guard_enabled: false,
            codex_app_force_chinese_locale: false,
            ..Default::default()
        };
        let saved = merge_manager_preferences(json!({}), &preferences).unwrap();
        let launched = ensure_kuaifan_runtime_settings(saved).unwrap();

        assert_eq!(launched["computerUseGuardEnabled"], false);
        assert_eq!(launched["codexAppForceChineseLocale"], true);
        assert_eq!(launched["codexAppPluginMarketplaceUnlock"], true);
        assert_eq!(launched["kuaifanRuntimeDefaultsVersion"], 4);
    }

    #[test]
    fn upsert_kuaifan_profile_preserves_other_profiles() {
        let updated = upsert_kuaifan_profile(
            json!({
                "relayProfiles": [{ "id": "other", "apiKey": "keep" }]
            }),
            "new-key",
            "gpt-5.6-sol",
            "model-a\nmodel-b",
        )
        .unwrap();

        assert_eq!(updated["relayProfiles"][0]["apiKey"], "keep");
        assert_eq!(updated["activeRelayId"], "kuaifan");
        assert_eq!(updated["relayProfiles"][1]["protocol"], "chatCompletions");
        assert_eq!(updated["relayProfiles"][1]["model"], "gpt-5.6-sol");
    }

    #[test]
    fn first_existing_runtime_uses_first_executable_candidate() {
        let temp = tempfile::tempdir().unwrap();
        let executable = temp.path().join("codex-plus-plus.exe");
        std::fs::write(&executable, b"runtime").unwrap();

        assert_eq!(
            first_existing_runtime(&[temp.path().join("missing.exe"), executable.clone()]),
            Some(executable)
        );
    }

    #[test]
    fn running_runtime_is_stopped_before_it_is_launched() {
        let calls = std::cell::RefCell::new(Vec::new());
        let started = restart_runtime_with(
            true,
            || {
                calls.borrow_mut().push("stop");
                Ok(())
            },
            || {
                calls.borrow_mut().push("launch");
                Ok(())
            },
        )
        .unwrap();

        assert!(started);
        assert_eq!(&*calls.borrow(), &["stop", "launch"]);
    }

    #[test]
    fn elevated_restart_script_terminates_before_starting_the_runtime() {
        let script = elevated_restart_script(Path::new(r"D:\Codex++\codex-plus-plus.exe"));

        assert!(script.find("Stop-Process").unwrap() < script.rfind("Start-Process").unwrap());
    }

    #[test]
    fn save_and_launch_detaches_runtime_restart() {
        let source = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/commands/codex_runtime.rs"));
        assert!(source.contains("std::thread::spawn(move ||"));
        assert!(source.contains("restart_runtime(&runtime_path, runtime_was_running)"));
        assert!(!elevated_powershell_launcher_script("encoded").contains("-Wait"));
    }

    #[test]
    fn elevated_launch_hides_the_powershell_host_but_keeps_the_codex_gui_visible() {
        let runtime = Path::new(r"D:\Codex++\codex-plus-plus.exe");

        assert!(!elevated_launch_script(runtime).contains("-WindowStyle Hidden"));
        assert!(!elevated_restart_script(runtime).contains("-WindowStyle Hidden"));
        let launcher = elevated_powershell_launcher_script("encoded-command");
        assert!(launcher.contains("-WindowStyle Hidden"));
        assert!(launcher.contains("-Verb RunAs"));
        assert!(!launcher.contains("-Wait"));
        assert!(!launcher.contains("-PassThru"));
    }

    #[test]
    fn kuaifan_runtime_settings_force_chinese_launch_args() {
        let updated = ensure_kuaifan_runtime_settings(json!({
            "codexExtraArgs": ["--foo", "--lang=en-US"]
        })).unwrap();
        let args = updated["codexExtraArgs"].as_array().unwrap();
        assert_eq!(args[0], "--lang=zh-CN");
        assert!(args.iter().any(|v| v == "--foo"));
        assert!(!args.iter().any(|v| v.as_str() == Some("--lang=en-US")));
    }

    #[test]
    fn runtime_candidates_exclude_independent_codex_install() {
        let temp = tempfile::tempdir().unwrap();
        let application = temp.path().join("kuaifanclaw.exe");
        let candidates = runtime_candidates_for(Some(&application));
        assert!(!candidates.iter().any(|path| path.to_string_lossy().eq_ignore_ascii_case(r"D:\Codex++\codex-plus-plus.exe")));
        assert!(!candidates.iter().any(|path| path.to_string_lossy().contains(r"D:\codex\Codex++\target\release")));
    }

    #[test]
    fn runtime_candidates_include_packaged_codex_binary() {
        let temp = tempfile::tempdir().unwrap();
        let application = temp.path().join("快泛claw.exe");

        let candidates = runtime_candidates_for(Some(&application));
        let bundled_runtime = temp
            .path()
            .join("bundled-codex")
            .join("codex-plus-plus.exe");
        std::fs::create_dir_all(bundled_runtime.parent().unwrap()).unwrap();
        std::fs::write(&bundled_runtime, b"runtime").unwrap();

        assert!(candidates.contains(
            &temp
                .path()
                .join("bundled-codex")
                .join("codex-plus-plus.exe")
        ));
        assert_eq!(first_existing_runtime(&candidates), Some(bundled_runtime));
        assert!(candidates.contains(
            &temp
                .path()
                .join("resources")
                .join("bundled-codex")
                .join("codex-plus-plus.exe")
        ));
    }

    #[test]
    fn backup_snapshot_restores_each_codex_configuration_file() {
        let temp = tempfile::tempdir().unwrap();
        let paths = CodexRuntimePaths {
            config_path: temp.path().join(".codex").join("config.toml"),
            auth_path: temp.path().join(".codex").join("auth.json"),
            settings_path: temp.path().join(".codex-session-delete").join("settings.json"),
            runtime_path: None,
        };
        std::fs::create_dir_all(paths.config_path.parent().unwrap()).unwrap();
        std::fs::create_dir_all(paths.settings_path.parent().unwrap()).unwrap();
        std::fs::write(&paths.config_path, b"model = \"before\"\n").unwrap();
        std::fs::write(&paths.auth_path, b"{\"OPENAI_API_KEY\":\"before\"}\n").unwrap();
        std::fs::write(&paths.settings_path, b"{\"activeRelayId\":\"before\"}\n").unwrap();

        let snapshot = backup_live_files(&paths).unwrap();
        std::fs::write(&paths.config_path, b"model = \"after\"\n").unwrap();
        std::fs::write(&paths.auth_path, b"{\"OPENAI_API_KEY\":\"after\"}\n").unwrap();
        std::fs::write(&paths.settings_path, b"{\"activeRelayId\":\"after\"}\n").unwrap();
        snapshot.restore().unwrap();

        assert!(snapshot.directory.join("config.toml").is_file());
        assert!(snapshot.directory.join("auth.json").is_file());
        assert!(snapshot.directory.join("codex-plus-settings.json").is_file());
        assert_eq!(std::fs::read(&paths.config_path).unwrap(), b"model = \"before\"\n");
        assert_eq!(std::fs::read(&paths.auth_path).unwrap(), b"{\"OPENAI_API_KEY\":\"before\"}\n");
        assert_eq!(
            std::fs::read(&paths.settings_path).unwrap(),
            b"{\"activeRelayId\":\"before\"}\n"
        );
    }

    #[test]
    fn runtime_status_serialization_does_not_include_api_key() {
        let secret = "kuaifan-secret-value";
        let temp = tempfile::tempdir().unwrap();
        let paths = CodexRuntimePaths {
            config_path: temp.path().join(".codex").join("config.toml"),
            auth_path: temp.path().join(".codex").join("auth.json"),
            settings_path: temp.path().join(".codex-session-delete").join("settings.json"),
            runtime_path: None,
        };
        std::fs::create_dir_all(paths.config_path.parent().unwrap()).unwrap();
        std::fs::write(&paths.config_path, "model = \"gpt-5\"\n").unwrap();
        std::fs::write(&paths.auth_path, format!("{{\"OPENAI_API_KEY\":\"{secret}\"}}")).unwrap();

        let serialized = serde_json::to_string(&runtime_status(&paths, false, None, None)).unwrap();

        assert!(!serialized.contains(secret));
    }

    #[test]
    fn atomic_write_replaces_an_existing_configuration_file() {
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join("config.toml");
        std::fs::write(&config, b"model = \"old\"\n").unwrap();

        atomic_write(&config, b"model = \"new\"\n").unwrap();

        assert_eq!(std::fs::read(&config).unwrap(), b"model = \"new\"\n");
    }

    #[test]
    fn manager_preferences_preserve_relay_profiles_and_do_not_serialize_api_keys() {
        let secret = "kuaifan-manager-secret";
        let settings = json!({
            "unmanaged": "keep",
            "relayProfiles": [{ "id": "kuaifan", "apiKey": secret }],
            "codexAppPluginMarketplaceUnlock": true
        });
        let preferences = CodexManagerPreferences {
            codex_app_plugin_marketplace_unlock: false,
            ..Default::default()
        };

        let updated = merge_manager_preferences(settings, &preferences).unwrap();
        let serialized = serde_json::to_string(&manager_preferences_from_value(&updated).unwrap()).unwrap();

        assert_eq!(updated["unmanaged"], "keep");
        assert_eq!(updated["relayProfiles"][0]["apiKey"], secret);
        assert_eq!(updated["codexAppPluginMarketplaceUnlock"], false);
        assert!(!serialized.contains(secret));
    }
}
