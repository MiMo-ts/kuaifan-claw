// 机器人管理命令

use crate::mirror::{
    fetch_github_monorepo_skill_folder, fetch_github_repo_tarball_to_dir,
    github_owner_repo_from_url_or_path, InstallProgressEvent,
};
use crate::models::{McpRecommendation, Robot, RobotTemplate, SkillInfo};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tracing::{info, warn};

/// 根据 robot_id 从内置模板查找 system_prompt，找不到则返回默认提示词。
pub fn get_robot_system_prompt(robot_id: &str) -> String {
    builtin_robot_templates()
        .into_iter()
        .find(|t| t.id == robot_id)
        .map(|t| t.system_prompt)
        .unwrap_or_else(|| "你是一个智能助手。".to_string())
}

/// 根据 robot_id 从内置模板查找 default_skills，找不到则返回空 vec。
pub fn get_robot_default_skills(robot_id: &str) -> Vec<String> {
    builtin_robot_templates()
        .into_iter()
        .find(|t| t.id == robot_id)
        .map(|t| t.default_skills)
        .unwrap_or_default()
}

/// 将 robot skills 目录追加到 `openclaw-cn/openclaw.json` 的 `skills.load.extraDirs`。
fn add_openclaw_skills_extra_dir(
    openclaw_dir: &Path,
    robot_skills_dir: &Path,
) -> Result<(), String> {
    use serde_json::Map;

    let cfg_path = openclaw_dir.join("openclaw.json");
    let mut map: Map<String, serde_json::Value> = if cfg_path.is_file() {
        let content = fs::read_to_string(&cfg_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_else(|_| Map::new())
    } else {
        Map::new()
    };

    let extra_dirs = map
        .get("skills")
        .and_then(|v| v.get("load"))
        .and_then(|v| v.get("extraDirs"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let robot_dir_str = robot_skills_dir.to_string_lossy().replace('\\', "/");
    if extra_dirs
        .iter()
        .any(|v| v.as_str() == Some(&robot_dir_str))
    {
        return Ok(()); // 已存在
    }

    let mut new_extra = extra_dirs;
    new_extra.push(serde_json::json!(robot_dir_str));

    let skills = map.entry("skills").or_insert_with(|| serde_json::json!({}));
    let skills_obj = skills.as_object_mut().unwrap();
    let load = skills_obj
        .entry("load")
        .or_insert_with(|| serde_json::json!({}));
    load.as_object_mut()
        .unwrap()
        .insert("extraDirs".to_string(), serde_json::json!(new_extra));

    let content =
        serde_json::to_string_pretty(&serde_json::Value::Object(map)).map_err(|e| e.to_string())?;
    fs::write(&cfg_path, content).map_err(|e| e.to_string())?;
    info!(
        "已将 {} 加入 openclaw.json skills.load.extraDirs",
        robot_dir_str
    );
    Ok(())
}

/// 向导内置的 `skill_id`（如 `douyin_content`）与社区总仓库 `skills/<文件夹名>` 的对应关系。
/// 默认仓库 `LeoYeAI/openclaw-master-skills` 等使用 kebab-case；未列出的 id 会按下划线转连字符尝试。
fn skills_subdir_in_monorepo(skill_id: &str) -> String {
    match skill_id {
        // 电商
        // 抖音/TikTok 脚本工具 citedy-video-shorts（免费，纯 LLM）
        "douyin_script" | "douyin_comment" => "citedy-video-shorts".to_string(),
        "xiaohongshu_copy" => "xiaohongshu-mcp".to_string(),
        "product_selector" | "taobao_api" => "product-marketing-context".to_string(),
        "xiaohongshu_seo" => "seo-audit".to_string(),
        "xiaohongshu_hashtag" => "marketing-ideas".to_string(),
        "video_script" => "citedy-video-shorts".to_string(),
        // 金融
        "tushare" => "tushare-finance".to_string(),
        "stock_news" | "news_sentiment" => "stock-analysis".to_string(),
        "quant_algo" | "stock_monitor" => "stock-market-pro".to_string(),
        // 内容创作
        "comic_script" | "novel_writer" | "story_outline" => "writing-skills".to_string(),
        "copywriter" => "copywriting".to_string(),
        // 办公效率
        "doc_writer" | "meeting_minutes" | "ppt_generator" => "writing-plans".to_string(),
        "email_writer" => "imap-smtp-email".to_string(),
        "web_search" => "web-search-plus".to_string(),
        "calendar" => "calendar".to_string(),
        // monorepo 内为 excel-xlsx，无独立 excel-analyzer 目录
        "excel_analyzer" => "excel-xlsx".to_string(),
        // 文档处理（新增）
        "pdf_reader" | "pdf_edit" => "nano-pdf".to_string(),
        "word_writer" => "docx".to_string(),
        // 飞书（仅映射总仓库中存在的目录；Sheets 等能力由网关 Feishu 插件提供，不依赖 skill 目录）
        "feishu_doc" => "feishu-doc".to_string(),
        "feishu_doc_collab" => "feishu-doc-collab".to_string(),
        // 以下 id 历史上指向不存在的目录；保留映射便于旧实例单独重试时仍能解析（若上游日后补齐目录则自动生效）
        "contract_review" => "contract-review".to_string(),
        "expense_report" => "expense-report".to_string(),
        "feishu_attendance" => "feishu-attendance".to_string(),
        "work_report" => "work-report".to_string(),
        "travel_manager" => "travel-manager".to_string(),
        "feishu_power_skill" => "feishu-power-skill".to_string(),
        "feishu_sheets" => "feishu-skills-kit".to_string(),
        "feishu_pro" => "feishu-pro".to_string(),
        other => other.replace('_', "-"),
    }
}

/// 预编译 Python 环境根目录：`scripts/data/skills-env`（开发）、`resources/skills-env`（安装包可选）、或数据目录下 `skills-env`。
fn resolve_prebuilt_skills_env_root(data_base: &Path) -> PathBuf {
    let dev = data_base
        .parent()
        .unwrap_or(data_base)
        .join("scripts")
        .join("data")
        .join("skills-env");
    if dev.is_dir() {
        return dev;
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join("resources").join("skills-env");
            if bundled.is_dir() {
                return bundled;
            }
        }
    }
    let inline = data_base.join("skills-env");
    if inline.is_dir() {
        return inline;
    }
    dev
}

/// 检查预编译 skill 环境是否存在，若存在则复制 .venv 到目标 skill 目录。
/// 预编译环境由 `scripts/build-skills-env.bat` 生成，存放在 `scripts/data/skills-env/{skill_id}/`。
/// 当前脚本内置 skill_id：`tushare`、`stock_news`、`quant_algo`、`web_search`、`xiaohongshu_copy`、
/// `document_parser`、`excel_analyzer`、`data_analysis`（与模板 default_skills 中需 Python 的包对齐）。
/// 这样做是为了在用户下载 skill 时，直接链接到预编译的 Python venv，无需重新安装包。
fn link_prebuilt_skill_env(
    skill_id: &str,
    target_skill_dir: &Path,
    data_base: &Path,
) -> Option<()> {
    let prebuilt_skill_dir = resolve_prebuilt_skills_env_root(data_base).join(skill_id);

    let prebuilt_venv = prebuilt_skill_dir.join(".venv");
    if !prebuilt_venv.exists() {
        return None;
    }

    // 跳过纯 LLM skill（不需要 venv）
    if matches!(
        skill_id,
        "copywriter"
            | "doc_writer"
            | "xiaohongshu_seo"
            | "xiaohongshu_hashtag"
            | "douyin_script"
            | "douyin_comment"
            | "video_script"
            | "comic_script"
            | "novel_writer"
            | "story_outline"
            | "ppt_generator"
            | "meeting_minutes"
            | "product_selector"
    ) {
        return None;
    }

    let target_venv = target_skill_dir.join(".venv");
    if target_venv.exists() {
        // 已有 venv（用户可能自己运行过 setup.bat），不覆盖
        tracing::info!("skill {} 已有 .venv，跳过预编译环境链接", skill_id);
        return Some(());
    }

    // 将预编译 .venv 复制到 skill 目录
    match copy_dir_all(&prebuilt_venv, &target_venv) {
        Ok(()) => {
            tracing::info!(
                "skill {} 成功链接预编译 Python 环境: {}",
                skill_id,
                target_venv.display()
            );
            Some(())
        }
        Err(e) => {
            tracing::warn!(
                "skill {} 预编译环境复制失败（skill 仍可用，但需手动运行 setup.bat）: {}",
                skill_id,
                e
            );
            Some(()) // 不阻塞 skill 安装，只是警告
        }
    }
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.is_dir() {
        return Err(format!("源不是目录: {}", src.display()));
    }
    if dst.exists() {
        fs::remove_dir_all(dst).map_err(|e| e.to_string())?;
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fn walk(src: &Path, dst: &Path) -> Result<(), std::io::Error> {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let ty = entry.file_type()?;
            let from = entry.path();
            let to = dst.join(entry.file_name());
            if ty.is_dir() {
                walk(&from, &to)?;
            } else {
                fs::copy(&from, &to)?;
            }
        }
        Ok(())
    }

    walk(src, dst).map_err(|e| format!("复制技能目录失败: {}", e))
}

fn mcp_recommendation_for(id: &str) -> McpRecommendation {
    let (name, desc, requires_key) = match id {
        "filesystem" => (
            "文件系统（filesystem）",
            "读写工作区目录与文件；本地进程，无需第三方 API Key。",
            false,
        ),
        "fetch" => (
            "HTTP / Fetch",
            "拉取公开网页与 REST 接口；默认无 Key，若接付费代理需自行配置。",
            false,
        ),
        "sqlite" => (
            "SQLite",
            "本地结构化存储与查询；无需云端 Key。",
            false,
        ),
        "git" => (
            "Git（只读）",
            "查看仓库状态、提交与 diff；本地命令，无需 API Key。",
            false,
        ),
        "browser" => (
            "浏览器自动化（Browser）",
            "通过本机 Chrome/Edge 无头浏览器抓取动态网页（JavaScript 渲染内容）。需本机已安装 Chrome，Cookie 登录态自动复用。无需 API Key。",
            false,
        ),
        "memory" => (
            "记忆 / 向量检索（Memory）",
            "常见实现会调用云端嵌入模型，需配置对应厂商 API Key。默认不推荐。",
            true,
        ),
        "taobao-scraper-mcp" => (
            "淘宝/天猫/京东 爬虫 MCP",
            "通过浏览器 Cookie 登录抓取淘宝、天猫、京东商品信息与热搜榜。完全免费，无需平台 API Key。需本机已安装 Chrome 并配置好 Cookie 登录态。",
            false,
        ),
        _ => (
            id,
            "请在 OpenClaw 的 MCP 配置中按需接入；标识名为上方 ID。",
            false,
        ),
    };
    McpRecommendation {
        id: id.to_string(),
        name: name.to_string(),
        description: desc.to_string(),
        setup_note: "本管理器不启动 MCP 进程；请在 OpenClaw 配置（如 openclaw.json 的 mcpServers）中自行安装并填写命令。".to_string(),
        requires_api_key: requires_key,
    }
}

fn synthetic_skill_info(skill_id: &str) -> SkillInfo {
    let title = skill_id
        .split('_')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    SkillInfo {
        id: skill_id.to_string(),
        name: title,
        description: "通过 HTTPS 拉取 GitHub 源码包安装（无需 Git 登录）".to_string(),
        license: "MIT".to_string(),
        stars: 500,
        free: true,
        downloaded: false,
        notice: Some("点击下方「下载免费 Skills」从网络拉取".to_string()),
    }
}

/// 内置机器人模板（与 get_robot_skills / download_skills 逻辑一致）。
///
/// 默认 **不** 捆绑需开放平台 Key 的 skill（如 `tushare`、`taobao_api`、`douyin_*`、
/// `stock_news`、`quant_algo` 等依赖第三方付费/授权 API 的 skill）；
/// `xiaohongshu_copy` 等为**扫码登录自有账号**，无平台 API Key，可保留在模板中。
/// 所有模板均使用仅依赖 LLM 或免费账号登录（无需付费 API Key）的 skill 组合。
///
/// 分类说明：
/// - **免费账号类**：`xiaohongshu_copy`（扫码登录小红书）/ `xiaohongshu_seo`（通用SEO）/ `xiaohongshu_hashtag`（营销思路）
/// - **纯 LLM 类**：`web_search`、`copywriter`、`doc_writer`、`video_script`、`excel_analyzer`、`data_analysis`、`document_parser`、`ppt_generator` 等
///
/// 以下 skill 需要**付费 API Key**，默认模板中已移除（用户可自行加装）：
/// - `tushare` / `stock_news` / `quant_algo` → 需 Tushare Pro / 行情 API Key
/// - `douyin_content` → TikTok 付费预测服务 ¥39/月
/// - `taobao_api` / `jd_api` → 需平台开放平台 API Key
///
/// 以下为**新增免费 MCP**：
/// - `taobao-scraper-mcp` → 淘宝/天猫/京东 爬虫 MCP，Cookie 登录，完全免费
/// - `browser` → 浏览器自动化，抓取动态网页，无需 API Key
/// - `filesystem` / `fetch` / `sqlite` → 本地存储与 HTTP，纯免费
/// 默认 MCP：`taobao-scraper-mcp`（电商）/ `browser`（全场景）/ `filesystem` / `fetch` / `sqlite`
pub fn builtin_robot_templates() -> Vec<RobotTemplate> {
    vec![
        // ═══════════════════════════════════════════════════════════════════
        //  技能可用性实测结论（2026-03-29）：
        //
        //  ✅ 有真实 index.js 代码：
        //     feishu_doc → feishu-doc（调用飞书 open API，需 appId/secret）
        //
        //  ⚠️  纯 SKILL.md（无 index.js，AI 读提示词生成内容，=正常 prompt skill）：
        //     copywriter → copywriting（完整 Markdown 提示词，AI 直接使用）
        //     doc_writer / ppt_generator / meeting_minutes → writing-plans
        //     video_script → citedy-video-shorts
        //     comic_script / novel_writer / story_outline → writing-skills
        //
        //  ❌ 完全不能用（必须移除）：
        //     douyin_script → citedy-video-shorts/（实际下载的是 tiktok-viral-predictor，
        //       内容是硬编码假数据，无任何真实 API，付费 ¥39/月）
        //     xiaohongshu_copy → xiaohongshu-mcp（只有 SKILL.md，无 index.js，
        //       需要用户手动下载 GitHub binary 并启动 MCP server，普通用户门槛极高）
        //     xiaohongshu_seo → seo-audit（只有 SKILL.md，无 index.js）
        //     xiaohongshu_hashtag → marketing-ideas（只有 SKILL.md，引用不存在的子目录）
        //
        //  ⚠️  文档 skill（需预编译 Python 环境）：
        //     excel_analyzer → excel-xlsx（有 SKILL.md + setup.md，无 index.js）
        //     data_analysis → data-analysis（需 Python 包，需预编译 .venv）
        //     document_parser → document-parser（需 Python 包，需预编译 .venv）
        //
        //  ⚠️  MCP（需用户自行在网关侧配置）：
        //     xiaohongshu-mcp → 需下载 binary + 启动 MCP server
        //     taobao-scraper-mcp → 需 cookie 配置
        //     feishu_doc → 需飞书应用 appId/secret
        //
        //  免费且零门槛可用的技能组合：
        //     web_search（HTTP 请求）、copywriter（SKILL.md 提示词）、
        //     doc_writer（SKILL.md 提示词）、ppt_generator（SKILL.md 提示词）、
        //     video_script（SKILL.md 提示词）、
        //     browser MCP（WebView2 自动化，无需 Key）、
        //     filesystem / fetch / sqlite（免费）
        // ═══════════════════════════════════════════════════════════════════

        // ── 电商机器人 ──────────────────────────────────────────────────
        // 免费零门槛：web_search + copywriter/doc_writer/ppt_generator（SKILL.md prompt skill）
        // 需要用户配置的：xiaohongshu_copy（需 MCP binary）、xiaohongshu-mcp（MCP）
        // 注意：douyin_script 已移除（实测为假数据脚本，付费不可用）
        RobotTemplate {
            id: "robot_ecom_001".to_string(),
            category: "电商机器人".to_string(),
            subcategory: "抖音/小红书带货".to_string(),
            name: "抖音/小红书带货助手".to_string(),
            description: "抖音/小红书平台带货全链路助手。热点检索 → 商品数据抓取 → SEO优化/标签策略 → 文案/脚本生成 → 账号自动发布 → Excel排期/PPT方案输出。支持扫码登录小红书账号自动发帖，零付费API Key。".to_string(),
            icon: "🛒".to_string(),
            color: "#FF6B6B".to_string(),
            system_prompt: r#"你是一位资深内容电商增长顾问，专注于抖音与小红书平台的带货运营。

【核心职能】
- 热点追踪：使用 web_search 工具检索抖音/小红书热搜词、平台话题榜、竞品爆款笔记；
- 选品辅助：browser + taobao-scraper-mcp 抓取淘宝/天猫/京东商品价格/销量/评价等公开数据；
- 数据整理：使用 excel_analyzer / data_analysis 对抓取到的数据进行对比、汇总、生成图表或结构化表格；
- SEO 优化：使用 xiaohongshu_seo 分析关键词优化策略；
- 标签策略：使用 xiaohongshu_hashtag 生成话题标签与营销思路；
- 文案创作：使用 copywriter / video_script 生成种草图文/短视频口播脚本/直播话术；
- 文档交付：使用 doc_writer / ppt_generator 产出活动策划案、投放 Brief、运营复盘报告等；
- 账号操作：xiaohongshu_copy MCP（需用户在网关侧安装并扫码登录小红书账号）。

【工作流程】
澄清目标 → web_search 取证/抓取 → browser + taobao-scraper-mcp 商品数据 → excel_analyzer / data_analysis 整理 → copywriter / video_script 成稿 → xiaohongshu_copy 发布 → doc_writer / ppt_generator 输出文档。

【输出要求】
- 带货文案：突出产品卖点、场景化表达、行动号召；
- 数据表格：结构清晰，附关键指标解读；
- 活动方案：时间线、渠道、资源配置一目了然；
- 脚本：分镜、时长、口播台词完整。

【合规声明】
本助手提供的信息与文案仅供运营参考，不构成投资建议。"#.to_string(),
            default_skills: vec![
                "web_search".to_string(),
                "xiaohongshu_seo".to_string(),
                "xiaohongshu_hashtag".to_string(),
                "xiaohongshu_copy".to_string(),
                "copywriter".to_string(),
                "doc_writer".to_string(),
                "video_script".to_string(),
                "excel_analyzer".to_string(),
                "data_analysis".to_string(),
                "ppt_generator".to_string(),
            ],
            default_mcp: vec![
                "browser".to_string(),
                "taobao-scraper-mcp".to_string(),
                "filesystem".to_string(),
                "fetch".to_string(),
                "sqlite".to_string(),
            ],
            tags: vec!["电商".to_string(), "抖音".to_string(), "小红书".to_string()],
        },
        RobotTemplate {
            id: "robot_ecom_002".to_string(),
            category: "电商机器人".to_string(),
            subcategory: "淘宝天猫".to_string(),
            name: "淘宝天猫运营助手".to_string(),
            description: "淘宝/天猫/京东店铺运营全链路助手。热点选品与竞品调研 → 商品数据抓取与对比 → 店铺运营数据整理 → 活动策划与投放方案输出。支持 Excel 选品对比表、大促运营文档、PPT 方案。全流程免费，无需平台付费 API Key。".to_string(),
            icon: "🛍️".to_string(),
            color: "#FF9500".to_string(),
            system_prompt: r#"你是一位资深淘宝天猫店铺运营增长顾问，精通选品、流量获取与大促运营。

【核心职能】
- 热点调研：使用 web_search 检索电商热点、平台活动节点、竞品动态与热搜词；
- 数据抓取：使用 browser 抓取商品价格/销量/评价等公开信息；
- 数据分析：使用 excel_analyzer / data_analysis 对选品数据进行对比与评分排序；
- 文案输出：使用 copywriter / doc_writer 生成商品卖点、客服话术、活动文案；
- 方案交付：使用 ppt_generator 产出大促活动方案、投放计划或店铺运营手册。

【工作流程】
澄清目标 → web_search / browser 取证 → excel_analyzer / data_analysis 深度对比 → copywriter / doc_writer 成稿 → ppt_generator 输出方案文档。

【输出要求】
- 选品报告：商品列表 + 价格/销量/评价对比表格 + 推荐理由；
- 运营周报：流量/转化/GMV 数据表格 + 问题诊断与优化建议；
- 大促方案：目标拆解、时间线、资源配置、推广节奏。

【合规声明】
本助手提供的信息与建议仅供运营参考，不构成投资或采购建议。"#.to_string(),
            default_skills: vec![
                "web_search".to_string(),
                "copywriter".to_string(),
                "doc_writer".to_string(),
                "product_selector".to_string(),
                "excel_analyzer".to_string(),
                "data_analysis".to_string(),
                "ppt_generator".to_string(),
            ],
            default_mcp: vec![
                "browser".to_string(),
                "filesystem".to_string(),
                "fetch".to_string(),
                "sqlite".to_string(),
            ],
            tags: vec!["电商".to_string(), "淘宝".to_string(), "天猫".to_string()],
        },
        // ── 社交媒体机器人 ─────────────────────────────────────────
        // 免费零门槛：web_search + copywriter/doc_writer（SKILL.md prompt skill）
        // 注意：xiaohongshu_copy/seo/hashtag 已移除（需 MCP binary，门槛高）
        RobotTemplate {
            id: "robot_social_001".to_string(),
            category: "社交媒体机器人".to_string(),
            subcategory: "小红书运营".to_string(),
            name: "小红书运营助手".to_string(),
            description: "小红书内容运营全链路助手。热点检索 → 竞品分析 → SEO优化 → 标签策略 → 内容创作/发布 → 数据分析 → 排期/周报输出。支持扫码登录小红书账号自动发帖，零付费API Key。".to_string(),
            icon: "📝".to_string(),
            color: "#FF2442".to_string(),
            system_prompt: r#"你是一位专业的小红书内容运营增长顾问，精通种草笔记、话题策划与账号增长策略。

【核心职能】
- 热点追踪：使用 web_search 工具检索小红书热搜词、平台话题榜、竞品爆款笔记；
- 账号操作：使用 xiaohongshu_copy MCP（需用户在网关侧安装并扫码登录小红书账号）执行发布笔记、查看互动数据；
- 数据分析：使用 excel_analyzer / data_analysis 对笔记互动数据进行对比与效果评估；
- SEO 优化：使用 xiaohongshu_seo 分析关键词优化策略；
- 标签策略：使用 xiaohongshu_hashtag 生成话题标签与营销思路；
- 文案创作：使用 copywriter / doc_writer 生成种草图文、运营周报、排期与复盘文档。

【工作流程】
澄清目标 → web_search 取证热点 → browser + xiaohongshu_copy 执行账号操作 → excel_analyzer / data_analysis 数据整理 → copywriter / doc_writer 输出排期/报告。

【输出要求】
- 排期表：日期、笔记主题、关键词/标签、预计发布时段；
- 周报：发文章数、互动总量、粉丝变化、问题诊断与下周计划；
- 爆款分析：对比表格 + 选题/标题/标签可复用的规律。

【合规声明】
本助手提供的信息与建议仅供运营参考，不构成投资或商业建议。"#.to_string(),
            default_skills: vec![
                "web_search".to_string(),
                "xiaohongshu_seo".to_string(),
                "xiaohongshu_hashtag".to_string(),
                "xiaohongshu_copy".to_string(),
                "copywriter".to_string(),
                "doc_writer".to_string(),
                "excel_analyzer".to_string(),
                "data_analysis".to_string(),
            ],
            default_mcp: vec![
                "browser".to_string(),
                "taobao-scraper-mcp".to_string(),
                "filesystem".to_string(),
                "fetch".to_string(),
                "sqlite".to_string(),
            ],
            tags: vec!["小红书".to_string(), "种草".to_string(), "运营".to_string()],
        },
        // 抖音内容助手：douyin_script 已移除（实测为假数据脚本，付费不可用）
        // 免费零门槛：web_search + copywriter/doc_writer/video_script + excel_analyzer/data_analysis
        RobotTemplate {
            id: "robot_social_002".to_string(),
            category: "社交媒体机器人".to_string(),
            subcategory: "抖音内容".to_string(),
            name: "抖音内容创作助手".to_string(),
            description: "抖音短视频内容创作全链路。热点检索 → 脚本/分镜设计 → 数据对比 → 策划/复盘文档。免费零门槛。".to_string(),
            icon: "🎬".to_string(),
            color: "#00F2EA".to_string(),
            system_prompt: r#"你是一位资深抖音内容创作增长顾问，精通短视频脚本、流量获取与账号运营策略。

【核心职能】
- 热点追踪：使用 web_search 检索抖音热榜、挑战赛、爆款话题与平台趋势；
- 数据分析：使用 excel_analyzer / data_analysis 对竞品视频数据（播放/点赞/评论/转发）进行对比与效果归因；
- 脚本创作：使用 video_script 生成短视频分镜、口播结构、钩子设计；
- 文案辅助：使用 copywriter 撰写视频标题、封面文案、互动话术；
- 方案输出：使用 doc_writer / ppt_generator 产出系列栏目策划案、投放复盘报告或活动 Brief。

【工作流程】
澄清目标 → web_search 热点取证 → video_script / copywriter 生成脚本 → excel_analyzer / data_analysis 竞品数据对比 → doc_writer / ppt_generator 输出策划/复盘文档。

【输出要求】
- 短视频脚本：分镜序号、画面描述、时长、口播台词、BGM 建议；
- 竞品分析表：视频标题、播放/点赞/评论、发布时间、内容形式；
- 栏目策划：系列主题、目标受众、更新频率、引流策略。

【合规声明】
本助手提供的信息与建议仅供内容创作参考，不构成投资或商业建议。全部免费，无需任何平台 API Key。"#.to_string(),
            default_skills: vec![
                "web_search".to_string(),
                "copywriter".to_string(),
                "video_script".to_string(),
                "doc_writer".to_string(),
                "excel_analyzer".to_string(),
                "data_analysis".to_string(),
                "ppt_generator".to_string(),
            ],
            default_mcp: vec![
                "browser".to_string(),
                "filesystem".to_string(),
                "fetch".to_string(),
                "sqlite".to_string(),
            ],
            tags: vec!["抖音".to_string(), "短视频".to_string(), "直播".to_string()],
        },
        // 微信公众号助手
        RobotTemplate {
            id: "robot_social_003".to_string(),
            category: "社交媒体机器人".to_string(),
            subcategory: "微信公众号".to_string(),
            name: "微信公众号助手".to_string(),
            description: "微信公众号内容创作与运营助手。热点检索 → 文章策划 → 排版与封面建议 → 粉丝互动与数据复盘。支持文章大纲、推广文案、运营周报与自动回复设置。全流程免费，无需微信公众平台 API Key。".to_string(),
            icon: "📰".to_string(),
            color: "#07C160".to_string(),
            system_prompt: r#"你是一位专业的微信公众号运营顾问，精通内容创作、排版优化与粉丝运营。

【核心职能】
- 热点检索：使用 web_search 检索公众号领域热点、行业动态与竞品爆款文章；
- 内容策划：使用 copywriter 创作公众号选题、标题、正文与结尾引导；
- 排版建议：提供 Markdown 排版规范与封面设计思路；
- 数据分析：使用 excel_analyzer / data_analysis 对阅读量/在看/留言数据进行对比与效果归因；
- 文档输出：使用 doc_writer 产出运营周报、选题规划与复盘报告。

【工作流程】
澄清定位 → web_search 取证热点 → copywriter 生成文章 → doc_writer 输出排版/方案 → excel_analyzer / data_analysis 整理数据 → 必要时 browser 抓取竞品参考。

【输出要求】
- 文章：标题、正文（含小标题）、结尾引导语完整；
- 排版：Markdown 格式，适配各平台编辑器；
- 周报：阅读量/在看/留言汇总 + 问题诊断与下周计划。

【合规声明】
本助手提供的信息与建议仅供运营参考，不构成投资或商业建议。"#.to_string(),
            default_skills: vec![
                "web_search".to_string(),
                "copywriter".to_string(),
                "doc_writer".to_string(),
                "excel_analyzer".to_string(),
                "data_analysis".to_string(),
            ],
            default_mcp: vec![
                "browser".to_string(),
                "filesystem".to_string(),
                "fetch".to_string(),
                "sqlite".to_string(),
            ],
            tags: vec!["公众号".to_string(), "微信".to_string(), "内容创作".to_string()],
        },
        // ── 金融股票机器人 ─────────────────────────────────────────
        // 移除：tushare / stock_news / quant_algo（需付费 API Key）
        // 替代：browser（抓取东方财富/新浪财经动态页面）+ fetch（公开数据接口）
        //       web_search + copywriter + doc_writer（纯 LLM，无需付费 API）
        RobotTemplate {
            id: "robot_stock_001".to_string(),
            category: "金融股票机器人".to_string(),
            subcategory: "A股资讯助手".to_string(),
            name: "A股资讯助手".to_string(),
            description: "A 股市场公开资讯整理与结构化输出助手。抓取东方财富/新浪财经等公开页面 → 提取研报摘要/公告要点/市场情绪 → 生成对比表格、数据结论与投资参考文档。支持 Excel 数据表与分析报告。全流程免费，无需 Tushare/行情付费 API Key。".to_string(),
            icon: "📈".to_string(),
            color: "#1A73E8".to_string(),
            system_prompt: r#"你是一位资深 A 股市场资讯顾问，专注于公开信息的检索、整理与结构化输出，辅助投资者做决策参考。

【核心职能】
- 公开资讯检索：使用 web_search 检索财经新闻、研报摘要、券商观点与市场公开数据；
- 网页抓取：使用 browser 抓取东方财富、同花顺、新浪财经等公开页面的行情数据与公告内容；
- 数据分析：使用 data_analysis / excel_analyzer 对多维度数据（估值/财务/技术指标）进行对比与汇总；
- 文档解析：使用 document_parser 提取 PDF 研报或网页长文中的关键数据点；
- 报告输出：使用 copywriter / doc_writer 生成每日复盘、持仓跟踪与资讯摘要文档。

【工作流程】
澄清需求 → browser / web_search 取证公开页面 → document_parser 解析研报 → data_analysis / excel_analyzer 汇总对比 → copywriter / doc_writer 输出结构化报告。

【输出要求】
- 数据表格：股票代码、名称、关键财务/行情指标对比；
- 资讯摘要：热点事件、市场情绪、资金流向；
- 每日复盘：涨跌原因、主力动向、下日展望。

【合规声明】
本助手仅基于公开信息整理，不构成投资建议。股市有风险，投资需谨慎。"#.to_string(),
            default_skills: vec![
                "web_search".to_string(),
                "copywriter".to_string(),
                "doc_writer".to_string(),
                "excel_analyzer".to_string(),
                "data_analysis".to_string(),
                "document_parser".to_string(),
            ],
            default_mcp: vec![
                "browser".to_string(),
                "fetch".to_string(),
                "filesystem".to_string(),
                "sqlite".to_string(),
            ],
            tags: vec!["A股".to_string(), "资讯".to_string(), "报告".to_string()],
        },
        RobotTemplate {
            id: "robot_stock_002".to_string(),
            category: "金融股票机器人".to_string(),
            subcategory: "数字货币".to_string(),
            name: "数字货币监控助手".to_string(),
            description: "加密货币市场公开资讯整理与情绪分析助手。抓取交易所/项目方公开页面 → 提取链上数据与社区情绪 → 生成对比表格、持仓记录与定期复盘文档。支持 Excel 表格与分析报告。全流程免费，无需链上/行情付费 API Key。".to_string(),
            icon: "₿".to_string(),
            color: "#F7931A".to_string(),
            system_prompt: r#"你是一位资深加密货币市场资讯顾问，专注于公开链上数据、交易所公告与社区情绪的检索与结构化输出，辅助投资者做决策参考。

【核心职能】
- 公开资讯检索：使用 web_search 检索加密货币新闻、项目动态、交易所公告与链上公开数据；
- 网页抓取：使用 browser 抓取 CoinMarketCap、Binance、CoinGecko、Twitter/X 等公开页面；
- 数据分析：使用 data_analysis / excel_analyzer 对多币种/多维度数据（价格/市值/链上指标）进行对比与汇总；
- 文档解析：使用 document_parser 提取项目白皮书或长文中的关键数据点；
- 报告输出：使用 copywriter / doc_writer 生成持仓记录、交易日志与定期复盘文档。

【工作流程】
澄清需求 → browser / web_search 取证公开页面 → document_parser 解析白皮书 → data_analysis / excel_analyzer 汇总对比 → copywriter / doc_writer 输出结构化复盘。

【输出要求】
- 数据表格：币种、价格、24h 涨跌、链上活跃度等指标对比；
- 情绪摘要：社区热度、资金流向、恐慌/贪婪指数；
- 定期复盘：持仓变化、收益/亏损、主要决策与下期计划。

【合规声明】
本助手仅基于公开信息整理，不构成投资建议。加密货币市场波动剧烈，投资有风险，请谨慎决策。"#.to_string(),
            default_skills: vec![
                "web_search".to_string(),
                "copywriter".to_string(),
                "doc_writer".to_string(),
                "excel_analyzer".to_string(),
                "data_analysis".to_string(),
                "document_parser".to_string(),
            ],
            default_mcp: vec![
                "browser".to_string(),
                "fetch".to_string(),
                "filesystem".to_string(),
                "sqlite".to_string(),
            ],
            tags: vec!["数字货币".to_string(), "BTC".to_string(), "ETH".to_string()],
        },
        // ── 内容创作机器人 ─────────────────────────────────────────
        // 漫剧、小说：comic_script / novel_writer / story_outline / video_script / copywriter 均免费
        // browser：抓取竞品内容分析
        RobotTemplate {
            id: "robot_content_001".to_string(),
            category: "内容创作机器人".to_string(),
            subcategory: "漫剧剧本".to_string(),
            name: "漫剧剧本生成器".to_string(),
            description: "分镜头剧本、对白生成、世界观设计（全部免费，纯 LLM + browser 抓取参考内容）。".to_string(),
            icon: "🎭".to_string(),
            color: "#9C27B0".to_string(),
            system_prompt: "你是一个专业的漫剧剧本创作助手...".to_string(),
            default_skills: vec![
                "comic_script".to_string(),
                "novel_writer".to_string(),
                "story_outline".to_string(),
            ],
            default_mcp: vec![
                "browser".to_string(),
                "filesystem".to_string(),
                "fetch".to_string(),
                "sqlite".to_string(),
            ],
            tags: vec!["漫剧".to_string(), "剧本".to_string(), "创作".to_string()],
        },
        RobotTemplate {
            id: "robot_content_002".to_string(),
            category: "内容创作机器人".to_string(),
            subcategory: "小说创作".to_string(),
            name: "小说创作助手".to_string(),
            description: "小说大纲、章节创作、人物设定（全部免费，纯 LLM + browser 抓取参考内容）。".to_string(),
            icon: "✍️".to_string(),
            color: "#673AB7".to_string(),
            system_prompt: "你是一个专业的小说创作助手...".to_string(),
            default_skills: vec![
                "novel_writer".to_string(),
                "story_outline".to_string(),
                "copywriter".to_string(),
            ],
            default_mcp: vec![
                "browser".to_string(),
                "filesystem".to_string(),
                "fetch".to_string(),
                "sqlite".to_string(),
            ],
            tags: vec!["小说".to_string(), "创作".to_string(), "写作".to_string()],
        },
        // ── 办公效率机器人 ─────────────────────────────────────────
        // 合并原 robot_office_001（日报周报）和 robot_office_002（PPT大纲），
        // 新增 PDF/Word/Excel 全套文档处理 skill，覆盖办公高频需求。
        // 所有 skill 均为纯 LLM，无需付费 API Key。
        RobotTemplate {
            id: "robot_office_001".to_string(),
            category: "办公效率机器人".to_string(),
            subcategory: "企业文档".to_string(),
            name: "企业文档助手".to_string(),
            description: "日报周报、会议纪要、PPT 大纲、PDF 阅读/编辑、Word 文档、Excel 数据分析、邮件撰写、日程管理。全部免费，纯 LLM + browser 抓取参考，无需付费 API Key。".to_string(),
            icon: "📋".to_string(),
            color: "#2196F3".to_string(),
            system_prompt: r#"你是一位专业的企业办公助手，精通各类日常文档、数据分析与流程协作。

【核心职能】
- 日报周报：使用 doc_writer 撰写日报、周报、月报与工作总结；
- 会议纪要：使用 meeting_minutes 整理会议要点、决策事项与待办清单；
- PPT 方案：使用 ppt_generator 生成演示结构、大纲与演讲稿；
- 数据分析：使用 excel_analyzer / data_analysis 处理表格数据，生成对比图表与趋势分析；
- 资料检索：使用 web_search 检索公开资料与行业参考；
- 文案辅助：使用 copywriter 生成各类正式文档草稿。

【工作流程】
澄清任务类型 → 对应 skill 执行 → doc_writer / ppt_generator 输出结构化文档。

【输出要求】
- 文档：格式规范、内容完整、结构清晰；
- 表格：数据准确、对比清晰、附图表说明；
- 方案：时间线、职责分工、资源配置一目了然。

【合规声明】
本助手仅辅助办公文档生成，所有内容由用户审核后使用。"#.to_string(),
            default_skills: vec![
                "doc_writer".to_string(),
                "meeting_minutes".to_string(),
                "ppt_generator".to_string(),
                "excel_analyzer".to_string(),
                "data_analysis".to_string(),
                "web_search".to_string(),
                "copywriter".to_string(),
            ],
            default_mcp: vec![
                "browser".to_string(),
                "filesystem".to_string(),
                "fetch".to_string(),
                "sqlite".to_string(),
            ],
            tags: vec!["办公".to_string(), "文档".to_string(), "PDF".to_string(), "Word".to_string(), "Excel".to_string()],
        },
        // 企业服务助手：default_skills 必须与技能总仓库 openclaw-master-skills 下实际存在的 skills/<kebab-name> 一致，
        // 否则「全部成功才显示已下载」会永远失败。飞书表格等能力可由网关 Feishu 插件提供，不强行绑定不存在的 skill 目录。
        RobotTemplate {
            id: "robot_office_002".to_string(),
            category: "办公效率机器人".to_string(),
            subcategory: "企业服务".to_string(),
            name: "企业服务助手".to_string(),
            description: "飞书文档与协作、本地 Excel/表格数据分析、文档解析、内部沟通稿与 Git 活动摘要。技能包来自开源总仓库中已收录目录（feishu-doc、excel-xlsx、data-analysis 等）。配置飞书应用后可在网关侧使用 Sheets/消息等插件能力。".to_string(),
            icon: "🏢".to_string(),
            color: "#4CAF50".to_string(),
            system_prompt: "你是一个专业的企业服务助手...".to_string(),
            default_skills: vec![
                "feishu_doc".to_string(),
                "feishu_doc_collab".to_string(),
                "excel_analyzer".to_string(),
                "data_analysis".to_string(),
                "document_parser".to_string(),
                "internal_comms".to_string(),
                "git_commit".to_string(),
                "doc_writer".to_string(),
            ],
            default_mcp: vec![
                "browser".to_string(),
                "filesystem".to_string(),
                "fetch".to_string(),
                "sqlite".to_string(),
            ],
            tags: vec!["合同".to_string(), "报销".to_string(), "考勤".to_string(), "飞书".to_string(), "数据分析".to_string()],
        },
        // ── 通用助手 ───────────────────────────────────────────────
        // 全场景覆盖：browser + filesystem + fetch + sqlite
        RobotTemplate {
            id: "robot_general_001".to_string(),
            category: "通用助手".to_string(),
            subcategory: "私人秘书".to_string(),
            name: "私人秘书".to_string(),
            description: "信息查询、任务整理与文档输出（全部免费，纯 LLM + browser 网页抓取）。".to_string(),
            icon: "🧑‍💼".to_string(),
            color: "#3F51B5".to_string(),
            system_prompt: "你是一个贴心的私人秘书...".to_string(),
            default_skills: vec![
                "web_search".to_string(),
                "doc_writer".to_string(),
                "copywriter".to_string(),
            ],
            default_mcp: vec![
                "browser".to_string(),
                "filesystem".to_string(),
                "fetch".to_string(),
                "sqlite".to_string(),
            ],
            tags: vec!["秘书".to_string(), "日程".to_string(), "效率".to_string()],
        },
        RobotTemplate {
            id: "robot_general_002".to_string(),
            category: "通用助手".to_string(),
            subcategory: "智能客服".to_string(),
            name: "智能客服基础版".to_string(),
            description: "通用客服场景、FAQ自动回复、问题分类（全部免费，纯 LLM + browser 抓取知识库）。".to_string(),
            icon: "🤖".to_string(),
            color: "#00BCD4".to_string(),
            system_prompt: "你是一个专业的智能客服助手...".to_string(),
            default_skills: vec![
                "web_search".to_string(),
                "doc_writer".to_string(),
                "copywriter".to_string(),
            ],
            default_mcp: vec![
                "browser".to_string(),
                "filesystem".to_string(),
                "fetch".to_string(),
                "sqlite".to_string(),
            ],
            tags: vec!["客服".to_string(), "问答".to_string(), "自动回复".to_string()],
        },
    ]
}

/// 当前模板推荐的 MCP 列表（含说明；需用户在 OpenClaw 侧配置）
#[tauri::command]
pub fn get_robot_mcp_recommendations(robot_id: String) -> Result<Vec<McpRecommendation>, String> {
    let template = builtin_robot_templates()
        .into_iter()
        .find(|t| t.id == robot_id)
        .ok_or_else(|| format!("未知机器人模板: {}", robot_id))?;
    Ok(template
        .default_mcp
        .iter()
        .map(|id| mcp_recommendation_for(id))
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RobotTemplateWithDownload {
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
    /// 是否全部默认 Skill 目录已就绪（与创建实例门槛一致）
    pub downloaded: bool,
    /// 已存在的 Skill 子目录数量（用于展示「部分下载」）
    pub skills_installed: usize,
    /// 模板要求的 Skill 总数
    pub skills_total: usize,
}

#[tauri::command]
pub async fn list_robot_templates(
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<Vec<RobotTemplateWithDownload>, String> {
    let data_base = data_dir.inner().data_dir.lock().unwrap().clone();
    let templates = builtin_robot_templates();
    let mut results = Vec::with_capacity(templates.len());

    for t in templates {
        let skills_total = t.default_skills.len();
        let skills_installed = t
            .default_skills
            .iter()
            .filter(|sid| {
                let skill_path = format!("{}/robots/{}/skills/{}", data_base, t.id, sid);
                std::path::Path::new(&skill_path).is_dir()
            })
            .count();
        // 无默认 skill 的模板不标为已下载（避免空 vec 时 all() 恒为 true）
        let downloaded = skills_total > 0 && skills_installed == skills_total;
        results.push(RobotTemplateWithDownload {
            id: t.id,
            category: t.category,
            subcategory: t.subcategory,
            name: t.name,
            description: t.description,
            icon: t.icon,
            color: t.color,
            system_prompt: t.system_prompt,
            default_skills: t.default_skills,
            default_mcp: t.default_mcp,
            tags: t.tags,
            downloaded,
            skills_installed,
            skills_total,
        });
    }

    Ok(results)
}

// 获取机器人的 Skills 信息
#[tauri::command]
pub async fn get_robot_skills(
    data_dir: tauri::State<'_, crate::AppState>,
    robot_id: String,
) -> Result<Vec<SkillInfo>, String> {
    let data_base = data_dir.inner().data_dir.lock().unwrap().clone();
    let template = builtin_robot_templates()
        .into_iter()
        .find(|t| t.id == robot_id)
        .ok_or_else(|| format!("未知机器人模板: {}", robot_id))?;

    let rich_map = get_skills_map();
    let rich_by_id: std::collections::HashMap<String, SkillInfo> = rich_map
        .get(&robot_id)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|s| (s.id.clone(), s))
        .collect();

    let mut out: Vec<SkillInfo> = Vec::new();
    for sid in &template.default_skills {
        let mut s = rich_by_id
            .get(sid.as_str())
            .cloned()
            .unwrap_or_else(|| synthetic_skill_info(sid));
        let skill_path = format!("{}/robots/{}/skills/{}", data_base, robot_id, sid);
        s.downloaded = Path::new(&skill_path).is_dir();
        out.push(s);
    }

    Ok(out)
}

// 获取 Skills 映射表（与 builtin_robot_templates 中的 default_skills 完全对齐）
//
// 全部免费 skill（无需付费 API Key）：
//   web_search        → LLM + 公开 HTTP，无 Key
//   copywriter        → 纯 LLM 文本生成，无 Key
//   doc_writer        → 纯 LLM 文档生成，无 Key
//   video_script      → 纯 LLM 脚本创作，无 Key
//   story_outline     → 纯 LLM 故事策划，无 Key
//   novel_writer      → 纯 LLM 小说创作，无 Key
//   comic_script      → 纯 LLM 漫剧剧本，无 Key
//   ppt_generator     → 纯 LLM 大纲/方案生成，无 Key
//   meeting_minutes   → 纯 LLM 会议整理，无 Key
//   excel_analyzer    → Python + LLM 表格分析，无 Key
//   data_analysis     → Python + LLM 数据对比洞察，无 Key
//   document_parser   → LLM 文档解析，无 Key
//   xiaohongshu_copy → 小红书扫码登录自己的账号，无平台 Key
//   xiaohongshu_seo   → 通用 SEO 框架，纯免费
//   xiaohongshu_hashtag → 营销思路库，纯免费
//   product_selector  → LLM 辅助选品决策，纯免费
//
// 以下 skill 需要**付费 API Key**，默认模板中已移除（用户可自行加装）：
//   tushare / stock_news / quant_algo → 需 Tushare Pro / 行情 API Key
//   douyin_content → TikTok 付费预测服务 ¥39/月
//   taobao_api / jd_api → 需平台开放平台 API Key
//   email_writer → 需 SMTP/IMAP 凭证
//   calendar → 需 Google/Outlook OAuth
fn get_skills_map() -> std::collections::HashMap<String, Vec<SkillInfo>> {
    let mut map = std::collections::HashMap::new();

    // ── 电商机器人（robot_ecom_001）───────────────────────────────
    // web_search：热点/热搜/竞品话题公开检索（可选配 Serper 等 Key 提升质量）
    // xiaohongshu_copy：扫码登录小红书账号，无需付费 API Key
    // copywriter + doc_writer：纯 LLM，无需付费接口
    // video_script：短视频/口播脚本，纯 LLM
    // excel_analyzer：带货数据表格，纯 LLM + 预编译 Python
    // data_analysis：数据对比与洞察，纯 LLM + 预编译 Python
    // ppt_generator：活动/投放 Brief，纯 LLM
    map.insert("robot_ecom_001".to_string(), vec![
        SkillInfo {
            id: "web_search".to_string(),
            name: "热点搜索（电商带货）".to_string(),
            description: "检索抖音/小红书热搜词、平台话题榜、竞品爆款笔记与公开带货数据，辅助选题与文案切入角度。纯 HTTP 请求，可选配 Serper/Tavily Key 提升搜索质量。".to_string(),
            license: "MIT".to_string(),
            stars: 3400,
            free: true,
            downloaded: false,
            notice: Some("可在环境变量中配置 SERPER/TAVILY 等 Key 提升搜索质量；不配则走内置多源策略。".to_string()),
        },
        SkillInfo {
            id: "xiaohongshu_copy".to_string(),
            name: "小红书账号操作（扫码登录）".to_string(),
            description: "通过扫码登录小红书账号，发布图文/视频笔记、搜索内容、分析互动数据。无需付费 API Key，使用用户自己的小红书账号。".to_string(),
            license: "MIT".to_string(),
            stars: 980,
            free: true,
            downloaded: false,
            notice: Some("需扫描二维码登录自己的小红书账号，无需付费 API Key".to_string()),
        },
        SkillInfo {
            id: "douyin_script".to_string(),
            name: "抖音/TikTok 脚本工具".to_string(),
            description: "抖音/TikTok 短视频分镜、口播结构、钩子设计与完整脚本；来自 citedy-video-shorts 工具包，免费使用。".to_string(),
            license: "MIT".to_string(),
            stars: 1100,
            free: true,
            downloaded: false,
            notice: Some("基于抖音/TikTok 生态脚本方法论，免费使用，无需付费 API Key".to_string()),
        },
        SkillInfo {
            id: "copywriter".to_string(),
            name: "营销文案生成".to_string(),
            description: "种草图文、带货脚本、直播话术与推广短文案；纯 LLM 生成，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 1350,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "doc_writer".to_string(),
            name: "运营文档写作".to_string(),
            description: "带货方案、运营复盘报告、活动策划案与商品卖点文档；纯 LLM 生成，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 2800,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "video_script".to_string(),
            name: "短视频/口播脚本".to_string(),
            description: "抖音/小红书短视频分镜、口播结构、钩子设计与完整脚本；纯 LLM 创作，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 1100,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "excel_analyzer".to_string(),
            name: "Excel 数据分析".to_string(),
            description: "带货数据（销量/转化/评价）的表格处理、多维度对比与图表生成；纯 Python + LLM，无需付费 API。".to_string(),
            license: "MIT".to_string(),
            stars: 2100,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "data_analysis".to_string(),
            name: "数据对比与洞察".to_string(),
            description: "竞品数据/市场数据的结构化对比、趋势分析与关键指标解读；纯 Python + LLM，无需付费 API。".to_string(),
            license: "MIT".to_string(),
            stars: 2400,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "ppt_generator".to_string(),
            name: "PPT 大纲与方案".to_string(),
            description: "活动策划案、投放 Brief、运营手册的 PPT 结构设计与大纲生成；纯 LLM，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 1890,
            free: true,
            downloaded: false,
            notice: None,
        },
    ]);

    map.insert("robot_ecom_002".to_string(), vec![
        SkillInfo {
            id: "web_search".to_string(),
            name: "热点搜索与竞品调研".to_string(),
            description: "检索淘宝天猫/京东热点、热搜词、竞品动态与公开资讯，支撑选品、活动与店铺运营选题。".to_string(),
            license: "MIT".to_string(),
            stars: 3400,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "copywriter".to_string(),
            name: "营销文案生成".to_string(),
            description: "店铺活动文案、商品卖点、推广脚本与客服话术；纯 LLM，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 1350,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "doc_writer".to_string(),
            name: "运营文档写作".to_string(),
            description: "活动策划案、运营周报、店铺手册与推广方案；纯 LLM，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 2800,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "product_selector".to_string(),
            name: "选品与市场分析".to_string(),
            description: "商品对比、选品评分、市场定位与优先级排序；纯 LLM 辅助选品决策，无需付费 API。".to_string(),
            license: "MIT".to_string(),
            stars: 1700,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "excel_analyzer".to_string(),
            name: "Excel 数据分析".to_string(),
            description: "店铺运营数据（流量/转化/GMV）的表格处理与对比分析；纯 Python + LLM，无需付费 API。".to_string(),
            license: "MIT".to_string(),
            stars: 2100,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "data_analysis".to_string(),
            name: "数据对比与洞察".to_string(),
            description: "多商品/多渠道数据的结构化对比、趋势分析与关键指标解读；纯 Python + LLM，无需付费 API。".to_string(),
            license: "MIT".to_string(),
            stars: 2400,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "ppt_generator".to_string(),
            name: "PPT 大纲与方案".to_string(),
            description: "大促活动方案、投放计划、店铺运营手册的 PPT 结构设计；纯 LLM，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 1890,
            free: true,
            downloaded: false,
            notice: None,
        },
    ]);

    // ── 社交媒体机器人（robot_social_001）──────────────────────────
    // web_search：热点/热搜/话题榜公开检索
    // xiaohongshu_seo / xiaohongshu_hashtag：通用 SEO + 营销思路，纯免费
    // xiaohongshu_copy：扫码登录小红书账号，无需付费 API Key
    // copywriter + doc_writer：纯 LLM 文案/报告
    // excel_analyzer + data_analysis：数据对比与效果分析
    // MCP：browser（网页抓取）、taobao-scraper-mcp（电商数据）、filesystem/fetch/sqlite（免费）
    map.insert("robot_social_001".to_string(), vec![
        SkillInfo {
            id: "web_search".to_string(),
            name: "热点搜索（小红书运营）".to_string(),
            description: "检索小红书平台热点、热搜、话题趋势与竞品爆款笔记，辅助内容选题与追热点节奏。纯 HTTP 请求，可选配 Serper/Tavily Key 提升搜索质量。".to_string(),
            license: "MIT".to_string(),
            stars: 3400,
            free: true,
            downloaded: false,
            notice: Some("可选配置 SERPER/TAVILY 等 Key；不配则使用内置多源与缓存策略。".to_string()),
        },
        SkillInfo {
            id: "xiaohongshu_seo".to_string(),
            name: "SEO 审计与关键词优化".to_string(),
            description: "提供网站/内容 SEO 审计框架与关键词优化思路，适用于所有平台内容搜索优化。纯免费，无需 API Key。".to_string(),
            license: "MIT".to_string(),
            stars: 1200,
            free: true,
            downloaded: false,
            notice: Some("通用 SEO 框架，适用于所有平台内容优化，无需付费 API Key".to_string()),
        },
        SkillInfo {
            id: "xiaohongshu_hashtag".to_string(),
            name: "话题标签与营销策略".to_string(),
            description: "提供话题标签策略与 139 种营销思路，帮助内容选题与账号增长规划。纯免费，无需 API Key。".to_string(),
            license: "MIT".to_string(),
            stars: 980,
            free: true,
            downloaded: false,
            notice: Some("纯营销思路库，无需付费 API Key".to_string()),
        },
        SkillInfo {
            id: "xiaohongshu_copy".to_string(),
            name: "小红书账号操作（扫码登录）".to_string(),
            description: "通过扫码登录小红书账号，发布图文/视频笔记、搜索内容、分析互动数据。无需付费 API Key，使用用户自己的小红书账号。".to_string(),
            license: "MIT".to_string(),
            stars: 980,
            free: true,
            downloaded: false,
            notice: Some("需扫描二维码登录自己的小红书账号，无需付费 API Key".to_string()),
        },
        SkillInfo {
            id: "copywriter".to_string(),
            name: "种草文案生成".to_string(),
            description: "小红书种草笔记、图文文案与互动话术；纯 LLM 生成，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 1350,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "doc_writer".to_string(),
            name: "运营文档写作".to_string(),
            description: "竞品分析报告、运营周报、内容排期表与复盘文档；纯 LLM，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 2800,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "excel_analyzer".to_string(),
            name: "Excel 数据分析".to_string(),
            description: "笔记互动数据（点赞/收藏/评论/转发）的表格处理与效果对比分析；纯 Python + LLM，无需付费 API。".to_string(),
            license: "MIT".to_string(),
            stars: 2100,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "data_analysis".to_string(),
            name: "数据对比与洞察".to_string(),
            description: "多篇笔记/多账号数据的结构化对比、趋势分析与效果归因解读；纯 Python + LLM，无需付费 API。".to_string(),
            license: "MIT".to_string(),
            stars: 2400,
            free: true,
            downloaded: false,
            notice: None,
        },
    ]);

    // ── 社交媒体机器人（robot_social_002 · 抖音内容）──────────────────
    // web_search：热点/热榜检索
    // copywriter：口播/标题文案
    // video_script：短视频分镜/口播脚本
    // doc_writer：系列策划/复盘文档
    // excel_analyzer + data_analysis：竞品数据对比
    // ppt_generator：活动/投放方案
    map.insert("robot_social_002".to_string(), vec![
        SkillInfo {
            id: "web_search".to_string(),
            name: "热点搜索（抖音运营）".to_string(),
            description: "检索抖音/短视频热榜、挑战赛、爆款话题与公开资讯，辅助脚本选题与追热点。纯 HTTP 请求，可选配 Serper/Tavily Key 提升搜索质量。".to_string(),
            license: "MIT".to_string(),
            stars: 3400,
            free: true,
            downloaded: false,
            notice: Some("可选配置 SERPER/TAVILY 等 Key；不配则使用内置多源策略。".to_string()),
        },
        SkillInfo {
            id: "copywriter".to_string(),
            name: "视频文案生成".to_string(),
            description: "视频标题、封面文案、口播话术与互动引导文案；纯 LLM 生成，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 1350,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "video_script".to_string(),
            name: "短视频/口播脚本".to_string(),
            description: "抖音/小红书短视频分镜、口播结构、钩子设计与完整脚本；纯 LLM 创作，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 1100,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "doc_writer".to_string(),
            name: "运营文档写作".to_string(),
            description: "系列栏目策划案、竞品分析报告与投放复盘文档；纯 LLM，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 2800,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "excel_analyzer".to_string(),
            name: "Excel 数据分析".to_string(),
            description: "竞品视频数据（播放/点赞/评论/转发）的表格处理与效果对比分析；纯 Python + LLM，无需付费 API。".to_string(),
            license: "MIT".to_string(),
            stars: 2100,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "data_analysis".to_string(),
            name: "数据对比与洞察".to_string(),
            description: "多视频/多账号数据的结构化对比、趋势分析与效果归因解读；纯 Python + LLM，无需付费 API。".to_string(),
            license: "MIT".to_string(),
            stars: 2400,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "ppt_generator".to_string(),
            name: "PPT 大纲与方案".to_string(),
            description: "系列栏目策划、活动 Brief 与投放复盘报告的 PPT 结构设计；纯 LLM，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 1890,
            free: true,
            downloaded: false,
            notice: None,
        },
    ]);

    // ── 社交媒体机器人（robot_social_003 · 微信公众号）──────────────────
    // web_search / copywriter / doc_writer：纯 LLM，无 Key
    // excel_analyzer / data_analysis：Python + LLM 数据分析
    // browser MCP：抓取竞品公众号文章内容分析
    map.insert("robot_social_003".to_string(), vec![
        SkillInfo {
            id: "web_search".to_string(),
            name: "热点检索（公众号运营）".to_string(),
            description: "检索公众号领域热点、行业动态与竞品爆款文章，辅助选题与内容规划。纯 HTTP 请求，可选配 Serper/Tavily Key 提升搜索质量。".to_string(),
            license: "MIT".to_string(),
            stars: 3400,
            free: true,
            downloaded: false,
            notice: Some("可选配置 SERPER/TAVILY 等 Key；不配则使用内置多源策略。".to_string()),
        },
        SkillInfo {
            id: "copywriter".to_string(),
            name: "公众号文章创作".to_string(),
            description: "公众号选题、标题、正文与结尾引导语；纯 LLM 生成，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 1350,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "doc_writer".to_string(),
            name: "运营文档写作".to_string(),
            description: "运营周报、选题规划、复盘报告与排版方案；纯 LLM，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 2800,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "excel_analyzer".to_string(),
            name: "公众号数据分析".to_string(),
            description: "阅读量/在看/留言等互动数据的表格处理与效果对比分析；纯 Python + LLM，无需付费 API。".to_string(),
            license: "MIT".to_string(),
            stars: 2100,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "data_analysis".to_string(),
            name: "数据对比与洞察".to_string(),
            description: "多篇文章/多账号数据的结构化对比、趋势分析与效果归因解读；纯 Python + LLM，无需付费 API。".to_string(),
            license: "MIT".to_string(),
            stars: 2400,
            free: true,
            downloaded: false,
            notice: None,
        },
    ]);

    // ── 金融股票机器人（A 股）───────────────────────────────────────────
    // 移除：tushare（需Tushare Token）/ stock_news（需行情API）/ quant_algo（需量化平台Key）
    // 替代：web_search + browser（公开页面抓取）+ data_analysis / excel_analyzer / document_parser（数据整理）
    //       copywriter / doc_writer（报告），纯 LLM，无需付费 API
    map.insert("robot_stock_001".to_string(), vec![
        SkillInfo {
            id: "web_search".to_string(),
            name: "公开财经资讯搜索".to_string(),
            description: "检索财经新闻、研报摘要、券商观点与 A 股市场公开信息；纯 HTTP 请求，可选配 Serper/Tavily Key 提升搜索质量。".to_string(),
            license: "MIT".to_string(),
            stars: 3400,
            free: true,
            downloaded: false,
            notice: Some("可选配置 SERPER/TAVILY 等 Key；不配则使用内置多源策略。".to_string()),
        },
        SkillInfo {
            id: "copywriter".to_string(),
            name: "市场观点与报告生成".to_string(),
            description: "市场分析报告、投资观点与资讯摘要；纯 LLM 生成，不构成投资建议，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 1350,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "doc_writer".to_string(),
            name: "文档整理与复盘".to_string(),
            description: "每日复盘、持仓跟踪与资讯摘要文档；纯 LLM 生成，不构成投资建议，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 2800,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "excel_analyzer".to_string(),
            name: "Excel 行情数据分析".to_string(),
            description: "A 股行情数据（估值/财务/技术指标）的表格处理与多维度对比分析；纯 Python + LLM，无需付费 API。".to_string(),
            license: "MIT".to_string(),
            stars: 2100,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "data_analysis".to_string(),
            name: "市场数据对比与洞察".to_string(),
            description: "多股票/多维度数据的结构化对比、趋势分析与关键指标解读；纯 Python + LLM，无需付费 API。".to_string(),
            license: "MIT".to_string(),
            stars: 2400,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "document_parser".to_string(),
            name: "研报/公告文档解析".to_string(),
            description: "解析 PDF 研报、网页长文与公告内容，提取关键数据点与结论；纯 LLM + 文档解析，无需付费 API。".to_string(),
            license: "MIT".to_string(),
            stars: 1500,
            free: true,
            downloaded: false,
            notice: None,
        },
    ]);

    map.insert("robot_stock_002".to_string(), vec![
        SkillInfo {
            id: "web_search".to_string(),
            name: "加密资讯搜索".to_string(),
            description: "检索加密货币新闻、项目动态、交易所公告与链上公开数据；纯 HTTP 请求，可选配 Serper/Tavily Key 提升搜索质量。".to_string(),
            license: "MIT".to_string(),
            stars: 3400,
            free: true,
            downloaded: false,
            notice: Some("可选配置 SERPER/TAVILY 等 Key；不配则使用内置多源策略。".to_string()),
        },
        SkillInfo {
            id: "copywriter".to_string(),
            name: "资讯摘要与观点生成".to_string(),
            description: "加密行情快讯、项目分析与社群情绪摘要；纯 LLM 生成，不构成投资建议，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 1350,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "doc_writer".to_string(),
            name: "持仓记录与复盘文档".to_string(),
            description: "持仓记录、交易日志与定期复盘文档；纯 LLM 生成，不构成投资建议，无需付费接口。".to_string(),
            license: "MIT".to_string(),
            stars: 2800,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "excel_analyzer".to_string(),
            name: "Excel 加密数据分析".to_string(),
            description: "加密货币行情数据（价格/市值/链上指标）的表格处理与多维度对比分析；纯 Python + LLM，无需付费 API。".to_string(),
            license: "MIT".to_string(),
            stars: 2100,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "data_analysis".to_string(),
            name: "市场数据对比与洞察".to_string(),
            description: "多币种/多维度数据的结构化对比、趋势分析与关键指标解读；纯 Python + LLM，无需付费 API。".to_string(),
            license: "MIT".to_string(),
            stars: 2400,
            free: true,
            downloaded: false,
            notice: None,
        },
        SkillInfo {
            id: "document_parser".to_string(),
            name: "白皮书/公告文档解析".to_string(),
            description: "解析项目白皮书、公告与网页长文内容，提取关键数据点与结论；纯 LLM + 文档解析，无需付费 API。".to_string(),
            license: "MIT".to_string(),
            stars: 1500,
            free: true,
            downloaded: false,
            notice: None,
        },
    ]);

    // ── 内容创作机器人 ────────────────────────────────────────────────
    // comic_script / novel_writer / story_outline / video_script / copywriter 均无 Key
    map.insert(
        "robot_content_001".to_string(),
        vec![
            SkillInfo {
                id: "comic_script".to_string(),
                name: "漫剧剧本生成".to_string(),
                description: "分镜头剧本、对白与场景描写".to_string(),
                license: "MIT".to_string(),
                stars: 890,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "novel_writer".to_string(),
                name: "小说创作框架".to_string(),
                description: "小说结构、人物弧光与章节设计".to_string(),
                license: "MIT".to_string(),
                stars: 1560,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "story_outline".to_string(),
                name: "故事大纲生成".to_string(),
                description: "世界观设计、情节走向与大纲规划".to_string(),
                license: "Apache-2.0".to_string(),
                stars: 678,
                free: true,
                downloaded: false,
                notice: None,
            },
        ],
    );

    map.insert(
        "robot_content_002".to_string(),
        vec![
            SkillInfo {
                id: "novel_writer".to_string(),
                name: "小说创作框架".to_string(),
                description: "小说结构、人物弧光与章节设计".to_string(),
                license: "MIT".to_string(),
                stars: 1560,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "story_outline".to_string(),
                name: "故事大纲生成".to_string(),
                description: "世界观设计、情节走向与大纲规划".to_string(),
                license: "Apache-2.0".to_string(),
                stars: 678,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "copywriter".to_string(),
                name: "营销文案生成".to_string(),
                description: "推广文案、书评与读者互动话术".to_string(),
                license: "MIT".to_string(),
                stars: 1350,
                free: true,
                downloaded: false,
                notice: None,
            },
        ],
    );

    // ── 办公效率机器人 ────────────────────────────────────────────────
    // 移除 email_writer/pdf_reader/pdf_edit/word_writer/calendar（需额外凭证或不存在）
    // 保留纯 LLM + 可选 Python skill
    map.insert(
        "robot_office_001".to_string(),
        vec![
            SkillInfo {
                id: "doc_writer".to_string(),
                name: "文档写作".to_string(),
                description: "日报周报、工作总结与汇报文档；纯 LLM 生成，无需付费接口。".to_string(),
                license: "MIT".to_string(),
                stars: 2800,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "meeting_minutes".to_string(),
                name: "会议纪要整理".to_string(),
                description: "自动整理会议要点、决策事项与待办清单；纯 LLM 生成，无需付费接口。".to_string(),
                license: "MIT".to_string(),
                stars: 2100,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "ppt_generator".to_string(),
                name: "PPT大纲生成".to_string(),
                description: "PPT结构设计、内容大纲与演讲稿；纯 LLM 生成，无需付费接口。".to_string(),
                license: "MIT".to_string(),
                stars: 1890,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "excel_analyzer".to_string(),
                name: "Excel 数据分析".to_string(),
                description: "表格数据处理、多维度对比与图表生成；纯 Python + LLM，无需付费 API。".to_string(),
                license: "MIT".to_string(),
                stars: 2100,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "data_analysis".to_string(),
                name: "数据对比与洞察".to_string(),
                description: "多维度数据的结构化对比、趋势分析与关键指标解读；纯 Python + LLM，无需付费 API。".to_string(),
                license: "MIT".to_string(),
                stars: 2400,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "web_search".to_string(),
                name: "热点检索".to_string(),
                description: "公开资讯检索与行业参考搜索；纯 HTTP 请求，可选配 Serper/Tavily Key 提升质量。".to_string(),
                license: "MIT".to_string(),
                stars: 3400,
                free: true,
                downloaded: false,
                notice: Some("可选配置 SERPER/TAVILY 等 Key；不配则使用内置多源策略。".to_string()),
            },
            SkillInfo {
                id: "copywriter".to_string(),
                name: "营销文案生成".to_string(),
                description: "正式文档、通知公告、推广文案的撰写；纯 LLM 生成，无需付费接口。".to_string(),
                license: "MIT".to_string(),
                stars: 1350,
                free: true,
                downloaded: false,
                notice: None,
            },
        ],
    );

    map.insert(
        "robot_office_002".to_string(),
        vec![
            SkillInfo {
                id: "feishu_doc".to_string(),
                name: "飞书文档".to_string(),
                description: "读取与处理飞书云文档（总仓库 skills/feishu-doc）".to_string(),
                license: "MIT".to_string(),
                stars: 1200,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "feishu_doc_collab".to_string(),
                name: "飞书文档协作".to_string(),
                description: "飞书文档协作相关能力（总仓库 skills/feishu-doc-collab）".to_string(),
                license: "MIT".to_string(),
                stars: 800,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "excel_analyzer".to_string(),
                name: "Excel 表格".to_string(),
                description: "表格数据处理（对应总仓库 skills/excel-xlsx）".to_string(),
                license: "MIT".to_string(),
                stars: 2100,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "data_analysis".to_string(),
                name: "数据分析".to_string(),
                description: "数据分析与洞察（总仓库 skills/data-analysis）".to_string(),
                license: "MIT".to_string(),
                stars: 2400,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "document_parser".to_string(),
                name: "文档解析".to_string(),
                description: "解析与提取文档内容（总仓库 skills/document-parser）".to_string(),
                license: "MIT".to_string(),
                stars: 1500,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "internal_comms".to_string(),
                name: "内部沟通".to_string(),
                description: "内部通讯与公告类文稿（总仓库 skills/internal-comms）".to_string(),
                license: "MIT".to_string(),
                stars: 900,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "git_commit".to_string(),
                name: "Git 提交摘要".to_string(),
                description: "基于提交记录整理变更说明（总仓库 skills/git-commit）".to_string(),
                license: "MIT".to_string(),
                stars: 1800,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "doc_writer".to_string(),
                name: "文档写作".to_string(),
                description: "办公文档与写作计划（总仓库 skills/writing-plans）".to_string(),
                license: "MIT".to_string(),
                stars: 2800,
                free: true,
                downloaded: false,
                notice: None,
            },
        ],
    );

    // ── 通用助手 ──────────────────────────────────────────────────────
    // 移除 calendar（需平台日历Key）；全免费 skill
    map.insert(
        "robot_general_001".to_string(),
        vec![
            SkillInfo {
                id: "web_search".to_string(),
                name: "网页搜索".to_string(),
                description: "通用网页搜索，信息查询与资料收集".to_string(),
                license: "MIT".to_string(),
                stars: 3400,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "doc_writer".to_string(),
                name: "文档写作".to_string(),
                description: "各类办公文档、方案与报告".to_string(),
                license: "MIT".to_string(),
                stars: 2800,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "copywriter".to_string(),
                name: "营销文案生成".to_string(),
                description: "日常沟通、推广与对外文档".to_string(),
                license: "MIT".to_string(),
                stars: 1350,
                free: true,
                downloaded: false,
                notice: None,
            },
        ],
    );

    map.insert(
        "robot_general_002".to_string(),
        vec![
            SkillInfo {
                id: "web_search".to_string(),
                name: "网页搜索".to_string(),
                description: "通用网页搜索，FAQ查询与知识库".to_string(),
                license: "MIT".to_string(),
                stars: 3400,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "doc_writer".to_string(),
                name: "文档写作".to_string(),
                description: "客服话术、FAQ文档与标准回复".to_string(),
                license: "MIT".to_string(),
                stars: 2800,
                free: true,
                downloaded: false,
                notice: None,
            },
            SkillInfo {
                id: "copywriter".to_string(),
                name: "营销文案生成".to_string(),
                description: "自动回复模板、引导话术与通知文案".to_string(),
                license: "MIT".to_string(),
                stars: 1350,
                free: true,
                downloaded: false,
                notice: None,
            },
        ],
    );

    map
}

/// 单个 Skill 下载与安装：缓存复制 → GitHub 归档解压 → 失败后自动重试（最多 2 次）。
async fn download_and_install_single_skill(
    app: &AppHandle,
    mono_repo_path: &str,
    mono_branch: &str,
    mono_skills_dir: &Path,
    robot_skills_dir: &Path,
    skill_id: &str,
    stage: &str,
    _data_base: &str,
) -> Result<(), String> {
    let skill_path = robot_skills_dir.join(skill_id);
    let remote_subdir = skills_subdir_in_monorepo(skill_id);

    #[allow(unused_variables)]
    // ── 1. 从本地缓存复制（零网络，若命中则直接成功）──────────────────────
    if let Some(src) = {
        let cache_by_id = mono_skills_dir.join(skill_id);
        let cache_by_remote = mono_skills_dir.join(&remote_subdir);
        if cache_by_id.is_dir() {
            Some(cache_by_id)
        } else if cache_by_remote.is_dir() {
            Some(cache_by_remote)
        } else {
            None
        }
    } {
        let dst = skill_path.clone();
        let r = tokio::task::spawn_blocking(move || copy_dir_all(&src, &dst)).await;
        if matches!(r, Ok(Ok(()))) {
            info!("从缓存复制 skill {} 成功", skill_id);
            return Ok(());
        }
    }

    // ── 2. GitHub 归档解压（镜像自动切换），失败自动重试 1 次 ────────────
    let attempts = 2;
    let mut last_err = String::new();

    for attempt in 0..attempts {
        if attempt > 0 {
            let _ = tokio::fs::remove_dir_all(&skill_path).await;
            let backoff_ms = 500u64.saturating_pow(attempt);
            let wait_for = std::time::Duration::from_millis(backoff_ms);
            let _ = app.emit(
                "install-progress",
                InstallProgressEvent::detail(
                    stage,
                    &format!("第 {} 次重试，等待 {}ms 后…", attempt, backoff_ms),
                ),
            );
            tokio::time::sleep(wait_for).await;
            let _ = app.emit(
                "install-progress",
                InstallProgressEvent::started(
                    stage,
                    &format!("正在安装 skill: {}（第 {} 次尝试）…", skill_id, attempt + 1),
                ),
            );
        } else {
            let _ = app.emit(
                "install-progress",
                InstallProgressEvent::started(
                    stage,
                    &format!("正在安装 skill: {}（HTTPS）…", skill_id),
                ),
            );
        }

        let _ = app.emit(
            "install-progress",
            InstallProgressEvent::detail(
                stage,
                &format!(
                    "下载: {}/archive/{}/.tar.gz → 解压 skills/{}/",
                    mono_repo_path, mono_branch, remote_subdir
                ),
            ),
        );

        let sp = skill_path.clone();
        let mr = mono_repo_path.to_string();
        let mb = mono_branch.to_string();
        let rd = remote_subdir.to_string();
        let st = stage.to_string();
        let app_c = app.clone();

        match fetch_github_monorepo_skill_folder(&mr, &mb, &rd, &sp, &st, &app_c).await {
            Ok(()) => {
                let cache_slot = mono_skills_dir.join(skill_id);
                if !cache_slot.is_dir() {
                    let from = skill_path.clone();
                    let to = cache_slot;
                    let _ = tokio::task::spawn_blocking(move || copy_dir_all(&from, &to)).await;
                }
                return Ok(());
            }
            Err(e) => {
                last_err = e.clone();
                info!("skill {} 第 {} 次尝试失败: {}", skill_id, attempt + 1, e);
            }
        }
    }

    Err(format!(
        "尝试 {} 次后仍失败。末次错误: {}",
        attempts, last_err
    ))
}

// 下载机器人的 Skills：本地 monorepo 缓存（HTTPS + 国内镜像优先）→ 自总仓库归档解压 skills/<id>/（不调用 git）
#[tauri::command]
pub async fn download_skills(
    app: AppHandle,
    data_dir: tauri::State<'_, crate::AppState>,
    robot_id: String,
    skills: Vec<String>,
) -> Result<serde_json::Value, String> {
    info!("开始下载机器人 {} 的 Skills: {:?}", robot_id, skills);

    let data_base = data_dir.inner().data_dir.lock().unwrap().clone();
    let robot_dir = PathBuf::from(&data_base).join("robots").join(&robot_id);
    let robot_skills_dir = robot_dir.join("skills");

    tokio::fs::create_dir_all(&robot_skills_dir)
        .await
        .map_err(|e| format!("创建目录失败: {}", e))?;

    let openclaw_dir = PathBuf::from(&data_base).join("openclaw-cn");

    let skills_branch =
        std::env::var("OPENCLAW_SKILLS_BRANCH").unwrap_or_else(|_| "main".to_string());

    let mono_repo_path = {
        let mono_repo = std::env::var("OPENCLAW_SKILLS_MONO_REPO")
            .unwrap_or_else(|_| "LeoYeAI/openclaw-master-skills".to_string());
        match github_owner_repo_from_url_or_path(&mono_repo) {
            Some(s) if s.contains('/') => s,
            Some(org) => format!("{}/openclaw-master-skills", org),
            None => "LeoYeAI/openclaw-master-skills".to_string(),
        }
    };
    let mono_branch =
        std::env::var("OPENCLAW_SKILLS_MONO_BRANCH").unwrap_or_else(|_| skills_branch.clone());

    // ── 1. monorepo 缓存（HTTPS archive，无 git）。若已存在则复用，避免每次重下 ──
    let mono_root = PathBuf::from(&data_base)
        .join(".cache")
        .join(format!("{}-cache", mono_repo_path.replace('/', "-")));
    let mono_skills_dir = mono_root.join("skills");
    let catalog_ready = mono_skills_dir.is_dir();
    if !catalog_ready {
        let _ = app.emit(
            "install-progress",
            InstallProgressEvent::started(
                "skills-catalog",
                "正在通过 HTTPS 拉取技能总仓库到本地缓存（首次较慢）…",
            ),
        );
        if let Some(parent) = mono_root.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("创建缓存目录失败: {}", e))?;
        }
        if mono_root.exists() {
            let _ = tokio::fs::remove_dir_all(&mono_root).await;
        }
        match fetch_github_repo_tarball_to_dir(
            &mono_repo_path,
            &mono_branch,
            &mono_root,
            "skills-catalog",
            &app,
        )
        .await
        {
            Ok(()) => {
                let _ = app.emit("install-progress", InstallProgressEvent::finished(
                    "skills-catalog",
                    if mono_skills_dir.is_dir() {
                        "技能总仓库缓存就绪"
                    } else {
                        "总仓库已拉取但未发现 skills/ 目录，请确认 OPENCLAW_SKILLS_MONO_REPO 指向正确仓库"
                    },
                ));
            }
            Err(e) => {
                info!("技能总仓库 HTTPS 拉取失败: {}", e);
                let _ = app.emit(
                    "install-progress",
                    InstallProgressEvent::finished(
                        "skills-catalog",
                        &format!("总仓库缓存不可用，将尝试逐个下载: {}", e),
                    ),
                );
            }
        }
    }

    // ── 2. 安装每个 skill ──────────────────────────────────────────────────
    let mut results = Vec::new();
    let mut success_count = 0;
    let mut skip_count = 0;
    let mut fail_count = 0;

    for skill_id in &skills {
        let stage = format!("skill-{}", skill_id);
        let skill_path = robot_skills_dir.join(skill_id);

        // 已有目录 → 跳过（不重复安装）
        if skill_path.is_dir() {
            results.push(serde_json::json!({
                "skill_id": skill_id,
                "status": "skipped",
                "message": "本地已存在，跳过"
            }));
            skip_count += 1;
            continue;
        }

        // ── 下载并安装单个 skill（含失败重试）────────────────────────────────
        let install_result = download_and_install_single_skill(
            &app,
            &mono_repo_path,
            &mono_branch,
            &mono_skills_dir,
            &robot_skills_dir,
            skill_id,
            &stage,
            &data_base,
        )
        .await;

        match install_result {
            Ok(()) => {
                success_count += 1;
                let _ = app.emit(
                    "install-progress",
                    InstallProgressEvent::finished(&stage, &format!("skill {} 安装成功", skill_id)),
                );

                // ── 尝试链接预编译 Python 环境（离线包）────────────────
                if let Some(()) =
                    link_prebuilt_skill_env(skill_id, &skill_path, Path::new(&data_base))
                {
                    let _ = app.emit(
                        "install-progress",
                        InstallProgressEvent::detail(&stage, "已链接预编译 Python 环境"),
                    );
                }

                results.push(serde_json::json!({
                    "skill_id": skill_id,
                    "status": "success",
                    "message": "安装成功"
                }));
            }
            Err(e) => {
                fail_count += 1;
                let _ = app.emit("install-progress", InstallProgressEvent::failed(&stage, &e));
                results.push(serde_json::json!({
                    "skill_id": skill_id,
                    "status": "failed",
                    "message": e
                }));
            }
        }
    }

    // 任一 Skill 未成功则返回 Err，避免前端误报「下载完成」而列表仍显示未下载
    if fail_count > 0 {
        let detail: Vec<String> = results
            .iter()
            .filter_map(|v| {
                let status = v.get("status")?.as_str()?;
                if status == "failed" {
                    let id = v.get("skill_id")?.as_str()?;
                    let msg = v.get("message")?.as_str().unwrap_or("");
                    Some(format!("{} — {}", id, msg))
                } else {
                    None
                }
            })
            .collect();
        return Err(format!(
            "{} 个 Skill 安装失败（需全部成功才显示已下载）。详情：\n{}",
            fail_count,
            detail.join("\n")
        ));
    }

    // ── 3. 注册到 OpenClaw skills.load.extraDirs ──────────────────────────
    if success_count > 0 && openclaw_dir.is_dir() {
        if let Err(e) = add_openclaw_skills_extra_dir(&openclaw_dir, &robot_skills_dir) {
            warn!("更新 openclaw.json extraDirs 失败: {}", e);
        } else {
            info!(
                "已将 {} 注册到 openclaw skills.load.extraDirs",
                robot_skills_dir.display()
            );
        }
    }

    // ── 4. 补全 SOUL.md（人设文件，OpenClaw 运行时读取）
    // ── 5. 写入 robot.json（含 skills 列表，供前端展示）────────────────────
    let robot_json_path = robot_dir.join("robot.json");
    let now = chrono::Utc::now().to_rfc3339();

    // 从内置模板读取 system_prompt；若找不到则用默认提示词
    let system_prompt = get_robot_system_prompt(&robot_id);

    // 写入 SOUL.md（OpenClaw 核心人设文件）
    let soul_path = robot_dir.join("SOUL.md");
    let write_soul = tokio::fs::write(&soul_path, &system_prompt).await;
    if let Err(e) = write_soul {
        warn!("写入 SOUL.md 失败: {}", e);
    } else {
        info!(
            "已写入/更新 {} 的 SOUL.md ({} chars)",
            robot_id,
            system_prompt.len()
        );
    }

    // 收集已成功安装（含 skip）的 skill ids，用于写入 robot.json
    let installed_skills: Vec<String> = results
        .iter()
        .filter_map(|v| {
            let status = v.get("status")?.as_str()?;
            if status == "success" || status == "skipped" {
                v.get("skill_id")?.as_str().map(|s| s.to_string())
            } else {
                None
            }
        })
        .collect();

    let robot = Robot {
        id: robot_id.clone(),
        name: robot_id.clone(),
        category: "本地机器人".to_string(),
        description: "从已安装技能创建的本地机器人".to_string(),
        icon: "🤖".to_string(),
        color: "#6B7280".to_string(),
        skills: installed_skills,
        created_at: now,
    };

    let robot_json = serde_json::to_string_pretty(&robot)
        .map_err(|e| format!("序列化 robot.json 失败: {}", e))?;
    tokio::fs::write(&robot_json_path, robot_json)
        .await
        .map_err(|e| format!("写入 robot.json 失败: {}", e))?;
    info!("已写入 robot.json（skills={} 个）", robot.skills.len());

    Ok(serde_json::json!({
        "success_count": success_count,
        "skip_count": skip_count,
        "fail_count": fail_count,
        "total": skills.len(),
        "results": results
    }))
}

/// 重试下载单个失败的 Skill（由前端「重试」按钮触发）。
/// 返回 "success" | "failed" + message，不抛 Err（避免中断前端流程）。
#[tauri::command]
pub async fn download_skill_retry(
    app: AppHandle,
    data_dir: tauri::State<'_, crate::AppState>,
    robot_id: String,
    skill_id: String,
) -> Result<serde_json::Value, String> {
    info!("重试下载 skill: {} -> robot {}", skill_id, robot_id);

    let data_base = data_dir.inner().data_dir.lock().unwrap().clone();
    let robot_skills_dir = PathBuf::from(&data_base)
        .join("robots")
        .join(&robot_id)
        .join("skills");

    tokio::fs::create_dir_all(&robot_skills_dir)
        .await
        .map_err(|e| format!("创建目录失败: {}", e))?;

    let mono_repo_path = {
        let mono_repo = std::env::var("OPENCLAW_SKILLS_MONO_REPO")
            .unwrap_or_else(|_| "LeoYeAI/openclaw-master-skills".to_string());
        match github_owner_repo_from_url_or_path(&mono_repo) {
            Some(s) if s.contains('/') => s,
            Some(org) => format!("{}/openclaw-master-skills", org),
            None => "LeoYeAI/openclaw-master-skills".to_string(),
        }
    };
    let mono_branch =
        std::env::var("OPENCLAW_SKILLS_MONO_BRANCH").unwrap_or_else(|_| "main".to_string());

    let mono_root = PathBuf::from(&data_base)
        .join(".cache")
        .join(format!("{}-cache", mono_repo_path.replace('/', "-")));
    let mono_skills_dir = mono_root.join("skills");

    let stage = format!("skill-{}-retry", skill_id);

    let result = download_and_install_single_skill(
        &app,
        &mono_repo_path,
        &mono_branch,
        &mono_skills_dir,
        &robot_skills_dir,
        &skill_id,
        &stage,
        &data_base,
    )
    .await;

    match result {
        Ok(()) => {
            let skill_path = robot_skills_dir.join(&skill_id);
            if let Some(()) = link_prebuilt_skill_env(&skill_id, &skill_path, Path::new(&data_base))
            {
                let _ = app.emit(
                    "install-progress",
                    InstallProgressEvent::detail(&stage, "已链接预编译 Python 环境"),
                );
            }
            Ok(serde_json::json!({
                "skill_id": skill_id,
                "status": "success",
                "message": "安装成功"
            }))
        }
        Err(e) => {
            let _ = app.emit("install-progress", InstallProgressEvent::failed(&stage, &e));
            Ok(serde_json::json!({
                "skill_id": skill_id,
                "status": "failed",
                "message": e
            }))
        }
    }
}

// 创建机器人
#[tauri::command]
pub async fn create_robot(
    data_dir: tauri::State<'_, crate::AppState>,
    template_id: String,
    name: String,
    custom_skills: Option<Vec<String>>,
) -> Result<Robot, String> {
    info!("创建机器人: {} from template {}", name, template_id);

    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let robot_dir = format!("{}/robots/{}", data_dir, template_id);

    // 创建机器人目录
    tokio::fs::create_dir_all(&robot_dir)
        .await
        .map_err(|e| format!("创建目录失败: {}", e))?;

    // 从内置模板查找 system_prompt 和 skills 列表
    let system_prompt = get_robot_system_prompt(&template_id);
    let template_skills = get_robot_default_skills(&template_id);

    // 用户若传了 custom_skills 则覆盖默认技能列表
    let skills = custom_skills.unwrap_or(template_skills);

    // ── 关键修复：写入 SOUL.md（OpenClaw 运行时读取人设）────────────────
    let soul_path = format!("{}/SOUL.md", robot_dir);
    tokio::fs::write(&soul_path, &system_prompt)
        .await
        .map_err(|e| format!("写入 SOUL.md 失败: {}", e))?;
    info!(
        "已写入机器人 {} 的 SOUL.md ({} chars)",
        template_id,
        system_prompt.len()
    );

    let now = chrono::Utc::now().to_rfc3339();

    let robot = Robot {
        id: template_id.clone(),
        name,
        category: "自定义机器人".to_string(),
        description: "".to_string(),
        icon: "🤖".to_string(),
        color: "#3B82F6".to_string(),
        skills,
        created_at: now,
    };

    // 写入 robot.json（供 list_robots 读取）
    let config_path = format!("{}/robot.json", robot_dir);
    let robot_json =
        serde_json::to_string_pretty(&robot).map_err(|e| format!("序列化机器人配置失败: {}", e))?;
    tokio::fs::write(&config_path, robot_json)
        .await
        .map_err(|e| format!("写入 robot.json 失败: {}", e))?;

    Ok(robot)
}

/// 若 `robots/{id}` 与内置商店模板 id 一致，用模板名称/分类/图标等覆盖展示字段，与「机器人商店」列表同步。
/// 同时补充 skills 列表（若 robot.json 中为空，则从模板继承）。
fn merge_robot_with_builtin_template(mut robot: Robot) -> Robot {
    if let Some(t) = builtin_robot_templates()
        .into_iter()
        .find(|x| x.id == robot.id)
    {
        robot.name = t.name;
        robot.category = t.category;
        robot.description = t.description;
        robot.icon = t.icon;
        robot.color = t.color;
        // 若 robot.json 中的 skills 为空，补充模板的默认技能列表
        if robot.skills.is_empty() {
            robot.skills = t.default_skills;
        }
    }
    robot
}

// 列出所有机器人
#[tauri::command]
pub async fn list_robots(
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<Vec<Robot>, String> {
    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let robots_dir = format!("{}/robots", data_dir);

    let mut robots = Vec::new();

    let entries = std::fs::read_dir(&robots_dir).map_err(|e| format!("读取目录失败: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let robot_id = path.file_name().unwrap().to_string_lossy().to_string();

            // 优先读 robot.json
            let config_path = format!("{}/{}/robot.json", robots_dir, robot_id);
            if let Ok(content) = tokio::fs::read_to_string(&config_path).await {
                if let Ok(robot) = serde_json::from_str::<Robot>(&content) {
                    robots.push(merge_robot_with_builtin_template(robot));
                    continue;
                }
            }

            // 无 robot.json 但有 skills 子目录 → 占位；若 id 匹配内置模板则与商店同名展示
            let skills_path = format!("{}/{}/skills", robots_dir, robot_id);
            if std::path::Path::new(&skills_path).is_dir() {
                let now = chrono::Utc::now().to_rfc3339();
                let placeholder = Robot {
                    id: robot_id.clone(),
                    name: robot_id.clone(),
                    category: "本地机器人".to_string(),
                    description: "从已安装技能创建的本地机器人".to_string(),
                    icon: "🤖".to_string(),
                    color: "#6B7280".to_string(),
                    skills: vec![],
                    created_at: now,
                };
                robots.push(merge_robot_with_builtin_template(placeholder));
            }
        }
    }

    Ok(robots)
}
