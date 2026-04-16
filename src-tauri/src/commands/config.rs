// 配置管理命令

use tracing::info;

/// 规范 npm registry，避免 `registry.npmmirror.com` 等无协议写法触发 npm `ERR_INVALID_URL`。
pub fn sanitize_npm_registry(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() {
        return String::new();
    }
    let t = t.trim_end_matches('/');
    if t.starts_with("http://") || t.starts_with("https://") {
        return t.to_string();
    }
    format!("https://{}", t.trim_start_matches('/'))
}

/// 从 app.yaml 解析 openclaw 配置字段，返回 (package, version_tag, registry, allow_scripts, prefer_system_node, legacy_peer_deps)
/// legacy_peer_deps 默认 true：可避免 npm 在复杂 peer 依赖上递归过深导致 Maximum call stack size exceeded
pub fn parse_openclaw_config(data_dir: &str) -> (String, String, String, bool, bool, bool) {
    let config_path = format!("{}/config/app.yaml", data_dir);
    let content = std::fs::read_to_string(&config_path).unwrap_or_default();

    let mut package = "openclaw-cn".to_string();
    let mut version_tag = "latest".to_string();
    let mut registry = "https://registry.npmmirror.com".to_string(); // 默认使用国内镜像
    let mut allow_scripts = true;
    let mut prefer_system_node = false;
    let mut legacy_peer_deps = true;

    // 解析 `key: value` 行；value 可含冒号（如 https://），禁止用 split(':').nth(1) 截断 URL。
    fn inline_yaml_value<'a>(trimmed: &'a str, key: &str) -> Option<&'a str> {
        let prefix = format!("{}:", key);
        trimmed
            .strip_prefix(&prefix)
            .map(|v| v.trim().trim_matches('"').trim_matches('\'').trim())
    }

    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(v) = inline_yaml_value(trimmed, "package") {
            if !v.is_empty() {
                package = v.to_string();
            }
        } else if let Some(v) = inline_yaml_value(trimmed, "version_tag") {
            if !v.is_empty() {
                version_tag = v.to_string();
            }
        } else if let Some(v) = inline_yaml_value(trimmed, "registry") {
            registry = sanitize_npm_registry(v);
        } else if trimmed.starts_with("allow_scripts:") {
            if let Some(val) = trimmed.split(':').nth(1) {
                allow_scripts = val.trim() != "false";
            }
        } else if trimmed.starts_with("prefer_system_node:") {
            if let Some(val) = trimmed.split(':').nth(1) {
                prefer_system_node = val.trim() == "true";
            }
        } else if trimmed.starts_with("legacy_peer_deps:") {
            if let Some(val) = trimmed.split(':').nth(1) {
                legacy_peer_deps = val.trim() != "false";
            }
        }
    }

    (
        package,
        version_tag,
        registry,
        allow_scripts,
        prefer_system_node,
        legacy_peer_deps,
    )
}

#[tauri::command]
pub async fn get_app_config(
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let config_path = format!("{}/config/app.yaml", data_dir);

    let content = tokio::fs::read_to_string(&config_path)
        .await
        .unwrap_or_default();

    // 文件为空时返回默认配置
    if content.trim().is_empty() {
        return Ok(serde_json::json!({
            "version": "1.0.0",
            "updates": {
                "check_app_updates": false,
                "check_openclaw_updates": false,
                "check_skills_updates": false
            },
            "appearance": {
                "theme": "system",
                "color": "#3B82F6"
            },
            "gateway": {
                "port": 8080
            }
        }));
    }

    // 尝试将 YAML 内容转为 JSON（简单解析关键字段）
    let mut result = serde_json::json!({
        "version": "1.0.0",
        "updates": {
            "check_app_updates": false,
            "check_openclaw_updates": false,
            "check_skills_updates": false
        },
        "appearance": {
            "theme": "system",
            "color": "#3B82F6"
        },
        "gateway": {
            "port": 8080
        }
    });

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("theme:") {
            if let Some(val) = trimmed.split(':').nth(1) {
                if let Some(obj) = result.get_mut("appearance").and_then(|v| v.as_object_mut()) {
                    obj.insert(
                        "theme".to_string(),
                        serde_json::json!(val.trim().trim_matches('"')),
                    );
                }
            }
        } else if trimmed.starts_with("color:") {
            if let Some(val) = trimmed.split(':').nth(1) {
                if let Some(obj) = result.get_mut("appearance").and_then(|v| v.as_object_mut()) {
                    obj.insert(
                        "color".to_string(),
                        serde_json::json!(val.trim().trim_matches('"')),
                    );
                }
            }
        } else if trimmed.starts_with("port:") {
            if let Some(val) = trimmed.split(':').nth(1) {
                if let Ok(p) = val.trim().parse::<u16>() {
                    if let Some(obj) = result.get_mut("gateway").and_then(|v| v.as_object_mut()) {
                        obj.insert("port".to_string(), serde_json::json!(p));
                    }
                }
            }
        }
    }

    Ok(result)
}

