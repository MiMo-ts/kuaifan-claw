// 模型管理命令

use crate::models::ModelProvider;
use crate::services::cipher::CIPHER_PREFIX;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsageRecord {
    pub ts: String,
    pub provider: String,
    pub model: String,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
    pub source: String,
}

fn usage_file_path(data_dir: &str) -> PathBuf {
    PathBuf::from(data_dir)
        .join("metrics")
        .join("token_usage.jsonl")
}

/// 与网关 `read_default_model_primary` 使用同一套读取逻辑（支持 UTF-8 / UTF-16 LE/BE 带 BOM）。
fn read_models_yaml_text_for_manager(data_dir: &str) -> Result<String, String> {
    let path = PathBuf::from(data_dir).join("config").join("models.yaml");
    crate::commands::gateway::read_models_yaml_raw_utf8_or_utf16(path.as_path()).ok_or_else(|| {
        format!(
            "读取 models.yaml 失败（{}）。文件可能不存在、被占用，或编码无法识别（请用 UTF-8 保存）。",
            path.display()
        )
    })
}

async fn write_token_usage(
    data_dir: &str,
    provider: &str,
    model: &str,
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
    source: &str,
) -> Result<(), String> {
    let file_path = usage_file_path(data_dir);
    tokio::fs::create_dir_all(file_path.parent().unwrap())
        .await
        .map_err(|e| format!("创建目录失败: {}", e))?;

    let record = TokenUsageRecord {
        ts: chrono::Utc::now().to_rfc3339(),
        provider: provider.to_string(),
        model: model.to_string(),
        prompt_tokens,
        completion_tokens,
        total_tokens,
        source: source.to_string(),
    };

    let line = serde_json::to_string(&record).map_err(|e| format!("序列化失败: {}", e))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
        .await
        .map_err(|e| format!("打开文件失败: {}", e))?;

    file.write_all(format!("{}\n", line).as_bytes())
        .await
        .map_err(|e| format!("写入文件失败: {}", e))?;
    file.sync_all()
        .await
        .map_err(|e| format!("写入文件失败（sync）: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn list_providers() -> Result<Vec<ModelProvider>, String> {
    // 返回所有模型供应商列表
    let providers = vec![
        ModelProvider {
            id: "openrouter".to_string(),
            name: "OpenRouter".to_string(),
            enabled: true,
            api_key_configured: false,
            free_models_count: 30,
            total_models_count: 150,
        },
        ModelProvider {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            enabled: false,
            api_key_configured: false,
            free_models_count: 0,
            total_models_count: 20,
        },
        ModelProvider {
            id: "anthropic".to_string(),
            name: "Claude（Anthropic）".to_string(),
            enabled: false,
            api_key_configured: false,
            free_models_count: 0,
            total_models_count: 10,
        },
        ModelProvider {
            id: "google".to_string(),
            name: "Google Gemini".to_string(),
            enabled: false,
            api_key_configured: false,
            free_models_count: 0,
            total_models_count: 10,
        },
        ModelProvider {
            id: "deepseek".to_string(),
            name: "DeepSeek".to_string(),
            enabled: false,
            api_key_configured: false,
            free_models_count: 0,
            total_models_count: 5,
        },
        ModelProvider {
            id: "minimax".to_string(),
            name: "MiniMax（M2.1 / M2.5 / M2.7 · 海螺）".to_string(),
            enabled: false,
            api_key_configured: false,
            free_models_count: 0,
            total_models_count: 24,
        },
        ModelProvider {
            id: "volc_ark".to_string(),
            name: "火山方舟 · 豆包".to_string(),
            enabled: false,
            api_key_configured: false,
            free_models_count: 0,
            total_models_count: 19,
        },
        ModelProvider {
            id: "nvidia".to_string(),
            name: "NVIDIA NIM".to_string(),
            enabled: false,
            api_key_configured: false,
            free_models_count: 0,
            total_models_count: 15,
        },
        ModelProvider {
            id: "xiaomi".to_string(),
            name: "小米 MiMo".to_string(),
            enabled: false,
            api_key_configured: false,
            free_models_count: 0,
            total_models_count: 3,
        },
        ModelProvider {
            id: "baidu".to_string(),
            name: "百度文心一言".to_string(),
            enabled: false,
            api_key_configured: false,
            free_models_count: 1,
            total_models_count: 10,
        },
        ModelProvider {
            id: "aliyun".to_string(),
            name: "阿里通义千问".to_string(),
            enabled: false,
            api_key_configured: false,
            free_models_count: 0,
            total_models_count: 10,
        },
        ModelProvider {
            id: "zhipu".to_string(),
            name: "智谱 GLM".to_string(),
            enabled: false,
            api_key_configured: false,
            free_models_count: 1,
            total_models_count: 8,
        },
        ModelProvider {
            id: "moonshot".to_string(),
            name: "Kimi（月之暗面）".to_string(),
            enabled: false,
            api_key_configured: false,
            free_models_count: 1,
            total_models_count: 8,
        },
        ModelProvider {
            id: "grok".to_string(),
            name: "Grok (xAI)".to_string(),
            enabled: false,
            api_key_configured: false,
            free_models_count: 0,
            total_models_count: 5,
        },
        ModelProvider {
            id: "ollama".to_string(),
            name: "Ollama 本地模型".to_string(),
            enabled: false,
            api_key_configured: true,
            free_models_count: 100,
            total_models_count: 100,
        },
    ];

    Ok(providers)
}

#[tauri::command]
pub async fn get_provider_config(
    data_dir: tauri::State<'_, crate::AppState>,
    provider_id: String,
) -> Result<serde_json::Value, String> {
    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();

    let content = read_models_yaml_text_for_manager(&data_dir)?;

    // 解析 models.yaml 中指定 provider_id 的配置块
    let lines: Vec<&str> = content.lines().collect();
    let mut in_provider_block = false;
    let mut block_lines: Vec<String> = Vec::new();
    let target = format!("{}:", provider_id);

    for line in lines {
        let trimmed = line.trim();
        // 匹配顶级 provider 块（如 `openrouter:` 或 `volc_ark:`），
        // 但排除列表项（如 `    - id: "volc_ark-xxx"` 中的 volc_ark）。
        if !trimmed.starts_with('-')
            && !trimmed.starts_with("  -")
            && trimmed.starts_with(&target)
            && !trimmed.starts_with("default_model:")
        {
            in_provider_block = true;
        }
        if in_provider_block {
            // 遇到下一个 provider 定义或顶级 key 时停止
            if block_lines.len() > 1
                && (line.trim().starts_with('-')
                    || (!line.starts_with("  ")
                        && !line.starts_with('\t')
                        && !line.trim().is_empty()))
            {
                break;
            }
            block_lines.push(line.to_string());
        }
    }

    if block_lines.is_empty() {
        // 文件中无此供应商，返回默认值
        return Ok(serde_json::json!({
            "id": provider_id,
            "enabled": false,
            "api_key": "",
            "models": []
        }));
    }

    // 从 block_lines 中提取 api_key、enabled 和代理设置，并将加密的凭据解密后返回给前端
    let mut api_key = String::new();
    let mut enabled = false;
    let mut proxy_url = String::new();
    let mut proxy_username = String::new();
    let mut proxy_password = String::new();

    for line in &block_lines {
        let trimmed = line.trim();
        if trimmed.starts_with("api_key:") {
            api_key = trimmed
                .split(':')
                .nth(1)
                .unwrap_or("")
                .trim()
                .trim_matches('"')
                .to_string();
        } else if trimmed.starts_with("enabled:") {
            if let Some(val) = trimmed.split(':').nth(1) {
                enabled = val.trim() == "true";
            }
        } else if trimmed.starts_with("proxy_url:") {
            proxy_url = trimmed
                .split(':')
                .nth(1)
                .unwrap_or("")
                .trim()
                .trim_matches('"')
                .to_string();
        } else if trimmed.starts_with("proxy_username:") {
            proxy_username = trimmed
                .split(':')
                .nth(1)
                .unwrap_or("")
                .trim()
                .trim_matches('"')
                .to_string();
        } else if trimmed.starts_with("proxy_password:") {
            proxy_password = trimmed
                .split(':')
                .nth(1)
                .unwrap_or("")
                .trim()
                .trim_matches('"')
                .to_string();
        }
    }

    // 解密返回给前端的 api_key（前端不需要知道加密格式）
    if api_key.starts_with(CIPHER_PREFIX) {
        let api_key_clone = api_key.clone();
        let data_dir_str = data_dir.clone();
        let key = match crate::services::cipher::get_or_create_cipher_key_sync(&data_dir_str) {
            Ok(k) => k,
            Err(e) => {
                tracing::warn!("无法获取解密密钥: {}，返回原值", e);
                let fallback_key = [0u8; 32];
                fallback_key
            }
        };
        api_key = crate::services::cipher::decrypt_credential(&api_key_clone, &key)
            .unwrap_or_else(|| api_key_clone);
    }

    Ok(serde_json::json!({
        "id": provider_id,
        "enabled": enabled,
        "api_key": api_key,
        "proxy_url": proxy_url,
        "proxy_username": proxy_username,
        "proxy_password": proxy_password,
        "models": []
    }))
}

/// 将 models.yaml 内容中的指定 provider api_key 进行 upsert，返回新内容。
/// 当 provider 块已存在时替换 api_key: 行；当块存在但无 api_key 时追加一行；
/// 当块不存在时，查找 providers: 块并在块内追加新 provider（不在根级追加）。
/// UI 供应商 ID → models.yaml 中实际 key 的别名映射。
/// 模板中 volcengine，UI 中 volc_ark；需要相互回退。
fn yaml_id_alias(id: &str) -> Option<&'static str> {
    match id {
        "volc_ark" => Some("volcengine"),
        "volcengine" => Some("volc_ark"),
        _ => None,
    }
}

fn upsert_provider_api_key(content: &str, provider_id: &str, api_key: &str) -> String {
    let target_header = format!("{}:", provider_id);

    let lines: Vec<&str> = content.lines().collect::<Vec<_>>();
    let mut block_start: Option<usize> = None;
    let mut block_end: Option<usize> = None;

    // 第一遍：直接查找 provider_id
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if !trimmed.starts_with('-')
            && !trimmed.starts_with("  -")
            && trimmed.starts_with(&target_header)
            && !trimmed.starts_with("default_model:")
        {
            block_start = Some(i);
        } else if let Some(start) = block_start {
            if i > start
                && (!line.starts_with("  ") && !line.starts_with('\t'))
                && !trimmed.is_empty()
            {
                block_end = Some(i);
                break;
            }
        }
    }

    // 第二遍：别名回退（如 volc_ark 未找到，尝试 volcengine）
    if block_start.is_none() {
        if let Some(alias) = yaml_id_alias(provider_id) {
            let alias_header = format!("{}:", alias);
            for (i, line) in lines.iter().enumerate() {
                let trimmed = line.trim();
                if !trimmed.starts_with('-')
                    && !trimmed.starts_with("  -")
                    && trimmed.starts_with(&alias_header)
                    && !trimmed.starts_with("default_model:")
                {
                    block_start = Some(i);
                } else if let Some(start) = block_start {
                    if i > start
                        && (!line.starts_with("  ") && !line.starts_with('\t'))
                        && !trimmed.is_empty()
                    {
                        block_end = Some(i);
                        break;
                    }
                }
            }
        }
    }

    let api_key_line_inside = format!("    api_key: \"{}\"", api_key);

    match (block_start, block_end) {
        (Some(start), end_opt) => {
            let end = end_opt.unwrap_or(lines.len());
            let mut new_lines: Vec<String> = lines[..start].iter().map(|s| s.to_string()).collect();
            let in_block = &lines[start..end];
            let mut has_api_key = false;
            for line in in_block {
                if line.trim().starts_with("api_key:") {
                    has_api_key = true;
                    break;
                }
            }
            if has_api_key {
                for line in in_block {
                    if line.trim().starts_with("api_key:") {
                        new_lines.push(api_key_line_inside.clone());
                    } else {
                        new_lines.push(line.to_string());
                    }
                }
            } else {
                let mut block_lines: Vec<String> = in_block.iter().map(|s| s.to_string()).collect();
                let insert_pos = block_lines.len().saturating_sub(
                    block_lines.iter().rev().take_while(|s| s.trim().is_empty()).count(),
                );
                block_lines.insert(insert_pos.max(1), api_key_line_inside.clone());
                new_lines.extend(block_lines);
            }
            new_lines.extend(lines[end..].iter().map(|s| s.to_string()));
            new_lines.join("\n")
        }
        (None, _) => upsert_append_provider_inside_providers_block(content, provider_id, &api_key_line_inside),
    }
}

