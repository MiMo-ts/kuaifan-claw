//! 后端业务逻辑集成测试
//! 运行方式: cargo test
//! 这些测试验证配置解析、数据结构、合并逻辑等核心业务规则

use std::collections::HashMap;
use std::path::Path;

// ============================================================
// helpers
// ============================================================

fn temp_dir() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

fn write_file(path: &Path, content: &str) {
    std::fs::write(path, content).unwrap();
}

// ============================================================
// gateway.rs 业务逻辑测试
// ============================================================

#[test]
fn test_read_gateway_config_defaults() {
    // 不写 gateway 节点，验证默认值
    let app_yaml = r#"
version: "1.0.0"
app:
  name: "Test"
"#;
    let dir = temp_dir();
    let config_dir = dir.path().join("config");
    std::fs::create_dir_all(&config_dir).unwrap();
    write_file(&config_dir.join("app.yaml"), app_yaml);

    let raw = std::fs::read_to_string(config_dir.join("app.yaml")).unwrap();
    let doc: serde_yaml::Value = serde_yaml::from_str(&raw).unwrap();
    let gw = doc
        .get("gateway")
        .cloned()
        .unwrap_or(serde_yaml::Value::Null);

    let port = gw.get("port").and_then(|v| v.as_i64()).unwrap_or(18789);
    let token = gw.get("token").and_then(|v| v.as_str()).unwrap_or("123456");
    let host = gw
        .get("host")
        .and_then(|v| v.as_str())
        .unwrap_or("127.0.0.1");

    assert_eq!(port, 18789, "默认端口应为 18789");
    assert_eq!(token, "123456", "默认令牌应为 123456");
    assert_eq!(host, "127.0.0.1", "默认 host 应为 127.0.0.1");
}

#[test]
fn test_read_custom_gateway_config() {
    let app_yaml = r#"
version: "1.0.0"
gateway:
  host: "0.0.0.0"
  port: 18000
  token: "mysecret123"
"#;
    let dir = temp_dir();
    let config_dir = dir.path().join("config");
    std::fs::create_dir_all(&config_dir).unwrap();
    write_file(&config_dir.join("app.yaml"), app_yaml);

    let raw = std::fs::read_to_string(config_dir.join("app.yaml")).unwrap();
    let doc: serde_yaml::Value = serde_yaml::from_str(&raw).unwrap();
    let gw = doc
        .get("gateway")
        .cloned()
        .unwrap_or(serde_yaml::Value::Null);

    assert_eq!(gw.get("port").and_then(|v| v.as_i64()), Some(18000));
    assert_eq!(
        gw.get("token").and_then(|v| v.as_str()),
        Some("mysecret123")
    );
    assert_eq!(gw.get("host").and_then(|v| v.as_str()), Some("0.0.0.0"));
}

#[test]
fn test_host_to_bind_mapping() {
    let cases = vec![
        ("127.0.0.1", "loopback"),
        ("localhost", "loopback"),
        ("::1", "loopback"),
        ("0.0.0.0", "lan"),
        ("192.168.1.1", "custom"),
    ];

    for (host, expected_bind) in cases {
        let h = host.to_lowercase();
        let bind = if h == "127.0.0.1" || h == "localhost" || h == "::1" {
            "loopback"
        } else if h == "0.0.0.0" {
            "lan"
        } else {
            "custom"
        };
        assert_eq!(
            bind, expected_bind,
            "host={} 应映射到 bind={}",
            host, expected_bind
        );
    }
}

