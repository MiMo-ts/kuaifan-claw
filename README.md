# 快泛 Claw v1.0.0

## 一、项目概述

快泛 Claw（原 OpenClaw-CN Manager）是一个基于 Tauri 2.x + React 18 的桌面自动化管理工具，用于安装和管理 OpenClaw-CN，支持多平台编译和自动更新。

### 核心特性

- **零基础友好**：点击即用，全程向导，无需手动配置
- **高可移植性**：绿色免安装，整个目录复制即可迁移
- **轻量化**：安装包约 18MB（对比 Electron 的 200MB+）
- **零依赖**：运行时无需额外安装 Node.js、Python 等（自带 Rust 运行时）
- **自动更新**：支持应用和 OpenClaw-CN 的自动更新
- **多平台支持**：支持 Windows、macOS、Linux 三端编译
- **代理后端**：内置代理后端服务，提供邀请码验证等功能
- **独立浏览器**：默认使用独立浏览器（clawd），无需 Chrome 扩展
- **GitHub Actions**：支持 CI/CD 自动化构建

## 二、快速开始

### 启动方式（已打包的发行目录）

`start.bat` 用于**已生成可执行文件**的目录。在仓库根目录双击时会自动回退查找 `src-tauri\target\release\` 和 `src-tauri\target\debug\` 下的构建产物；均无则提示「找不到文件」并给出开发指引。

- **Windows**：双击 `start.bat`
- **macOS / Linux**：在发行目录中直接运行打包产物（如 `openclaw-cn-manager`），或按你方安装包提供的启动方式

**日常开发请使用 `dev.bat`**，不要在仓库根目录期望 `start.bat` 能直接工作（除非已执行过构建）。

### 开发调试（源码，未打包）

三端流程一致：**在 `web` 目录执行 Tauri 开发命令**，会编译 Rust 并打开带热更新的桌面窗口。

**环境要求（各平台）**

- [Node.js](https://nodejs.org/) LTS（建议 18+）
- [Rust](https://rustup.rs/)（`rustup` 安装 stable）
- **Windows**：WebView2（Win10/11 通常已自带）
- **macOS**：Xcode Command Line Tools
- **Linux**：按 [Tauri 文档](https://v2.tauri.app/start/prerequisites/) 安装系统依赖（如 WebKitGTK 等）

**命令（Win / macOS / Linux 相同）**

前端在 `web/`、Tauri 配置在 `src-tauri/`。Tauri CLI 要求**当前工作目录**下能识别到 `tauri.conf.json`（一般在 `src-tauri/`），因此勿在 `web` 里直接运行无参数的 `tauri dev`。请**在 `web` 目录**使用已写好的脚本（内部会进入 `src-tauri` 并调用 `web` 中的 CLI）：

```bash
cd web
npm install
npm run tauri:dev
```

**Windows 命令提示符 (CMD) 必看**：若你当前在 **C:** 盘（例如 `C:\Users\Administrator`），只输入 `cd d:\ORD\web` **不会**把「当前目录」切到 D 盘，后面的 `npm` 仍会在 C 盘用户目录找 `package.json`，从而报 `ENOENT` / 找不到 `package.json`。请任选其一：

- 使用 **`cd /d d:\ORD\web`** 再执行 `npm install`、`npm run tauri:dev`
- 或先输入 **`d:`**，再 **`cd \ORD\web`**
- 或直接双击项目根目录的 **`dev.bat`**（脚本内已用 `cd /d`，可避免此问题）

打包同理：在真正位于 `web` 的当前目录下执行 `npm run tauri:build`；若在 CMD 里从 C 盘一条命令写完，请用 `cd /d d:\ORD\web && npm run tauri:build`。

**一键脚本（可选）**

- Windows：双击项目根目录 `dev.bat`（失败时会 `pause`，避免窗口一闪而过）
- macOS / Linux：在项目根目录执行 `chmod +x dev.sh && ./dev.sh`

### 打包发行（生成可分发的程序）

在 `web` 目录执行：

```bash
npm run tauri:build
```

产物在 `src-tauri/target/release/`（或 `bundle/` 下的安装包，视 `tauri.conf` 配置而定）。将生成的可执行文件与 `start.bat`（Windows）或等价启动方式一起放入发行目录即可。

> **详细发布操作流程（快速补丁 / 正式发版 / 便携版）见 [`RELEASE.md`](RELEASE.md)。日常开发用 `dev.bat`，发布给用户时才需要打包。

### 首次使用向导（6 步）

1. **环境检测** - 自动检测 Node.js、Git、npm、pnpm、网络、磁盘空间；**macOS 另检测 Homebrew**（便于使用向导内基于 brew 的安装路径）
2. **安装 OpenClaw-CN** - 下载并安装核心程序
3. **聊天插件配置** - 选择钉钉/飞书/企业微信/微信ClawBot/Telegram/QQ等
4. **大模型配置** - 配置 AI 模型 API Key（含 30+ 款免费模型）
5. **机器人商店** - 选择预设机器人，自动下载免费 Skills
6. **创建实例** - 将机器人绑定到聊天通道，完成配置

### 数据目录、磁盘检测与安装位置说明

- **为什么以前像「在扫 C 盘」？** 旧版磁盘检测写死为 C: 盘剩余空间。现已改为检测 **本程序 `data` 目录所在磁盘分区** 的可用空间（与 exe 同盘，把程序放在 D 盘即按 D 盘计算）。
- **数据跟「项目源码在哪」还是跟「程序在哪」？** 运行时的数据目录是 **`可执行文件所在目录` 下的 `data/`，不是 Git 仓库根目录**。开发时 exe 在 `src-tauri/target/debug/`，数据会在该目录旁；发行包则应与 `openclaw-cn-manager.exe` 同级出现 `data/`。
- **统一管理文件（本管理器）**：`data/config/` 下多份 YAML，与仓库内 `data/config/` 模板对应，例如 `app.yaml`（应用/网关/代理等）、`models.yaml`、`plugins.yaml`、`instances.yaml`、`robots.yaml`。没有单一「一个文件管全部」，而是按模块分文件。
- **OpenClaw-CN 本体**：由向导通过 `npm install openclaw-cn` 安装到 **`data/openclaw-cn/`**（相对上述 exe 旁 `data`）。下载源由 `NPM_CONFIG_REGISTRY` 环境变量或用户 `.npmrc` 决定，默认从 npm 官方（`registry.npmjs.org`）拉取；国内用户可在 npm 配置（如 `npm config set registry https://registry.npmmirror.com`）或环境变量中设置镜像 registry，无需额外配置即可工作。
- **Node / Git**：通过向导「一键安装」或官方安装包安装时，默认进入系统目录（如 Windows 的 `Program Files\nodejs`、`Program Files\Git`），由 **PATH** 供本管理器与子进程调用，**不会**装进 `data/openclaw-cn`。
- **改配置分工**：**管理器里**向导/设置页保存的内容 → 写 **`data/config/*.yaml`**；**OpenClaw-CN 服务自身** 的通道、环境变量等 → 在 **`data/openclaw-cn/`** 内按该项目要求修改（两者可能互相关联，以各自文档为准）。

