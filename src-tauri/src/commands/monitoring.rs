// 全模型多供应商监控命令

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use crate::models::{BudgetType, CostAlert, CostBudget, RealTimeMetrics};
use crate::services::cost_control::CostControlService;
use crate::services::monitor::MonitoringSummary;

use std::sync::LazyLock;

static COST_CONTROL_SERVICE: LazyLock<CostControlService> =
    LazyLock::new(|| CostControlService::new());

/// 合并内存中的热数据与磁盘上的 `token_usage.jsonl` / `detailed_usage.jsonl` 摘要
#[tauri::command]
pub async fn get_monitoring_summary(
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<MonitoringSummary, String> {
    let dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let disk = crate::commands::usage::compute_monitoring_summary_from_logs(&dir).await?;
    let mem = crate::services::monitor::USAGE_MONITOR.get_summary().await;

    // 若进程内无热数据，直接返回磁盘聚合（覆盖管理端测试连接等）
    if mem.total_requests == 0 && mem.total_tokens == 0 {
        return Ok(disk);
    }

    let models = crate::commands::usage::load_merged_model_usage_stats(&dir, None).await?;
    let mem_metrics = crate::services::monitor::USAGE_MONITOR
        .get_all_metrics()
        .await;
    let mut provs: HashSet<String> = models.iter().map(|m| m.provider.clone()).collect();
    let mut keys: HashSet<String> = models
        .iter()
        .map(|m| format!("{}/{}", m.provider, m.model))
        .collect();
    for m in &mem_metrics {
        provs.insert(m.provider.clone());
        keys.insert(format!("{}/{}", m.provider, m.model));
    }

    let top_model = {
        let mut best: Option<(u64, String)> = None;
        for s in &models {
            let t = s.total_tokens;
            let label = format!("{}/{}", s.provider, s.model);
            if best.as_ref().map(|(x, _)| *x).unwrap_or(0) < t {
                best = Some((t, label));
            }
        }
        for m in &mem_metrics {
            let t = m.tokens_total;
            let label = format!("{}/{}", m.provider, m.model);
            if best.as_ref().map(|(x, _)| *x).unwrap_or(0) < t {
                best = Some((t, label));
            }
        }
        best.map(|(_, l)| l)
    };

    let top_provider = {
        let mut best: Option<(u64, String)> = None;
        let mut by_p: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
        for s in &models {
            *by_p.entry(s.provider.clone()).or_insert(0) += s.total_tokens;
        }
        for m in &mem_metrics {
            *by_p.entry(m.provider.clone()).or_insert(0) += m.tokens_total;
        }
        for (p, t) in by_p {
            if best.as_ref().map(|(x, _)| *x).unwrap_or(0) < t {
                best = Some((t, p));
            }
        }
        best.map(|(_, p)| p)
    };

    let avg_rt = {
        let n = disk.total_requests + mem.total_requests;
        if n == 0 {
            0.0
        } else {
            (disk.avg_response_time_ms * disk.total_requests as f64
                + mem.avg_response_time_ms * mem.total_requests as f64)
                / n as f64
        }
    };

    Ok(MonitoringSummary {
        total_requests: disk.total_requests + mem.total_requests,
        total_tokens: disk.total_tokens + mem.total_tokens,
        total_cost: disk.total_cost + mem.total_cost,
        total_errors: disk.total_errors + mem.total_errors,
        active_providers: provs.len(),
        active_models: keys.len(),
        avg_response_time_ms: avg_rt,
        overall_rpm: mem.overall_rpm,
        overall_tpm: mem.overall_tpm,
        top_provider,
        top_model,
    })
}

/// 磁盘日志聚合的「实时」指标行 + 进程内热数据（按 provider/model 合并）
#[tauri::command]
pub async fn get_realtime_metrics(
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<Vec<RealTimeMetrics>, String> {
    let dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let file_stats = crate::commands::usage::load_merged_model_usage_stats(&dir, None).await?;
    let mut map: std::collections::HashMap<String, RealTimeMetrics> =
        std::collections::HashMap::new();

    let now = chrono::Utc::now().to_rfc3339();
    for s in file_stats {
        let key = format!("{}/{}", s.provider, s.model);
        map.insert(
            key,
            RealTimeMetrics {
                timestamp: now.clone(),
                provider: s.provider.clone(),
                model: s.model.clone(),
                requests_total: s.request_count,
                requests_success: s.request_count.saturating_sub(s.error_count),
                requests_error: s.error_count,
                tokens_total: s.total_tokens,
                cost_total: s.total_cost,
                avg_response_time_ms: s.avg_response_time_ms.unwrap_or(0.0),
                rpm: 0.0,
                tpm: 0,
            },
        );
    }

    let mem_metrics = crate::services::monitor::USAGE_MONITOR
        .get_all_metrics()
        .await;
    for m in mem_metrics {
        let key = format!("{}/{}", m.provider, m.model);
        map.entry(key)
            .and_modify(|e| {
                e.requests_total += m.requests_total;
                e.requests_success += m.requests_success;
                e.requests_error += m.requests_error;
                e.tokens_total += m.tokens_total;
                e.cost_total += m.cost_total;
                e.timestamp = m.timestamp.clone();
                if m.requests_total > 0 {
                    e.avg_response_time_ms = m.avg_response_time_ms;
                }
            })
            .or_insert(m);
    }

    let mut v: Vec<RealTimeMetrics> = map.into_values().collect();
    v.sort_by(|a, b| b.tokens_total.cmp(&a.tokens_total));
    Ok(v)
}

/// 获取特定模型的指标
#[tauri::command]
pub fn get_model_metrics(provider: String, model: String) -> Option<RealTimeMetrics> {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        crate::services::monitor::USAGE_MONITOR
            .get_metrics(&provider, &model)
            .await
    })
}

