// 实例管理命令 — 使用标准 YAML 结构 `instances:` 数组，避免手写拼接导致解析永远为空

use crate::models::{Instance, ModelConfig};
use crate::services::cipher::{decrypt_credential, CIPHER_PREFIX};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tracing::{info, warn};

/// 统计所有实例中每个 robot_id 被多少个实例引用（引用计数）。
fn count_robot_refs(instances: &[Instance]) -> HashMap<String, usize> {
    let mut refs: HashMap<String, usize> = HashMap::new();
    for inst in instances {
        *refs.entry(inst.robot_id.clone()).or_insert(0) += 1;
    }
    refs
}

/// 机器人目录安全删除：只有 robot_id 不被任何存活实例引用、且是业务目录时才删除。
/// 兼容旧逻辑留下的 orphan 目录（曾被实例使用但现已无实例引用）。
async fn try_delete_robot_dir(data_dir: &str, robot_id: &str, refs: &HashMap<String, usize>) {
    let robot_dir = PathBuf::from(data_dir).join("robots").join(robot_id);
    if !robot_dir.exists() {
        return;
    }

    // 引用计数 > 0 → 被其他实例共用，不能删
    if let Some(&count) = refs.get(robot_id) {
        if count > 0 {
            info!(
                "机器人 {} 仍有 {} 个实例引用，跳过目录删除",
                robot_id, count
            );
            return;
        }
    }

    match tokio::fs::remove_dir_all(&robot_dir).await {
        Ok(_) => info!("已删除无引用机器人目录: {}", robot_dir.display()),
        Err(e) => warn!("删除机器人目录失败 {}: {}", robot_dir.display(), e),
    }
}

/// 使用 serde_yaml 正确解析 models.yaml 的 default_model 块
#[derive(serde::Deserialize)]
struct ModelsYamlDoc {
    #[serde(rename = "default_model", default)]
    default_model: Option<DefaultModelBlock>,
}

#[derive(serde::Deserialize)]
struct DefaultModelBlock {
    #[serde(rename = "provider", default)]
    provider: Option<String>,
    #[serde(rename = "model_name", default)]
    model_name: Option<String>,
}

/// 从 models.yaml 读取 default_model 块，返回完整 ModelConfig（含 api_key 等）
async fn read_default_model(data_dir: &str) -> Option<ModelConfig> {
    let config_path = format!("{}/config/models.yaml", data_dir);
    let content = tokio::fs::read_to_string(&config_path).await.ok()?;

    let doc: ModelsYamlDoc = serde_yaml::from_str(&content).ok()?;
    let block = doc.default_model?;

    let provider = block.provider?.trim().to_string();
    let model_name = block.model_name?.trim().to_string();
    if provider.is_empty() || model_name.is_empty() {
        return None;
    }

    // 读取对应 provider 的 api_key
    let api_key = extract_provider_api_key(&content, &provider);

    Some(ModelConfig {
        provider,
        model_name,
        api_key,
        api_base: None,
        temperature: 0.7,
        max_tokens: 4096,
    })
}

/// 从 models.yaml 中提取指定 provider 的 api_key，并自动解密（若已加密）。
fn extract_provider_api_key(content: &str, provider: &str) -> Option<String> {
    #[derive(serde::Deserialize)]
    struct ProviderInner {
        #[serde(rename = "api_key", default)]
        api_key: Option<String>,
    }

    #[derive(serde::Deserialize)]
    struct RootDoc {
        #[serde(default)]
        providers: Option<std::collections::HashMap<String, ProviderInner>>,
        #[serde(flatten)]
        flat: std::collections::HashMap<String, ProviderInner>,
    }

    let root: RootDoc = serde_yaml::from_str(content).ok()?;

    // 先查 providers.<id>.api_key
    if let Some(ref providers) = root.providers {
        if let Some(inner) = providers.get(provider) {
            if let Some(ref key) = inner.api_key {
                if !key.is_empty() {
                    return Some(decrypt_if_needed(key));
                }
            }
        }
    }
    // 再查顶层的 <id>.api_key
    if let Some(inner) = root.flat.get(provider) {
        if let Some(ref key) = inner.api_key {
            if !key.is_empty() {
                return Some(decrypt_if_needed(key));
            }
        }
    }
    None
}

