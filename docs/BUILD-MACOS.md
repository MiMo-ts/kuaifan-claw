# OpenClaw-CN Manager — macOS 打包指南

> 本项目使用 [Tauri 2](https://v2.tauri.app/) 构建，默认在 Windows 环境下开发和打包。本文档说明如何在 macOS（Intel / Apple Silicon）上编译并生成 `.app` / `.dmg` / `.pkg` 安装包。

---

## 一、环境准备

### 1.1 必需工具

| 工具 | 版本要求 | 安装方式 |
|------|---------|---------|
| **Rust** | ≥ 1.75 | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **Node.js** | ≥ 18 | [官网下载](https://nodejs.org/) 或 `brew install node` |
| **npm** | ≥ 9 | 随 Node.js 一同安装 |
| **Xcode Command Line Tools** | 最新 | `xcode-select --install` |
| **Xcode**（可选，仅签名打包时需要） | ≥ 15 | App Store |

安装 Rust 后确认目标平台已安装：

```bash
rustup target add aarch64-apple-darwin   # Apple Silicon
rustup target add x86_64-apple-darwin    # Intel Mac
rustup show                             # 确认 active targets
```

### 1.2 同步项目到 Mac

将 `d:\ORD` 整个仓库复制到 Mac 上，建议通过 Git 同步：

```bash
git clone <your-repo-url> openclaw-cn-manager
cd openclaw-cn-manager
```

> **注意**：请确认 Git LFS 已正确处理大文件（`bundled-env/` 和 `bundled-openclaw/` 目录下的二进制包）。

---

## 二、安装前端依赖

```bash
cd web
npm install
cd ..
```

> 如果 `npm install` 报错，尝试清除缓存后重试：
> ```bash
> npm cache clean --force
> npm install
> ```

---

## 三、下载 macOS 版内置资源包（关键步骤）

release 打包要求内置资源文件已就位。Windows 版使用的是 `.zip` 包（Node.js Windows 版 + MinGit for Windows），**macOS 版需要使用对应的 `.tar.gz` 包**。

### 3.1 创建目录并下载

```bash
# 在 src-tauri 目录下创建 macOS 专用目录
mkdir -p src-tauri/bundled-env

# 下载 Node.js v22.14.0 for macOS（Apple Silicon / Intel 通用 tar.gz）
curl -L "https://nodejs.org/dist/v22.14.0/node-v22.14.0-darwin-x64.tar.gz" \
  -o src-tauri/bundled-env/node-v22.14.0-darwin-x64.tar.gz

# 下载 MinGit for macOS（使用 Git for Windows 的 tar.gz 版本，macOS 可解压使用）
curl -L "https://github.com/git-for-windows/git/releases/download/v2.53.0.windows.3/MinGit-2.53.0.64-bit.tar.bz2" \
  -o src-tauri/bundled-env/MinGit-2.53.0-64-bit.tar.bz2
```

> 如果 Git for Windows 的 tar.gz 下载缓慢，可使用 Homebrew 安装 Git 后自行打包：
> ```bash
> brew install git
> tar -cjf src-tauri/bundled-env/MinGit-2.53.0-64-bit.tar.bz2 \
>    "$(brew --prefix)/mingw64"  # 路径可能有差异，视安装情况调整
> ```

> `openclaw-cn.tgz` 是跨平台的 npm 包，无需替换。

### 3.2 验证文件存在

```bash
ls -lh src-tauri/bundled-env/
# 应看到:
#   node-v22.14.0-darwin-x64.tar.gz
#   MinGit-2.53.0-64-bit.tar.bz2
#   openclaw-cn.tgz          （已从 Windows 端同步过来）

ls -lh src-tauri/bundled-openclaw/
# 应看到:
#   openclaw-cn.tgz
```

### 3.3 配置 Tauri 打包资源（macOS Bundle）

当前 `tauri.conf.json` 的 `bundle.resources` 指向的是 Windows 版资源路径。macOS 打包时 Tauri 会自动把 `resources` 数组里的文件复制进 `.app`，因此需要确保路径正确。

如果你的应用运行时代码能根据 `cfg(target_os)` 自动选择正确文件名（`node-v22.14.0-win-x64.zip` vs `node-v22.14.0-darwin-x64.tar.gz`），**只需将上述 macOS 文件下载到 `bundled-env/` 目录即可**，因为 Rust 代码中读取的是文件名而非路径前缀。

如果 Rust 运行时代码中写死了 Windows 特定路径，请参考 [六、常见问题](#六常见问题) 中的说明进行修改。

---

## 四、修改 tauri.conf.json（macOS 目标平台配置）

`bundle.targets` 当前只包含 `["nsis", "msi"]`（Windows）。打包 macOS 需要加上 Darwin 目标，并移除 Windows 专属配置。

### 4.1 备份原配置

```bash
cp src-tauri/tauri.conf.json src-tauri/tauri.conf.json.bak.win
```

### 4.2 修改配置

编辑 `src-tauri/tauri.conf.json`，做以下两处修改：

**修改 1：bundle.targets（加入 macOS）**

将：

```json
"targets": ["nsis", "msi"],
```

改为：

```json
"targets": ["nsis", "msi", "dmg", "app", "appimage"],
```

> Tauri 2 macOS 可用目标：`dmg`（安装包）、`app`（绿色 .app）、`pkg`（macOS 安装程序）。本项目目前只需要 `dmg` 和 `app`。

**修改 2：resources（确保 macOS 资源路径正确）**

确保 `resources` 数组包含 macOS 可用的资源。如果 Rust 运行时已按 OS 选择文件名，确保 `bundled-env/` 目录下有 macOS 版文件即可，无需修改此数组。

**修改 3：添加 macOS 专属字段（可选，用于签名）**

在 `bundle` 下添加：

```json
"macOS": {
  "minimumSystemVersion": "10.15",
  "entitlements": null
}
```

> 如果没有 Apple 开发者签名，首次打包会出现"签名无效"警告，不影响功能，可正常安装运行。

---

## 五、执行打包

### 5.1 方式一：使用 npm 脚本（推荐）

```bash
cd web
npm run tauri:build
```

如果 `tauri:build` 脚本中使用了 Windows 路径分隔符（`\`），需要先修正为 macOS 兼容路径。检查 `web/package.json` 中的 `tauri:build` 脚本：

当前内容（Windows）：

```json
"tauri:build": "node ..\\scripts\\kill-manager-before-dev.cjs && cd ..\\src-tauri && node ..\\web\\node_modules\\@tauri-apps\\cli\\tauri.js build"
```

改为（macOS）：

```json
"tauri:build": "cd ../src-tauri && node ../web/node_modules/@tauri-apps/cli/tauri.js build"
```

> `kill-manager-before-dev.cjs` 是 Windows 专用脚本（用于关闭已运行的 Manager），macOS 不需要。

### 5.2 方式二：直接调用 Tauri CLI

```bash
cd src-tauri

# 清理旧构建（建议首次在 Mac 上构建时执行）
cargo clean

# 构建（自动包含 dmg + app 产物）
cargo build --release --target aarch64-apple-darwin   # Apple Silicon
# 或
cargo build --release --target x86_64-apple-darwin     # Intel Mac
```

或使用 Tauri CLI 统一处理：

```bash
cd web
node ../web/node_modules/@tauri-apps/cli/tauri.js build
```

### 5.3 等待构建完成

首次构建需要编译所有 Rust 依赖，预计 **10–20 分钟**（视网络和 CPU 而定）。后续增量构建约 2–3 分钟。

---

## 六、构建产物

macOS 打包产物位于 `src-tauri/target/release/bundle/` 目录下：

```
src-tauri/target/release/bundle/
├── dmg/
│   └── OpenClaw-CN Manager_1.0.1_aarch64.dmg    # macOS 安装包（Apple Silicon）
│   └── OpenClaw-CN Manager_1.0.1_x64.dmg         # macOS 安装包（Intel）
├── app/
│   └── OpenClaw-CN Manager.app                  # 绿色 .app 目录
└── pkg/                                          # （如果 target 包含 pkg）
    └── OpenClaw-CN Manager_1.0.1_aarch64.pkg
```

| 产物类型 | 说明 | 分发建议 |
|---------|------|---------|
| `.dmg` | 磁盘镜像，双击后拖入 Applications 即可安装 | 推荐分发 |
| `.app` | 绿色应用目录，直接运行 | 临时测试用 |
| `.pkg` | 标准 macOS 安装程序，支持企业部署 | 需签名后才正式可用 |

---

## 七、运行与验证

### 7.1 运行 .app

```bash
open src-tauri/target/release/bundle/app/OpenClaw-CN\ Manager.app
```

或双击 Finder 中的 `.dmg` 文件挂载后拖入 Applications。

### 7.2 验证功能

- [ ] 应用正常启动，显示主窗口
- [ ] 托盘图标正常显示
- [ ] 内置 Node.js 版本检测正常
- [ ] 内置 MinGit 版本检测正常

---

## 八、常见问题

### Q1: 打包时报 `error: missing expected keyword 'cfg'`

**原因**：`build.rs` 中的 `#[cfg(windows)]` 属性语法不兼容 Rust 旧版本。

**解决**：更新 Rust 后重试：

```bash
rustup update
rustup target add aarch64-apple-darwin
```

### Q2: macOS 提示"无法打开，因为来自未识别的开发者"

**解决**：依次执行：

```bash
# 方式一：单次放行
xattr -rd com.apple.quarantine "/Applications/OpenClaw-CN Manager.app"

# 方式二：系统设置永久放行
# 系统设置 → 隐私与安全性 → 安全性 → 仍要打开
```

### Q3: Rust 运行时找不到 macOS 版 Node.js

**原因**：`src-tauri/src/` 中的资源解析代码可能写死了 Windows 特定文件名。

**解决**：检查 `bundled_env.rs`（或对应文件）中的路径解析逻辑，添加 `#[cfg(target_os = "darwin")]` 分支：

```rust
#[cfg(target_os = "windows")]
fn node_bundle_name() -> &'static str {
    "node-v22.14.0-win-x64.zip"
}

#[cfg(target_os = "darwin")]
fn node_bundle_name() -> &'static str {
    "node-v22.14.0-darwin-x64.tar.gz"
}
```

### Q4: 首次构建非常慢（编译依赖）

**正常现象**。Tauri 和 Rust 生态依赖较多，首次编译需要从源码构建所有依赖。可以在 Cargo 镜像加速：

在 `~/.cargo/config.toml` 中添加（使用中科大镜像）：

```toml
[source.crates-io]
replace-with = "ustc"

[source.ustc]
registry = "sparse+https://mirrors.ustc.edu.cn/crates.io-index/"
```

### Q5: Apple Silicon Mac 打包后，在 Intel Mac 上无法运行

**正常现象**。交叉编译 macOS 需要 `cross` 工具：

```bash
cargo install cross
cross build --release --target aarch64-apple-darwin   # M1/M2/M3
cross build --release --target x86_64-apple-darwin     # Intel
```

---

## 九、快速参考（完整流程）

```bash
# 1. 安装 Xcode CLI
xcode-select --install

# 2. 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add aarch64-apple-darwin

# 3. 同步项目
git clone <your-repo> openclaw-cn-manager
cd openclaw-cn-manager

# 4. 安装前端依赖
cd web && npm install && cd ..

# 5. 下载 macOS 资源包
mkdir -p src-tauri/bundled-env
curl -L "https://nodejs.org/dist/v22.14.0/node-v22.14.0-darwin-x64.tar.gz" \
  -o src-tauri/bundled-env/node-v22.14.0-darwin-x64.tar.gz

# 6. 修改 tauri.conf.json（targets 加入 dmg/app，修正 windows 专属配置）
# 参考本文档"四、修改 tauri.conf.json"

# 7. 修正 web/package.json 中的 tauri:build 脚本路径

# 8. 执行打包
cd web
npm run tauri:build

# 9. 产出位于 src-tauri/target/release/bundle/dmg/
```

---

## 十、持续构建建议

### 10.1 GitHub Actions 自动 macOS 打包

在 `.github/workflows/` 中添加 macOS job：

```yaml
macos-build:
  runs-on: macos-latest
  steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@stable
      with:
        targets: aarch64-apple-darwin
    - name: Install Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '22'
    - name: Install Rust dependencies
      run: cargo fetch
      working-directory: src-tauri
    - name: Build Tauri app
      run: npm run tauri:build
      working-directory: web
    - name: Upload dmg artifact
      uses: actions/upload-artifact@v4
      with:
        name: openclaw-cn-manager-macos
        path: src-tauri/target/release/bundle/dmg/*.dmg
```

### 10.2 签名与公证（正式分发）

要绕过"来自未识别的开发者"警告并正式分发，需要：

1. 注册 [Apple Developer Program](https://developer.apple.com/programs/)（年费 $99）
2. 在 Xcode 中配置签名证书
3. 执行公证：

```bash
# 创建临时凭证（开发测试用）
xcrun notarytool store-credentials \
  "AC_PASSWORD" \
  --apple-id "your@email.com" \
  --password "app-specific-password" \
  --team-id "YOUR_TEAM_ID"

# 打包后公证 dmg
xcrun notarytool submit \
  "OpenClaw-CN Manager_1.0.1_aarch64.dmg" \
  --keychain-profile "AC_PASSWORD"
```
