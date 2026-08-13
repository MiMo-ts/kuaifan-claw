use crate::models::{Instance, RuntimeLogsTail};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleDescriptor {
    pub id: &'static str,
    pub name: &'static str,
    pub available: bool,
    pub supports_instances: bool,
    pub supports_gateway_logs: bool,
}

const MODULE_CATALOG: &[ModuleDescriptor] = &[
    ModuleDescriptor {
        id: "openclaw",
        name: "OpenClaw",
        available: true,
        supports_instances: true,
        supports_gateway_logs: true,
    },
    ModuleDescriptor {
        id: "hermes",
        name: "Hermes",
        available: true,
        supports_instances: true,
        supports_gateway_logs: true,
    },
    ModuleDescriptor {
        id: "codex",
        name: "Codex",
        available: false,
        supports_instances: false,
        supports_gateway_logs: false,
    },
    ModuleDescriptor {
        id: "claude",
        name: "Claude",
        available: false,
        supports_instances: false,
        supports_gateway_logs: false,
    },
    ModuleDescriptor {
        id: "infinite_canvas",
        name: "无限画布",
        available: true,
        supports_instances: false,
        supports_gateway_logs: true,
    },
];

pub fn module_gateway_log_filename(module_id: &str) -> Option<&'static str> {
    match module_id {
        "openclaw" => Some("openclaw-gateway.log"),
        "hermes" => Some("hermes_runtime.log"),
        "infinite_canvas" => Some("infinite_canvas_runtime.log"),
        _ => None,
    }
}

fn module_gateway_log_path(data_dir: &str, module_id: &str) -> Result<PathBuf, String> {
    match module_id {
        "openclaw" => Ok(PathBuf::from(data_dir)
            .join("logs")
            .join("openclaw-gateway.log")),
        "hermes" => Ok(crate::commands::runtime::runtime_log_path(data_dir, "hermes")),
        "infinite_canvas" => Ok(crate::commands::runtime::runtime_log_path(data_dir, "infinite_canvas")),
        _ => Err(format!("模块 '{}' 尚未提供网关日志适配器", module_id)),
    }
}

fn module_gateway_log_paths(data_dir: &str, module_id: &str) -> Result<Vec<PathBuf>, String> {
    if module_id != "hermes" {
        return Ok(vec![module_gateway_log_path(data_dir, module_id)?]);
    }
    let fallback = module_gateway_log_path(data_dir, module_id)?;
    let Some(log_dir) = fallback.parent() else {
        return Ok(vec![fallback]);
    };
    let mut paths = std::fs::read_dir(log_dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|extension| extension.to_str()) == Some("log"))
        .collect::<Vec<_>>();
    paths.sort();
    if paths.is_empty() {
        paths.push(fallback);
    }
    Ok(paths)
}

fn tail_lines(content: &str, max_lines: usize) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].join("\n")
}

const OPENAI_CHAT_COMPLETIONS: &str = "chat_completions";

