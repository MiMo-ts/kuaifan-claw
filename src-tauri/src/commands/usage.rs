// Token 用量统计命令

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::models::{
    DetailedUsageRecord, ModelUsageStats, ProviderPricing, ProviderUsageStats, TokenUsageRecord,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsageSummary {
    pub total_prompt_tokens: u64,
    pub total_completion_tokens: u64,
    pub total_tokens: u64,
    pub record_count: u64,
    pub by_provider: HashMap<String, u64>,
    #[serde(default)]
    pub total_cost: f64,
    #[serde(default)]
    pub error_count: u64,
    #[serde(default)]
    pub avg_response_time_ms: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct UsageFilter {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub status: Option<String>,
}

fn usage_file_path(data_dir: &str) -> PathBuf {
    PathBuf::from(data_dir)
        .join("metrics")
        .join("token_usage.jsonl")
}

fn detailed_usage_file_path(data_dir: &str) -> PathBuf {
    PathBuf::from(data_dir)
        .join("metrics")
        .join("detailed_usage.jsonl")
}

/// 将一条用量合并进按「供应商/模型」分组的统计表
fn merge_into_model_map(
    all_stats: &mut HashMap<String, ModelUsageStats>,
    provider: &str,
    model: &str,
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
    is_error: bool,
) {
    let key = format!("{}/{}", provider, model);
    let stats = all_stats.entry(key).or_insert_with(|| ModelUsageStats {
        provider: provider.to_string(),
        model: model.to_string(),
        request_count: 0,
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_tokens: 0,
        total_cost: 0.0,
        avg_response_time_ms: None,
        error_count: 0,
        success_rate: 100.0,
    });
    stats.request_count += 1;
    stats.total_prompt_tokens += prompt_tokens as u64;
    stats.total_completion_tokens += completion_tokens as u64;
    stats.total_tokens += total_tokens as u64;
    if is_error {
        stats.error_count += 1;
    }
}

/// 从 `token_usage.jsonl` + `detailed_usage.jsonl` 合并统计（管理端测试写入前者，详细监控写入后者）
pub async fn load_merged_model_usage_stats(
    data_dir: &str,
    provider_filter: Option<String>,
) -> Result<Vec<ModelUsageStats>, String> {
    let mut all_stats: HashMap<String, ModelUsageStats> = HashMap::new();
    let mut rt_acc: HashMap<String, (u64, u64)> = HashMap::new();

    let detailed_path = detailed_usage_file_path(data_dir);
    if detailed_path.exists() {
        let file = File::open(&detailed_path)
            .await
            .map_err(|e| format!("打开 detailed_usage 失败: {}", e))?;
        let reader = BufReader::new(file);
        let mut lines = reader.lines();
        while let Some(line) = lines
            .next_line()
            .await
            .map_err(|e| format!("读取失败: {}", e))?
        {
            if let Ok(record) = serde_json::from_str::<DetailedUsageRecord>(&line) {
                if let Some(ref p) = provider_filter {
                    if &record.provider != p {
                        continue;
                    }
                }
                let is_err = record.status != "success";
                merge_into_model_map(
                    &mut all_stats,
                    &record.provider,
                    &record.model,
                    record.prompt_tokens,
                    record.completion_tokens,
                    record.total_tokens,
                    is_err,
                );
                if let Some(ms) = record.response_time_ms {
                    let key = format!("{}/{}", record.provider, record.model);
                    let e = rt_acc.entry(key).or_insert((0, 0));
                    e.0 += ms;
                    e.1 += 1;
                }
            }
        }
    }

    let token_path = usage_file_path(data_dir);
    if token_path.exists() {
        let file = File::open(&token_path)
            .await
            .map_err(|e| format!("打开 token_usage 失败: {}", e))?;
        let reader = BufReader::new(file);
        let mut lines = reader.lines();
        while let Some(line) = lines
            .next_line()
            .await
            .map_err(|e| format!("读取失败: {}", e))?
        {
            if let Ok(record) = serde_json::from_str::<TokenUsageRecord>(&line) {
                if let Some(ref p) = provider_filter {
                    if &record.provider != p {
                        continue;
                    }
                }
                merge_into_model_map(
                    &mut all_stats,
                    &record.provider,
                    &record.model,
                    record.prompt_tokens,
                    record.completion_tokens,
                    record.total_tokens,
                    false,
                );
            }
        }
    }

    let pricing = get_default_pricing();
    let mut result: Vec<ModelUsageStats> = all_stats
        .into_iter()
        .map(|(key, mut s)| {
            s.success_rate = if s.request_count > 0 {
                ((s.request_count - s.error_count) as f64 / s.request_count as f64) * 100.0
            } else {
                100.0
            };
            if let Some((sum, n)) = rt_acc.get(&key) {
                if *n > 0 {
                    s.avg_response_time_ms = Some(*sum as f64 / *n as f64);
                }
            }
            s.total_cost = pricing
                .get(&s.provider)
                .map(|p| p.calculate_cost(s.total_prompt_tokens, s.total_completion_tokens, 0, 0))
                .unwrap_or(0.0);
            s
        })
        .collect();

    result.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));
    Ok(result)
}

