//! 安装包内置的 Node / MinGit 压缩包路径解析（离线优先）。
//!
//! 策略优先级（从高到低）：
//! 1. 项目源码内置：`CARGO_MANIFEST_DIR/bundled-env/<file>`
//!    （打包后仍可用 exe 同级 bundled-env/、resources/bundled-env/ 等路径回退）
//! 2. exe 同级 `bundled-env/<file>`（NSIS/MSI 常用）
//! 3. exe 同级 `resources/bundled-env/<file>`
//! 4. exe 同级 `../bundled-env/<file>`
//! 5. Resource 协议（Tauri 打包资源路径）
//!
//! 不再联网下载；若所有路径均未命中，返回 None 并由调用方决定如何处理。

use std::path::PathBuf;
use tauri::{path::BaseDirectory, AppHandle, Manager};

/// 内置 zip 在打包资源中的相对路径前缀（与 `tauri.conf.json` 的 resources 一致）
pub const BUNDLED_SUBDIR: &str = "bundled-env";
/// 内置 openclaw-cn 包 zip 的资源子目录
pub const BUNDLED_OPENCLAW_SUBDIR: &str = "bundled-openclaw";
/// 内置 openclaw-cn 包 zip 文件名（由构建脚本在 build 时产出）
pub const BUNDLED_OPENCLAW_TARBALL: &str = "openclaw-cn.tgz";
/// 内置 chrome-extension tgz 的资源子目录（与 tauri.conf.json resources 一致）
pub const BUNDLED_CHROME_EXTENSION_SUBDIR: &str = "plugins";
/// 内置 chrome-extension tgz 文件名
pub const BUNDLED_CHROME_EXTENSION_ZIP: &str = "chrome-extension.tgz";

/// 从项目源码目录解析内置 zip（优先级最高）。
/// 用于：exe 开发调试阶段、用户手动将 zip 放入 src-tauri/bundled-env。
pub fn resolve_bundled_zip_from_project(filename: &str) -> Option<PathBuf> {
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(BUNDLED_SUBDIR)
        .join(filename);
    if dev_path.is_file() {
        tracing::info!("内置 zip（项目目录）: {}", dev_path.display());
        return Some(dev_path);
    }
    None
}

/// 解析内置 zip，按优先级尝试以下路径：
/// 1. 项目源码内置：`CARGO_MANIFEST_DIR/bundled-env/<file>`
/// 2. exe 同级（生产）
/// 3. Resource 协议（Tauri 打包资源路径）
///
/// **离线优先**：所有路径均未命中时返回 None，**不再联网下载**。
pub fn resolve_bundled_zip(app: &AppHandle, filename: &str) -> Option<PathBuf> {
    // 1. 项目源码内置（优先级最高，调试和手动放置 zip 场景）
    if let Some(p) = resolve_bundled_zip_from_project(filename) {
        return Some(p);
    }

    // 2. exe 同级（生产）
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidates = [
                dir.join(BUNDLED_SUBDIR).join(filename),
                dir.join("resources").join(BUNDLED_SUBDIR).join(filename),
                dir.join("..").join(BUNDLED_SUBDIR).join(filename),
            ];
            for p in &candidates {
                if p.is_file() {
                    tracing::debug!("内置 zip（exe 同级）: {}", p.display());
                    return Some(p.clone());
                }
            }
        }
    }

    // 3. Resource 协议（生产安装包）
    let rel = format!("{}/{}", BUNDLED_SUBDIR, filename);
    if let Ok(p) = app.path().resolve(&rel, BaseDirectory::Resource) {
        if p.is_file() {
            tracing::debug!("内置 zip（Resource）: {}", p.display());
            return Some(p);
        }
    }

    None
}