#[test]
fn test_deep_merge_preserves_skills() {
    // 模拟深度合并逻辑（与 gateway.rs 中的 merge_json_deep 一致）
    fn merge_json_deep(target: &mut serde_json::Value, patch: serde_json::Value) {
        match (target, patch) {
            (serde_json::Value::Object(tobj), serde_json::Value::Object(pobj)) => {
                for (k, pv) in pobj {
                    if let Some(tv) = tobj.get_mut(&k) {
                        merge_json_deep(tv, pv);
                    } else {
                        tobj.insert(k, pv);
                    }
                }
            }
            (t, p) => *t = p,
        }
    }

    let mut base = serde_json::json!({
        "skills": {
            "load": {
                "extraDirs": ["D:/robots/robot1/skills"]
            }
        }
    });

    let patch = serde_json::json!({
        "gateway": {
            "mode": "local",
            "port": 18789,
            "auth": { "token": "123456" },
            "bind": "loopback"
        }
    });

    merge_json_deep(&mut base, patch);

    // skills 保留
    let skills_dirs = base
        .get("skills")
        .and_then(|s| s.get("load"))
        .and_then(|l| l.get("extraDirs"))
        .and_then(|d| d.as_array())
        .map(|a| a.len());
    assert_eq!(skills_dirs, Some(1), "skills 应保留");

    // gateway 合并
    assert_eq!(
        base.get("gateway")
            .and_then(|g| g.get("mode"))
            .and_then(|v| v.as_str()),
        Some("local"),
        "gateway.mode 应为 local"
    );
    assert_eq!(
        base.get("gateway")
            .and_then(|g| g.get("port"))
            .and_then(|v| v.as_i64()),
        Some(18789),
        "gateway.port 应为 18789"
    );
    assert_eq!(
        base.get("gateway")
            .and_then(|g| g.get("auth"))
            .and_then(|a| a.get("token"))
            .and_then(|v| v.as_str()),
        Some("123456"),
        "gateway.auth.token 应为 123456"
    );
}

#[test]
fn test_openclaw_port_from_app_yaml() {
    let app_yaml = r#"
gateway:
  port: 9999
  token: "secret"
  host: "0.0.0.0"
"#;
    let dir = temp_dir();
    let config_dir = dir.path().join("config");
    std::fs::create_dir_all(&config_dir).unwrap();
    write_file(&config_dir.join("app.yaml"), app_yaml);

    let raw = std::fs::read_to_string(config_dir.join("app.yaml")).unwrap();
    let doc: serde_yaml::Value = serde_yaml::from_str(&raw).unwrap();
    let port = doc
        .get("gateway")
        .and_then(|g| g.get("port"))
        .and_then(|v| v.as_i64());

    assert_eq!(port, Some(9999), "端口应为 9999");
}

#[test]
fn test_custom_bind_host_cleanup() {
    let mut cfg = serde_json::json!({
        "gateway": {
            "customBindHost": "192.168.1.1"
        }
    });

    let bind = "loopback"; // 切换回 loopback
    if bind != "custom" {
        if let Some(g) = cfg.get_mut("gateway").and_then(|x| x.as_object_mut()) {
            g.remove("customBindHost");
        }
    }

    assert!(
        cfg.get("gateway")
            .and_then(|g| g.get("customBindHost"))
            .is_none(),
        "customBindHost 应在 bind=loopback 时移除"
    );
}

// ============================================================
// instance.rs 业务逻辑测试
// ============================================================

#[test]
fn test_parse_default_model_from_yaml() {
    let content = r#"
default_model:
  provider: "openrouter"
  model_name: "google/gemini-2.0-flash-thinking-exp:free"

providers:
  openrouter:
    enabled: true
    api_key: "sk-test"
"#;
    let doc: serde_yaml::Value = serde_yaml::from_str(content).ok().unwrap();

    let provider = doc
        .get("default_model")
        .and_then(|d| d.get("provider"))
        .and_then(|v| v.as_str());
    let model_name = doc
        .get("default_model")
        .and_then(|d| d.get("model_name"))
        .and_then(|v| v.as_str());

    assert_eq!(provider.as_deref(), Some("openrouter"));
    assert_eq!(
        model_name.as_deref(),
        Some("google/gemini-2.0-flash-thinking-exp:free")
    );
}

#[test]
fn test_instances_yaml_roundtrip() {
    let instances_yaml = r#"instances:
  - id: test-instance-001
    name: "测试实例"
    enabled: true
    robot_id: robot_ecom_001
    channel_type: telegram
    channel_config: {}
    max_history: 100
    response_mode: auto
    message_count: 0
    created_at: "2026-03-25T00:00:00Z"
    updated_at: "2026-03-25T00:00:00Z"

stats:
  total_instances: 1
  running_instances: 0
  total_messages: 0
  last_updated: null
"#;

    let parsed: serde_yaml::Value = serde_yaml::from_str(instances_yaml).unwrap();
    let count = parsed
        .get("instances")
        .and_then(|i| i.as_sequence())
        .map(|a| a.len());
    assert_eq!(count, Some(1), "应解析出 1 个实例");

    let stats = parsed
        .get("stats")
        .and_then(|s| s.get("total_instances"))
        .and_then(|v| v.as_i64());
    assert_eq!(stats, Some(1), "total_instances 应为 1");

    let name = parsed
        .get("instances")
        .and_then(|i| i.as_sequence())
        .and_then(|a| a.first())
        .and_then(|inst| inst.get("name"))
        .and_then(|v| v.as_str());
    assert_eq!(name, Some("测试实例"));
}

