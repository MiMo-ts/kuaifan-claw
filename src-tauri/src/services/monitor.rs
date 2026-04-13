// 全模型多供应商实时监控服务

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::LazyLock;
use tokio::sync::RwLock;
use tokio::time::{Duration, Instant};

use crate::models::RealTimeMetrics;

/// 实时监控器
pub struct UsageMonitor {
    /// 实时指标缓存（按 provider/model 索引）
    metrics: Arc<RwLock<HashMap<String, RealTimeMetrics>>>,
    /// 请求历史（用于计算 RPM/TPM）
    request_timestamps: Arc<RwLock<Vec<Instant>>>,
    /// Token 历史（用于计算 TPM）
    token_history: Arc<RwLock<Vec<(Instant, u64)>>>,
}

impl Default for UsageMonitor {
    fn default() -> Self {
        Self::new()
    }
}

#[allow(dead_code)]
impl UsageMonitor {
    pub fn new() -> Self {
        Self {
            metrics: Arc::new(RwLock::new(HashMap::new())),
            request_timestamps: Arc::new(RwLock::new(Vec::new())),
            token_history: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// 记录一次请求
    pub async fn record_request(
        &self,
        provider: String,
        model: String,
        tokens: u64,
        cost: f64,
        response_time_ms: u64,
        success: bool,
    ) {
        let key = format!("{}/{}", provider, model);
        let now = chrono::Utc::now().to_rfc3339();
        let instant = Instant::now();

        // 更新指标
        let mut metrics = self.metrics.write().await;
        let entry = metrics
            .entry(key.clone())
            .or_insert_with(|| RealTimeMetrics {
                timestamp: now.clone(),
                provider: provider.clone(),
                model: model.clone(),
                requests_total: 0,
                requests_success: 0,
                requests_error: 0,
                tokens_total: 0,
                cost_total: 0.0,
                avg_response_time_ms: 0.0,
                rpm: 0.0,
                tpm: 0,
            });

        entry.timestamp = now;
        entry.requests_total += 1;
        entry.tokens_total += tokens;
        entry.cost_total += cost;

        if success {
            entry.requests_success += 1;
        } else {
            entry.requests_error += 1;
        }

        // 更新平均响应时间（指数移动平均）
        if entry.requests_total == 1 {
            entry.avg_response_time_ms = response_time_ms as f64;
        } else {
            entry.avg_response_time_ms =
                entry.avg_response_time_ms * 0.9 + (response_time_ms as f64) * 0.1;
        }

        // 更新历史记录
        drop(metrics);

        let mut timestamps = self.request_timestamps.write().await;
        timestamps.push(instant);
        drop(timestamps);

        let mut tokens_hist = self.token_history.write().await;
        tokens_hist.push((instant, tokens));
    }

    /// 获取所有实时指标
    pub async fn get_all_metrics(&self) -> Vec<RealTimeMetrics> {
        let metrics = self.metrics.read().await;
        metrics.values().cloned().collect()
    }

    /// 获取特定模型的指标
    pub async fn get_metrics(&self, provider: &str, model: &str) -> Option<RealTimeMetrics> {
        let key = format!("{}/{}", provider, model);
        let metrics = self.metrics.read().await;
        metrics.get(&key).cloned()
    }

    /// 计算当前 RPM（每分钟请求数）
    pub async fn calculate_rpm(&self, provider: &str, model: &str) -> f64 {
        let _key = format!("{}/{}", provider, model);
        let timestamps = self.request_timestamps.read().await;
        let one_minute_ago = Instant::now() - Duration::from_secs(60);

        let recent_count = timestamps.iter().filter(|&&t| t >= one_minute_ago).count();

        recent_count as f64
    }

    /// 计算当前 TPM（每分钟 Token 数）
    pub async fn calculate_tpm(&self, provider: &str, model: &str) -> u64 {
        let _key = format!("{}/{}", provider, model);
        let tokens_hist = self.token_history.read().await;
        let one_minute_ago = Instant::now() - Duration::from_secs(60);

        tokens_hist
            .iter()
            .filter(|&&(t, _)| t >= one_minute_ago)
            .map(|&(_, tokens)| tokens)
            .sum()
    }

    /// 清理过期数据（保留最近 5 分钟）
    pub async fn cleanup_expired(&self) {
        let five_minutes_ago = Instant::now() - Duration::from_secs(300);

        let mut timestamps = self.request_timestamps.write().await;
        timestamps.retain(|&t| t >= five_minutes_ago);
        drop(timestamps);

        let mut tokens_hist = self.token_history.write().await;
        tokens_hist.retain(|(t, _)| *t >= five_minutes_ago);
    }

    /// 重置所有指标
    pub async fn reset(&self) {
        let mut metrics = self.metrics.write().await;
        metrics.clear();
        drop(metrics);

        let mut timestamps = self.request_timestamps.write().await;
        timestamps.clear();
        drop(timestamps);

        let mut tokens_hist = self.token_history.write().await;
        tokens_hist.clear();
    }
}

/// 监控摘要
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoringSummary {
    pub total_requests: u64,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub total_errors: u64,
    pub active_providers: usize,
    pub active_models: usize,
    pub avg_response_time_ms: f64,
    pub overall_rpm: f64,
    pub overall_tpm: u64,
    pub top_provider: Option<String>,
    pub top_model: Option<String>,
}

impl UsageMonitor {
    /// 获取监控摘要
    pub async fn get_summary(&self) -> MonitoringSummary {
        let metrics = self.metrics.read().await;

        let mut total_requests = 0u64;
        let mut total_tokens = 0u64;
        let mut total_cost = 0.0;
        let mut total_errors = 0u64;
        let mut total_response_time = 0.0;
        let mut top_provider_tokens = 0u64;
        let mut top_model_tokens = 0u64;
        let mut top_provider = None;
        let mut top_model = None;

        for m in metrics.values() {
            total_requests += m.requests_total;
            total_tokens += m.tokens_total;
            total_cost += m.cost_total;
            total_errors += m.requests_error;
            total_response_time += m.avg_response_time_ms;

            if m.tokens_total > top_provider_tokens {
                top_provider_tokens = m.tokens_total;
                top_provider = Some(m.provider.clone());
            }
            if m.tokens_total > top_model_tokens {
                top_model_tokens = m.tokens_total;
                top_model = Some(format!("{}/{}", m.provider, m.model));
            }
        }

        let count = metrics.len() as f64;
        let avg_response_time = if count > 0.0 {
            total_response_time / count
        } else {
            0.0
        };

        MonitoringSummary {
            total_requests,
            total_tokens,
            total_cost,
            total_errors,
            active_providers: metrics
                .values()
                .map(|m| &m.provider)
                .collect::<std::collections::HashSet<_>>()
                .len(),
            active_models: metrics.len(),
            avg_response_time_ms: avg_response_time,
            overall_rpm: 0.0,
            overall_tpm: 0,
            top_provider,
            top_model,
        }
    }
}

/// 全局监控器实例
pub static USAGE_MONITOR: LazyLock<UsageMonitor> = LazyLock::new(|| UsageMonitor::new());