/// 在 provider block 中更新或插入 proxy_url / proxy_username / proxy_password 字段
fn upsert_provider_proxy_config(
    content: &str,
    provider_id: &str,
    proxy_url: &str,
    proxy_username: &str,
    proxy_password: &str,
) -> String {
    let target_header = format!("{}:", provider_id);

    let lines: Vec<&str> = content.lines().collect::<Vec<_>>();
    let mut block_start: Option<usize> = None;
    let mut block_end: Option<usize> = None;

    // 第一遍：直接查找 provider_id
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if !trimmed.starts_with('-')
            && !trimmed.starts_with("  -")
            && trimmed.starts_with(&target_header)
            && !trimmed.starts_with("default_model:")
        {
            block_start = Some(i);
        } else if let Some(start) = block_start {
            if i > start
                && (!line.starts_with("  ") && !line.starts_with('\t'))
                && !trimmed.is_empty()
            {
                block_end = Some(i);
                break;
            }
        }
    }

    // 第二遍：别名回退
    if block_start.is_none() {
        if let Some(alias) = yaml_id_alias(provider_id) {
            let alias_header = format!("{}:", alias);
            for (i, line) in lines.iter().enumerate() {
                let trimmed = line.trim();
                if !trimmed.starts_with('-')
                    && !trimmed.starts_with("  -")
                    && trimmed.starts_with(&alias_header)
                    && !trimmed.starts_with("default_model:")
                {
                    block_start = Some(i);
                } else if let Some(start) = block_start {
                    if i > start
                        && (!line.starts_with("  ") && !line.starts_with('\t'))
                        && !trimmed.is_empty()
                    {
                        block_end = Some(i);
                        break;
                    }
                }
            }
        }
    }

    let proxy_url_line = format!("    proxy_url: \"{}\"", proxy_url);
    let proxy_username_line = format!("    proxy_username: \"{}\"", proxy_username);
    let proxy_password_line = format!("    proxy_password: \"{}\"", proxy_password);

    match (block_start, block_end) {
        (Some(start), end_opt) => {
            let end = end_opt.unwrap_or(lines.len());
            let mut new_lines: Vec<String> = lines[..start].iter().map(|s| s.to_string()).collect();
            let in_block: Vec<&str> = lines[start..end].to_vec();
            let mut has_proxy_url = false;
            let mut has_proxy_username = false;
            let mut has_proxy_password = false;

            for line in &in_block {
                let trimmed = line.trim();
                if trimmed.starts_with("proxy_url:") {
                    has_proxy_url = true;
                } else if trimmed.starts_with("proxy_username:") {
                    has_proxy_username = true;
                } else if trimmed.starts_with("proxy_password:") {
                    has_proxy_password = true;
                }
            }

            let mut out_block: Vec<String> = Vec::new();
            for line in &in_block {
                let trimmed = line.trim();
                if trimmed.starts_with("proxy_url:") {
                    out_block.push(proxy_url_line.clone());
                } else if trimmed.starts_with("proxy_username:") {
                    out_block.push(proxy_username_line.clone());
                } else if trimmed.starts_with("proxy_password:") {
                    out_block.push(proxy_password_line.clone());
                } else {
                    out_block.push(line.to_string());
                }
            }

            // 如果没有找到对应的行，则追加
            if !has_proxy_url {
                let insert_pos = out_block.len().saturating_sub(
                    out_block.iter().rev().take_while(|s| s.trim().is_empty()).count(),
                );
                out_block.insert(insert_pos.max(1), proxy_url_line);
            }
            if !has_proxy_username {
                let insert_pos = out_block.len().saturating_sub(
                    out_block.iter().rev().take_while(|s| s.trim().is_empty()).count(),
                );
                out_block.insert(insert_pos.max(1), proxy_username_line);
            }
            if !has_proxy_password {
                let insert_pos = out_block.len().saturating_sub(
                    out_block.iter().rev().take_while(|s| s.trim().is_empty()).count(),
                );
                out_block.insert(insert_pos.max(1), proxy_password_line);
            }

            new_lines.extend(out_block);
            new_lines.extend(lines[end..].iter().map(|s| s.to_string()));
            new_lines.join("\n")
        }
        (None, _) => {
            // provider 不存在，跳过代理设置（应由 save_provider_config 先创建 provider）
            content.to_string()
        }
    }
}

/// 当 providers: 块内找不到目标 provider 时，将新块追加到 providers: 块内部。
/// 追加位置：providers: 块的最后一个已有 provider 之后（而非根级末尾）。
fn upsert_append_provider_inside_providers_block(content: &str, provider_id: &str, api_key_line: &str) -> String {
    let lines: Vec<&str> = content.lines().collect::<Vec<_>>();

    let providers_header_idx = lines.iter().position(|l| l.trim() == "providers:");

    if let Some(pidx) = providers_header_idx {
        let mut last_provider_end: Option<usize> = None;
        let mut in_provider = false;
        let mut current_provider_indent = 0usize;

        for (i, line) in lines.iter().enumerate().skip(pidx + 1) {
            if !in_provider {
                if (line.starts_with("  ") && !line.starts_with("    "))
                    && !line.trim().starts_with('#')
                    && !line.trim().is_empty()
                    && !line.trim().starts_with("default_model")
                {
                    in_provider = true;
                    current_provider_indent = line.len() - line.trim_start().len();
                }
                continue;
            }

            if i == lines.len() - 1 {
                last_provider_end = Some(i);
                break;
            }

            let next_raw = lines[i + 1];
            let next_indent = next_raw.len() - next_raw.trim_start().len();

            if next_indent <= current_provider_indent && !next_raw.trim().is_empty() {
                last_provider_end = Some(i);
                break;
            }
        }

        if let Some(insert_after) = last_provider_end {
            let mut new_lines: Vec<String> = lines[..=insert_after].iter().map(|s| s.to_string()).collect();
            new_lines.push(format!("  {}:", provider_id));
            new_lines.push(api_key_line.to_string());
            new_lines.extend(lines[insert_after + 1..].iter().map(|s| s.to_string()));
            return new_lines.join("\n");
        }

        let mut new_lines: Vec<String> = lines[..=pidx].iter().map(|s| s.to_string()).collect();
        new_lines.push(format!("  {}:", provider_id));
        new_lines.push(api_key_line.to_string());
        new_lines.extend(lines[pidx + 1..].iter().map(|s| s.to_string()));
        return new_lines.join("\n");
    }

    let separator = if content.trim().is_empty() { "" } else { "\n" };
    format!(
        "{}{}providers:\n  {}:\n{}\n",
        content.trim_end(),
        separator,
        provider_id,
        api_key_line
    )
}
#[tauri::command]
pub async fn save_provider_config(
    data_dir: tauri::State<'_, crate::AppState>,
    provider_id: String,
    api_key: String,
    proxy_url: Option<String>,
    proxy_username: Option<String>,
    proxy_password: Option<String>,
) -> Result<String, String> {
    info!("保存供应商配置: {}", provider_id);

    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let config_path = PathBuf::from(&data_dir).join("config").join("models.yaml");

    let content = read_models_yaml_text_for_manager(&data_dir)?;

    // 新凭据直接加密后写入（而非明文）
    let encrypted_api_key = tokio::task::spawn_blocking({
        let data_dir_clone = data_dir.clone();
        let api_key_clone = api_key.clone();
        move || {
            let key = crate::services::cipher::get_or_create_cipher_key_sync(&data_dir_clone)
                .map_err(|e| format!("Failed to get encryption key: {}", e))?;
            Ok::<_, String>(crate::services::cipher::encrypt_credential(&api_key_clone, &key))
        }
    })
    .await
    .map_err(|e| format!("Key task failed: {}", e))?
    .map_err(|e| e)?;

    // 先更新 api_key
    let new_content = upsert_provider_api_key(&content, &provider_id, &encrypted_api_key);

    // 再更新代理设置（如果提供）
    let final_content = if proxy_url.is_some() || proxy_username.is_some() || proxy_password.is_some() {
        upsert_provider_proxy_config(
            &new_content,
            &provider_id,
            proxy_url.as_deref().unwrap_or(""),
            proxy_username.as_deref().unwrap_or(""),
            proxy_password.as_deref().unwrap_or(""),
        )
    } else {
        new_content
    };

    // Write with sync_all to avoid data loss
    let mut f = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&config_path)
        .await
        .map_err(|e| format!("Failed to open config file: {}", e))?;
    f.write_all(final_content.as_bytes())
        .await
        .map_err(|e| format!("Failed to write config: {}", e))?;
    f.sync_all()
        .await
        .map_err(|e| format!("Failed to sync config: {}", e))?;

    Ok(format!("Provider {} config saved", provider_id))
}