fn yaml_string(value: Option<&serde_yaml::Value>) -> String {
    value
        .and_then(serde_yaml::Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn default_openai_compatible_base_url(provider_id: &str) -> &'static str {
    match provider_id {
        "kuaifan" => "https://kuaifanio.cn/v1",
        "openai" => "https://api.openai.com/v1",
        "anthropic" => "https://api.anthropic.com/v1",
        "deepseek" => "https://api.deepseek.com/v1",
        "minimax" => "https://api.minimax.chat/v1",
        "volc_ark" | "volcengine" => "https://ark.cn-beijing.volces.com/api/v3",
        "nvidia" => "https://integrate.api.nvidia.com/v1",
        "aliyun" => "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "zhipu" => "https://open.bigmodel.cn/api/paas/v4",
        "moonshot" => "https://api.moonshot.cn/v1",
        "baidu" => "https://qianfan.baidubce.com/v2",
        "xiaomi" => "https://api.xiaomi.com/v1",
        _ => "",
    }
}

fn decrypt_shared_api_key(value: &str, data_dir: &str) -> String {
    if !value.starts_with(crate::services::cipher::CIPHER_PREFIX) {
        return value.to_string();
    }

    let Ok(key) = crate::services::cipher::get_or_create_cipher_key_sync(data_dir) else {
        return value.to_string();
    };
    crate::services::cipher::decrypt_credential(value, &key).unwrap_or_else(|| value.to_string())
}

fn known_model_supports_vision(model_name: &str) -> bool {
    let model = model_name.trim().to_ascii_lowercase();
    model.starts_with("gpt-5")
        || model.starts_with("gpt-4o")
        || model.starts_with("gpt-4.1")
        || model.starts_with("o1")
        || model.starts_with("o3")
        || model.starts_with("o4-mini")
}

fn projected_model_capabilities(
    provider: &serde_yaml::Value,
    model_name: &str,
) -> serde_yaml::Mapping {
    let mut capabilities = serde_yaml::Mapping::new();
    let configured_vision = provider
        .get("models")
        .and_then(|models| models.get(model_name))
        .and_then(|model| model.get("supports_vision"))
        .and_then(serde_yaml::Value::as_bool);

    if configured_vision.unwrap_or_else(|| known_model_supports_vision(model_name)) {
        capabilities.insert(
            serde_yaml::Value::String("supports_vision".into()),
            serde_yaml::Value::Bool(true),
        );
    }
    capabilities
}

/// Projects the manager-owned model catalog into Hermes's native custom-provider schema.
/// Every manager provider is explicitly configured as OpenAI Chat Completions; provider
/// names are never used to infer an Anthropic or Responses transport.
fn apply_hermes_model_projection(
    config: &mut serde_yaml::Mapping,
    models: &serde_yaml::Value,
    data_dir: &str,
) {
    let default_model = models.get("default_model");
    let default_provider = yaml_string(default_model.and_then(|value| value.get("provider")));
    let default_model_name = yaml_string(default_model.and_then(|value| value.get("model_name")));

    let mut projected_providers = serde_yaml::Mapping::new();
    if let Some(providers) = models.get("providers").and_then(serde_yaml::Value::as_mapping) {
        for (provider_key, provider_value) in providers {
            let provider_id = yaml_string(Some(provider_key));
            if provider_id.is_empty() {
                continue;
            }

            let base_url = yaml_string(provider_value.get("base_url"));
            let base_url = if base_url.is_empty() {
                default_openai_compatible_base_url(&provider_id).to_string()
            } else {
                base_url
            };
            if base_url.is_empty() {
                continue;
            }

            let api_key = decrypt_shared_api_key(
                &yaml_string(provider_value.get("api_key")),
                data_dir,
            );
            let mut entry = serde_yaml::Mapping::new();
            entry.insert(serde_yaml::Value::String("name".into()), serde_yaml::Value::String(provider_id.clone()));
            entry.insert(serde_yaml::Value::String("api".into()), serde_yaml::Value::String(base_url));
            entry.insert(
                serde_yaml::Value::String("transport".into()),
                serde_yaml::Value::String(OPENAI_CHAT_COMPLETIONS.into()),
            );
            if !api_key.is_empty() {
                entry.insert(serde_yaml::Value::String("api_key".into()), serde_yaml::Value::String(api_key));
            }
            if provider_id == default_provider && !default_model_name.is_empty() {
                entry.insert(
                    serde_yaml::Value::String("default_model".into()),
                    serde_yaml::Value::String(default_model_name.clone()),
                );
                let mut model_catalog = serde_yaml::Mapping::new();
                model_catalog.insert(
                    serde_yaml::Value::String(default_model_name.clone()),
                    serde_yaml::Value::Mapping(projected_model_capabilities(
                        provider_value,
                        &default_model_name,
                    )),
                );
                entry.insert(serde_yaml::Value::String("models".into()), serde_yaml::Value::Mapping(model_catalog));
            }
            projected_providers.insert(serde_yaml::Value::String(provider_id), serde_yaml::Value::Mapping(entry));
        }
    }

    config.insert(
        serde_yaml::Value::String("providers".into()),
        serde_yaml::Value::Mapping(projected_providers),
    );

    let mut model = serde_yaml::Mapping::new();
    model.insert(
        serde_yaml::Value::String("provider".into()),
        serde_yaml::Value::String(format!("custom:{}", default_provider)),
    );
    model.insert(serde_yaml::Value::String("default".into()), serde_yaml::Value::String(default_model_name));
    model.insert(
        serde_yaml::Value::String("api_mode".into()),
        serde_yaml::Value::String(OPENAI_CHAT_COMPLETIONS.into()),
    );
    config.insert(serde_yaml::Value::String("model".into()), serde_yaml::Value::Mapping(model));
}

async fn sync_hermes_configuration(data_dir: &str) -> Result<(), String> {
    crate::commands::instance::migrate_legacy_instances_to_modules(data_dir).await?;
    crate::commands::model::ensure_models_yaml_api_keys_are_plaintext(data_dir).await?;
    let data_path = PathBuf::from(data_dir);
    let managed_skill_root = crate::services::bundled_skills::bootstrap_managed_skill(&data_path)?;

    let module_dir = PathBuf::from(data_dir).join("modules").join("hermes");
    tokio::fs::create_dir_all(&module_dir)
        .await
        .map_err(|error| format!("创建 Hermes 配置目录失败: {}", error))?;

    let models_path = PathBuf::from(data_dir).join("config").join("models.yaml");
    let models_raw = crate::commands::gateway::read_models_yaml_raw_utf8_or_utf16(&models_path)
        .unwrap_or_default();
    let models: serde_yaml::Value = serde_yaml::from_str(
        models_raw.strip_prefix('\u{feff}').unwrap_or(&models_raw),
    )
    .unwrap_or(serde_yaml::Value::Mapping(Default::default()));

    let config_path = module_dir.join("config.yaml");
    let current = tokio::fs::read_to_string(&config_path).await.unwrap_or_default();
    let mut config: serde_yaml::Mapping = serde_yaml::from_str::<serde_yaml::Value>(&current)
        .ok()
        .and_then(|value| value.as_mapping().cloned())
        .unwrap_or_default();

    apply_hermes_model_projection(&mut config, &models, data_dir);
    crate::services::bundled_skills::register_hermes_skill_root(&mut config, &managed_skill_root);

    let config_yaml = serde_yaml::to_string(&serde_yaml::Value::Mapping(config))
        .map_err(|error| format!("序列化 Hermes 配置失败: {}", error))?;
    tokio::fs::write(&config_path, &config_yaml)
        .await
        .map_err(|error| format!("写入 Hermes 配置失败: {}", error))?;

    // 同步到 Hermes 实际读取的 HOME 目录（%LOCALAPPDATA%/hermes/）
    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        let hermes_home_config = PathBuf::from(&local_appdata).join("hermes").join("config.yaml");
        if let Some(parent) = hermes_home_config.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        let _ = tokio::fs::write(&hermes_home_config, &config_yaml).await;
        tracing::info!("[module] Hermes config synced to {}", hermes_home_config.display());
    }

    let instances_path = PathBuf::from(data_dir)
        .join("config")
        .join("modules")
        .join("hermes")
        .join("instances.yaml");
    let all_instances = tokio::fs::read_to_string(instances_path).await.unwrap_or_default();
    let instances: Vec<Instance> = serde_yaml::from_str::<serde_yaml::Value>(&all_instances)
        .ok()
        .and_then(|value| value.get("instances").cloned())
        .and_then(|value| serde_yaml::from_value::<Vec<Instance>>(value).ok())
        .unwrap_or_default()
        .into_iter()
        .collect();
    let instances_yaml = serde_yaml::to_string(&serde_yaml::to_value(serde_json::json!({
        "module_id": "hermes",
        "instances": instances,
    })).map_err(|error| format!("序列化 Hermes 实例失败: {}", error))?)
        .map_err(|error| format!("序列化 Hermes 实例失败: {}", error))?;
    tokio::fs::write(module_dir.join("instances.yaml"), instances_yaml)
        .await
        .map_err(|error| format!("写入 Hermes 实例配置失败: {}", error))?;

    Ok(())
}

