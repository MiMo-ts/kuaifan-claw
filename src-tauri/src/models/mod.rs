// 鏁版嵁缁撴瀯妯″潡
use serde::{Deserialize, Serialize};

// 鐜妫€娴嬬姸鎬?
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum EnvStatus {
    Success,
    Warning,
    Error,
    Checking,
}

// 鐜妫€娴嬮」
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvItem {
    pub name: String,
    pub version: Option<String>,
    pub status: EnvStatus,
    pub message: String,
    pub required: bool,
}

// 鐜妫€娴嬬粨鏋?
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvCheckResult {
    pub success: bool,
    pub items: Vec<EnvItem>,
    pub recommendations: Vec<String>,
}

// 涓€閿慨澶嶇幆澧冿紙瀹夎鑴氭湰鎵ц璁板綍锛?
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvAutoFixResult {
    pub ok: bool,
    pub messages: Vec<String>,
}

// 瀹夎杩涘害
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallProgress {
    pub step: String,
    pub progress: f32,
    pub message: String,
    pub status: String,
}

/// 鍚戝銆屽畨瑁?OpenClaw銆嶆楠わ細鐢ㄤ簬妫€娴嬫槸鍚﹀彲璺宠繃鏁存瀹夎銆?
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawCnStatus {
    /// 瀛樺湪 `dist/entry.js`锛堢綉鍏?CLI 鍏ュ彛锛?
    pub core_ready: bool,
    /// `node_modules` 宸插惈鏍稿績渚濊禆锛堝彲鍚姩缃戝叧锛?
    pub deps_ready: bool,
    /// 鏍稿績 + 渚濊禆鍧囧氨缁紝鍚戝鍙洿鎺ャ€屼笅涓€姝ャ€?
    pub fully_ready: bool,
    pub version: Option<String>,
    pub openclaw_dir: String,
}

// 鎻掍欢淇℃伅
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub description: String,
    pub installed: bool,
    pub version: Option<String>,
    pub enabled: bool,
    /// 杩愯鏃?npm 渚濊禆鏄惁灏辩华锛坈hannel_plugin_runtime_ready锛夛紝灏辩华鏃剁綉鍏虫墠鑳芥甯稿姞杞?
    pub deps_ready: bool,
}

// 妯″瀷渚涘簲鍟?
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProvider {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub api_key_configured: bool,
    pub free_models_count: usize,
    pub total_models_count: usize,
}

// 妯″瀷閰嶇疆
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub provider: String,
    pub model_name: String,
    pub api_key: Option<String>,
    pub api_base: Option<String>,
    pub temperature: f32,
    pub max_tokens: usize,
}

// 鏈哄櫒浜烘ā鏉?
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RobotTemplate {
    pub id: String,
    pub category: String,
    pub subcategory: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub color: String,
    pub system_prompt: String,
    pub default_skills: Vec<String>,
    pub default_mcp: Vec<String>,
    pub tags: Vec<String>,
}

/// 鍚戝灞曠ず鐨?MCP 鎺ㄨ崘椤癸紙闇€鍦?OpenClaw 渚ц嚜琛屾帴鍏ワ紝绠＄悊鍣ㄤ笉鑷姩瀹夎 MCP 杩涚▼锛?
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpRecommendation {
    pub id: String,
    pub name: String,
    pub description: String,
    pub setup_note: String,
    /// 甯歌 MCP 瀹炵幇鍙兘渚濊禆浜戠宓屽叆/鎼滅储绛?API Key锛堜粎鎻愮ず鐢級
    #[serde(default)]
    pub requires_api_key: bool,
}

// Skill 淇℃伅
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub license: String,
    pub stars: usize,
    pub free: bool,
    pub downloaded: bool,
    pub notice: Option<String>,
}

// 鏈哄櫒浜?
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Robot {
    pub id: String,
    pub name: String,
    pub category: String,
    pub description: String,
    pub icon: String,
    pub color: String,
    /// 璇ユ満鍣ㄤ汉妯℃澘瀵瑰簲鐨勪笓灞炴妧鑳?ID 鍒楄〃锛堟潵鑷?builtin_robot_templates 鎴栫敤鎴疯嚜瀹氫箟锛?
    pub skills: Vec<String>,
    pub created_at: String,
}

// 瀹炰緥
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Instance {
    pub id: String,
    #[serde(default = "default_instance_module_id")]
    pub module_id: String,
    pub name: String,
    pub enabled: bool,
    /// 缁戝畾鐨勬満鍣ㄤ汉 ID锛屼笉閫夋満鍣ㄤ汉鏃朵负 None锛堜娇鐢ㄩ€氱敤浜鸿 + openclaw skills锛?
    #[serde(default)]
    pub robot_id: Option<String>,
    pub channel_type: String,
    pub channel_config: serde_json::Value,
    pub model: Option<ModelConfig>,
    pub max_history: usize,
    pub response_mode: String,
    pub message_count: usize,
    pub created_at: String,
    pub updated_at: String,
}

fn default_instance_module_id() -> String {
    "openclaw".to_string()
}