/// 从合并后的模型统计汇总到供应商维度
pub async fn load_merged_provider_usage_stats(
    data_dir: &str,
) -> Result<Vec<ProviderUsageStats>, String> {
    let models = load_merged_model_usage_stats(data_dir, None).await?;
    let mut pstat: HashMap<String, ProviderUsageStats> = HashMap::new();
    let mut per_prov_model_tokens: HashMap<String, HashMap<String, u64>> = HashMap::new();

    for m in models {
        let prov = m.provider.clone();
        let entry = pstat
            .entry(prov.clone())
            .or_insert_with(|| ProviderUsageStats {
                provider: prov.clone(),
                request_count: 0,
                total_tokens: 0,
                total_cost: 0.0,
                model_count: 0,
                top_model: None,
            });
        entry.request_count += m.request_count;
        entry.total_tokens += m.total_tokens;
        entry.total_cost += m.total_cost;
        per_prov_model_tokens
            .entry(prov)
            .or_default()
            .insert(m.model.clone(), m.total_tokens);
    }

    for (prov, stats) in pstat.iter_mut() {
        if let Some(mm) = per_prov_model_tokens.get(prov) {
            stats.model_count = mm.len();
            stats.top_model = mm
                .iter()
                .max_by_key(|(_, t)| *t)
                .map(|(name, _)| name.clone());
        }
    }

    let mut result: Vec<ProviderUsageStats> = pstat.into_values().collect();
    result.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));
    Ok(result)
}

/// 根据合并后的模型统计生成监控页顶部的摘要数字
pub async fn compute_monitoring_summary_from_logs(
    data_dir: &str,
) -> Result<crate::services::monitor::MonitoringSummary, String> {
    let models = load_merged_model_usage_stats(data_dir, None).await?;
    let mut total_requests = 0u64;
    let mut total_tokens = 0u64;
    let mut total_cost = 0.0;
    let mut total_errors = 0u64;
    let mut total_rt = 0.0f64;
    let mut rt_entries = 0u64;
    let mut providers = HashSet::new();
    let mut top_model_tokens = 0u64;
    let mut top_provider: Option<String> = None;
    let mut top_model: Option<String> = None;

    for m in &models {
        total_requests += m.request_count;
        total_tokens += m.total_tokens;
        total_cost += m.total_cost;
        total_errors += m.error_count;
        providers.insert(m.provider.clone());
        if let Some(avg) = m.avg_response_time_ms {
            total_rt += avg * m.request_count as f64;
            rt_entries += m.request_count;
        }
        if m.total_tokens > top_model_tokens {
            top_model_tokens = m.total_tokens;
            top_provider = Some(m.provider.clone());
            top_model = Some(format!("{}/{}", m.provider, m.model));
        }
    }

    let avg_response = if rt_entries > 0 {
        total_rt / rt_entries as f64
    } else {
        0.0
    };

    Ok(crate::services::monitor::MonitoringSummary {
        total_requests,
        total_tokens,
        total_cost,
        total_errors,
        active_providers: providers.len(),
        active_models: models.len(),
        avg_response_time_ms: avg_response,
        overall_rpm: 0.0,
        overall_tpm: 0,
        top_provider,
        top_model,
    })
}