pub async fn sync_module_configuration(module_id: &str, data_dir: &str) -> Result<(), String> {
    match module_id {
        "openclaw" => crate::commands::gateway::sync_openclaw_config_from_manager(data_dir).await,
        "hermes" => sync_hermes_configuration(data_dir).await,
        "infinite_canvas" => crate::commands::infinite_canvas::sync_infinite_canvas_configuration(data_dir).await,
        _ => Err(format!("模块 '{}' 尚未提供配置适配器", module_id)),
    }
}

pub async fn sync_all_module_configurations(data_dir: &str) -> Result<(), String> {
    sync_module_configuration("openclaw", data_dir).await?;
    sync_module_configuration("hermes", data_dir).await?;
    sync_module_configuration("infinite_canvas", data_dir).await
}

fn project_hermes_feishu_env(env: &str, config: Option<&serde_yaml::Value>) -> String {
    let mut projected = env.to_string();
    if let Some(app_id) = config.and_then(|value| value.get("appId")).and_then(|value| value.as_str()) {
        projected = set_env_line(&projected, "FEISHU_APP_ID", app_id);
    }
    if let Some(app_secret) = config.and_then(|value| value.get("appSecret")).and_then(|value| value.as_str()) {
        projected = set_env_line(&projected, "FEISHU_APP_SECRET", app_secret);
    }

    let allowed_users = config
        .and_then(|value| value.get("allowFrom"))
        .and_then(|value| value.as_sequence())
        .map(|users| {
            users
                .iter()
                .filter_map(|user| user.as_str())
                .map(str::trim)
                .filter(|user| !user.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let allow_all = allowed_users.is_empty() || allowed_users.iter().any(|user| *user == "*");
    let allowed_users = if allow_all {
        String::new()
    } else {
        allowed_users.join(",")
    };

    projected = set_env_line(&projected, "FEISHU_ALLOWED_USERS", &allowed_users);
    projected = set_env_line(
        &projected,
        "FEISHU_ALLOW_ALL_USERS",
        if allow_all { "true" } else { "false" },
    );
    projected = set_env_line(&projected, "FEISHU_CONNECTION_MODE", "websocket");
    projected
}

/// 将 Hermes 实例的平台凭证同步到 .env（飞书→FEISHU_APP_ID/SECRET, 钉钉→DINGTALK_CLIENT_ID/SECRET, 微信→WEIXIN_TOKEN）
pub async fn sync_hermes_platform_credentials(data_dir: &str) {
    if let Err(error) = crate::commands::instance::migrate_legacy_instances_to_modules(data_dir).await {
        tracing::warn!("[module] Hermes instance migration failed: {}", error);
        return;
    }
    let instances_path = PathBuf::from(data_dir)
        .join("config")
        .join("modules")
        .join("hermes")
        .join("instances.yaml");
    let all_instances = match tokio::fs::read_to_string(&instances_path).await {
        Ok(s) => s,
        Err(_) => return,
    };
    let instances: Vec<serde_yaml::Value> = serde_yaml::from_str::<serde_yaml::Value>(&all_instances)
        .ok()
        .and_then(|v| v.get("instances").cloned())
        .and_then(|v| serde_yaml::from_value::<Vec<serde_yaml::Value>>(v).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|inst| inst.get("enabled").and_then(|v| v.as_bool()) == Some(true))
        .collect();

    let env_dir = PathBuf::from(data_dir).join("modules").join("hermes");
    let _ = tokio::fs::create_dir_all(&env_dir).await;
    let env_path = env_dir.join(".env");
    let mut env = tokio::fs::read_to_string(&env_path).await.unwrap_or_default();

    for inst in &instances {
        let channel = inst.get("channel_type").and_then(|v| v.as_str()).unwrap_or("");
        let config = inst.get("channel_config");
        match channel {
            "feishu" => {
                env = project_hermes_feishu_env(&env, config);
                env = set_env_line(&env, "FEISHU_DM_POLICY", "open");
                env = set_env_line(&env, "FEISHU_HOME_CHANNEL", "auto");
            }
            "dingtalk" => {
                if let Some(client_id) = config.and_then(|c| c.get("appId").and_then(|v| v.as_str())) {
                    env = set_env_line(&env, "DINGTALK_CLIENT_ID", client_id);
                }
                if let Some(client_secret) = config.and_then(|c| c.get("appSecret").and_then(|v| v.as_str())) {
                    env = set_env_line(&env, "DINGTALK_CLIENT_SECRET", client_secret);
                }
                env = set_env_line(&env, "DINGTALK_ALLOWED_USERS", "*");
                env = set_env_line(&env, "DINGTALK_DM_POLICY", "open");
                env = set_env_line(&env, "DINGTALK_HOME_CHANNEL", "auto");
            }
            "wechat_clawbot" => {
                if let Some(auth_code) = config.and_then(|c| c.get("authCode").and_then(|v| v.as_str())) {
                    let (account_id, token) = if let Some((a, t)) = auth_code.split_once("@im.bot:") {
                        (a.to_string(), t.to_string())
                    } else {
                        continue;
                    };
                    env = set_env_line(&env, "WEIXIN_ACCOUNT_ID", &account_id);
                    env = set_env_line(&env, "WEIXIN_TOKEN", &token);
                }
                env = set_env_line(&env, "WEIXIN_ALLOWED_USERS", "*");
                env = set_env_line(&env, "WEIXIN_HOME_CHANNEL", "auto");
            }
            _ => {}
        }
    }

    if let Err(e) = tokio::fs::write(&env_path, &env).await {
        tracing::warn!("[module] Hermes platform env sync failed: {}", e);
    } else {
        tracing::info!("[module] Hermes platform credentials synced to .env");
    }
    // 同步到 Hermes HOME 目录
    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        let hermes_home_env = PathBuf::from(&local_appdata).join("hermes").join(".env");
        if let Some(parent) = hermes_home_env.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        let _ = tokio::fs::write(&hermes_home_env, &env).await;
        tracing::info!("[module] Hermes .env synced to {}", hermes_home_env.display());
    }
}

pub(crate) fn set_env_line(env: &str, key: &str, value: &str) -> String {
    let mut result = env.to_string();
    if let Some(start) = result.find(&format!("{}=", key)) {
        let end = result[start..].find('\n').map(|i| start + i).unwrap_or(result.len());
        result.replace_range(start..end, &format!("{}={}", key, value));
    } else {
        if !result.is_empty() && !result.ends_with('\n') {
            result.push('\n');
        }
        result.push_str(&format!("{}={}\n", key, value));
    }
    result
}

#[tauri::command]
pub fn get_module_catalog() -> Vec<ModuleDescriptor> {
    MODULE_CATALOG.to_vec()
}

#[tauri::command]
pub async fn read_module_logs_tail(
    data_dir: tauri::State<'_, crate::AppState>,
    module_id: String,
    lines: Option<usize>,
) -> Result<RuntimeLogsTail, String> {
    let data_dir = data_dir.inner().get_data_dir();
    let max_lines = lines.unwrap_or(400).clamp(50, 3000);
    let gateway_paths = module_gateway_log_paths(&data_dir, &module_id)?;
    let manager_path = PathBuf::from(&data_dir).join("logs").join("app.log");
    let mut gateway_sections = Vec::new();
    for path in gateway_paths {
        let content = tokio::fs::read_to_string(&path).await.unwrap_or_default();
        gateway_sections.push(format!("===== {} =====\n{}", path.file_name().and_then(|name| name.to_str()).unwrap_or("hermes.log"), tail_lines(&content, max_lines)));
    }
    let manager = tokio::fs::read_to_string(manager_path).await.unwrap_or_default();

    Ok(RuntimeLogsTail {
        gateway: gateway_sections.join("\n\n"),
        manager: tail_lines(&manager, max_lines),
    })
}

#[tauri::command]
pub async fn clear_module_gateway_log(
    data_dir: tauri::State<'_, crate::AppState>,
    module_id: String,
) -> Result<String, String> {
    let data_dir = data_dir.inner().get_data_dir();
    for path in module_gateway_log_paths(&data_dir, &module_id)? {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|error| format!("创建日志目录失败: {}", error))?;
        }
        tokio::fs::write(path, "")
            .await
            .map_err(|error| format!("清空模块网关日志失败: {}", error))?;
    }
    Ok(format!("{} 网关日志已清空", module_id))
}

