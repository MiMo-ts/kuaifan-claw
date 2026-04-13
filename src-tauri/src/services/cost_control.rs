// 成本控制服务

use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::RwLock;

use crate::models::{AlertType, CostAlert, CostBudget};

/// 成本控制服务
pub struct CostControlService {
    /// 预算配置
    budgets: Arc<RwLock<Vec<CostBudget>>>,
    /// 告警记录
    alerts: Arc<RwLock<Vec<CostAlert>>>,
}

impl Default for CostControlService {
    fn default() -> Self {
        Self::new()
    }
}

#[allow(dead_code)]
impl CostControlService {
    pub fn new() -> Self {
        Self {
            budgets: Arc::new(RwLock::new(Vec::new())),
            alerts: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// 从文件加载预算配置
    pub async fn load_budgets(&self, data_dir: &str) -> Result<(), String> {
        let file_path = Self::budgets_file_path(data_dir);
        if !file_path.exists() {
            return Ok(());
        }

        let file = File::open(&file_path)
            .await
            .map_err(|e| format!("打开文件失败: {}", e))?;
        let reader = BufReader::new(file);
        let mut lines = reader.lines();

        let mut budgets = Vec::new();
        while let Some(line) = lines
            .next_line()
            .await
            .map_err(|e| format!("读取失败: {}", e))?
        {
            if let Ok(budget) = serde_json::from_str::<CostBudget>(&line) {
                budgets.push(budget);
            }
        }

        let mut stored = self.budgets.write().await;
        *stored = budgets;
        Ok(())
    }

    /// 保存预算配置到文件
    pub async fn save_budgets(&self, data_dir: &str) -> Result<(), String> {
        let file_path = Self::budgets_file_path(data_dir);
        tokio::fs::create_dir_all(file_path.parent().unwrap())
            .await
            .map_err(|e| format!("创建目录失败: {}", e))?;

        let budgets = self.budgets.read().await;
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&file_path)
            .await
            .map_err(|e| format!("打开文件失败: {}", e))?;

        for budget in budgets.iter() {
            let line = serde_json::to_string(budget).map_err(|e| format!("序列化失败: {}", e))?;
            file.write_all(format!("{}\n", line).as_bytes())
                .await
                .map_err(|e| format!("写入失败: {}", e))?;
        }

        Ok(())
    }

    /// 添加或更新预算
    pub async fn set_budget(&self, budget: CostBudget, data_dir: &str) -> Result<(), String> {
        let mut budgets = self.budgets.write().await;
        if let Some(existing) = budgets.iter_mut().find(|b| b.id == budget.id) {
            *existing = budget;
        } else {
            budgets.push(budget);
        }
        drop(budgets);
        self.save_budgets(data_dir).await
    }

    /// 删除预算
    pub async fn delete_budget(&self, budget_id: &str, data_dir: &str) -> Result<(), String> {
        let mut budgets = self.budgets.write().await;
        budgets.retain(|b| b.id != budget_id);
        drop(budgets);
        self.save_budgets(data_dir).await
    }

    /// 获取所有预算
    pub async fn get_budgets(&self) -> Vec<CostBudget> {
        self.budgets.read().await.clone()
    }

    /// 检查是否超过预算
    pub async fn check_budget(&self, provider: &str, model: &str, cost: f64) -> Option<CostAlert> {
        let budgets = self.budgets.read().await;

        for budget in budgets.iter() {
            if !budget.enabled {
                continue;
            }

            // 检查是否匹配
            if let Some(ref p) = budget.provider {
                if p != provider {
                    continue;
                }
            }
            if let Some(ref m) = budget.model {
                if m != model {
                    continue;
                }
            }

            let new_spend = budget.current_spend + cost;
            let ratio = new_spend / budget.limit_amount;

            if ratio >= 1.0 {
                return Some(CostAlert {
                    id: uuid::Uuid::new_v4().to_string(),
                    budget_id: budget.id.clone(),
                    alert_type: AlertType::Threshold100,
                    threshold: budget.limit_amount,
                    current_spend: new_spend,
                    message: format!(
                        "预算 {} 已超限！当前花费 {:.4} / {:.4}",
                        budget.name, new_spend, budget.limit_amount
                    ),
                    triggered_at: chrono::Utc::now().to_rfc3339(),
                    acknowledged: false,
                });
            } else if ratio >= budget.alert_threshold {
                let alert_type = if ratio >= 0.9 {
                    AlertType::Threshold90
                } else if ratio >= 0.75 {
                    AlertType::Threshold75
                } else {
                    AlertType::Threshold50
                };

                return Some(CostAlert {
                    id: uuid::Uuid::new_v4().to_string(),
                    budget_id: budget.id.clone(),
                    alert_type,
                    threshold: budget.limit_amount * budget.alert_threshold,
                    current_spend: new_spend,
                    message: format!(
                        "预算 {} 消费达到 {:.0}%！当前花费 {:.4} / {:.4}",
                        budget.name,
                        ratio * 100.0,
                        new_spend,
                        budget.limit_amount
                    ),
                    triggered_at: chrono::Utc::now().to_rfc3339(),
                    acknowledged: false,
                });
            }
        }

        None
    }

    pub async fn update_spend(&self, budget_id: &str, cost: f64) {
        let mut budgets = self.budgets.write().await;
        if let Some(budget) = budgets.iter_mut().find(|b| b.id == budget_id) {
            budget.current_spend += cost;
        }
    }

    /// 重置预算（按周期）
    pub async fn reset_budget(&self, budget_id: &str) {
        let mut budgets = self.budgets.write().await;
        if let Some(budget) = budgets.iter_mut().find(|b| b.id == budget_id) {
            budget.current_spend = 0.0;
            budget.last_reset = Some(chrono::Utc::now().to_rfc3339());
        }
    }

    /// 获取未确认的告警
    pub async fn get_unacknowledged_alerts(&self) -> Vec<CostAlert> {
        self.alerts
            .read()
            .await
            .iter()
            .filter(|a| !a.acknowledged)
            .cloned()
            .collect()
    }

    /// 确认告警
    pub async fn acknowledge_alert(&self, alert_id: &str) {
        let mut alerts = self.alerts.write().await;
        if let Some(alert) = alerts.iter_mut().find(|a| a.id == alert_id) {
            alert.acknowledged = true;
        }
    }

    /// 添加告警
    pub async fn add_alert(&self, alert: CostAlert) {
        let mut alerts = self.alerts.write().await;
        alerts.push(alert);
    }

    fn budgets_file_path(data_dir: &str) -> PathBuf {
        PathBuf::from(data_dir)
            .join("metrics")
            .join("cost_budgets.jsonl")
    }
}