/// 获取供应商默认定价信息
pub fn get_default_pricing() -> HashMap<String, ProviderPricing> {
    let mut pricing = HashMap::new();

    pricing.insert(
        "openai".to_string(),
        ProviderPricing {
            provider: "openai".to_string(),
            input_cost_per_mtok: 2.5,
            output_cost_per_mtok: 10.0,
            cache_read_cost_per_mtok: 1.25,
            cache_write_cost_per_mtok: 10.0,
            currency: "USD".to_string(),
            free_tier_tokens: None,
        },
    );

    pricing.insert(
        "anthropic".to_string(),
        ProviderPricing {
            provider: "anthropic".to_string(),
            input_cost_per_mtok: 3.0,
            output_cost_per_mtok: 15.0,
            cache_read_cost_per_mtok: 0.3,
            cache_write_cost_per_mtok: 3.75,
            currency: "USD".to_string(),
            free_tier_tokens: None,
        },
    );

    pricing.insert(
        "google".to_string(),
        ProviderPricing {
            provider: "google".to_string(),
            input_cost_per_mtok: 0.125,
            output_cost_per_mtok: 0.5,
            cache_read_cost_per_mtok: 0.0,
            cache_write_cost_per_mtok: 0.0,
            currency: "USD".to_string(),
            free_tier_tokens: Some(1_000_000),
        },
    );

    pricing.insert(
        "deepseek".to_string(),
        ProviderPricing {
            provider: "deepseek".to_string(),
            input_cost_per_mtok: 0.27,
            output_cost_per_mtok: 1.1,
            cache_read_cost_per_mtok: 0.1,
            cache_write_cost_per_mtok: 1.1,
            currency: "USD".to_string(),
            free_tier_tokens: None,
        },
    );

    pricing.insert(
        "openrouter".to_string(),
        ProviderPricing {
            provider: "openrouter".to_string(),
            input_cost_per_mtok: 0.0,
            output_cost_per_mtok: 0.0,
            cache_read_cost_per_mtok: 0.0,
            cache_write_cost_per_mtok: 0.0,
            currency: "USD".to_string(),
            free_tier_tokens: None,
        },
    );

    pricing.insert(
        "ollama".to_string(),
        ProviderPricing {
            provider: "ollama".to_string(),
            input_cost_per_mtok: 0.0,
            output_cost_per_mtok: 0.0,
            cache_read_cost_per_mtok: 0.0,
            cache_write_cost_per_mtok: 0.0,
            currency: "USD".to_string(),
            free_tier_tokens: None,
        },
    );

    // 其他供应商默认值
    for (id, _name) in [
        ("minimax", "MiniMax"),
        ("volc_ark", "火山方舟"),
        ("nvidia", "NVIDIA NIM"),
        ("aliyun", "阿里通义千问"),
        ("zhipu", "智谱 GLM"),
        ("moonshot", "Kimi"),
        ("baidu", "百度文心"),
        ("xiaomi", "小米 MiMo"),
    ] {
        if !pricing.contains_key(id) {
            pricing.insert(
                id.to_string(),
                ProviderPricing {
                    provider: id.to_string(),
                    input_cost_per_mtok: 0.5,
                    output_cost_per_mtok: 1.5,
                    cache_read_cost_per_mtok: 0.0,
                    cache_write_cost_per_mtok: 0.0,
                    currency: "USD".to_string(),
                    free_tier_tokens: None,
                },
            );
        }
    }

    pricing
}