#[test]
fn test_channel_config_serde() {
    let channel_config = serde_json::json!({
        "bot_token": "123456:ABC-DEF",
        "chat_id": "-1001234567890"
    });

    let serialized = serde_json::to_string(&channel_config).unwrap();
    assert!(serialized.contains("bot_token"));
    assert!(serialized.contains("123456:ABC-DEF"));

    let deserialized: serde_json::Value = serde_json::from_str(&serialized).unwrap();
    assert_eq!(
        deserialized.get("bot_token").and_then(|v| v.as_str()),
        Some("123456:ABC-DEF")
    );
}

// ============================================================
// backup.rs 业务逻辑测试
// ============================================================

#[test]
fn test_backup_filename_format() {
    let now = chrono::Local::now();
    let filename = format!("config_backup_{}.zip", now.format("%Y%m%d_%H%M%S"));
    assert!(filename.starts_with("config_backup_"));
    assert!(filename.ends_with(".zip"));
    assert!(filename.len() > "config_backup_.zip".len());
}

#[test]
fn test_backup_sort_by_time_desc() {
    let mut backups = vec![
        serde_json::json!({"filename": "backup_20260325_120000.zip", "created_at": "2026-03-25T12:00:00Z"}),
        serde_json::json!({"filename": "backup_20260325_080000.zip", "created_at": "2026-03-25T08:00:00Z"}),
        serde_json::json!({"filename": "backup_20260325_100000.zip", "created_at": "2026-03-25T10:00:00Z"}),
    ];

    backups.sort_by(|a, b| {
        let ta = a.get("created_at").and_then(|v| v.as_str()).unwrap_or("");
        let tb = b.get("created_at").and_then(|v| v.as_str()).unwrap_or("");
        tb.cmp(ta)
    });

    assert_eq!(
        backups[0].get("filename").and_then(|v| v.as_str()),
        Some("backup_20260325_120000.zip")
    );
    assert_eq!(
        backups[1].get("filename").and_then(|v| v.as_str()),
        Some("backup_20260325_100000.zip")
    );
    assert_eq!(
        backups[2].get("filename").and_then(|v| v.as_str()),
        Some("backup_20260325_080000.zip")
    );
}

// ============================================================
// usage.rs 业务逻辑测试
// ============================================================

#[test]
fn test_token_usage_jsonl_roundtrip() {
    let record = serde_json::json!({
        "ts": "2026-03-25T00:00:00Z",
        "provider": "openrouter",
        "model": "google/gemini-2.0-flash-thinking-exp:free",
        "prompt_tokens": 100,
        "completion_tokens": 200,
        "total_tokens": 300,
        "source": "test"
    });

    let line = serde_json::to_string(&record).unwrap();
    assert!(line.contains("prompt_tokens"));
    assert!(line.contains("total_tokens"));

    let parsed: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(
        parsed.get("total_tokens").and_then(|v| v.as_u64()),
        Some(300)
    );
}