/// 若字符串为加密格式（enc:...）则尝试解密，否则原样返回
fn decrypt_if_needed(encoded: &str) -> String {
    if encoded.starts_with(CIPHER_PREFIX) {
        // 从进程启动时设置的 data_dir 环境变量读取（main.rs 中设置）
        let data_dir = std::env::var("OPENCLAW_CN_DATA_DIR")
            .or_else(|_| std::env::var("APPDATA").map(|a| format!("{}/OpenClaw-CN Manager", a)))
            .unwrap_or_else(|_| ".".to_string());
        let key = crate::services::cipher::get_or_create_cipher_key_sync(&data_dir)
            .unwrap_or_else(|e| {
                tracing::warn!("无法获取解密密钥: {}，直接返回加密值", e);
                let k = [0u8; 32];
                k
            });
        decrypt_credential(encoded, &key).unwrap_or_else(|| encoded.to_string())
    } else {
        encoded.to_string()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct InstancesDocument {
    instances: Vec<Instance>,
    #[serde(default)]
    stats: serde_yaml::Value,
}

fn normalize_channel_config(v: serde_json::Value) -> serde_json::Value {
    match v {
        serde_json::Value::String(s) => {
            serde_json::from_str(&s).unwrap_or(serde_json::Value::String(s))
        }
        other => other,
    }
}

/// 旧版实现把 `- id: ...` 块追加在 `stats` 之后（根级列表项），整文件无法被 serde 解析；此处按块回收
fn legacy_parse_instances(content: &str) -> Vec<Instance> {
    let mut blocks: Vec<String> = Vec::new();
    let mut cur: Vec<String> = Vec::new();
    for line in content.lines() {
        if line.starts_with("- id:") {
            if !cur.is_empty() {
                blocks.push(cur.join("\n"));
                cur.clear();
            }
        }
        if line.starts_with("- id:") || !cur.is_empty() {
            cur.push(line.to_string());
        }
    }
    if !cur.is_empty() {
        blocks.push(cur.join("\n"));
    }

    let mut out = Vec::new();
    for b in blocks {
        let wrapped = format!("instances:\n{}", b);
        if let Ok(doc) = serde_yaml::from_str::<InstancesDocument>(&wrapped) {
            out.extend(doc.instances);
        }
    }
    out
}

async fn read_instances_document(config_path: &str) -> InstancesDocument {
    let content = match tokio::fs::read_to_string(config_path).await {
        Ok(c) if !c.trim().is_empty() => c,
        _ => return InstancesDocument::default(),
    };

    match serde_yaml::from_str::<InstancesDocument>(&content) {
        Ok(mut doc) => {
            if doc.instances.is_empty() {
                let legacy = legacy_parse_instances(&content);
                if !legacy.is_empty() {
                    doc.instances = legacy;
                }
            }
            doc
        }
        Err(_) => {
            let legacy = legacy_parse_instances(&content);
            InstancesDocument {
                instances: legacy,
                stats: serde_yaml::Value::Null,
            }
        }
    }
}

async fn write_instances_document(
    config_path: &str,
    doc: &InstancesDocument,
) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(config_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建配置目录失败: {}", e))?;
    }
    let header = "# 实例配置\n# 实例 = 机器人 + 聊天通道 + 模型\n\n";
    let body =
        serde_yaml::to_string(doc).map_err(|e| format!("序列化 instances.yaml 失败: {}", e))?;
    let full = format!("{}{}", header, body);

    // 使用 OpenOptions + sync_all 替代简单 write，确保数据真正落盘（Windows/Linux 均适用）
    use tokio::fs::OpenOptions;
    use tokio::io::AsyncWriteExt;
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(config_path)
        .await
        .map_err(|e| format!("打开实例配置文件失败: {}", e))?;
    let mut file = file;
    file.write_all(full.as_bytes())
        .await
        .map_err(|e| format!("写入 instances.yaml 失败: {}", e))?;
    file.sync_all()
        .await
        .map_err(|e| format!("sync instances.yaml 失败: {}", e))?;
    Ok(())
}

// ── openclaw.json extraDirs 清理工具 ─────────────────────────────────────────

/// 读取 openclaw.json，从 skills.load.extraDirs 中移除所有包含指定机器人目录的条目
async fn cleanup_openclaw_extra_dirs(data_dir: &str, robot_id: &str) {
    let openclaw_json_path = PathBuf::from(data_dir)
        .join("openclaw-cn")
        .join("openclaw.json");

    let content = match tokio::fs::read_to_string(&openclaw_json_path).await {
        Ok(c) => c,
        Err(_) => return,
    };

    let mut json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return,
    };

    // 遍历 skills.load.extraDirs，移除匹配项。
    // 修复：先归一化路径（Windows backslash → forward slash），避免 `D:\data\robots\xxx` 与
    // forward-slash pattern "robots/xxx/skills" 无法匹配而导致清理失败。
    let robot_skills_pattern = format!("robots/{}/skills", robot_id);
    if let Some(extra_dirs) = json
        .get_mut("skills")
        .and_then(|s| s.get_mut("load"))
        .and_then(|l| l.get_mut("extraDirs"))
        .and_then(|ed| ed.as_array_mut())
    {
        extra_dirs.retain(|v| {
            v.as_str()
                .map(|s| {
                    let normalized = s.replace('\\', "/");
                    !normalized.contains(&robot_skills_pattern)
                })
                .unwrap_or(true)
        });
    }

    // 写回 openclaw.json（同样加 sync_all 确保原子落盘）
    if let Ok(new_content) = serde_json::to_string_pretty(&json) {
        use tokio::fs::OpenOptions;
        use tokio::io::AsyncWriteExt;
        match OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&openclaw_json_path)
            .await
        {
            Ok(file) => {
                let mut file = file;
                if file.write_all(new_content.as_bytes()).await.is_ok() {
                    let _ = file.sync_all().await;
                    info!("已从 openclaw extraDirs 中移除机器人 {} 相关目录", robot_id);
                }
            }
            Err(e) => warn!("清理 openclaw extraDirs 失败: {}", e),
        }
    }
}