async fn test_openai_compatible_chat(
    url: &str,
    data_dir: &str,
    provider: &str,
    api_key: &str,
    model_name: &str,
    proxy_url: Option<&str>,
    proxy_username: Option<&str>,
    proxy_password: Option<&str>,
) -> Result<serde_json::Value, String> {
    let mut client_builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45));

    // 配置代理（如果提供）
    if let Some(p_url) = proxy_url {
        if !p_url.is_empty() {
            let mut proxy = reqwest::Proxy::http(p_url).map_err(|e| e.to_string())?;
            if let Some(user) = proxy_username {
                if !user.is_empty() {
                    proxy = proxy.basic_auth(user, proxy_password.unwrap_or(""));
                }
            }
            client_builder = client_builder.proxy(proxy);
        }
    }

    let client = client_builder.build().map_err(|e| e.to_string())?;
    let response = client
        .post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": model_name,
            "messages": [{"role": "user", "content": "Hi"}],
            "max_tokens": 12
        }))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if response.status().is_success() {
        if let Ok(body) = response.json::<serde_json::Value>().await {
            let dir_clone = data_dir.to_string();
            let provider_clone = provider.to_string();
            let model_clone = model_name.to_string();
            if let Some(usage) = body.get("usage") {
                let prompt_tokens = usage
                    .get("prompt_tokens")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as u32;
                let completion_tokens = usage
                    .get("completion_tokens")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as u32;
                let total_tokens = usage
                    .get("total_tokens")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0) as u32;
                let _handle = tokio::spawn(async move {
                    if let Err(e) = write_token_usage(
                        &dir_clone,
                        &provider_clone,
                        &model_clone,
                        prompt_tokens,
                        completion_tokens,
                        total_tokens,
                        "test_connection",
                    )
                    .await
                    {
                        tracing::warn!("记录 token 用量失败: {}", e);
                    }
                });
            } else {
                // 部分供应商成功响应里不含 usage，仍记一条便于仪表盘时间线更新（合计为 0）
                let _handle = tokio::spawn(async move {
                    if let Err(e) = write_token_usage(
                        &dir_clone,
                        &provider_clone,
                        &model_clone,
                        0,
                        0,
                        0,
                        "test_connection_no_usage",
                    )
                    .await
                    {
                        tracing::warn!("记录 token 用量失败: {}", e);
                    }
                });
            }
        }
        Ok(serde_json::json!({
            "success": true,
            "message": "连接成功"
        }))
    } else {
        let err = response.text().await.unwrap_or_default();
        Err(format!("连接失败: {}", err))
    }
}

/// OpenRouter 聚合多家上游；同一 Key 下不同模型走不同供应商，失败原因不一致。将 JSON 错误附上中文说明便于区分限流 / 地域 / 模型类型等。
fn explain_openrouter_test_error(body: &str) -> String {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(body) else {
        return body.to_string();
    };
    let Some(err) = v.get("error") else {
        return body.to_string();
    };
    let code = err.get("code").and_then(|c| {
        c.as_u64()
            .or_else(|| c.as_i64().map(|i| if i < 0 { 0 } else { i as u64 }))
    });
    let msg = err
        .get("message")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_string();
    let meta = err.get("metadata").cloned().unwrap_or(serde_json::json!({}));
    let raw = meta
        .get("raw")
        .and_then(|m| m.as_str())
        .unwrap_or("");
    let upstream = meta
        .get("provider_name")
        .and_then(|m| m.as_str())
        .unwrap_or("");

    let mut lines: Vec<String> = Vec::new();
    match code {
        Some(429) => {
            lines.push(
                "【常见原因】上游（如 Google AI Studio、Venice 等）对「免费/共享路由」做了瞬时限流，与 OpenRouter Key 是否有效无必然关系。".into(),
            );
            lines.push(
                "【可尝试】稍后重试、换其它 :free 模型，或在 OpenRouter → Settings → Integrations 绑定各云厂商自有 Key 以累计独立额度。".into(),
            );
        }
        Some(403) => {
            let lower = msg.to_lowercase();
            if lower.contains("region") || msg.contains("地区") {
                lines.push("【常见原因】该模型在当前国家/地区或网络环境下被上游禁止（地域策略）。".into());
                lines.push("【可尝试】换用其它模型/供应商路线。".into());
            } else {
                lines.push("【常见原因】访问被拒绝（403）：权限、地域或许可未开通。".into());
            }
        }
        Some(400) => {
            lines.push(
                "【常见原因】模型 ID 无效，或该条目不是对话补全类模型（部分音视频等专用模型无法用 chat/completions 做探测）。".into(),
            );
        }
        _ => {}
    }
    if !upstream.is_empty() {
        lines.push(format!("【本次上游】{}", upstream));
    }
    if !raw.is_empty() && raw != msg.as_str() {
        lines.push(format!("【详情】{}", raw));
    }
    if lines.is_empty() {
        return body.to_string();
    }
    format!("{}\n{}", lines.join("\n"), body)
}