/// 解析内置 openclaw-cn npm tarball（tgz）的路径，优先级：
/// 1. 项目源码 `bundled-openclaw/openclaw-cn.tgz`（开发者调试 / 手动放置）
/// 2. exe 同级 `bundled-openclaw/openclaw-cn.tgz`
/// 3. Resource 协议 `bundled-openclaw/openclaw-cn.tgz`
///
/// 若存在，说明安装包已内置预下载的 openclaw-cn 包，可跳过 registry 网络拉包。
pub fn resolve_bundled_openclaw_tarball(app: &AppHandle) -> Option<PathBuf> {
    let filename = BUNDLED_OPENCLAW_TARBALL;

    // 1. 项目源码内置（调试 / 手动放置）
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(BUNDLED_OPENCLAW_SUBDIR)
        .join(filename);
    if dev_path.is_file() {
        tracing::info!(
            "内置 openclaw-cn tarball（项目目录）: {}",
            dev_path.display()
        );
        return Some(dev_path);
    }

    // 2. exe 同级（生产安装包）
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidates = [
                dir.join(BUNDLED_OPENCLAW_SUBDIR).join(filename),
                dir.join("resources")
                    .join(BUNDLED_OPENCLAW_SUBDIR)
                    .join(filename),
            ];
            for p in &candidates {
                if p.is_file() {
                    tracing::info!("内置 openclaw-cn tarball（exe 同级）: {}", p.display());
                    return Some(p.clone());
                }
            }
        }
    }

    // 3. Resource 协议
    let rel = format!("{}/{}", BUNDLED_OPENCLAW_SUBDIR, filename);
    if let Ok(p) = app.path().resolve(&rel, BaseDirectory::Resource) {
        if p.is_file() {
            tracing::info!("内置 openclaw-cn tarball（Resource）: {}", p.display());
            return Some(p);
        }
    }

    None
}

/// 内置通道插件 tgz 的资源子目录（与 tauri.conf.json resources 一致）
pub const BUNDLED_PLUGINS_SUBDIR: &str = "plugins";

/// 解析内置通道插件 tgz 的路径，按优先级：
/// 1. 项目源码 `resources/plugins/<plugin-id>.tgz`（开发者调试 / 手动放置）
/// 2. exe 同级 `resources/plugins/<plugin-id>.tgz`（NSIS/MSI 安装包）
/// 3. Resource 协议（Tauri 打包资源路径）
pub fn resolve_bundled_plugin_tgz(app: &AppHandle, plugin_id: &str) -> Option<PathBuf> {
    let filename = format!("{}.tgz", plugin_id);

    // 1. 项目源码（调试 / 手动放置）
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(BUNDLED_PLUGINS_SUBDIR)
        .join(&filename);
    if dev_path.is_file() {
        tracing::info!("内置插件包（项目目录）: {}", dev_path.display());
        return Some(dev_path);
    }

    // 2. exe 同级（生产安装包）
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidates = [
                dir.join("resources")
                    .join(BUNDLED_PLUGINS_SUBDIR)
                    .join(&filename),
                dir.join(BUNDLED_PLUGINS_SUBDIR).join(&filename),
            ];
            for p in &candidates {
                if p.is_file() {
                    tracing::info!("内置插件包（exe 同级）: {}", p.display());
                    return Some(p.clone());
                }
            }
        }
    }

    // 3. Resource 协议
    let rel = format!("{}/{}", BUNDLED_PLUGINS_SUBDIR, filename);
    if let Ok(p) = app.path().resolve(&rel, BaseDirectory::Resource) {
        if p.is_file() {
            tracing::info!("内置插件包（Resource）: {}", p.display());
            return Some(p);
        }
    }

    None
}

/// 解析内置 chrome-extension tgz（含图标已生成的 chrome-extension 打包）。
/// 策略与 resolve_bundled_plugin_tgz 一致：项目源码 → exe 同级 → Resource 协议。
pub fn resolve_bundled_chrome_extension_zip(app: &AppHandle) -> Option<PathBuf> {
    let filename = BUNDLED_CHROME_EXTENSION_ZIP;

    // 1. 项目源码（调试 / 手动放置）
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(BUNDLED_CHROME_EXTENSION_SUBDIR)
        .join(filename);
    if dev_path.is_file() {
        tracing::info!("内置 chrome-extension（项目目录）: {}", dev_path.display());
        return Some(dev_path);
    }

    // 2. exe 同级（生产安装包）
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidates = [
                dir.join("resources")
                    .join(BUNDLED_CHROME_EXTENSION_SUBDIR)
                    .join(filename),
                dir.join(BUNDLED_CHROME_EXTENSION_SUBDIR).join(filename),
            ];
            for p in &candidates {
                if p.is_file() {
                    tracing::info!("内置 chrome-extension（exe 同级）: {}", p.display());
                    return Some(p.clone());
                }
            }
        }
    }

    // 3. Resource 协议
    let rel = format!("{}/{}", BUNDLED_CHROME_EXTENSION_SUBDIR, filename);
    if let Ok(p) = app.path().resolve(&rel, BaseDirectory::Resource) {
        if p.is_file() {
            tracing::debug!("内置 chrome-extension（Resource）: {}", p.display());
            return Some(p);
        }
    }

    None
}