#[tauri::command]
pub async fn sync_active_module_configuration(
    data_dir: tauri::State<'_, crate::AppState>,
    module_id: String,
) -> Result<(), String> {
    sync_module_configuration(&module_id, &data_dir.inner().get_data_dir()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_gateway_logs_per_module() {
        assert_eq!(module_gateway_log_filename("openclaw"), Some("openclaw-gateway.log"));
        assert_eq!(module_gateway_log_filename("hermes"), Some("hermes_runtime.log"));
        assert_eq!(module_gateway_log_filename("infinite_canvas"), Some("infinite_canvas_runtime.log"));
        assert_eq!(module_gateway_log_filename("codex"), None);
    }

    #[test]
    fn hermes_projection_keeps_openai_chat_completions_for_every_provider() {
        let models: serde_yaml::Value = serde_yaml::from_str(
            r#"
default_model:
  provider: anthropic
  model_name: claude-compatible-model
providers:
  anthropic:
    api_key: test-key
    base_url: https://relay.example.test/v1
"#,
        )
        .unwrap();
        let mut config = serde_yaml::Mapping::new();

        apply_hermes_model_projection(&mut config, &models, "D:/unused");

        let model = config
            .get(serde_yaml::Value::String("model".into()))
            .and_then(serde_yaml::Value::as_mapping)
            .unwrap();
        assert_eq!(
            model
                .get(serde_yaml::Value::String("provider".into()))
                .and_then(serde_yaml::Value::as_str),
            Some("custom:anthropic")
        );
        assert_eq!(
            model
                .get(serde_yaml::Value::String("api_mode".into()))
                .and_then(serde_yaml::Value::as_str),
            Some("chat_completions")
        );

        let providers = config
            .get(serde_yaml::Value::String("providers".into()))
            .and_then(serde_yaml::Value::as_mapping)
            .unwrap();
        let provider = providers
            .get(serde_yaml::Value::String("anthropic".into()))
            .and_then(serde_yaml::Value::as_mapping)
            .unwrap();
        assert_eq!(
            provider
                .get(serde_yaml::Value::String("api".into()))
                .and_then(serde_yaml::Value::as_str),
            Some("https://relay.example.test/v1")
        );
        assert_eq!(
            provider
                .get(serde_yaml::Value::String("api_key".into()))
                .and_then(serde_yaml::Value::as_str),
            Some("test-key")
        );
        assert_eq!(
            provider
                .get(serde_yaml::Value::String("transport".into()))
                .and_then(serde_yaml::Value::as_str),
            Some("chat_completions")
        );
    }

    #[test]
    fn hermes_projection_marks_known_vision_models_for_native_image_input() {
        let models: serde_yaml::Value = serde_yaml::from_str(
            r#"
default_model:
  provider: kuaifan
  model_name: gpt-5.4
providers:
  kuaifan:
    api_key: test-key
    base_url: https://kuaifanio.cn/v1
"#,
        )
        .unwrap();
        let mut config = serde_yaml::Mapping::new();

        apply_hermes_model_projection(&mut config, &models, "D:/unused");

        let supports_vision = config
            .get(serde_yaml::Value::String("providers".into()))
            .and_then(serde_yaml::Value::as_mapping)
            .and_then(|providers| providers.get(serde_yaml::Value::String("kuaifan".into())))
            .and_then(serde_yaml::Value::as_mapping)
            .and_then(|provider| provider.get(serde_yaml::Value::String("models".into())))
            .and_then(serde_yaml::Value::as_mapping)
            .and_then(|catalog| catalog.get(serde_yaml::Value::String("gpt-5.4".into())))
            .and_then(serde_yaml::Value::as_mapping)
            .and_then(|model| model.get(serde_yaml::Value::String("supports_vision".into())))
            .and_then(serde_yaml::Value::as_bool);

        assert_eq!(supports_vision, Some(true));
    }

    #[test]
    fn hermes_feishu_env_preserves_scanned_user_allowlist() {
        let channel_config: serde_yaml::Value = serde_yaml::from_str(
            r#"
appId: cli_test
appSecret: secret
allowFrom:
  - ou_scanned_user
"#,
        )
        .unwrap();

        let env = project_hermes_feishu_env(
            "FEISHU_ALLOWED_USERS=*\nFEISHU_DM_POLICY=open\n",
            Some(&channel_config),
        );

        assert!(env.contains("FEISHU_ALLOWED_USERS=ou_scanned_user"));
        assert!(env.contains("FEISHU_ALLOW_ALL_USERS=false"));
        assert!(!env.contains("FEISHU_ALLOWED_USERS=*"));
    }

    #[test]
    fn hermes_feishu_env_uses_official_allow_all_flag_without_an_allowlist() {
        let channel_config: serde_yaml::Value = serde_yaml::from_str(
            r#"
appId: cli_test
appSecret: secret
"#,
        )
        .unwrap();

        let env = project_hermes_feishu_env("FEISHU_ALLOWED_USERS=*\n", Some(&channel_config));

        assert!(env.contains("FEISHU_ALLOWED_USERS=\n"));
        assert!(env.contains("FEISHU_ALLOW_ALL_USERS=true"));
        assert!(!env.contains("FEISHU_ALLOWED_USERS=*"));
    }
}