/// 将 app.yaml 内容中的指定顶级键进行 upsert，返回新内容。
fn upsert_app_yaml_key(content: &str, key: &str, value: &serde_json::Value) -> String {
    let lines: Vec<&str> = content.lines().collect::<Vec<_>>();
    let target = format!("{}:", key);
    let mut in_block = false;
    let mut new_lines: Vec<String> = Vec::new();
    let value_str = match value {
        serde_json::Value::String(s) => format!("\"{}\"", s.replace('"', "\\\"")),
        serde_json::Value::Null => "~".to_string(),
        serde_json::Value::Bool(b) => {
            if *b {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
        other => other.to_string(),
    };

    for (_i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with(&target) && !in_block {
            // 找到顶级 key，行级替换值
            if line.find(':').is_some() {
                let indent = &line[..line.len() - line.trim_start().len()];
                new_lines.push(format!("{}{}", indent, value_str));
            } else {
                new_lines.push(line.to_string());
            }
            continue;
        }
        // 顶级块开始
        if !in_block && !trimmed.is_empty() && (!line.starts_with("  ") && !line.starts_with('\t'))
        {
            in_block = true;
        }
        new_lines.push(line.to_string());
    }

    // 若 key 不存在，追加到文件末尾
    if !new_lines.iter().any(|l| l.trim().starts_with(&target)) {
        if !content.trim().is_empty() {
            new_lines.push(String::new());
        }
        new_lines.push(format!("{}: {}", key, value_str));
    }

    new_lines.join("\n")
}

#[tauri::command]
pub async fn save_app_config(
    data_dir: tauri::State<'_, crate::AppState>,
    config: serde_json::Value,
) -> Result<String, String> {
    info!("保存应用配置...");

    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let config_path = format!("{}/config/app.yaml", data_dir);

    let content = tokio::fs::read_to_string(&config_path)
        .await
        .unwrap_or_default();

    // 将传入的 config（JSON）逐键合并到现有 YAML 内容中
    let mut merged = content.clone();
    if let Some(obj) = config.as_object() {
        for (key, value) in obj {
            merged = upsert_app_yaml_key(&merged, key, value);
        }
    } else {
        // config 不是对象时直接序列化覆盖（兜底）
        merged = serde_yaml::to_string(&config).map_err(|e| format!("序列化配置失败: {}", e))?;
    }

    tokio::fs::write(&config_path, &merged)
        .await
        .map_err(|e| format!("保存配置失败: {}", e))?;

    Ok("配置保存成功".to_string())
}

#[tauri::command]
pub async fn get_data_dir(data_dir: tauri::State<'_, crate::AppState>) -> Result<String, String> {
    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    Ok(data_dir)
}

/// 供前端/用户核对「正在读写哪一份 models.yaml」，避免编辑 resources 或另一台机器上的副本。
#[tauri::command]
pub async fn get_config_paths(
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    let root = data_dir.inner().data_dir.lock().unwrap().clone();
    let models_yaml = crate::commands::gateway::models_yaml_path(&root);
    Ok(serde_json::json!({
        "data_dir": root,
        "models_yaml": models_yaml.to_string_lossy(),
        "models_yaml_exists": models_yaml.exists(),
    }))
}