环境检测页提供 **「一键安装缺失组件」**：

- **macOS**：Homebrew → Node.js → Git → pnpm，按此顺序自动串行安装
- **Windows**：Node.js → Git → pnpm
- **Linux**：Node.js（via nodesource）→ Git（apt）→ pnpm

一键安装会在向导页逐步输出日志，若中途弹出 UAC 请允许；完成后建议关闭管理器再打开（刷新 PATH），再点「重新检测」验证。

### 启动后功能

- **首页**：网关状态监控、实例管理、快捷入口
- **机器人商店**：创建和管理机器人
- **聊天插件**：管理聊天平台连接
- **模型配置**：管理 AI 模型供应商
- **配置备份**：一键备份/恢复所有配置
- **设置**：自动更新开关、主题、代理等

## 三、大模型支持

### 推荐免费模型（OpenRouter）

| 模型 | 评分 | 特点 |
|------|------|------|
| Gemini 2.0 Flash Thinking | ★★★★★ | 推理能力最强 |
| DeepSeek V3 | ★★★★★ | 国产最强免费 |
| Claude 3.5 Haiku | ★★★★☆ | Claude 性价比 |
| Llama 3.3 70B | ★★★★☆ | 最大参数开源 |
| Qwen 2.5 72B | ★★★☆☆ | 阿里开源 |