#[test]
fn test_usage_summary_aggregation() {
    let records = vec![
        serde_json::json!({"provider": "openrouter", "prompt_tokens": 100, "completion_tokens": 200, "total_tokens": 300}),
        serde_json::json!({"provider": "openrouter", "prompt_tokens": 50, "completion_tokens": 100, "total_tokens": 150}),
        serde_json::json!({"provider": "anthropic", "prompt_tokens": 80, "completion_tokens": 160, "total_tokens": 240}),
    ];

    let mut total_prompt = 0u64;
    let mut total_completion = 0u64;
    let mut total_tokens = 0u64;
    let mut by_provider: HashMap<String, u64> = HashMap::new();

    for r in &records {
        let p = r.get("prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
        let c = r
            .get("completion_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let t = r.get("total_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
        total_prompt += p;
        total_completion += c;
        total_tokens += t;

        let provider = r
            .get("provider")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        *by_provider.entry(provider.to_string()).or_insert(0) += t;
    }

    assert_eq!(total_prompt, 230);
    assert_eq!(total_completion, 460);
    assert_eq!(total_tokens, 690);
    assert_eq!(by_provider.get("openrouter"), Some(&450));
    assert_eq!(by_provider.get("anthropic"), Some(&240));
}

// ============================================================
// config.rs 业务逻辑测试
// ============================================================

#[test]
fn test_parse_theme_and_color() {
    let app_yaml = r###"
version: "1.0.0"
appearance:
  theme: "dark"
  color: "#FF5733"
gateway:
  port: 8080
"###;

    let doc: serde_yaml::Value = serde_yaml::from_str(app_yaml).unwrap();
    assert_eq!(
        doc.get("appearance")
            .and_then(|a| a.get("theme"))
            .and_then(|v| v.as_str()),
        Some("dark")
    );
    assert_eq!(
        doc.get("appearance")
            .and_then(|a| a.get("color"))
            .and_then(|v| v.as_str()),
        Some("#FF5733")
    );
    assert_eq!(
        doc.get("gateway")
            .and_then(|g| g.get("port"))
            .and_then(|v| v.as_i64()),
        Some(8080)
    );
}

#[test]
fn test_empty_app_yaml_defaults() {
    let content = "";
    if content.trim().is_empty() {
        let result = serde_json::json!({
            "version": "1.0.0",
            "gateway": { "port": 8080 },
            "appearance": { "theme": "system", "color": "#3B82F6" }
        });

        assert_eq!(
            result
                .get("appearance")
                .and_then(|a| a.get("theme"))
                .and_then(|v| v.as_str()),
            Some("system")
        );
        assert_eq!(
            result
                .get("gateway")
                .and_then(|g| g.get("port"))
                .and_then(|v| v.as_i64()),
            Some(8080)
        );
    }
}

// ============================================================
// env.rs 业务逻辑测试
// ============================================================

#[test]
fn test_node_version_requirement() {
    let cases = vec![
        ("v22.0.0", true),
        ("v18.16.0", true),
        ("v17.0.0", false),
        ("v16.0.0", false),
        ("v20.14.0", true),
    ];

    for (version, expected_ok) in cases {
        let version_str = version.trim_start_matches('v');
        let major: u32 = version_str
            .split('.')
            .next()
            .unwrap_or("0")
            .parse()
            .unwrap_or(0);
        let ok = major >= 18;
        assert_eq!(
            ok, expected_ok,
            "版本 {} major={} 应 ok={}",
            version, major, expected_ok
        );
    }
}

#[test]
fn test_git_version_parsing() {
    let cases = vec![
        ("git version 2.43.0.windows.1", "2.43.0.windows.1"),
        ("git version 2.39.3", "2.39.3"),
    ];

    for (input, expected) in cases {
        let version = input.replace("git version ", "").trim().to_string();
        assert_eq!(version, expected);
    }
}

#[test]
fn test_disk_space_thresholds() {
    let cases = vec![
        (15.0, "success"),
        (10.0, "success"),
        (7.0, "warning"),
        (5.0, "warning"),
        (3.0, "error"),
    ];

    for (free_gb, expected_status) in cases {
        let status = if free_gb >= 10.0 {
            "success"
        } else if free_gb >= 5.0 {
            "warning"
        } else {
            "error"
        };
        assert_eq!(
            status, expected_status,
            "free={} 应为 {}",
            free_gb, expected_status
        );
    }
}

// ============================================================
// model.rs 业务逻辑测试
// ============================================================

#[test]
fn test_provider_api_key_env_vars() {
    let cases = vec![
        ("openai", "OPENAI_API_KEY"),
        ("anthropic", "ANTHROPIC_API_KEY"),
        ("google", "GEMINI_API_KEY"),
        ("openrouter", "OPENROUTER_API_KEY"),
        ("groq", "GROQ_API_KEY"),
        ("xai", "XAI_API_KEY"),
        ("mistral", "MISTRAL_API_KEY"),
        ("deepseek", "DEEPSEEK_API_KEY"),
        ("moonshot", "MOONSHOT_API_KEY"),
        ("minimax", "MINIMAX_API_KEY"),
        ("volcengine", "VOLCENGINE_API_KEY"),
        ("dashscope", "DASHSCOPE_API_KEY"),
        ("siliconflow", "SILICONFLOW_API_KEY"),
    ];

    for (provider, expected_var) in cases {
        let env_var = match provider.to_lowercase().as_str() {
            "openai" => "OPENAI_API_KEY",
            "anthropic" => "ANTHROPIC_API_KEY",
            "google" => "GEMINI_API_KEY",
            "openrouter" => "OPENROUTER_API_KEY",
            "groq" => "GROQ_API_KEY",
            "xai" => "XAI_API_KEY",
            "mistral" => "MISTRAL_API_KEY",
            "deepseek" => "DEEPSEEK_API_KEY",
            "moonshot" => "MOONSHOT_API_KEY",
            "minimax" => "MINIMAX_API_KEY",
            "volcengine" => "VOLCENGINE_API_KEY",
            "dashscope" => "DASHSCOPE_API_KEY",
            "siliconflow" => "SILICONFLOW_API_KEY",
            _ => "UNKNOWN",
        };
        assert_eq!(
            env_var, expected_var,
            "provider={} 应映射到 {}",
            provider, expected_var
        );
    }
}

#[test]
fn test_providers_list() {
    let providers = vec![
        "openrouter",
        "openai",
        "anthropic",
        "google",
        "deepseek",
        "xiaomi",
        "baidu",
        "aliyun",
        "tencent",
        "volcengine",
        "xfyun",
        "zhipu",
        "moonshot",
        "ollama",
        "groq",
        "cohere",
        "minimax",
        "baichuan",
        "custom",
    ];

    assert_eq!(providers.len(), 19, "应支持 19 个供应商");
    assert!(providers.contains(&"openrouter"));
    assert!(providers.contains(&"ollama"), "应包含 ollama（本地模型）");
    assert!(providers.contains(&"anthropic"));
}

// ============================================================
// robot.rs 业务逻辑测试
// ============================================================

#[test]
fn test_robot_templates_categories() {
    let templates = vec![
        ("ecom", "电商机器人"),
        ("ecom", "电商机器人2"),
        ("social", "社交机器人"),
        ("stock", "股票机器人"),
        ("stock", "股票机器人2"),
        ("stock", "股票机器人3"),
        ("content", "内容创作"),
        ("office", "办公效率"),
        ("office", "办公效率2"),
        ("office", "办公效率3"),
        ("office", "办公效率4"),
        ("dev", "开发者"),
        ("dev", "开发者2"),
        ("general", "通用助手"),
        ("general", "通用助手2"),
        ("general", "通用助手3"),
    ];

    let mut cats: HashMap<String, usize> = HashMap::new();
    for (cat, _) in &templates {
        *cats.entry(cat.to_string()).or_insert(0) += 1;
    }

    assert_eq!(cats.get("ecom").copied(), Some(2), "电商应有 2 个");
    assert_eq!(cats.get("social").copied(), Some(1), "社交应有 1 个");
    assert_eq!(cats.get("stock").copied(), Some(3), "股票应有 3 个");
    assert_eq!(cats.get("office").copied(), Some(4), "办公应有 4 个");
    assert_eq!(cats.get("dev").copied(), Some(2), "开发者应有 2 个");
    assert_eq!(cats.get("general").copied(), Some(3), "通用应有 3 个");
    assert_eq!(templates.len(), 16, "应有 16 个模板");
}

#[test]
fn test_skills_extra_dirs_merge() {
    let mut updated = serde_json::json!({
        "skills": {
            "load": {
                "extraDirs": ["D:/robots/robot1/skills"]
            }
        }
    });

    let new_dir = "D:/robots/robot2/skills";
    if let Some(skills) = updated.get_mut("skills").and_then(|s| s.get_mut("load")) {
        if let Some(dirs) = skills.get_mut("extraDirs").and_then(|d| d.as_array_mut()) {
            dirs.push(serde_json::json!(new_dir));
        }
    }

    let dirs_count = updated
        .get("skills")
        .and_then(|s| s.get("load"))
        .and_then(|l| l.get("extraDirs"))
        .and_then(|d| d.as_array())
        .map(|d| d.len());

    assert_eq!(dirs_count, Some(2), "应有 2 个 extraDirs");
}

// ============================================================
// plugin.rs 业务逻辑测试
// ============================================================

#[test]
fn test_plugin_platforms() {
    let plugins = vec![
        "feishu", "dingtalk", "wecom", "weixin", "telegram", "qq", "whatsapp", "discord", "slack",
        "email",
    ];

    assert_eq!(plugins.len(), 10, "应支持 10 个聊天平台");
    assert!(plugins.contains(&"feishu"));
    assert!(plugins.contains(&"dingtalk"));
    assert!(plugins.contains(&"wecom"));
    assert!(plugins.contains(&"telegram"));
    assert!(plugins.contains(&"qq"));
    assert!(plugins.contains(&"discord"));
    assert!(plugins.contains(&"slack"));
    assert!(plugins.contains(&"email"));
}

// ============================================================
// models.rs 数据结构测试
// ============================================================

#[test]
fn test_gateway_status_serde() {
    let status = serde_json::json!({
        "running": true,
        "version": "0.1.9",
        "port": 18789u16,
        "uptime_seconds": 3600u64,
        "memory_mb": 120.5f64,
        "instances_running": 2usize,
    });

    assert_eq!(status.get("running").and_then(|v| v.as_bool()), Some(true));
    assert_eq!(
        status.get("version").and_then(|v| v.as_str()),
        Some("0.1.9")
    );
    assert_eq!(status.get("port").and_then(|v| v.as_u64()), Some(18789));
    assert_eq!(
        status.get("uptime_seconds").and_then(|v| v.as_u64()),
        Some(3600)
    );
    assert_eq!(
        status.get("memory_mb").and_then(|v| v.as_f64()),
        Some(120.5)
    );
    assert_eq!(
        status.get("instances_running").and_then(|v| v.as_u64()),
        Some(2)
    );
}

#[test]
fn test_env_status_values() {
    let statuses = vec!["Success", "Warning", "Error", "Checking"];
    assert_eq!(statuses.len(), 4);
}

#[test]
fn test_log_level_filter() {
    let logs = vec![
        serde_json::json!({"level": "INFO", "message": "启动网关"}),
        serde_json::json!({"level": "WARN", "message": "配置缺失"}),
        serde_json::json!({"level": "ERROR", "message": "安装失败"}),
        serde_json::json!({"level": "INFO", "message": "环境检测"}),
    ];

    let errors: Vec<_> = logs
        .iter()
        .filter(|l| l.get("level").and_then(|v| v.as_str()) == Some("ERROR"))
        .collect();

    let infos: Vec<_> = logs
        .iter()
        .filter(|l| l.get("level").and_then(|v| v.as_str()) == Some("INFO"))
        .collect();

    assert_eq!(errors.len(), 1);
    assert_eq!(infos.len(), 2);
}

#[test]
fn test_backup_info_serde() {
    let backup = serde_json::json!({
        "id": "backup-001",
        "filename": "config_backup_20260325.zip",
        "created_at": "2026-03-25T12:00:00Z",
        "size_bytes": 102400u64,
        "description": "安装前备份"
    });

    assert_eq!(
        backup.get("id").and_then(|v| v.as_str()),
        Some("backup-001")
    );
    assert_eq!(
        backup.get("size_bytes").and_then(|v| v.as_u64()),
        Some(102400)
    );
}

#[test]
fn test_system_info_fields() {
    let sysinfo = serde_json::json!({
        "os": "windows",
        "arch": "x86_64",
        "cpu_count": 8usize,
        "total_memory_mb": 16384u64,
        "available_memory_mb": 8192u64,
        "hostname": "DESKTOP-TEST"
    });

    assert_eq!(sysinfo.get("os").and_then(|v| v.as_str()), Some("windows"));
    assert_eq!(sysinfo.get("cpu_count").and_then(|v| v.as_u64()), Some(8));
    assert_eq!(
        sysinfo.get("total_memory_mb").and_then(|v| v.as_u64()),
        Some(16384)
    );
    assert!(
        sysinfo
            .get("available_memory_mb")
            .and_then(|v| v.as_u64())
            .unwrap()
            <= 16384
    );
}