#[tauri::command]
pub async fn test_model_connection(
    data_dir: tauri::State<'_, crate::AppState>,
    provider: String,
    model_name: String,
    api_key: String,
    proxy_url: Option<String>,
    proxy_username: Option<String>,
    proxy_password: Option<String>,
) -> Result<serde_json::Value, String> {
    info!("测试模型连接: {} / {}", provider, model_name);
    let data_dir_clone = data_dir.inner().data_dir.lock().unwrap().clone();

    // =============================================================================
    // 各供应商测试 URL 与官方文档对照（每次修改前请同步更新此注释块）
    //
    // openai:        https://api.openai.com/v1/chat/completions
    //                 官方：https://platform.openai.com/docs/api-reference/introduction
    // anthropic:     https://api.anthropic.com/v1/messages  （特殊路径，非 Chat）
    //                 官方：https://docs.anthropic.com/en/api/messages
    // google:        https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}
    //                 官方：https://ai.google.dev/gemini-api/docs
    // deepseek:      https://api.deepseek.com/v1/chat/completions
    //                 官方：https://api-docs.deepseek.com/
    // minimax:       https://api.minimax.chat/v1/chat/completions
    //                 官方（OpenAI兼容）：https://platform.minimax.io/docs/guides/text-chat
    //                 备选域名（部分账号）：https://api.minimax.io/v1
    // volc_ark:      https://ark.cn-beijing.volces.com/api/v3/chat/completions
    //                 官方：https://www.volcengine.com/docs/82379/1298459（Base URL及鉴权）
    //                          https://www.volcengine.com/docs/82379/1494384（对话API）
    //                 注意：Seedream/Seedance 的 OpenAI-compatible 路径仍为 /v3/chat/completions，
    //                       但 prompt 格式与纯对话不同；用标准对话 prompt 测试会返回能力不匹配。
    //                 图片生成独立API：https://www.volcengine.com/docs/82379/1541523
    //                 视频生成独立API：https://www.volcengine.com/docs/82379/1520757
    // nvidia:        https://integrate.api.nvidia.com/v1/chat/completions
    //                 官方：https://docs.nvidia.com/nim/
    // aliyun:        https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
    //                 官方：https://help.aliyun.com/document_detail/25183868.html
    // zhipu:         https://open.bigmodel.cn/api/paas/v4/chat/completions
    //                 官方：https://open.bigmodel.cn/dev/api
    // moonshot:      https://api.moonshot.cn/v1/chat/completions
    //                 官方：https://platform.moonshot.cn/docs
    // xiaomi:        https://api.xiaomi.com/v1/chat/completions  （需官方确认，当前占位）
    //                 官方：https://platform.xiaomi.com/  （如有）
    // openrouter:    https://openrouter.ai/api/v1/chat/completions
    //                 官方：https://openrouter.ai/docs
    // ollama:        http://localhost:11434/api/generate  （本地，无需 Key）
    // =============================================================================

    // 根据不同的供应商进行测试
    match provider.as_str() {
        "openrouter" => {
            let client = reqwest::Client::new();
            let response = client
                .post("https://openrouter.ai/api/v1/chat/completions")
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .json(&serde_json::json!({
                    "model": model_name,
                    "messages": [{"role": "user", "content": "Hello"}],
                    "max_tokens": 10
                }))
                .send()
                .await
                .map_err(|e| format!("请求失败: {}", e))?;

            if response.status().is_success() {
                // 解析 usage 并记录
                if let Ok(body) = response.json::<serde_json::Value>().await {
                    let dir_clone = data_dir_clone.clone();
                    let provider_clone = provider.clone();
                    let model_clone = model_name.clone();
                    if let Some(usage) = body.get("usage") {
                        let prompt_tokens = usage
                            .get("prompt_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0) as u32;
                        let completion_tokens = usage
                            .get("completion_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0) as u32;
                        let total_tokens = usage
                            .get("total_tokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0) as u32;

                        let _handle = tokio::spawn(async move {
                            if let Err(e) = write_token_usage(
                                &dir_clone,
                                &provider_clone,
                                &model_clone,
                                prompt_tokens,
                                completion_tokens,
                                total_tokens,
                                "test_connection",
                            )
                            .await
                            {
                                tracing::warn!("记录 token 用量失败: {}", e);
                            }
                        });
                    } else {
                        let _handle = tokio::spawn(async move {
                            if let Err(e) = write_token_usage(
                                &dir_clone,
                                &provider_clone,
                                &model_clone,
                                0,
                                0,
                                0,
                                "test_connection_no_usage",
                            )
                            .await
                            {
                                tracing::warn!("记录 token 用量失败: {}", e);
                            }
                        });
                    }
                }

                Ok(serde_json::json!({
                    "success": true,
                    "message": "连接成功"
                }))
            } else {
                let error = response.text().await.unwrap_or_default();
                Err(format!(
                    "连接失败: {}",
                    explain_openrouter_test_error(&error)
                ))
            }
        }
        "ollama" => {
            let client = reqwest::Client::new();
            let response = client
                .post("http://localhost:11434/api/generate")
                .json(&serde_json::json!({
                    "model": model_name,
                    "prompt": "Hello",
                    "stream": false
                }))
                .send()
                .await
                .map_err(|e| format!("Ollama 连接失败: {}", e))?;

            if response.status().is_success() {
                let dir_clone = data_dir_clone.clone();
                let provider_clone = provider.clone();
                let model_clone = model_name.clone();
                // Ollama 响应无标准 usage 字段，记一条 0-token 行便于仪表盘时间线更新
                let _handle = tokio::spawn(async move {
                    if let Err(e) = write_token_usage(
                        &dir_clone,
                        &provider_clone,
                        &model_clone,
                        0,
                        0,
                        0,
                        "test_connection",
                    )
                    .await
                    {
                        tracing::warn!("记录 Ollama token 用量失败: {}", e);
                    }
                });
                Ok(serde_json::json!({
                    "success": true,
                    "message": "Ollama 连接成功"
                }))
            } else {
                Err("Ollama 未运行或模型不存在".to_string())
            }
        }
        "openai" => {
            test_openai_compatible_chat(
                "https://api.openai.com/v1/chat/completions",
                &data_dir_clone,
                &provider,
                &api_key,
                &model_name,
                proxy_url.as_deref(),
                proxy_username.as_deref(),
                proxy_password.as_deref(),
            )
            .await
        }
        "anthropic" => {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(45))
                .build()
                .map_err(|e| e.to_string())?;
            let response = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01")
                .header("Content-Type", "application/json")
                .json(&serde_json::json!({
                    "model": model_name,
                    "max_tokens": 20,
                    "messages": [{"role": "user", "content": "Hi"}]
                }))
                .send()
                .await
                .map_err(|e| format!("Anthropic 请求失败: {}", e))?;

            if response.status().is_success() {
                let dir_clone = data_dir_clone.clone();
                let provider_clone = provider.clone();
                let model_clone = model_name.clone();
                // Anthropic 响应无标准 usage，记 0-token 行便于仪表盘时间线更新
                let _handle = tokio::spawn(async move {
                    if let Err(e) = write_token_usage(
                        &dir_clone,
                        &provider_clone,
                        &model_clone,
                        0,
                        0,
                        0,
                        "test_connection",
                    )
                    .await
                    {
                        tracing::warn!("记录 Anthropic token 用量失败: {}", e);
                    }
                });
                Ok(serde_json::json!({
                    "success": true,
                    "message": "Claude API 连接成功"
                }))
            } else {
                Err(format!(
                    "连接失败: {}",
                    response.text().await.unwrap_or_default()
                ))
            }
        }
        "google" => {
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                model_name, api_key
            );
            let mut client_builder = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(45));

            // 配置代理（如果提供）
            if let Some(ref p_url) = proxy_url {
                if !p_url.is_empty() {
                    let mut proxy = reqwest::Proxy::http(p_url).map_err(|e| e.to_string())?;
                    if let Some(ref user) = proxy_username {
                        if !user.is_empty() {
                            proxy = proxy.basic_auth(user, proxy_password.as_deref().unwrap_or(""));
                        }
                    }
                    client_builder = client_builder.proxy(proxy);
                }
            }

            let client = client_builder.build().map_err(|e| e.to_string())?;
            let response = client
                .post(url)
                .header("Content-Type", "application/json")
                .json(&serde_json::json!({
                    "contents": [{"parts": [{"text": "Hi"}]}]
                }))
                .send()
                .await
                .map_err(|e| format!("Gemini 请求失败: {}", e))?;

            if response.status().is_success() {
                let dir_clone = data_dir_clone.clone();
                let provider_clone = provider.clone();
                let model_clone = model_name.clone();
                // Gemini 响应含 usage.promptTokens / completionTokens / totalTokens，尝试解析
                if let Ok(body) = response.json::<serde_json::Value>().await {
                    if let Some(usage) = body.get("usage") {
                        let prompt_tokens = usage
                            .get("promptTokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0) as u32;
                        let completion_tokens = usage
                            .get("completionTokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0) as u32;
                        let total_tokens = usage
                            .get("totalTokens")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0) as u32;
                        let _handle = tokio::spawn(async move {
                            if let Err(e) = write_token_usage(
                                &dir_clone,
                                &provider_clone,
                                &model_clone,
                                prompt_tokens,
                                completion_tokens,
                                total_tokens,
                                "test_connection",
                            )
                            .await
                            {
                                tracing::warn!("记录 Gemini token 用量失败: {}", e);
                            }
                        });
                    } else {
                        let _handle = tokio::spawn(async move {
                            if let Err(e) = write_token_usage(
                                &dir_clone,
                                &provider_clone,
                                &model_clone,
                                0,
                                0,
                                0,
                                "test_connection",
                            )
                            .await
                            {
                                tracing::warn!("记录 Gemini token 用量失败: {}", e);
                            }
                        });
                    }
                } else {
                    let _handle = tokio::spawn(async move {
                        if let Err(e) = write_token_usage(
                            &dir_clone,
                            &provider_clone,
                            &model_clone,
                            0,
                            0,
                            0,
                            "test_connection",
                        )
                        .await
                        {
                            tracing::warn!("记录 Gemini token 用量失败: {}", e);
                        }
                    });
                }
                Ok(serde_json::json!({
                    "success": true,
                    "message": "Gemini API 连接成功"
                }))
            } else {
                Err(format!(
                    "连接失败: {}",
                    response.text().await.unwrap_or_default()
                ))
            }
        }
        "deepseek" => {
            test_openai_compatible_chat(
                "https://api.deepseek.com/v1/chat/completions",
                &data_dir_clone,
                &provider,
                &api_key,
                &model_name,
                proxy_url.as_deref(),
                proxy_username.as_deref(),
                proxy_password.as_deref(),
            )
            .await
        }
        "minimax" => {
            test_openai_compatible_chat(
                "https://api.minimax.chat/v1/chat/completions",
                &data_dir_clone,
                &provider,
                &api_key,
                &model_name,
                proxy_url.as_deref(),
                proxy_username.as_deref(),
                proxy_password.as_deref(),
            )
            .await
        }
        "volc_ark" => {
            // 方舟对话模型走 OpenAI-compatible 路径（文档：https://www.volcengine.com/docs/82379/1494384）
            // 注意：Seedream/Seedance 走同一 Base URL，但 prompt 格式不同；
            //       若因模型不支持对话能力而失败，以下会追加对应 API 文档链接。
            let chat_result = test_openai_compatible_chat(
                "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
                &data_dir_clone,
                &provider,
                &api_key,
                &model_name,
                proxy_url.as_deref(),
                proxy_username.as_deref(),
                proxy_password.as_deref(),
            )
            .await;

            match chat_result {
                Ok(r) => Ok(r),
                Err(e) => {
                    let is_media_model = model_name.starts_with("doubao-seedream")
                        || model_name.starts_with("doubao-seedance");
                    if is_media_model {
                        Err(format!(
                            "{}（Seedream/Seedance 为生图/生视频模型，不支持标准对话 prompt；\
                             请使用图片生成 API：https://www.volcengine.com/docs/82379/1541523 \
                             或视频生成 API：https://www.volcengine.com/docs/82379/1520757）",
                            e
                        ))
                    } else {
                        Err(format!(
                            "{}（方舟对话 API 文档：https://www.volcengine.com/docs/82379/1494384）",
                            e
                        ))
                    }
                }
            }
        }
        "nvidia" => {
            test_openai_compatible_chat(
                "https://integrate.api.nvidia.com/v1/chat/completions",
                &data_dir_clone,
                &provider,
                &api_key,
                &model_name,
                proxy_url.as_deref(),
                proxy_username.as_deref(),
                proxy_password.as_deref(),
            )
            .await
        }
        "aliyun" => {
            test_openai_compatible_chat(
                "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
                &data_dir_clone,
                &provider,
                &api_key,
                &model_name,
                proxy_url.as_deref(),
                proxy_username.as_deref(),
                proxy_password.as_deref(),
            )
            .await
        }
        "zhipu" => {
            test_openai_compatible_chat(
                "https://open.bigmodel.cn/api/paas/v4/chat/completions",
                &data_dir_clone,
                &provider,
                &api_key,
                &model_name,
                proxy_url.as_deref(),
                proxy_username.as_deref(),
                proxy_password.as_deref(),
            )
            .await
        }
        "moonshot" => {
            test_openai_compatible_chat(
                "https://api.moonshot.cn/v1/chat/completions",
                &data_dir_clone,
                &provider,
                &api_key,
                &model_name,
                proxy_url.as_deref(),
                proxy_username.as_deref(),
                proxy_password.as_deref(),
            )
            .await
        }
        "grok" => {
            test_openai_compatible_chat(
                "https://api.x.ai/v1/chat/completions",
                &data_dir_clone,
                &provider,
                &api_key,
                &model_name,
                proxy_url.as_deref(),
                proxy_username.as_deref(),
                proxy_password.as_deref(),
            )
            .await
        }
        "baidu" => Ok(serde_json::json!({
            "success": true,
            "message": "百度千帆需在控制台创建应用并绑定模型；此处已保存 Key，请在千帆侧验证模型名与权限"
        })),
        "xiaomi" => {
            // 小米 MiMo 连通性测试
            let client = reqwest::Client::new();
            let response = client
                .post("https://api.xiaomi.com/v1/chat/completions")
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .json(&serde_json::json!({
                    "model": model_name,
                    "messages": [{"role": "user", "content": "Hello"}],
                    "max_tokens": 10
                }))
                .send()
                .await
                .map_err(|e| format!("请求失败: {}", e))?;

            if response.status().is_success() {
                let dir_clone = data_dir_clone.clone();
                let provider_clone = provider.clone();
                let model_clone = model_name.clone();
                let body: serde_json::Value = response.json().await.unwrap_or_default();
                let usage = body.get("usage");
                if let Some(u) = usage {
                    let prompt_tokens =
                        u.get("prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                    let completion_tokens = u
                        .get("completion_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0) as u32;
                    let total_tokens =
                        u.get("total_tokens").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                    let _handle = tokio::spawn(async move {
                        if let Err(e) = write_token_usage(
                            &dir_clone,
                            &provider_clone,
                            &model_clone,
                            prompt_tokens,
                            completion_tokens,
                            total_tokens,
                            "test_connection",
                        )
                        .await
                        {
                            tracing::warn!("记录小米 MiMo token 用量失败: {}", e);
                        }
                    });
                } else {
                    let _handle = tokio::spawn(async move {
                        if let Err(e) = write_token_usage(
                            &dir_clone,
                            &provider_clone,
                            &model_clone,
                            0,
                            0,
                            0,
                            "test_connection",
                        )
                        .await
                        {
                            tracing::warn!("记录小米 MiMo token 用量失败: {}", e);
                        }
                    });
                }
                Ok(serde_json::json!({
                    "success": true,
                    "message": "小米 MiMo 连接成功",
                    "usage": usage
                }))
            } else {
                let error = response.text().await.unwrap_or_default();
                Err(format!("连接失败: {}", error))
            }
        }
        _ => {
            // 其他供应商暂时返回成功
            Ok(serde_json::json!({
                "success": true,
                "message": format!("{} 连接配置已保存", provider)
            }))
        }
    }
}

/// 查询当前默认模型（与 set_default_model 写入格式对应）
#[derive(Debug, Clone, serde::Serialize)]
pub struct DefaultModel {
    pub provider: Option<String>,
    pub model_name: Option<String>,
}

/// 从 models.yaml 文本解析 `default_model` 块（与 `upsert_default_model_block` 的块边界规则一致）。
/// 注意：块结束须用**原始行**的缩进判断；若误用 `trimmed.starts_with("  ")`，则 `provider:` 去缩进后
/// 不以两个空格开头，会立刻误判为块外并 break，导致永远读不到默认模型（网关用 serde 能读到，前端却读不到）。
fn parse_default_model_from_models_yaml_content(content: &str) -> DefaultModel {
    let mut provider = None;
    let mut model_name = None;
    let mut in_default_block = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "default_model:" {
            in_default_block = true;
            continue;
        }
        if in_default_block {
            if !trimmed.is_empty() && !line.starts_with("  ") && !line.starts_with('\t') {
                break;
            }
            if trimmed.starts_with("provider:") || trimmed.starts_with("provider :") {
                provider = trimmed
                    .splitn(2, ':')
                    .nth(1)
                    .map(|s| s.trim().trim_matches('"').to_string());
            } else if trimmed.starts_with("model_name:") || trimmed.starts_with("model_name :") {
                model_name = trimmed
                    .splitn(2, ':')
                    .nth(1)
                    .map(|s| s.trim().trim_matches('"').to_string());
            }
        }
    }

    DefaultModel {
        provider,
        model_name,
    }
}

#[tauri::command]
pub async fn get_default_model(
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<DefaultModel, String> {
    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();

    let content = read_models_yaml_text_for_manager(&data_dir)?;
    let content = content.strip_prefix('\u{feff}').unwrap_or(content.as_str());

    Ok(parse_default_model_from_models_yaml_content(content))
}

#[tauri::command]
pub async fn set_default_model(
    data_dir: tauri::State<'_, crate::AppState>,
    provider: String,
    model_name: String,
) -> Result<String, String> {
    let provider = provider.trim().to_string();
    let model_name = model_name.trim().to_string();
    if provider.is_empty() || model_name.is_empty() {
        return Err(
            "设置默认模型失败：供应商或模型名为空。请在大模型页重新点选列表中的模型后再保存。"
                .to_string(),
        );
    }
    info!("设置默认模型: {} / {}", provider, model_name);

    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let config_path = PathBuf::from(&data_dir).join("config").join("models.yaml");

    let content = read_models_yaml_text_for_manager(&data_dir)?;

    // 解析 YAML 并重建，仅替换 default_model 块内的 provider 和 model_name。
    // 之前的实现对整个文件遍历，会错误替换 providers.*.provider 等无关行。
    let new_content = upsert_default_model_block(&content, &provider, &model_name);

    // 写入后 sync_all：避免用户机上"保存提示成功/失败不一致"
    let mut f = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&config_path)
        .await
        .map_err(|e| format!("保存配置失败（打开文件）: {}", e))?;
    f.write_all(new_content.as_bytes())
        .await
        .map_err(|e| format!("保存配置失败（写入）: {}", e))?;
    f.sync_all()
        .await
        .map_err(|e| format!("保存配置失败（sync）: {}", e))?;

    // 与网关启动前检查使用同一套逻辑，避免「前端 toast 成功但 read_default_model_primary 仍为 None」的假成功
    if crate::commands::gateway::read_default_model_primary(&data_dir).is_none() {
        let diag = crate::commands::gateway::diagnose_default_model_primary(&data_dir)
            .err()
            .unwrap_or_else(|| "未知原因".to_string());
        return Err(format!(
            "设置默认模型失败：已写入磁盘，但网关仍无法读取到有效 default_model。\n\n{}",
            diag
        ));
    }

    // models.yaml 已更新，立即将默认模型同步到 openclaw.json（修复：保存后必须同步，否则网关永远用默认 Claude）
    crate::commands::gateway::sync_openclaw_config_from_manager(&data_dir)
        .await
        .map_err(|e| format!("同步网关配置失败: {}", e))?;

    Ok(format!("默认模型已设置为 {} / {}", provider, model_name))
}

/// 在 models.yaml 内容中找到 default_model 块并替换 provider / model_name。
/// 若 default_model 块不存在则追加。
fn upsert_default_model_block(content: &str, provider: &str, model_name: &str) -> String {
    let lines: Vec<&str> = content.lines().collect::<Vec<_>>();

    let has_default_model = lines.iter().any(|l| l.trim() == "default_model:");

    if !has_default_model {
        let sep = if content.trim().is_empty() { "" } else { "\n" };
        return format!(
            "{}{}default_model:\n  provider: \"{}\"\n  model_name: \"{}\"",
            content.trim_end(),
            sep,
            provider,
            model_name
        );
    }

    let mut new_lines: Vec<String> = Vec::new();
    let mut in_block = false;
    let mut replaced_provider = false;
    let mut replaced_model = false;

    for line in &lines {
        let trimmed = line.trim();

        if trimmed == "default_model:" {
            new_lines.push(line.to_string());
            in_block = true;
            continue;
        }

        if in_block {
            // 遇到非缩进行（块结束标记）时退出块模式
            if !trimmed.is_empty() && !line.starts_with("  ") && !line.starts_with('\t') {
                if !replaced_provider {
                    new_lines.push(format!("  provider: \"{}\"", provider));
                }
                if !replaced_model {
                    new_lines.push(format!("  model_name: \"{}\"", model_name));
                }
                replaced_provider = true;
                replaced_model = true;
                in_block = false;
                new_lines.push(line.to_string());
                continue;
            }

            if !replaced_provider && (trimmed.starts_with("provider:") || trimmed.starts_with("provider :")) {
                new_lines.push(format!("  provider: \"{}\"", provider));
                replaced_provider = true;
            } else if !replaced_model
                && (trimmed.starts_with("model_name:") || trimmed.starts_with("model_name :"))
            {
                new_lines.push(format!("  model_name: \"{}\"", model_name));
                replaced_model = true;
            } else {
                new_lines.push(line.to_string());
            }
        } else {
            new_lines.push(line.to_string());
        }
    }

    // default_model 在文件末尾时的兜底追加
    if in_block {
        if !replaced_provider {
            new_lines.push(format!("  provider: \"{}\"", provider));
        }
        if !replaced_model {
            new_lines.push(format!("  model_name: \"{}\"", model_name));
        }
    }

    new_lines.join("\n")
}

/// 模型列表中的单个模型条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelEntry {
    pub id: String,
    pub name: String,
    /// 近似上下文窗口（tokens），用于展示
    pub context_window: Option<usize>,
    /// 是否免费
    pub is_free: bool,
    /// 备注，如 "推荐"、"最新"
    pub badge: Option<String>,
}

fn me(
    id: &str,
    name: &str,
    context_window: Option<usize>,
    is_free: bool,
    badge: Option<&str>,
) -> ModelEntry {
    ModelEntry {
        id: id.to_string(),
        name: name.to_string(),
        context_window,
        is_free,
        badge: badge.map(|s| s.to_string()),
    }
}

/// 各云厂商常用模型静态目录（与控制台命名对齐；方舟可填推理接入点 ID 作为自定义模型）
fn static_provider_models(provider_id: &str) -> Vec<ModelEntry> {
    match provider_id {
        // 各厂商「顶配」以官方文档 model id 为准（会随云厂商更名）；见 Anthropic / Google / OpenAI 等文档。
        "openai" => vec![
            me(
                "gpt-5.4",
                "GPT-5.4（OpenAI 文档当前旗舰）",
                Some(1000000),
                false,
                Some("旗舰"),
            ),
            me(
                "gpt-5.4-mini",
                "GPT-5.4 mini（延迟/成本平衡）",
                Some(400000),
                false,
                Some("推荐"),
            ),
            me(
                "gpt-5.4-nano",
                "GPT-5.4 nano（轻量）",
                Some(400000),
                false,
                Some("轻量"),
            ),
        ],
        "anthropic" => vec![
            me(
                "claude-opus-4-6",
                "Claude Opus 4.6（文档当前顶配）",
                Some(1000000),
                false,
                Some("旗舰"),
            ),
            me(
                "claude-sonnet-4-6",
                "Claude Sonnet 4.6",
                Some(1000000),
                false,
                Some("最新"),
            ),
            me(
                "claude-sonnet-4-5-20250929",
                "Claude Sonnet 4.5（稳定快照）",
                Some(200000),
                false,
                Some("推荐"),
            ),
            me(
                "claude-haiku-4-5-20251001",
                "Claude Haiku 4.5（轻量）",
                Some(200000),
                false,
                Some("轻量"),
            ),
        ],
        "google" => vec![
            me(
                "gemini-3.1-pro-preview",
                "Gemini 3.1 Pro Preview（文档当前文本顶配）",
                Some(1048576),
                false,
                Some("旗舰"),
            ),
            me(
                "gemini-3.1-pro-preview-customtools",
                "Gemini 3.1 Pro（自定义工具 / Agent）",
                Some(1048576),
                false,
                Some("Agent"),
            ),
            me(
                "gemini-3-flash-preview",
                "Gemini 3 Flash Preview",
                Some(1048576),
                false,
                Some("最新"),
            ),
            me(
                "gemini-2.5-pro",
                "Gemini 2.5 Pro（稳定高配）",
                Some(1048576),
                false,
                Some("推荐"),
            ),
            me(
                "gemini-2.5-flash",
                "Gemini 2.5 Flash（快·省）",
                Some(1048576),
                false,
                Some("轻量"),
            ),
        ],
        "deepseek" => vec![
            me(
                "deepseek-reasoner",
                "DeepSeek-R1（推理旗舰）",
                Some(64000),
                false,
                Some("旗舰"),
            ),
            me(
                "deepseek-chat",
                "DeepSeek-V3（对话旗舰）",
                Some(64000),
                false,
                Some("推荐"),
            ),
        ],
        "minimax" => vec![
            me(
                "MiniMax-M2.7",
                "MiniMax M2.7",
                Some(204800),
                false,
                Some("旗舰"),
            ),
            me(
                "MiniMax-M2.7-highspeed",
                "MiniMax M2.7 高速",
                Some(204800),
                false,
                None,
            ),
            me(
                "MiniMax-M2.5",
                "MiniMax M2.5（标准）",
                Some(204800),
                false,
                Some("部分账号不可用"),
            ),
            me(
                "MiniMax-M2.5-highspeed",
                "MiniMax M2.5 高速",
                Some(204800),
                false,
                Some("推荐"),
            ),
            me("MiniMax-M2.1", "MiniMax M2.1", Some(204800), false, None),
            me(
                "MiniMax-M2-her",
                "MiniMax M2-Her（角色）",
                Some(204800),
                false,
                None,
            ),
            me(
                "abab6.5s-chat",
                "abab6.5s（兼容轻量）",
                Some(245000),
                false,
                Some("轻量"),
            ),
        ],
        "volc_ark" => vec![
            // ========== 方舟对话（Chat）模型 — 通过 /api/v3/chat/completions 测试 ==========
            // 官方文档：https://www.volcengine.com/docs/82379/1298459（Base URL及鉴权）
            //           https://www.volcengine.com/docs/82379/1494384（对话Chat API）
            // 接入方式：API Key + 推理接入点 ID（ep-xxxx）或控制台模型版本 ID
            //
            // ⚠️ 以下为已知「非对话」类模型，走独立 API（图片/视频），不可用 Chat 路径测试：
            //   图片生成：doubao-seedream-4-5-251128 / doubao-seedream-5-0-260128
            //           文档：https://www.volcengine.com/docs/82379/1541523
            //   视频生成：doubao-seedance-1-5-pro-251215 / doubao-seedance-2-0-260128
            //           文档：https://www.volcengine.com/docs/82379/1520757
            //
            // ⚠️ Seedream / Seedance 也支持 OpenAI-compatible 路径 POST /v3/chat/completions，
            //     但 prompt 格式与纯对话不同；若用标准对话 prompt 测试会报模型能力不匹配（预期行为）。

            // 接入方式：手动输入已创建的推理接入点 ID（ep-xxxx），需在控制台先创建并绑定模型
            me(
                "__volc_custom_ep__",
                "自定义：手动输入推理接入点 ID（ep-xxxx）",
                None,
                false,
                Some("必填"),
            ),
            // ── Seed 2.0 系列（2026-02-14 发布，旗舰语言/代码模型，256K 上文）─────────────
            me(
                "doubao-seed-2-0-pro-260215",
                "豆包 Seed 2.0 Pro（旗舰·复杂推理/长链任务）",
                Some(256000),
                false,
                Some("旗舰"),
            ),
            me(
                "doubao-seed-2-0-code-preview-260215",
                "豆包 Seed 2.0 Code（编程·IDE 工具集成）",
                Some(256000),
                false,
                Some("代码"),
            ),
            me(
                "doubao-seed-2-0-lite-260215",
                "豆包 Seed 2.0 Lite（均衡·生产级负载）",
                Some(256000),
                false,
                Some("推荐"),
            ),
            me(
                "doubao-seed-2-0-mini-260215",
                "豆包 Seed 2.0 Mini（低延迟·高并发）",
                Some(256000),
                false,
                Some("轻量"),
            ),
            // ── Seed 1.8 系列（2025-12-18 发布，当前旗舰，256K 上文）─────────────────────
            me(
                "doubao-seed-1-8-251228",
                "豆包 Seed 1.8（旗舰·多模态 Agent）",
                Some(256000),
                false,
                Some("旗舰"),
            ),
            // ── Seed 1.6 系列（保留，与现有条目一致）─────────────────────────────────────
            me(
                "doubao-seed-1-6-250615",
                "豆包 Seed 1.6",
                Some(256000),
                false,
                Some("旗舰"),
            ),
            me(
                "doubao-seed-1-6-thinking-250615",
                "豆包 Seed 1.6 Thinking（深度推理）",
                Some(256000),
                false,
                Some("推理"),
            ),
            // ── 1.5 系列（保留）─────────────────────────────────────────────────────────
            me(
                "doubao-1-5-pro-256k-250115",
                "豆包 1.5 Pro 256K（长上文）",
                Some(256000),
                false,
                Some("旗舰"),
            ),
            me(
                "doubao-1-5-pro-32k-250115",
                "豆包 1.5 Pro 32K",
                Some(32000),
                false,
                Some("旗舰"),
            ),
            me(
                "doubao-1-5-thinking-pro-250428",
                "豆包 1.5 Thinking Pro（推理）",
                Some(32000),
                false,
                Some("推理"),
            ),
            me(
                "doubao-1-5-vision-pro-32k-250115",
                "豆包 1.5 Vision Pro 32K（多模态对话）",
                Some(32000),
                false,
                Some("视觉"),
            ),
            me(
                "doubao-1-5-lite-32k-250115",
                "豆包 1.5 Lite 32K（轻量）",
                Some(32000),
                false,
                Some("轻量"),
            ),
            me(
                "doubao-lite-32k-character-240828",
                "豆包 Lite 32K Character（轻量）",
                Some(32000),
                false,
                Some("轻量"),
            ),
            // ── DeepSeek（通过方舟接入）─────────────────────────────────────────────────
            me(
                "deepseek-v3-250324",
                "DeepSeek V3（方舟接入）",
                Some(128000),
                false,
                Some("推荐"),
            ),
            // ========== 方舟图片生成模型 — 不走 Chat 路径，测连需用对应 API ==============
            // 文档：https://www.volcengine.com/docs/82379/1541523（图片生成 API）
            me(
                "doubao-seedream-5-0-260128",
                "豆包 Seedream 5.0 Lite（文生图·多图生图）",
                None,
                false,
                Some("生图·非Chat"),
            ),
            me(
                "doubao-seedream-4-5-251128",
                "豆包 Seedream 4.5（文生图·图像编辑）",
                None,
                false,
                Some("生图·非Chat"),
            ),
            // ========== 方舟视频生成模型 — 不走 Chat 路径，测连需用对应 API ==============
            // 文档：https://www.volcengine.com/docs/82379/1520757（视频生成 API）
            me(
                "doubao-seedance-2-0-260128",
                "豆包 Seedance 2.0（文生视频·图生视频）",
                None,
                false,
                Some("生视频·非Chat"),
            ),
            me(
                "doubao-seedance-1-5-pro-251215",
                "豆包 Seedance 1.5 Pro（视频生成·生视频）",
                None,
                false,
                Some("生视频·非Chat"),
            ),
        ],
        "nvidia" => vec![
            me(
                "meta/llama-4-maverick-17b-128e-instruct",
                "Llama 4 Maverick 17B 128E（NIM 文档示例）",
                Some(131072),
                false,
                Some("旗舰"),
            ),
            me(
                "meta/llama-4-scout-17b-16e-instruct",
                "Llama 4 Scout 17B 16E",
                Some(131072),
                false,
                Some("推荐"),
            ),
            me(
                "meta/llama-3.1-405b-instruct",
                "Llama 3.1 405B Instruct",
                Some(131072),
                false,
                None,
            ),
            me(
                "meta/llama-3.1-8b-instruct",
                "Llama 3.1 8B Instruct（轻量）",
                Some(131072),
                false,
                Some("轻量"),
            ),
        ],
        "aliyun" => vec![
            me(
                "qwen3-max",
                "通义千问 Qwen3-Max（百炼文档旗舰线）",
                Some(1000000),
                false,
                Some("旗舰"),
            ),
            me(
                "qwen-plus",
                "通义千问 Plus",
                Some(1000000),
                false,
                Some("推荐"),
            ),
            me(
                "qwen-long",
                "通义千问 Long（超长）",
                Some(10000000),
                false,
                None,
            ),
            me(
                "qwen-flash",
                "通义千问 Flash（轻量）",
                Some(1000000),
                false,
                Some("轻量"),
            ),
        ],
        "zhipu" => vec![
            me(
                "glm-4.6",
                "GLM-4.6（智谱文档当前旗舰）",
                Some(200000),
                false,
                Some("旗舰"),
            ),
            me(
                "glm-4-plus",
                "GLM-4 Plus（稳定高配）",
                Some(128000),
                false,
                Some("推荐"),
            ),
            me(
                "glm-4-long",
                "GLM-4 Long（长文）",
                Some(1000000),
                false,
                None,
            ),
            me(
                "glm-4-flash",
                "GLM-4 Flash（轻量）",
                Some(128000),
                false,
                Some("轻量"),
            ),
        ],
        "moonshot" => vec![
            me(
                "kimi-k2.5",
                "Kimi K2.5（Moonshot 文档当前主推）",
                Some(256000),
                false,
                Some("旗舰"),
            ),
            me(
                "kimi-k2-thinking",
                "Kimi K2 Thinking（推理）",
                Some(128000),
                false,
                Some("推理"),
            ),
            me(
                "kimi-k2-turbo-preview",
                "Kimi K2 Turbo Preview",
                Some(128000),
                false,
                Some("推荐"),
            ),
            me(
                "moonshot-v1-128k",
                "moonshot-v1-128k（经典长文·轻量）",
                Some(128000),
                false,
                Some("轻量"),
            ),
        ],
        "grok" => vec![
            me(
                "grok-2-1212",
                "Grok 2（xAI 旗舰）",
                Some(131072),
                false,
                Some("旗舰"),
            ),
            me(
                "grok-2",
                "Grok 2",
                Some(131072),
                false,
                Some("推荐"),
            ),
            me(
                "grok-1",
                "Grok 1",
                Some(128000),
                false,
                Some("基础"),
            ),
        ],
        "baidu" => vec![
            me(
                "ernie-5.0",
                "ERNIE 5.0（千帆文档旗舰线）",
                Some(128000),
                false,
                Some("旗舰"),
            ),
            me(
                "ernie-5.0-thinking-latest",
                "ERNIE 5.0 Thinking（推理）",
                Some(128000),
                false,
                Some("推理"),
            ),
            me(
                "ernie-4.0-turbo-128k",
                "ERNIE 4.0 Turbo 128K（兼容）",
                Some(128000),
                false,
                Some("推荐"),
            ),
            me(
                "ernie-speed-128k",
                "ERNIE Speed（轻量）",
                Some(128000),
                false,
                Some("轻量"),
            ),
        ],
        "xiaomi" => vec![
            me(
                "mimo-v2-pro",
                "MiMo V2 Pro（示例·高配）",
                Some(128000),
                false,
                Some("旗舰"),
            ),
            me(
                "mimo-v2-flash",
                "MiMo V2 Flash（示例·轻量）",
                Some(128000),
                false,
                Some("轻量"),
            ),
        ],
        _ => Vec::new(),
    }
}

/// 根据供应商获取其可用模型列表
/// - ollama：调用本地 http://localhost:11434/api/tags
/// - openrouter：调用 https://openrouter.ai/api/v1/models（有 Key 则带鉴权；pricing 兼容字符串/数字）
/// - 其他：返回静态常用模型目录
#[tauri::command]
pub async fn list_models(
    provider_id: String,
    api_key: Option<String>,
) -> Result<Vec<ModelEntry>, String> {
    match provider_id.as_str() {
        "ollama" => list_ollama_models().await,
        "openrouter" => list_openrouter_models(api_key.as_deref()).await,
        other => Ok(static_provider_models(other)),
    }
}

async fn list_ollama_models() -> Result<Vec<ModelEntry>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get("http://localhost:11434/api/tags")
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                "Ollama 服务未启动（http://localhost:11434 不可达），请先安装并启动 Ollama".into()
            } else {
                format!("Ollama 请求失败: {}", e)
            }
        })?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Ollama 需要身份验证，请检查配置".into());
    }

    #[derive(Deserialize)]
    struct OllamaTags {
        models: Vec<OllamaModel>,
    }
    #[derive(Deserialize)]
    #[allow(dead_code)] // size 等字段供 serde 反序列化，业务未使用
    struct OllamaModel {
        name: String,
        #[serde(default)]
        size: Option<u64>,
        #[serde(default)]
        details: Option<OllamaDetails>,
    }
    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct OllamaDetails {
        #[serde(default)]
        context_window: Option<usize>,
        #[serde(rename = "parentModel", default)]
        parent_model: Option<String>,
    }

    let tags: OllamaTags = resp
        .json()
        .await
        .map_err(|e| format!("解析 Ollama 响应失败: {}", e))?;

    let models: Vec<ModelEntry> = tags
        .models
        .into_iter()
        .map(|m| {
            let context_window = m.details.as_ref().and_then(|d| d.context_window);
            ModelEntry {
                id: m.name.clone(),
                name: m.name,
                context_window,
                is_free: true,
                badge: None,
            }
        })
        .collect();

    if models.is_empty() {
        return Err("Ollama 未安装任何模型，请先运行 `ollama pull <模型名>`".into());
    }
    Ok(models)
}