// 缃戝叧鐘舵€?
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayStatus {
    pub running: bool,
    pub version: Option<String>,
    pub port: u16,
    pub uptime_seconds: u64,
    pub memory_mb: f64,
    pub instances_running: usize,
}

// 澶囦唤淇℃伅
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupInfo {
    pub id: String,
    pub filename: String,
    pub created_at: String,
    pub size_bytes: u64,
    pub description: Option<String>,
}

// 绯荤粺淇℃伅
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os: String,
    pub arch: String,
    pub cpu_count: usize,
    pub total_memory_mb: u64,
    pub available_memory_mb: u64,
    pub hostname: String,
}

// 鏃ュ織鏉＄洰
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
    pub target: Option<String>,
}

/// 璁剧疆椤点€岃繍琛屾棩蹇椼€嶏細缃戝叧 stdout/stderr 涓庣鐞嗙 app.log 灏鹃儴
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeLogsTail {
    pub gateway: String,
    pub manager: String,
}

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
// 鍏ㄦā鍨嬪渚涘簲鍟嗙洃鎺ф暟鎹粨鏋?
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?

/// 鐢ㄩ噺璁板綍鎵╁睍锛堟敮鎸佽缁嗘寚鏍囷級
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetailedUsageRecord {
    pub ts: String,
    pub provider: String,
    pub model: String,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
    pub source: String,
    #[serde(default)]
    pub response_time_ms: Option<u64>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub error_message: Option<String>,
}

/// 鍩虹鐢ㄩ噺璁板綍锛堢敤浜庡悜鍚庡吋瀹癸級
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

impl From<TokenUsageRecord> for DetailedUsageRecord {
    fn from(r: TokenUsageRecord) -> Self {
        Self {
            ts: r.ts,
            provider: r.provider,
            model: r.model,
            prompt_tokens: r.prompt_tokens,
            completion_tokens: r.completion_tokens,
            total_tokens: r.total_tokens,
            source: r.source,
            response_time_ms: None,
            status: "success".to_string(),
            error_message: None,
        }
    }
}

/// 妯″瀷鐢ㄩ噺姹囨€伙紙鎸夋ā鍨嬪垎缁勶級
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelUsageStats {
    pub provider: String,
    pub model: String,
    pub request_count: u64,
    pub total_prompt_tokens: u64,
    pub total_completion_tokens: u64,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub avg_response_time_ms: Option<f64>,
    pub error_count: u64,
    pub success_rate: f64,
}

/// 渚涘簲鍟嗙敤閲忔眹鎬伙紙鎸変緵搴斿晢鍒嗙粍锛?
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderUsageStats {
    pub provider: String,
    pub request_count: u64,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub model_count: usize,
    pub top_model: Option<String>,
}

/// 渚涘簲鍟嗗畾浠蜂俊鎭?
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderPricing {
    pub provider: String,
    pub input_cost_per_mtok: f64,
    pub output_cost_per_mtok: f64,
    pub cache_read_cost_per_mtok: f64,
    pub cache_write_cost_per_mtok: f64,
    pub currency: String,
    pub free_tier_tokens: Option<u64>,
}

impl ProviderPricing {
    pub fn calculate_cost(
        &self,
        prompt_tokens: u64,
        completion_tokens: u64,
        cache_read: u64,
        cache_write: u64,
    ) -> f64 {
        let input_cost = (prompt_tokens as f64) * self.input_cost_per_mtok / 1_000_000.0;
        let output_cost = (completion_tokens as f64) * self.output_cost_per_mtok / 1_000_000.0;
        let cache_read_cost = (cache_read as f64) * self.cache_read_cost_per_mtok / 1_000_000.0;
        let cache_write_cost = (cache_write as f64) * self.cache_write_cost_per_mtok / 1_000_000.0;
        input_cost + output_cost + cache_read_cost + cache_write_cost
    }
}

/// 鎴愭湰棰勭畻閰嶇疆
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostBudget {
    pub id: String,
    pub name: String,
    pub budget_type: BudgetType,
    pub limit_amount: f64,
    pub alert_threshold: f64,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub enabled: bool,
    pub current_spend: f64,
    pub reset_period: Option<String>,
    pub last_reset: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BudgetType {
    Daily,
    Weekly,
    Monthly,
    Total,
}

/// 鎴愭湰鍛婅璁板綍
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostAlert {
    pub id: String,
    pub budget_id: String,
    pub alert_type: AlertType,
    pub threshold: f64,
    pub current_spend: f64,
    pub message: String,
    pub triggered_at: String,
    pub acknowledged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlertType {
    Threshold50,
    Threshold75,
    Threshold90,
    Threshold100,
}

/// 瀹炴椂鐩戞帶鎸囨爣
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RealTimeMetrics {
    pub timestamp: String,
    pub provider: String,
    pub model: String,
    pub requests_total: u64,
    pub requests_success: u64,
    pub requests_error: u64,
    pub tokens_total: u64,
    pub cost_total: f64,
    pub avg_response_time_ms: f64,
    pub rpm: f64,
    pub tpm: u64,
}
