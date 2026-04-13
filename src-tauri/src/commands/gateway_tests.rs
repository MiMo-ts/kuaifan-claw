// Gateway 路由逻辑自动化测试（仅在 `cargo test` 时编译）
// 覆盖：agent_id 与 account_id 一一对应、created_at 排序、account 清理、幂等性、account_id 格式

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    // ── 辅助：复刻 gateway.rs 中的 normalize_account_id ────────────────────────
    fn normalize_account_id(id: &str) -> String {
        id.trim()
            .to_lowercase()
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
            .take(64)
            .collect()
    }

    // ── 辅助：复刻 feishu_manager_account_id（修复后版本）──────────────────────
    fn feishu_manager_account_id(instance_id: &str) -> String {
        normalize_account_id(instance_id)
    }

    // ── 辅助：复刻 channel_account_id ─────────────────────────────────────────
    fn channel_account_id(channel_type: &str, instance_id: &str) -> String {
        match channel_type {
            "feishu" => feishu_manager_account_id(instance_id),
            _ => normalize_account_id(&format!("{}-{}", channel_type, instance_id)),
        }
    }

    // ── 辅助：复刻 prune_stale_manager_channel_account_keys（修复后版本）─────────
    fn prune_stale_accounts(base: &mut serde_json::Value, valid_ids: &HashSet<String>) {
        // 用 get_key_value + replace 避免 iter_mut + as_object_mut 嵌套可变借用
        if let Some(channels_obj) = base.get_mut("channels").and_then(|c| c.as_object_mut()) {
            let names: Vec<String> = channels_obj.keys().cloned().collect();
            for name in names {
                // get_mut 返回 &mut Value，之后不会再访问 channels_obj，所以无借用冲突
                if let Some(ch_val) = channels_obj.get_mut(&name) {
                    if let Some(acc_map) =
                        ch_val.get_mut("accounts").and_then(|a| a.as_object_mut())
                    {
                        let stale: Vec<String> = acc_map
                            .keys()
                            .filter(|k| !valid_ids.contains(k.as_str()))
                            .cloned()
                            .collect();
                        for k in stale {
                            acc_map.remove(&k);
                        }
                    }
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 测试 1：每个实例 agent_id = account_id（无共享 main）
    // ─────────────────────────────────────────────────────────────────────────
    #[test]
    fn test_agent_id_matches_account_id_per_instance() {
        #[derive(Debug)]
        struct MockInst {
            id: String,
            channel_type: String,
        }

        let instances = vec![
            MockInst {
                id: "inst_001".into(),
                channel_type: "feishu".into(),
            },
            MockInst {
                id: "inst_002".into(),
                channel_type: "feishu".into(),
            },
            MockInst {
                id: "inst_003".into(),
                channel_type: "dingtalk".into(),
            },
            MockInst {
                id: "inst_004".into(),
                channel_type: "dingtalk".into(),
            },
        ];

        let results: Vec<(String, String)> = instances
            .into_iter()
            .map(|inst| {
                let account_id = channel_account_id(&inst.channel_type, &inst.id);
                let agent_id = account_id.clone();
                (account_id, agent_id)
            })
            .collect();

        assert_eq!(results[0].1, "inst_001");
        assert_eq!(results[1].1, "inst_002");
        assert_eq!(results[2].1, "dingtalk-inst_003");
        assert_eq!(results[3].1, "dingtalk-inst_004");
        for (acc, ag) in &results {
            assert_eq!(acc, ag);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 测试 2：按 created_at 排序后，仍各自 agent_id = account_id
    // ─────────────────────────────────────────────────────────────────────────
    #[test]
    fn test_agent_id_order_by_created_at() {
        #[derive(Debug)]
        struct MockInst {
            id: String,
            channel_type: String,
            created_at: String,
        }

        let mut instances = vec![
            MockInst {
                id: "inst_later".into(),
                channel_type: "feishu".into(),
                created_at: "2025-03-01T10:00:00Z".into(),
            },
            MockInst {
                id: "inst_earlier".into(),
                channel_type: "feishu".into(),
                created_at: "2025-01-01T10:00:00Z".into(),
            },
        ];
        instances.sort_by(|a, b| a.created_at.cmp(&b.created_at));

        let results: Vec<String> = instances
            .iter()
            .map(|inst| channel_account_id(&inst.channel_type, &inst.id))
            .collect();

        assert_eq!(results[0], "inst_earlier");
        assert_eq!(results[1], "inst_later");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 测试 3：prune 清理不在 valid_ids 中的 account
    // ─────────────────────────────────────────────────────────────────────────
    #[test]
    fn test_prune_removes_non_inst_prefix() {
        let valid_ids: HashSet<String> = ["inst_001", "inst_002"]
            .iter()
            .map(|s| s.to_string())
            .collect();

        let mut base = serde_json::json!({
            "channels": {
                "feishu": {
                    "enabled": true,
                    "accounts": {
                        "qq-inst_xxx": {},
                        "inst_001": {}
                    }
                }
            }
        });

        let before = serde_json::to_string_pretty(&base).unwrap();
        prune_stale_accounts(&mut base, &valid_ids);
        let after = serde_json::to_string_pretty(&base).unwrap();

        assert!(
            !after.contains("qq-inst_xxx"),
            "prune 后不应包含 qq-inst_xxx\nprune 前: {}\nprune 后: {}",
            before,
            after
        );
        assert!(
            after.contains("inst_001"),
            "prune 后应保留 inst_001\nprune 前: {}\nprune 后: {}",
            before,
            after
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 测试 4：幂等性——两次同步结果相同
    // ─────────────────────────────────────────────────────────────────────────
    #[test]
    fn test_idempotent_sync_twice() {
        #[derive(Debug, Clone)]
        struct MockAccount {
            agent_id: String,
        }

        let accounts = vec![
            MockAccount {
                agent_id: "inst_001".into(),
            },
            MockAccount {
                agent_id: "inst_002".into(),
            },
        ];

        let mut seen1: HashSet<String> = HashSet::new();
        let written1: Vec<String> = accounts
            .iter()
            .filter(|a| seen1.insert(a.agent_id.clone()))
            .map(|a| a.agent_id.clone())
            .collect();

        let mut seen2: HashSet<String> = HashSet::new();
        let written2: Vec<String> = accounts
            .iter()
            .filter(|a| seen2.insert(a.agent_id.clone()))
            .map(|a| a.agent_id.clone())
            .collect();

        assert_eq!(written1, written2);
        assert_eq!(written1, vec!["inst_001", "inst_002"]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 测试 5：飞书 account_id 不出现双 inst- 前缀
    // ─────────────────────────────────────────────────────────────────────────
    #[test]
    fn test_account_id_no_double_prefix() {
        let instance_id = "inst_1774534098306";
        let account_id = channel_account_id("feishu", instance_id);
        assert!(!account_id.contains("inst-inst"), "不应出现双 inst- 前缀");
        assert_eq!(account_id, normalize_account_id(instance_id));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 测试 6：非飞书通道的 account_id 格式正确
    // ─────────────────────────────────────────────────────────────────────────
    #[test]
    fn test_non_feishu_account_id_format() {
        assert_eq!(channel_account_id("qq", "inst_001"), "qq-inst_001");
        assert_eq!(
            channel_account_id("telegram", "inst_002"),
            "telegram-inst_002"
        );
        assert_eq!(
            channel_account_id("dingtalk", "inst_003"),
            "dingtalk-inst_003"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 测试 7：seen_agent_ids 去重——各实例 agent_id 本就不重复
    // ─────────────────────────────────────────────────────────────────────────
    #[test]
    fn test_seen_agent_ids_dedup() {
        #[derive(Debug)]
        struct MockAcct {
            agent_id: String,
        }

        let accounts = vec![
            MockAcct {
                agent_id: "inst_a".into(),
            },
            MockAcct {
                agent_id: "inst_b".into(),
            },
            MockAcct {
                agent_id: "dingtalk-inst_c".into(),
            },
            MockAcct {
                agent_id: "dingtalk-inst_d".into(),
            },
        ];

        let mut seen: HashSet<String> = HashSet::new();
        let written: Vec<String> = accounts
            .iter()
            .filter(|a| seen.insert(a.agent_id.clone()))
            .map(|a| a.agent_id.clone())
            .collect();

        assert_eq!(
            written,
            vec!["inst_a", "inst_b", "dingtalk-inst_c", "dingtalk-inst_d"]
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 测试 8：Windows 路径归一化（cleanup extraDirs）
    // ─────────────────────────────────────────────────────────────────────────
    #[test]
    fn test_extra_dirs_windows_path_normalization() {
        let robot_id = "robot_stock";
        let pattern = format!("robots/{}/skills", robot_id);

        let extra_dirs = vec![
            r#"D:\data\robots\robot_stock\skills"#,
            r"D:/data/robots/robot_stock/skills",
            r#"D:\data\robots\robot_other\skills"#,
        ];

        let retained: Vec<&str> = extra_dirs
            .iter()
            .filter(|s| {
                let normalized = s.replace('\\', "/");
                !normalized.contains(&pattern)
            })
            .copied()
            .collect();

        assert_eq!(retained.len(), 1);
        assert!(retained[0].contains("robot_other"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 测试 9：KNOWN_CHANNELS 校验
    // ─────────────────────────────────────────────────────────────────────────
    #[test]
    fn test_unknown_channel_type_detected() {
        const KNOWN_CHANNELS: [&str; 6] = [
            "feishu",
            "dingtalk",
            "wxwork",
            "wechat_clawbot",
            "telegram",
            "qq",
        ];

        assert!(KNOWN_CHANNELS.contains(&"feishu"));
        assert!(KNOWN_CHANNELS.contains(&"qq"));
        assert!(!KNOWN_CHANNELS.contains(&"slack"));
        assert!(!KNOWN_CHANNELS.contains(&"discord"));
        assert!(!KNOWN_CHANNELS.contains(&""));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 测试 10：prune 保留仍在 valid_ids 中的 key
    // ─────────────────────────────────────────────────────────────────────────
    #[test]
    fn test_prune_preserves_valid_ids() {
        let valid_ids: HashSet<String> = ["inst_001", "qq-inst_003"]
            .iter()
            .map(|s| s.to_string())
            .collect();

        let mut base = serde_json::json!({
            "channels": {
                "feishu": {
                    "enabled": true,
                    "accounts": {
                        "inst_001": { "appId": "cli_a" },
                        "qq-inst_003": { "appId": "cli_b" },
                        "stale_inst_999": {}
                    }
                }
            }
        });

        let before = serde_json::to_string_pretty(&base).unwrap();
        prune_stale_accounts(&mut base, &valid_ids);
        let after = serde_json::to_string_pretty(&base).unwrap();

        assert!(
            after.contains("inst_001") && after.contains("qq-inst_003"),
            "应保留 inst_001 和 qq-inst_003\nprune 前: {}\nprune 后: {}",
            before,
            after
        );
        assert!(
            !after.contains("stale_inst_999"),
            "stale_inst_999 应被删除\nprune 前: {}\nprune 后: {}",
            before,
            after
        );
    }
}
