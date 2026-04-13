# 快泛claw 发布操作指南

本文档说明如何构建、打包和发布 快泛claw。

---

## 一、核心概念：exe 与 data 目录的关系

运行时数据目录（`data_dir`）= **exe 所在目录**下的 `data/`。

```
src-tauri/target/debug/kuaifan-claw.exe
  └── data/                        ← dev 环境数据（配置/机器人/openclaw-cn）

src-tauri/target/release/kuaifan-claw.exe
  └── data/                        ← release 构建数据

安装到 C:\Program Files\快泛claw\
  └── data/                        ← 用户环境数据
```

因此：
- 不同 exe 路径 → 不同 `data/` → 不同的实例/配置/安装状态
- 切换 exe 路径后，"实例"和"OpenClaw 安装"看起来是空的，因为各自指向不同的 `data/` 目录

> **最佳实践**：始终使用同一个 exe 路径来运行应用，避免数据分散。

---

## 二、双轨发布模式

本项目采用**快速补丁 + 正式发版**双轨模式：

| | 快速补丁 | 正式安装包 |
|---|---|---|
| **触发时机** | 日常 bugfix、热修 | 大版本、功能发布 |
| **发布频率** | 可每天多次 | 建议 1-2 周一次 |
| **包大小** | ~20MB（单个 exe） | ~4.6MB（压缩后 installer） |
| **打包耗时** | ~30-60 秒 | ~2-5 分钟 |
| **用户操作** | 覆盖 exe 文件 | 运行安装程序 |
| **适合用户** | 技术用户、内测用户 | 普通用户 |

---

## 三、模式一：快速补丁（Hot Patch）

### 适用场景

- Bug 修复当天上线
- 内测灰度发布
- 紧急热修（生产问题不过夜）
- 前端 UI 改动，不需要完整安装包

### 构建步骤

**Step 1：确认改动范围**

| 改动类型 | 打包范围 |
|---|---|
| Rust 后端逻辑（gateway/instance/robot 等） | 仅 exe |
| 前端 UI（React/Vue 组件） | exe + 前端重新构建 |
| 两者都改了 | 完整重新构建（推荐） |

> **更安全的做法**：无论改了什么，每次都跑完整构建（Step 2），前端资源已内置到 exe 里，用户只需替换一个文件。

**Step 2：完整构建**

```powershell
# 方式 A：使用 npm 脚本（推荐）
cd d:\ORD\web
npm run tauri:build

# 方式 B：手动分步
cd d:\ORD\src-tauri
cargo build --release
# 然后需要更新前端时，再在 web/ 目录执行
npm run build
```

**Step 3：提取补丁包**

```powershell
# 构建完成后，从 release 目录取出 exe
copy "d:\ORD\src-tauri\target\release\kuaifan-claw.exe" "d:\ORD\patch-v1.0.2\"
```

**Step 4：交付**

将 `patch-v1.0.2/kuaifan-claw.exe` 发给用户。

**Step 5：用户侧应用补丁**

```
下载 patch-v1.0.2.zip → 解压 → 覆盖原 exe → 完成
```

> `data/` 目录完全不动，用户的配置、机器人、openclaw-cn 全保留。

---

## 四、模式二：正式发版（Official Release）

### 适用场景

- 版本大更新（新增功能）
- 正式版本发布
- 需要干净安装体验
- 企业 MSI 分发（域部署）

### 构建步骤

**Step 1：代码冻结，完整构建**

```powershell
cd d:\ORD\web
npm run tauri:build
```

耗时约 2-5 分钟（Rust 编译 + 前端构建 + NSIS 打包）。

**Step 2：确认输出物**

```
src-tauri/target/release/bundle/
├── nsis/
│   └── 快泛claw_1.0.0_x64-setup.exe    ← 分发给普通用户
└── msi/
    └── 快泛claw_1.0.0_x64_en-US.msi    ← 企业域部署用
```

原始 exe 也在：

```
src-tauri/target/release/kuaifan-claw.exe
```

**Step 3：交付**

- **普通用户**：分发 `快泛claw_1.0.0_x64-setup.exe`，用户双击运行，一路下一步
- **企业用户**：分发 `.msi` 文件，通过 SCCM/Intune 域推送
- **便携版**：将 `kuaifan-claw.exe` + 空 `data/` 打成 ZIP

---

## 五、便携版 ZIP 制作（离线/内网分发）