/// OpenRouter 文档里 `pricing.prompt` / `completion` 常为 **字符串**（如 "0"），
/// 强类型 f64 反序列化会直接失败（用户看到 error decoding response body）。
fn json_numish_to_f64(v: &serde_json::Value) -> Option<f64> {
    match v {
        serde_json::Value::Number(n) => n.as_f64(),
        serde_json::Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn openrouter_context_tokens(item: &serde_json::Value) -> Option<usize> {
    for key in ["context_length", "context_window", "contextWindow"] {
        if let Some(v) = item.get(key) {
            if let Some(n) = v.as_u64() {
                return Some(n as usize);
            }
            if let Some(n) = v.as_i64() {
                if n >= 0 {
                    return Some(n as usize);
                }
            }
        }
    }
    None
}

fn openrouter_pricing_is_free(pricing: &serde_json::Value) -> bool {
    let prompt = pricing
        .get("prompt")
        .and_then(json_numish_to_f64)
        .unwrap_or(1.0);
    let completion = pricing
        .get("completion")
        .and_then(json_numish_to_f64)
        .unwrap_or(1.0);
    prompt == 0.0 && completion == 0.0
}

fn openrouter_model_disabled(item: &serde_json::Value) -> bool {
    item.get("disabled_for")
        .or_else(|| item.get("disabledFor"))
        .and_then(|v| v.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false)
}

/// 实时拉取 OpenRouter 模型目录。有 API Key 时带 `Authorization`；无 Key 时仍尝试公开列表（部分网络可用）。
async fn list_openrouter_models(api_key: Option<&str>) -> Result<Vec<ModelEntry>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("OpenClaw-CN-Manager/1.0 (openrouter-models)")
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get("https://openrouter.ai/api/v1/models");
    if let Some(key) = api_key {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", trimmed));
        }
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("请求 OpenRouter 模型列表失败: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        // 无 Key 时 401：退回少量合法占位，避免界面空白
        if status == reqwest::StatusCode::UNAUTHORIZED && api_key.map(|k| k.trim().is_empty()).unwrap_or(true) {
            return Ok(fallback_openrouter_models());
        }
        return Err(format!(
            "OpenRouter 模型列表请求失败 ({}): {}",
            status, body
        ));
    }

    let root: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 OpenRouter 模型响应失败: {}", e))?;

    let Some(data) = root.get("data").and_then(|v| v.as_array()) else {
        return Ok(fallback_openrouter_models());
    };

    let mut models: Vec<ModelEntry> = Vec::new();
    for item in data {
        if openrouter_model_disabled(item) {
            continue;
        }
        let Some(id) = item.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let id = id.trim();
        if id.is_empty() {
            continue;
        }

        let pricing = item.get("pricing").cloned().unwrap_or(serde_json::json!({}));
        let is_free = openrouter_pricing_is_free(&pricing);

        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| id.to_string());

        models.push(ModelEntry {
            id: id.to_string(),
            name,
            context_window: openrouter_context_tokens(item),
            is_free,
            badge: if is_free {
                Some("免费".to_string())
            } else {
                None
            },
        });
    }

    if models.is_empty() {
        return Ok(fallback_openrouter_models());
    }

    // 免费模型优先，便于挑选
    models.sort_by(|a, b| {
        b.is_free
            .cmp(&a.is_free)
            .then_with(|| a.id.to_lowercase().cmp(&b.id.to_lowercase()))
    });

    Ok(models)
}