#[tauri::command]
pub async fn record_token_usage(
    data_dir: tauri::State<'_, crate::AppState>,
    provider: String,
    model: String,
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
    source: String,
) -> Result<String, String> {
    // Token 范围校验：单个字段最大值 u32::MAX，过大会导致统计溢出
    const MAX_VALID_TOKEN: u32 = 100_000_000; // 1亿，足以覆盖任何实际用量
    if prompt_tokens > MAX_VALID_TOKEN {
        return Err(format!("prompt_tokens {} 超出有效范围（上限 {}）", prompt_tokens, MAX_VALID_TOKEN));
    }
    if completion_tokens > MAX_VALID_TOKEN {
        return Err(format!("completion_tokens {} 超出有效范围（上限 {}）", completion_tokens, MAX_VALID_TOKEN));
    }
    if total_tokens > MAX_VALID_TOKEN {
        return Err(format!("total_tokens {} 超出有效范围（上限 {}）", total_tokens, MAX_VALID_TOKEN));
    }

    // 一致性校验：允许前端传入计算好的 total_tokens 与实际计算值有少量误差（浮点/取整），但偏差过大说明数据有问题
    let computed_total = prompt_tokens.saturating_add(completion_tokens);
    if total_tokens > 0 {
        let diff = if total_tokens >= computed_total {
            total_tokens - computed_total
        } else {
            computed_total - total_tokens
        };
        // 允许 ±5% 的计算误差，超出则警告但不拒绝（避免因取整导致合法请求被拒）
        if computed_total > 0 {
            let threshold = (computed_total / 20).max(10); // 至少10的误差容忍
            if diff > threshold {
                tracing::warn!(
                    "token 一致性警告：prompt={} completion={} total={}（差异 {} 超过阈值 {}）",
                    prompt_tokens, completion_tokens, total_tokens, diff, threshold
                );
            }
        }
    }

    let dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let file_path = usage_file_path(&dir);

    tokio::fs::create_dir_all(file_path.parent().unwrap())
        .await
        .map_err(|e| format!("创建目录失败: {}", e))?;

    let record = TokenUsageRecord {
        ts: chrono::Utc::now().to_rfc3339(),
        provider,
        model,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        source,
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

    Ok("记录已保存".to_string())
}

#[tauri::command]
pub async fn record_detailed_usage(
    data_dir: tauri::State<'_, crate::AppState>,
    provider: String,
    model: String,
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
    source: String,
    response_time_ms: Option<u64>,
    status: Option<String>,
    error_message: Option<String>,
) -> Result<String, String> {
    let dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let file_path = detailed_usage_file_path(&dir);

    tokio::fs::create_dir_all(file_path.parent().unwrap())
        .await
        .map_err(|e| format!("创建目录失败: {}", e))?;

    let record = DetailedUsageRecord {
        ts: chrono::Utc::now().to_rfc3339(),
        provider,
        model,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        source,
        response_time_ms,
        status: status.unwrap_or_else(|| "success".to_string()),
        error_message,
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

    Ok("详细记录已保存".to_string())
}

#[tauri::command]
pub async fn get_token_usage_summary(
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<TokenUsageSummary, String> {
    let dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let file_path = usage_file_path(&dir);

    if !file_path.exists() {
        return Ok(TokenUsageSummary {
            total_prompt_tokens: 0,
            total_completion_tokens: 0,
            total_tokens: 0,
            record_count: 0,
            by_provider: HashMap::new(),
            total_cost: 0.0,
            error_count: 0,
            avg_response_time_ms: None,
        });
    }

    let file = File::open(&file_path)
        .await
        .map_err(|e| format!("打开文件失败: {}", e))?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();

    let mut total_prompt = 0u64;
    let mut total_completion = 0u64;
    let mut total_tokens_sum = 0u64;
    let mut count = 0u64;
    let mut by_provider: HashMap<String, u64> = HashMap::new();

    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| format!("读取失败: {}", e))?
    {
        if let Ok(record) = serde_json::from_str::<TokenUsageRecord>(&line) {
            total_prompt += record.prompt_tokens as u64;
            total_completion += record.completion_tokens as u64;
            total_tokens_sum += record.total_tokens as u64;
            count += 1;
            *by_provider.entry(record.provider).or_insert(0) += record.total_tokens as u64;
        }
    }

    Ok(TokenUsageSummary {
        total_prompt_tokens: total_prompt,
        total_completion_tokens: total_completion,
        total_tokens: total_tokens_sum,
        record_count: count,
        by_provider,
        total_cost: 0.0,
        error_count: 0,
        avg_response_time_ms: None,
    })
}

#[tauri::command]
pub async fn get_token_usage_events(
    data_dir: tauri::State<'_, crate::AppState>,
    limit: Option<u32>,
) -> Result<Vec<TokenUsageRecord>, String> {
    let dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let file_path = usage_file_path(&dir);

    if !file_path.exists() {
        return Ok(vec![]);
    }

    let file = File::open(&file_path)
        .await
        .map_err(|e| format!("打开文件失败: {}", e))?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();

    let mut records = Vec::new();
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| format!("读取失败: {}", e))?
    {
        if let Ok(record) = serde_json::from_str::<TokenUsageRecord>(&line) {
            records.push(record);
        }
    }

    let limit = limit.unwrap_or(100) as usize;
    let len = records.len();
    if len > limit {
        records = records.split_off(len.saturating_sub(limit));
    }
    records.reverse();
    Ok(records)
}

#[tauri::command]
pub async fn get_usage_by_model(
    data_dir: tauri::State<'_, crate::AppState>,
    provider: Option<String>,
    _model: Option<String>,
    _start_date: Option<String>,
    _end_date: Option<String>,
) -> Result<Vec<ModelUsageStats>, String> {
    let dir = data_dir.inner().data_dir.lock().unwrap().clone();
    load_merged_model_usage_stats(&dir, provider).await
}

#[tauri::command]
pub async fn get_usage_by_provider(
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<Vec<ProviderUsageStats>, String> {
    let dir = data_dir.inner().data_dir.lock().unwrap().clone();
    load_merged_provider_usage_stats(&dir).await
}

#[tauri::command]
pub fn get_provider_pricing() -> Vec<ProviderPricing> {
    get_default_pricing().into_values().collect()
}

#[tauri::command]
pub fn calculate_usage_cost(
    provider: String,
    prompt_tokens: u64,
    completion_tokens: u64,
    cache_read: Option<u64>,
    cache_write: Option<u64>,
) -> Result<f64, String> {
    let pricing_map = get_default_pricing();
    let pricing = pricing_map
        .get(&provider)
        .ok_or_else(|| format!("未找到供应商 {} 的定价信息", provider))?;

    Ok(pricing.calculate_cost(
        prompt_tokens,
        completion_tokens,
        cache_read.unwrap_or(0),
        cache_write.unwrap_or(0),
    ))
}