/// 记录一次请求到监控
#[tauri::command]
pub fn record_request_metrics(
    provider: String,
    model: String,
    tokens: u64,
    cost: f64,
    response_time_ms: u64,
    success: bool,
) {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        crate::services::monitor::USAGE_MONITOR
            .record_request(provider, model, tokens, cost, response_time_ms, success)
            .await;
    });
}

/// 重置监控数据
#[tauri::command]
pub fn reset_monitoring() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        crate::services::monitor::USAGE_MONITOR.reset().await;
    });
}

// ─── 成本控制命令 ───────────────────────────────────────────────

/// 获取所有预算
#[tauri::command]
pub fn get_cost_budgets() -> Vec<CostBudget> {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async { COST_CONTROL_SERVICE.get_budgets().await })
}

/// 创建或更新预算
#[tauri::command]
pub async fn save_cost_budget(
    data_dir: tauri::State<'_, crate::AppState>,
    budget: CostBudget,
) -> Result<(), String> {
    let dir = data_dir.inner().data_dir.lock().unwrap().clone();
    COST_CONTROL_SERVICE.set_budget(budget, &dir).await
}

/// 删除预算
#[tauri::command]
pub async fn delete_cost_budget(
    data_dir: tauri::State<'_, crate::AppState>,
    budget_id: String,
) -> Result<(), String> {
    let dir = data_dir.inner().data_dir.lock().unwrap().clone();
    COST_CONTROL_SERVICE.delete_budget(&budget_id, &dir).await
}

/// 检查预算（请求前调用）
#[tauri::command]
pub fn check_cost_budget(provider: String, model: String, cost: f64) -> Option<CostAlert> {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        COST_CONTROL_SERVICE
            .check_budget(&provider, &model, cost)
            .await
    })
}

/// 获取未确认的告警
#[tauri::command]
pub fn get_unacknowledged_alerts() -> Vec<CostAlert> {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async { COST_CONTROL_SERVICE.get_unacknowledged_alerts().await })
}

/// 确认告警
#[tauri::command]
pub fn acknowledge_alert(alert_id: String) {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        COST_CONTROL_SERVICE.acknowledge_alert(&alert_id).await;
    });
}

/// 重置预算
#[tauri::command]
pub fn reset_budget(budget_id: String) {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        COST_CONTROL_SERVICE.reset_budget(&budget_id).await;
    });
}

/// 加载预算配置
#[tauri::command]
pub async fn load_budgets(data_dir: tauri::State<'_, crate::AppState>) -> Result<(), String> {
    let dir = data_dir.inner().data_dir.lock().unwrap().clone();
    COST_CONTROL_SERVICE.load_budgets(&dir).await
}

// ─── 预算创建辅助 ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetCreateRequest {
    pub name: String,
    pub budget_type: String,
    pub limit_amount: f64,
    pub alert_threshold: f64,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub reset_period: Option<String>,
}

#[tauri::command]
pub async fn create_cost_budget(
    data_dir: tauri::State<'_, crate::AppState>,
    request: BudgetCreateRequest,
) -> Result<CostBudget, String> {
    let budget_type = match request.budget_type.as_str() {
        "daily" => BudgetType::Daily,
        "weekly" => BudgetType::Weekly,
        "monthly" => BudgetType::Monthly,
        _ => BudgetType::Total,
    };

    let budget = CostBudget {
        id: uuid::Uuid::new_v4().to_string(),
        name: request.name,
        budget_type,
        limit_amount: request.limit_amount,
        alert_threshold: request.alert_threshold,
        provider: request.provider,
        model: request.model,
        enabled: true,
        current_spend: 0.0,
        reset_period: request.reset_period,
        last_reset: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    let dir = data_dir.inner().data_dir.lock().unwrap().clone();
    COST_CONTROL_SERVICE
        .set_budget(budget.clone(), &dir)
        .await?;

    Ok(budget)
}