// ── 实例命令 ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_instances(
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<Vec<Instance>, String> {
    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let config_path = format!("{}/config/instances.yaml", data_dir);
    let doc = read_instances_document(&config_path).await;
    Ok(doc.instances)
}

#[tauri::command]
pub async fn get_instance(
    data_dir: tauri::State<'_, crate::AppState>,
    instance_id: String,
) -> Result<Instance, String> {
    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let config_path = format!("{}/config/instances.yaml", data_dir);
    let doc = read_instances_document(&config_path).await;
    doc.instances
        .into_iter()
        .find(|i| i.id == instance_id)
        .ok_or_else(|| format!("未找到实例: {}", instance_id))
}

#[tauri::command]
pub async fn create_instance(
    data_dir: tauri::State<'_, crate::AppState>,
    name: String,
    robot_id: String,
    channel_type: String,
    channel_config: serde_json::Value,
    model_config: Option<ModelConfig>,
    max_history: usize,
    response_mode: String,
) -> Result<Instance, String> {
    info!("创建实例: {}", name);

    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let config_path = format!("{}/config/instances.yaml", data_dir);
    let now = chrono::Utc::now().to_rfc3339();

    let instance_id = format!("inst_{}", chrono::Utc::now().timestamp_millis());
    let channel_config = normalize_channel_config(channel_config);

    // 若前端未传模型配置，从 models.yaml 的 default_model 合并
    // 若前端传了配置但 api_key 为空，从 models.yaml 补全（支持「选模型 + 复用全局 Key」）
    let model = if let Some(mut cfg) = model_config {
        if cfg.api_key.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
            let models_yaml = tokio::fs::read_to_string(format!("{}/config/models.yaml", data_dir))
                .await
                .unwrap_or_default();
            cfg.api_key = extract_provider_api_key(&models_yaml, &cfg.provider);
        }
        Some(cfg)
    } else {
        read_default_model(&data_dir).await
    };

    let instance = Instance {
        id: instance_id,
        name,
        enabled: true,
        robot_id,
        channel_type,
        channel_config,
        model,
        max_history,
        response_mode,
        message_count: 0,
        created_at: now.clone(),
        updated_at: now,
    };

    let mut doc = read_instances_document(&config_path).await;
    doc.instances.push(instance.clone());
    write_instances_document(&config_path, &doc).await?;

    // 同步飞书凭证 + 路由到 openclaw.json（失败仅警告，不阻断保存）
    if let Err(e) = crate::commands::gateway::sync_openclaw_config_from_manager(&data_dir).await {
        warn!("保存实例后同步网关配置失败: {}", e);
    } else if matches!(
        instance.channel_type.as_str(),
        "wechat_clawbot" | "qq" | "wxwork"
    ) {
        // 同步后若同步线内「停网关 → ensure 插件 → 等端口」可长达数分钟，前端会一直卡在「创建中」。
        // openclaw.json 已写入，改为后台重启；插件通道（微信 / QQ / 企业微信）在网关起来后生效。
        let dd = data_dir.clone();
        let ch = instance.channel_type.clone();
        tokio::spawn(async move {
            info!(
                "通道 {} 实例已保存：正在后台重启网关以加载 openclaw.json（不阻塞创建接口）…",
                ch
            );
            match crate::commands::gateway::restart_gateway_if_running_for_wechat_config(&dd).await
            {
                Ok(()) => info!("实例创建后：网关后台重启流程结束"),
                Err(e) => warn!(
                    "新建实例后后台重启网关失败（请手动点「重启网关」使通道生效）: {}",
                    e
                ),
            }
        });
    }

    Ok(instance)
}