### 国内模型

| 供应商 | 代表模型 | 文档 |
|--------|----------|------|
| 小米 MiMo | MiLM-7B 搜索版/对话版/12B | [官方文档](https://platform.xiaomimimo.com) |
| 百度文心 | ERNIE 4.0 / Lite | - |
| 阿里通义 | Qwen 2.5 / VL | - |
| 腾讯混元 | Hunyuan Pro/Lite | - |
| 字节豆包 | Doubao Pro/Lite | - |
| 讯飞星火 | Spark 4.0 / Lite | - |
| 智谱 GLM | GLM-4 Plus / Flash | - |
| Kimi | Moonshot V1 128K | - |

### 国际模型

OpenAI GPT-4o / Claude 3.7 / Google Gemini 2.5 / DeepSeek / Ollama 本地模型等

## 四、机器人与 Skills

### 预置机器人模板

- **电商机器人**：抖音/小红书带货助手、淘宝天猫运营、选品分析
- **社交媒体机器人**：小红书运营、抖音内容创作、公众号助手
- **金融股票机器人**：A股量化、数字货币监控、基金分析
- **内容创作机器人**：漫剧剧本、小说创作、短视频脚本
- **办公效率机器人**：日报周报、PPT大纲、会议纪要、Excel分析
- **开发者机器人**：代码审查、文档生成、DevOps
- **通用助手**：私人秘书、智能客服、问答助手

### Skills 选择策略

- **免费优先**：自动过滤付费 Skills
- **星级排序**：按 GitHub Stars 降序排列
- **无替代提示**：无免费 Skills 时提示但不阻塞流程

### Skills 在线下载（打包到新设备）

向导「下载免费 Skills」通过 **HTTPS** 下载 GitHub `archive/refs/heads/<branch>.tar.gz` 并解压（**不调用 git**，避免 Git Credential Manager 弹窗），流程如下：

1. **技能总仓库**：默认从 `LeoYeAI/openclaw-master-skills`（339+ 社区技能，HTTPS archive）拉取归档缓存。下载顺序默认**官方 GitHub 优先**；若需镜像优先，设置环境变量 `OPENCLAW_GITHUB_ARCHIVE_MIRROR_FIRST=1`；还可通过 **`OPENCLAW_GITHUB_MIRROR_PREFIXES`**（逗号分隔的前缀 URL）追加自有加速源。
2. **逐个 skill**：优先从缓存 `skills/<id>/` 复制；若未命中，则从总仓库归档中仅解压对应 `skills/<id>/`。
3. **注册到 OpenClaw**：安装成功后，将机器人 skills 目录写入 `openclaw-cn/openclaw.json` 的 `skills.load.extraDirs`，下次 OpenClaw 启动即可加载。
4. **离线/内网**：将总仓库 fork 到可达的地址并设置 `OPENCLAW_SKILLS_MONO_REPO`；或手动将目录放进 `data/.cache/<repo>-cache/skills/<id>/`。

> **注意**：向导里的技能 ID（如 `douyin_content`）与社区仓库里文件夹名（多为 kebab-case，如 `tiktok-viral-predictor`）不一致时，程序会按内置表映射后再从 `skills/<映射名>/` 拉取；未映射的 id 会尝试将下划线改为连字符。若仍失败，可 fork 仓库并自建 `skills/<你的 id>/`，或改 `OPENCLAW_SKILLS_MONO_REPO`。

依赖：**能访问 GitHub 官方或配置的镜像前缀**。**无需**为技能下载单独安装 Git。

## 五、聊天平台支持

| 平台 | 接入方式 | 备注 |
|------|----------|------|
| 钉钉 | 企业内部应用 | AppKey + AppSecret |
| 飞书 | 企业自建应用 | AppID + AppSecret |
| 企业微信 | 企业自建应用 | CorpID + CorpSecret |
| 微信 ClawBot | 协议接入 | **非公众号**，扫码授权 |
| Telegram | Bot API | Bot Token |
| QQ | 机器人协议 | AppID + AppSecret |
| WhatsApp | Business API | Phone ID + Token |
| Discord | Bot API | Bot Token |

## 六、目录结构

```
bin/                          # 可执行文件目录（可迁移）
├── openclaw-cn-manager.exe  # 主程序
├── config/                   # 配置文件
│   ├── app.yaml             # 程序配置
│   ├── models.yaml           # 模型配置
│   ├── robots.yaml           # 机器人配置
│   ├── instances.yaml        # 实例配置
│   └── plugins.yaml         # 插件配置
├── data/                     # 用户数据
│   ├── backups/             # 备份文件
│   ├── instances/           # 实例数据
│   └── logs/               # 日志文件
├── web/                      # 前端资源
└── start.bat               # 启动脚本
```

## 七、配置文件说明

### app.yaml - 程序配置

```yaml
version: "1.0.0"
app:
  data_dir: "./data"
  log_level: "INFO"
updates:
  check_app_updates: false     # 默认关闭
  check_openclaw_updates: false
  check_skills_updates: false
appearance:
  theme: "system"
  color: "#3B82F6"
```

### models.yaml - 模型配置

支持 20+ 供应商，预置 150+ 模型，配置 API Key 后可用。

### skills-repos.yaml - Skills 索引

每个机器人的 Skills 仓库映射，按 Stars 降序排列。

## 八、自动更新（默认关闭）

在「设置」页面可手动开启：

- 程序自动更新检查
- OpenClaw-CN 自动更新检查
- Skills 更新提示（仅提示，不自动更新）

## 九、备份与恢复

- **重要操作前自动备份**（默认开启）
- **一键备份**：将所有配置打包为 ZIP
- **恢复**：选择备份文件，一键还原
- **迁移**：复制整个 `bin/` 目录即可迁移

## 十、Token 用量统计

本应用提供 Token 用量仪表盘，记录本管理端发起的 API 调用用量：

- **统计来源**：仅统计本管理端发起的调用（如「测试连接」），便于监控模型供应商消耗
- **访问入口**：首页快捷入口「Token 用量」
- **全量消耗**：实际对话消耗请查看各模型供应商的控制台

## 十一、技术栈与数据目录说明

应用数据根目录为 **可执行文件所在目录下的 `data/`**（见 `src-tauri/src/main.rs`）。向导安装页会调用 `get_data_dir` 显示完整路径。

本工具下载/安装的所有内容（Git、Node.js、OpenClaw-CN 仓库、插件等）均存放在 `data/` 下，**与系统自带环境路径无关**：

| 下载内容 | 存放路径 |
|---------|---------|
| OpenClaw-CN 仓库 | `{exe_dir}/data/openclaw-cn/` |
| 插件 | `{exe_dir}/data/plugins/{pluginId}/` |
| Robot 模板 | `{exe_dir}/data/robots/{robotId}/` |
| Node.js（自包含模式） | `{exe_dir}/data/env/node-win-x64/` |
| Git for Windows（自包含模式） | `{exe_dir}/data/env/git-win/` |
| 应用配置（实例/模型等） | `{exe_dir}/data/config/` |
| 应用日志 | `{exe_dir}/data/logs/` |
| 备份文件 | `{exe_dir}/data/backups/` |
| Token 用量记录 | `{exe_dir}/data/metrics/` |

> `exe_dir` 为可执行文件所在目录。开发模式下即 `src-tauri/target/debug/` 或 `release/`。配置/日志等与系统 PATH 中的 Node/Git 完全隔离。

| 层级 | 技术 |
|------|------|
| 框架 | Tauri 2.x |
| 前端 | React 18 + TypeScript |
| UI | TailwindCSS + shadcn/ui 风格 |
| 状态管理 | Zustand |
| 后端 | Rust |
| 打包体积 | ~18MB（不含 WebView2） |

## 十二、常见问题

**Q: 程序打不开？**
A: 确保已安装 WebView2 运行时（Windows 10/11 通常自带）

**Q: 如何迁移到其他电脑？**
A: 复制整个 `bin/` 目录即可，所有配置和数据都在其中

**Q: OpenClaw-CN 仓库、插件、配置等存在哪里？**
A: 与可执行文件同目录下的 `data/`（开发模式示例：`src-tauri/target/debug/data/`）。其中 **OpenClaw-CN** 在 `data/openclaw-cn/`，插件在 `data/plugins/`，配置在 `data/config/`。这些路径与系统自带的 Node、Git 无关。

**Q: 通过本工具安装的 Node.js / Git 装在哪里？**
A: Windows 下走官方安装包：`Node` 为 MSI 静默安装到系统目录（如 `Program Files\nodejs`）；`Git` 为官方 exe 静默安装到系统目录（如 `Program Files\Git`）。安装包会先下载到系统**临时目录**再执行。若机器上已有 Node/Git，环境检测会使用 PATH 中的版本，不一定经过上述目录。

**Q: 怎么查看日志？**
A: 日志文件在 `data/logs/app.log`

**Q: 如何重置？**
A: 删除 `data/` 目录，重新启动程序即可

**Q: 微信 ClawBot 在哪安装？**
A: 在向导「聊天插件」步骤中，点击微信 ClawBot 卡片的展开按钮，复制 CLI 命令后在终端执行，按提示扫码授权即可。Windows/Linux/macOS 命令完全相同。

---

## 十二、代理后端服务

### 功能
- **邀请码验证**：验证用户邀请码的有效性
- **用户管理**：管理系统用户
- **统计分析**：提供使用统计数据

### 启动方式
```bash
cd agent-backend/backend
npm install
npm start
```

### API 端点
- POST `/api/invite-codes/validate` - 验证邀请码
- GET `/api/invite-codes/test/:code` - 测试邀请码
- POST `/api/auth/login` - 用户登录
- GET `/api/stats` - 获取统计数据

## 十三、更新服务

### 功能
- **版本检查**：检查应用和 OpenClaw-CN 的新版本
- **更新下载**：下载并安装更新包

### 配置
配置文件：`update-service/config/versionConfig.js`

### 启动方式
```bash
cd update-service
npm install
npm start
```

## 十四、GitHub Actions 自动化构建

### 功能
- **多平台编译**：自动为 Windows、macOS、Linux 构建安装包
- **持续集成**：代码推送或 PR 时自动触发构建
- **构建产物**：自动上传构建产物供下载

### 配置
配置文件：`.github/workflows/build.yml`

### 触发方式
- **自动触发**：推送代码到 main 分支或创建 PR 时
- **手动触发**：在 GitHub Actions 页面点击 "Run workflow" 按钮

### 构建产物
- Windows: `.msi` 安装包
- macOS: `.app` 应用程序
- Linux: `.deb` 安装包

---

**版本**: v1.0.0
**构建日期**: 2026-04-13
