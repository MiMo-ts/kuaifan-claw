// 供应商定价服务

use std::collections::HashMap;

use crate::models::ProviderPricing;

/// 供应商定价管理器
pub struct PricingManager {
    /// 定价表
    pricing: HashMap<String, ProviderPricing>,
}

impl Default for PricingManager {
    fn default() -> Self {
        Self::new()
    }
}

#[allow(dead_code)]
impl PricingManager {
    pub fn new() -> Self {
        let mut pricing = HashMap::new();

        // OpenAI 定价（GPT-4o 等）
        pricing.insert(
            "openai".to_string(),
            ProviderPricing {
                provider: "openai".to_string(),
                input_cost_per_mtok: 2.5,       // $2.50 / 1M tokens
                output_cost_per_mtok: 10.0,     // $10.00 / 1M tokens
                cache_read_cost_per_mtok: 1.25, // $1.25 / 1M tokens
                cache_write_cost_per_mtok: 10.0,
                currency: "USD".to_string(),
                free_tier_tokens: None,
            },
        );

        // Anthropic Claude
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

        // Google Gemini
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

        // DeepSeek
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

        // OpenRouter（聚合定价，默认免费模型）
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

        // Ollama（本地，免费）
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
        for (id, input, output) in [
            ("minimax", 0.5, 1.5),
            ("volc_ark", 0.5, 1.5),
            ("nvidia", 0.5, 1.5),
            ("aliyun", 0.5, 1.5),
            ("zhipu", 0.5, 1.5),
            ("moonshot", 0.5, 1.5),
            ("baidu", 0.5, 1.5),
            ("xiaomi", 0.5, 1.5),
        ] {
            pricing.insert(
                id.to_string(),
                ProviderPricing {
                    provider: id.to_string(),
                    input_cost_per_mtok: input,
                    output_cost_per_mtok: output,
                    cache_read_cost_per_mtok: 0.0,
                    cache_write_cost_per_mtok: 0.0,
                    currency: "USD".to_string(),
                    free_tier_tokens: None,
                },
            );
        }

        Self { pricing }
    }

    /// 获取定价
    pub fn get_pricing(&self, provider: &str) -> Option<&ProviderPricing> {
        self.pricing.get(provider)
    }

    /// 获取所有定价
    pub fn get_all_pricing(&self) -> Vec<&ProviderPricing> {
        self.pricing.values().collect()
    }

    /// 更新定价
    pub fn set_pricing(&mut self, provider: &str, pricing: ProviderPricing) {
        self.pricing.insert(provider.to_string(), pricing);
    }

    /// 计算费用
    pub fn calculate_cost(
        &self,
        provider: &str,
        prompt_tokens: u64,
        completion_tokens: u64,
        cache_read: u64,
        cache_write: u64,
    ) -> Option<f64> {
        self.pricing
            .get(provider)
            .map(|p| p.calculate_cost(prompt_tokens, completion_tokens, cache_read, cache_write))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_cost() {
        let manager = PricingManager::new();

        // OpenAI: 1000 input + 500 output tokens
        let cost = manager.calculate_cost("openai", 1000, 500, 0, 0);
        assert!(cost.is_some());
        let cost = cost.unwrap();
        assert!((cost - 0.0075).abs() < 0.001); // ~$0.0075

        // Ollama: 应该是免费的
        let cost = manager.calculate_cost("ollama", 1000, 500, 0, 0);
        assert_eq!(cost, Some(0.0));
    }
}