#[tauri::command]
pub async fn update_instance(
    data_dir: tauri::State<'_, crate::AppState>,
    instance_id: String,
    name: Option<String>,
    enabled: Option<bool>,
    channel_type: Option<String>,
    channel_config: Option<serde_json::Value>,
    model_config: Option<ModelConfig>,
) -> Result<Instance, String> {
    info!("更新实例: {}", instance_id);

    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let config_path = format!("{}/config/instances.yaml", data_dir);

    let mut doc = read_instances_document(&config_path).await;
    let inst = doc
        .instances
        .iter_mut()
        .find(|i| i.id == instance_id)
        .ok_or_else(|| format!("未找到实例: {}", instance_id))?;

    if let Some(n) = name {
        inst.name = n;
    }
    if let Some(e) = enabled {
        inst.enabled = e;
    }
    if let Some(ct) = channel_type {
        inst.channel_type = ct;
    }
    if let Some(cc) = channel_config {
        inst.channel_config = normalize_channel_config(cc);
    }
    if let Some(mut new_model) = model_config {
        if new_model
            .api_key
            .as_ref()
            .map(|s| s.is_empty())
            .unwrap_or(true)
        {
            let models_yaml = tokio::fs::read_to_string(format!("{}/config/models.yaml", data_dir))
                .await
                .unwrap_or_default();
            new_model.api_key = extract_provider_api_key(&models_yaml, &new_model.provider);
        }
        inst.model = Some(new_model);
    }
    inst.updated_at = chrono::Utc::now().to_rfc3339();

    let updated = inst.clone();
    write_instances_document(&config_path, &doc).await?;

    // 同步飞书凭证 + 路由到 openclaw.json（失败仅警告，不阻断保存）
    if let Err(e) = crate::commands::gateway::sync_openclaw_config_from_manager(&data_dir).await {
        warn!("更新实例后同步网关配置失败: {}", e);
    } else if matches!(
        updated.channel_type.as_str(),
        "wechat_clawbot" | "qq" | "wxwork"
    ) {
        let dd = data_dir.clone();
        let ch = updated.channel_type.clone();
        tokio::spawn(async move {
            info!(
                "通道 {} 实例已更新：正在后台重启网关以应用 openclaw.json（不阻塞更新接口）…",
                ch
            );
            if let Err(e) =
                crate::commands::gateway::restart_gateway_if_running_for_wechat_config(&dd).await
            {
                warn!("更新实例后后台重启网关失败（请手动「重启网关」）: {}", e);
            }
        });
    }

    Ok(updated)
}