适合 U 盘携带、无法访问外网的机器。

### 方式 A：空 data 目录（首次运行引导安装）

适用于目标机器**能联网**，用户可在向导中完成 OpenClaw-CN 安装。

```powershell
mkdir "d:\ORD\portable-v1.0.0"
copy "d:\ORD\src-tauri\target\release\kuaifan-claw.exe" "d:\ORD\portable-v1.0.0\"
# data/ 目录会在首次运行时自动创建
```

交付：`portable-v1.0.0/` 整体打成 ZIP，用户解压后双击 exe，首次运行点"安装向导"即可。

### 方式 B：预装完整 data 目录（完全离线）

适用于目标机器**无法联网**，需要把已配置好的环境完整打包。

```powershell
# 用已安装好 openclaw-cn 的环境（dev 或其他机器），直接复制 data
xcopy /E /I /Y "d:\ORD\src-tauri\target\debug\data" "d:\ORD\portable-v1.0.0-full\data\"
copy "d:\ORD\src-tauri\target\release\kuaifan-claw.exe" "d:\ORD\portable-v1.0.0-full\"
```

交付：完整 data 目录 + exe，打成 ZIP，用户解压后双击 exe，直接启动网关，无需再运行安装向导。

### 便携版目录结构

```
portable-v1.0.0/
├── kuaifan-claw.exe      ← 主程序
├── start.bat                    ← 可选：启动脚本（参考仓库根目录 start.bat）
└── data/                        ← 用户数据（首次运行自动创建；预装版已包含全部内容）
    ├── config/                  ← 配置文件（app.yaml, models.yaml, ...）
    ├── instances/               ← 实例数据
    ├── logs/                    ← 日志文件
    ├── openclaw-cn/             ← OpenClaw-CN 运行时（预装版已包含）
    ├── plugins/                 ← 聊天插件
    ├── robots/                  ← 机器人模板及 Skills
    └── env/                     ← 自包含 Node.js / Git（预装版已包含）
```

---

## 六、日常开发工作流

日常开发**不需要关心打包**，使用 `dev.bat` 直接热重载开发：

```
dev.bat → npm run tauri:dev → Rust 热重载 + 前端 HMR → 秒级看效果
```

详细说明见 `README.md` 第二章「快速开始」。

---

## 七、版本号管理

当前版本定义在 `src-tauri/Cargo.toml`：

```toml
[package]
name = "kuaifan-claw"
version = "1.0.0"
```

发布新版本时手动更新此数字，同步更新：

- `src-tauri/Cargo.toml` → `version`
- `src-tauri/tauri.conf.json` → `version`
- `README.md` → 底部的"版本"和"构建日期"
- `RELEASE.md`（本文档）→ 更新日志

---

## 八、打包产物一览

| 产物 | 路径 | 用途 | 大小 |
|------|------|------|------|
| 原始 exe | `src-tauri/target/release/kuaifan-claw.exe` | 便携补丁/直接分发 | ~20MB |
| NSIS 安装包 | `src-tauri/target/release/bundle/nsis/*.exe` | 普通用户分发 | ~4.6MB |
| MSI 安装包 | `src-tauri/target/release/bundle/msi/*.msi` | 企业域部署 | ~5MB |

---

## 九、常见问题

**Q: 快速补丁和正式安装包哪个先发？**
A: 建议先发快速补丁给核心用户/内测验证，再发正式安装包。

**Q: 只改了前端，要完整构建吗？**
A: 是的，Tauri 的前端资源在构建时打包进 exe，`npm run tauri:build` 会重新编译前端并重新打包 exe。只改前端也必须完整构建。

**Q: 便携版能直接覆盖安装版的数据吗？**
A: 不能。安装版的 exe 在 `Program Files\`，对应 `data/` 也在那里。便携版 exe 在其他路径，`data/` 在同级目录，两者数据隔离。切换方式时需要迁移数据目录。

**Q: 如何给便携版预装 openclaw-cn？**
A: 用已安装好的机器，将 `data/openclaw-cn/` 整个目录复制到打包目录即可。具体见「方式 B：预装完整 data 目录」。

**Q: 如何彻底清理 dev 环境重新开始？**
A: 删除 `src-tauri/target/debug/data/` 整个目录，重启 `dev.bat` 即可重新走安装向导。

---

*最后更新：2026-03-26*