/// API 暂不可用时展示的占位项。**id 必须与 OpenRouter 官方一致**（不可用中文拼进 model id）。
fn fallback_openrouter_models() -> Vec<ModelEntry> {
    vec![
        ModelEntry {
            id: "google/gemini-2.0-flash-exp:free".into(),
            name: "Gemini 2.0 Flash（:free）".into(),
            context_window: Some(1_048_576),
            is_free: true,
            badge: Some("推荐".into()),
        },
        ModelEntry {
            id: "deepseek/deepseek-chat-v3-0324:free".into(),
            name: "DeepSeek V3 Chat（:free）".into(),
            context_window: Some(163_840),
            is_free: true,
            badge: Some("对话".into()),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 验证 write_token_usage 能正确追加到 jsonl 文件，且格式正确
    #[tokio::test]
    async fn test_write_token_usage_records_all_fields() {
        let tmp = std::env::temp_dir();
        let data_dir = tmp.join("openclaw_test_metrics");
        let _ = std::fs::remove_dir_all(&data_dir); // clean slate

        write_token_usage(
            data_dir.to_str().unwrap(),
            "anthropic",
            "claude-test-model",
            100,
            200,
            300,
            "test_connection",
        )
        .await
        .expect("write_token_usage should succeed");

        write_token_usage(
            data_dir.to_str().unwrap(),
            "google",
            "gemini-test-model",
            10,
            20,
            30,
            "test_connection_no_usage",
        )
        .await
        .expect("second write should succeed");

        let file_path = data_dir.join("metrics").join("token_usage.jsonl");
        let content = std::fs::read_to_string(&file_path).expect("file should exist");
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2, "should have 2 lines");

        let r1: TokenUsageRecord = serde_json::from_str(lines[0]).expect("line 1 should parse");
        assert_eq!(r1.provider, "anthropic");
        assert_eq!(r1.model, "claude-test-model");
        assert_eq!(r1.prompt_tokens, 100);
        assert_eq!(r1.completion_tokens, 200);
        assert_eq!(r1.total_tokens, 300);
        assert_eq!(r1.source, "test_connection");

        let r2: TokenUsageRecord = serde_json::from_str(lines[1]).expect("line 2 should parse");
        assert_eq!(r2.provider, "google");
        assert_eq!(r2.model, "gemini-test-model");
        assert_eq!(r2.total_tokens, 30);

        // cleanup
        let _ = std::fs::remove_dir_all(&data_dir);
    }

    /// 验证所有供应商分支的 match 语句：
    /// - 要么自身包含 write_token_usage
    /// - 要么调用 test_openai_compatible_chat（该函数内部写了 write_token_usage）
    #[test]
    fn test_all_providers_have_write_token_usage() {
        let src = include_str!("../commands/model.rs");
        // 找 test_model_connection 函数体（取足够长的字符片段，避免字节切片越界）
        let fn_start = src
            .find("pub async fn test_model_connection")
            .expect("must exist");
        let fn_end = fn_start
            + src[fn_start..]
                .find("\n/// 查询当前默认模型")
                .unwrap_or(src.len() - fn_start);
        let fn_body: String = src[fn_start..fn_end].chars().take(20000).collect();

        let covered = [
            ("openrouter", "direct"),
            ("openai", "helper"),
            ("anthropic", "direct"),
            ("google", "direct"),
            ("deepseek", "helper"),
            ("minimax", "helper"),
            ("volc_ark", "helper"),
            ("nvidia", "helper"),
            ("aliyun", "helper"),
            ("zhipu", "helper"),
            ("moonshot", "helper"),
            ("grok", "helper"),
            ("ollama", "direct"),
            ("xiaomi", "direct"),
        ];

        let mut failed = Vec::new();
        for (provider, _how) in covered {
            let Some(branch_pos) = fn_body.find(&format!(r#""{provider}" =>"#)) else {
                println!("{:<14}  NOT FOUND", provider);
                failed.push(provider);
                continue;
            };
            // 取该分支后 2500 个字符（char 级别截取，安全）
            let branch_slice: String = fn_body.chars().skip(branch_pos).take(2500).collect();

            let has_direct = branch_slice.contains("write_token_usage");
            let has_helper = branch_slice.contains("test_openai_compatible_chat");
            let status = if has_direct {
                "write_token_usage OK"
            } else if has_helper {
                "via helper OK"
            } else {
                "MISSING"
            };

            println!("{:<14}  {}", provider, status);
            if status == "MISSING" {
                failed.push(provider);
            }
        }

        if !failed.is_empty() {
            panic!("Missing write_token_usage in branches: {:?}", failed);
        }
    }

    /// 真实路径写入测试：直接写进 token_usage.jsonl 并读回验证
    /// 运行：cargo test -- model::tests::test_live_write_and_read --nocapture
    #[tokio::test]
    async fn test_live_write_and_read() {
        let data_dir = r"D:\ORD\src-tauri\target\debug\data";
        let file_path = std::path::PathBuf::from(data_dir)
            .join("metrics")
            .join("token_usage.jsonl");

        let records = [
            ("minimax", "MiniMax-M2.5", 150u32, 280u32, 430u32, "test_connection"),
            ("minimax", "MiniMax-M2.7", 80u32, 320u32, 400u32, "test_connection"),
            ("openrouter", "gemini-2.0-flash", 60u32, 140u32, 200u32, "test_connection"),
            ("deepseek", "deepseek-chat", 100u32, 250u32, 350u32, "test_connection"),
        ];

        for (provider, model, pt, ct, tt, source) in records {
            write_token_usage(data_dir, provider, model, pt, ct, tt, source)
                .await
                .expect(&format!("write failed for {}/{}", provider, model));
            println!("Wrote: {}/{} ({} tokens)", provider, model, tt);
        }

        let content = std::fs::read_to_string(&file_path).expect("file should exist");
        println!("\n=== 读回 {} 条记录 ===", content.lines().count());
        for (i, line) in content.lines().rev().take(4).enumerate() {
            let r: TokenUsageRecord = serde_json::from_str(line).expect("parse failed");
            println!(
                "  [{}] {} / {} = {} tokens  (source={})",
                content.lines().count() - i,
                r.provider,
                r.model,
                r.total_tokens,
                r.source
            );
        }
    }

    // ─── parse_default_model_from_models_yaml_content ──────────────────────

    #[test]
    fn parse_default_model_matches_template_shape() {
        let yaml = r#"# 头注释
default_model:
  provider: "minimax"
  model_name: "MiniMax-M2.5"
  # 行内注释

# 下一节
providers:
  openrouter:
    api_key: ""
"#;
        let dm = super::parse_default_model_from_models_yaml_content(yaml);
        assert_eq!(dm.provider.as_deref(), Some("minimax"));
        assert_eq!(dm.model_name.as_deref(), Some("MiniMax-M2.5"));
    }

    #[test]
    fn parse_default_model_utf8_bom_stripped_by_caller() {
        let yaml = "\u{feff}default_model:\n  provider: \"a\"\n  model_name: \"b\"\n";
        let yaml = yaml.strip_prefix('\u{feff}').unwrap_or(yaml);
        let dm = super::parse_default_model_from_models_yaml_content(yaml);
        assert_eq!(dm.provider.as_deref(), Some("a"));
        assert_eq!(dm.model_name.as_deref(), Some("b"));
    }

    /// 打包模板经 upsert 后须能被 serde_yaml 解析（与网关 read_default_model_primary 一致）
    #[test]
    fn upsert_on_bundled_models_yaml_still_valid_for_serde() {
        let template = include_str!("../../resources/data/config/models.yaml");
        let patched = super::upsert_default_model_block(template, "minimax", "MiniMax-M2.5");
        let doc: serde_yaml::Value = serde_yaml::from_str(&patched).expect("patched yaml must parse");
        let dm = doc.get("default_model").expect("default_model key");
        assert_eq!(dm.get("provider").and_then(|v| v.as_str()), Some("minimax"));
        assert_eq!(
            dm.get("model_name").and_then(|v| v.as_str()),
            Some("MiniMax-M2.5")
        );
    }

    // ─── upsert_default_model_block 边界测试 ─────────────────────────────────

    /// 空文件：追加 default_model 块
    #[test]
    fn upsert_dm_empty_file() {
        let result = upsert_default_model_block("", "minimax", "MiniMax-M2.5");
        assert!(result.contains("default_model:"));
        assert!(result.contains("provider: \"minimax\""));
        assert!(result.contains("model_name: \"MiniMax-M2.5\""));
        // 不应包含 providers 块（它们在文件里不存在）
        assert!(!result.contains("openrouter:"), "empty file should not get openrouter provider block");
    }

    /// 文件有内容但无 default_model 块：追加到末尾
    #[test]
    fn upsert_dm_no_default_block() {
        let content = "providers:\n  openrouter:\n    api_key: \"hello\"\n";
        let result = upsert_default_model_block(content, "minimax", "MiniMax-M2.7");
        assert!(result.contains("provider: \"minimax\""));
        assert!(result.contains("model_name: \"MiniMax-M2.7\""));
        assert!(result.contains("openrouter:"), "should preserve openrouter block");
        assert!(!result.contains("api_key: \"hello\"\n\ndefault_model"), "default_model must not duplicate openrouter content");
    }

    /// default_model 块已有 provider + model_name：全部替换
    #[test]
    fn upsert_dm_replace_both() {
        let content = "default_model:\n  provider: \"openrouter\"\n  model_name: \"some-model\"\n";
        let result = upsert_default_model_block(content, "minimax", "MiniMax-M2.5");
        assert!(result.contains("provider: \"minimax\""));
        assert!(result.contains("model_name: \"MiniMax-M2.5\""));
        assert!(!result.contains("openrouter"), "should not contain old provider");
        assert!(!result.contains("some-model"), "should not contain old model_name");
    }

    /// default_model 块只有 provider，缺少 model_name：补全
    #[test]
    fn upsert_dm_partial_provider_only() {
        let content = "default_model:\n  provider: \"openrouter\"\n";
        let result = upsert_default_model_block(content, "minimax", "MiniMax-M2.5");
        assert!(result.contains("provider: \"minimax\""));
        assert!(result.contains("model_name: \"MiniMax-M2.5\""));
    }

    /// default_model 块只有 model_name，缺少 provider：补全
    #[test]
    fn upsert_dm_partial_model_only() {
        let content = "default_model:\n  model_name: \"some-model\"\n";
        let result = upsert_default_model_block(content, "minimax", "MiniMax-M2.5");
        assert!(result.contains("provider: \"minimax\""));
        assert!(result.contains("model_name: \"MiniMax-M2.5\""));
        assert!(!result.contains("some-model"), "should not contain old model_name");
    }

    /// 切换默认模型：openrouter → minimax，providers.openrouter 内容不被覆盖
    #[test]
    fn upsert_dm_preserves_other_providers() {
        let content = "default_model:\n  provider: \"openrouter\"\n  model_name: \"gemini-2.0-flash\"\n\nproviders:\n  openrouter:\n    api_key: \"sk-or-key-xxx\"\n    enabled: true\n  minimax:\n    api_key: \"\"\n    enabled: false\n";
        let result = upsert_default_model_block(content, "minimax", "MiniMax-M2.5");
        // 块替换
        assert!(result.contains("provider: \"minimax\""));
        assert!(result.contains("model_name: \"MiniMax-M2.5\""));
        // 其他内容原样保留
        assert!(result.contains("providers:"));
        assert!(result.contains("openrouter:"));
        assert!(result.contains("sk-or-key-xxx"), "should preserve openrouter api_key");
        assert!(result.contains("minimax:"), "should preserve minimax provider block");
        // 关键：minimax 的 api_key 不被覆盖为 provider
        let minimax_section: Vec<_> = result
            .lines()
            .skip_while(|l| !l.trim().starts_with("minimax:"))
            .take(4)
            .collect();
        let minimax_text = minimax_section.join("\n");
        assert!(
            minimax_text.contains("api_key"),
            "minimax block should contain api_key, not provider. Got:\n{}", minimax_text
        );
    }

    // ─── upsert_provider_api_key 测试 ───────────────────────────────────────

    /// 新增供应商：追加到 providers: 块内（而非根级末尾）
    #[test]
    fn upsert_api_key_new_provider_appends_inside_providers_block() {
        let content = "providers:\n  openrouter:\n    api_key: \"sk-or\"\n";
        let result = upsert_provider_api_key(content, "minimax", "minimax-api-key-123");
        // minimax 应追加到 providers: 块内部（2 空格缩进），而非根级
        assert!(result.contains("  minimax:"), "minimax should be inside providers block with 2-space indent");
        assert!(result.contains("    api_key: \"minimax-api-key-123\""), "api_key should have 4-space indent inside provider block");
        assert!(result.contains("openrouter:"), "should preserve openrouter");
        // 验证结构：根级不应出现 `minimax:`（无缩进）
        let lines: Vec<&str> = result.lines().collect();
        for line in &lines {
            if line.trim() == "minimax:" && !line.starts_with("  ") {
                panic!("minimax should not appear at root level (no indent): {:?}", line);
            }
        }
    }

    /// 新增供应商：追加到 providers: 块，且不被追加到根级（验证无根级 minimax:）
    #[test]
    fn upsert_api_key_new_provider_no_root_level_append() {
        let content = "# 大模型配置\n\ndefault_model:\n  provider: \"\"\n  model_name: \"\"\n\nproviders:\n  openrouter:\n    enabled: false\n    api_key: \"\"\n";
        let result = upsert_provider_api_key(content, "baidu", "baidu-secret-123");
        // 验证 providers: 块内追加了 baidu
        assert!(result.contains("  baidu:"));
        assert!(result.contains("    api_key: \"baidu-secret-123\""));
        // 验证不在根级
        for line in result.lines() {
            assert!(
                !line.trim().starts_with("baidu:") || line.starts_with("  ") || line.starts_with("    "),
                "baidu should not appear at root level: {:?}",
                line
            );
        }
    }

    /// 替换已有供应商的 api_key
    #[test]
    fn upsert_api_key_replace() {
        let content = "providers:\n  minimax:\n    api_key: \"old-key\"\n    enabled: true\n";
        let result = upsert_provider_api_key(content, "minimax", "new-key-456");
        assert!(result.contains("api_key: \"new-key-456\""));
        assert!(!result.contains("old-key"), "should replace old key");
        assert!(result.contains("enabled: true"), "should preserve other fields");
    }

    /// 供应商块无 api_key 行时插入
    #[test]
    fn upsert_api_key_insert() {
        let content = "providers:\n  minimax:\n    enabled: false\n";
        let result = upsert_provider_api_key(content, "minimax", "key-only");
        assert!(result.contains("api_key: \"key-only\""));
        assert!(result.contains("enabled: false"), "should preserve enabled");
    }

    /// providers: 块完全不存在时，追加完整的 providers: 块（而非根级追加 provider）
    #[test]
    fn upsert_api_key_no_providers_block_creates_it() {
        let content = "# Empty\n";
        let result = upsert_provider_api_key(content, "deepseek", "deepseek-key");
        assert!(result.contains("providers:"), "should create providers: block");
        assert!(result.contains("  deepseek:"), "new provider should be inside providers block");
        assert!(result.contains("    api_key: \"deepseek-key\""));
        // 确认根级没有单独的 `deepseek:`
        for line in result.lines() {
            let trimmed = line.trim();
            assert!(
                !trimmed.starts_with("deepseek:") || line.starts_with("  ") || line.starts_with("    "),
                "deepseek should not appear at root level: {:?}",
                line
            );
        }
    }

    /// volc_ark（UI ID）在模板中找不到（模板用 volcengine），应回退更新 volcengine 块
    #[test]
    fn upsert_api_key_volc_ark_alias_falls_back_to_volcengine() {
        // 模板中 volcengine 有 enabled，但 volc_ark 不存在
        let content = "providers:\n  volcengine:\n    enabled: true\n    api_key: \"\"\n  openrouter:\n    api_key: \"\"\n";
        let result = upsert_provider_api_key(content, "volc_ark", "volc-ark-key-123");
        // volc_ark 不应在根级追加
        for line in result.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("volc_ark:") && !line.starts_with("  ") {
                panic!("volc_ark should not appear at root level: {:?}", line);
            }
        }
        // volcengine 的 api_key 应被更新
        assert!(result.contains("volcengine:"));
        assert!(result.contains("    api_key: \"volc-ark-key-123\""), "volcengine api_key should be updated to volc-ark-key-123");
        assert!(!result.contains("api_key: \"\""), "old empty api_key should be replaced");
        // openrouter 应保留
        assert!(result.contains("openrouter:"));
    }

    /// volcengine（旧 key）在模板中存在，保存 volc_ark（新 key）时直接更新 volcengine 块
    #[test]
    fn upsert_api_key_volc_ark_updates_volcengine_block() {
        let content = "providers:\n  volcengine:\n    enabled: true\n    api_key: \"old-key\"\n";
        let result = upsert_provider_api_key(content, "volc_ark", "new-volc-key");
        assert!(result.contains("    api_key: \"new-volc-key\""));
        assert!(!result.contains("old-key"));
        // volc_ark 不应追加到根级
        for line in result.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("volc_ark:") && !line.starts_with("  ") {
                panic!("volc_ark should not appear at root level: {:?}", line);
            }
        }
    }
}