#[tauri::command]
pub async fn delete_instance(
    data_dir: tauri::State<'_, crate::AppState>,
    instance_id: String,
) -> Result<String, String> {
    info!("删除实例: {}", instance_id);

    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let config_path = format!("{}/config/instances.yaml", data_dir);

    // 从 YAML 读取当前实例（含 robot_id）
    let doc = read_instances_document(&config_path).await;
    let robot_id = doc
        .instances
        .iter()
        .find(|i| i.id == instance_id)
        .map(|i| i.robot_id.clone());

    let n_before = doc.instances.len();
    let mut doc = doc;
    doc.instances.retain(|i| i.id != instance_id);
    if doc.instances.len() == n_before {
        return Err(format!("未找到实例: {}", instance_id));
    }

    // 删除前统计引用计数：修改后的 YAML 中该 robot_id 还剩几个实例
    let refs_after_delete = count_robot_refs(&doc.instances);

    write_instances_document(&config_path, &doc).await?;

    // 清理 openclaw extraDirs（不管引用计数，都要清除引用）
    if let Some(ref rid) = robot_id {
        cleanup_openclaw_extra_dirs(&data_dir, rid).await;
    }

    // 删除 robots/{robot_id} 目录（引用计数归零才删）
    if let Some(rid) = robot_id {
        try_delete_robot_dir(&data_dir, &rid, &refs_after_delete).await;
    }

    // 同步 openclaw.json agents/bindings（失败仅警告）
    if let Err(e) = crate::commands::gateway::sync_openclaw_config_from_manager(&data_dir).await {
        warn!("删除实例后同步网关配置失败: {}", e);
    }

    Ok(format!("实例 {} 已删除", instance_id))
}

#[tauri::command]
pub async fn toggle_instance(
    data_dir: tauri::State<'_, crate::AppState>,
    instance_id: String,
    enabled: bool,
) -> Result<String, String> {
    info!("切换实例 {} 状态: {}", instance_id, enabled);

    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let config_path = format!("{}/config/instances.yaml", data_dir);

    let mut doc = read_instances_document(&config_path).await;
    let inst = doc
        .instances
        .iter_mut()
        .find(|i| i.id == instance_id)
        .ok_or_else(|| format!("未找到实例: {}", instance_id))?;
    inst.enabled = enabled;
    inst.updated_at = chrono::Utc::now().to_rfc3339();

    write_instances_document(&config_path, &doc).await?;

    // 同步飞书凭证 + 路由到 openclaw.json（失败仅警告，不阻断保存）
    if let Err(e) = crate::commands::gateway::sync_openclaw_config_from_manager(&data_dir).await {
        warn!("切换实例状态后同步网关配置失败: {}", e);
    }

    Ok(format!(
        "实例 {} 已{}",
        instance_id,
        if enabled { "启用" } else { "停用" }
    ))
}
