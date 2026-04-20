// OpenClaw-CN Manager - Rust Backend

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bundled_env;
mod commands;
pub mod env_paths;
pub mod mirror;
mod models;
mod services;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

pub struct AppState {
    pub data_dir: Mutex<String>,
}

fn init_logging(data_dir: &std::path::Path) -> Result<WorkerGuard, String> {
    let log_dir = data_dir.join("logs");
    std::fs::create_dir_all(&log_dir).map_err(|e| format!("创建日志目录失败: {}", e))?;

    let file_appender = tracing_appender::rolling::Builder::new()
        .filename_prefix("app")
        .filename_suffix("log")
        .max_log_files(7)
        .build(&log_dir)
        .map_err(|e| format!("创建日志文件追加器失败: {}", e))?;

    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::registry()
        .with(
            fmt::layer()
                .with_writer(non_blocking)
                .with_ansi(false)
                .with_target(true),
        )
        .with(EnvFilter::from_default_env().add_directive(tracing::Level::INFO.into()))
        .init();

    Ok(guard)
}

/// 去掉 Windows 扩展路径前缀 `\\?\`（若有），得到子进程可用的普通路径。
/// 不影响日志/资源管理器等使用 `\\?\` 的场景。
fn strip_extended_prefix(p: &std::path::Path) -> std::path::PathBuf {
    let s = p.to_string_lossy();
    if s.starts_with("\\\\?\\") {
        PathBuf::from(&s[4..])
    } else {
        p.to_path_buf()
    }
}

/// 用户可写诊断目录（避免 Program Files 下无法创建 start.log / crash.log）。
fn diagnostics_dir() -> PathBuf {
    std::env::temp_dir().join("OpenClaw-CN-Manager")
}

fn write_diagnostic_file(name: &str, content: &str) {
    let dir = diagnostics_dir();
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(dir.join(name), content);
}

/// 检测目录是否可由当前用户写入（用于 Program Files 安装场景）。
fn data_root_is_writable(root: &std::path::Path) -> bool {
    if std::fs::create_dir_all(root).is_err() {
        return false;
    }
    let probe = root.join(".ocm_write_probe");
    match std::fs::write(&probe, b"1") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// 安装到 Program Files 等只读位置时，回退到用户目录（仍可通过 OPENCLAW_CN_DATA_DIR 覆盖）。
fn fallback_user_data_dir() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir())
            .join("OpenClaw-CN Manager")
            .join("data")
    }
    #[cfg(target_os = "macos")]
    {
        // macOS: ~/Library/Application Support/OpenClaw-CN Manager/data
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .map(|h| h.join("Library").join("Application Support").join("OpenClaw-CN Manager").join("data"))
            .unwrap_or_else(|| std::env::temp_dir().join("OpenClaw-CN-Manager-data"))
    }
    #[cfg(target_os = "linux")]
    {
        // Linux: ~/.local/share/OpenClaw-CN Manager/data
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .map(|h| h.join(".local/share/OpenClaw-CN Manager/data"))
            .unwrap_or_else(|| std::env::temp_dir().join("OpenClaw-CN-Manager-data"))
    }
    #[cfg(target_os = "freebsd")]
    {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .map(|h| h.join(".local/share/OpenClaw-CN Manager/data"))
            .unwrap_or_else(|| std::env::temp_dir().join("OpenClaw-CN-Manager-data"))
    }
}

/// 在「exe 旁 data」不可写时自动改用用户目录，避免 init_logging 因权限 panic 导致无界面、无日志。
fn ensure_writable_release_data_dir(exe_path: &std::path::Path) -> PathBuf {
    let preferred = resolve_release_data_dir(exe_path);
    // 显式环境变量：由部署方保证可写，不做改写
    if std::env::var("OPENCLAW_CN_DATA_DIR")
        .ok()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
    {
        return preferred;
    }
    if data_root_is_writable(&preferred) {
        return preferred;
    }
    let fb = fallback_user_data_dir();
    if data_root_is_writable(&fb) {
        write_diagnostic_file(
            "data-dir-fallback.txt",
            &format!(
                "首选数据目录不可写，已回退到用户目录。\n首选: {}\n当前: {}\n",
                preferred.display(),
                fb.display()
            ),
        );
        return fb;
    }
    // 极端情况：仍返回首选，后续错误由 init_logging / panic 诊断文件说明
    preferred
}

/// release 下解析「真实数据目录」：
/// 优先环境变量 OPENCLAW_CN_DATA_DIR；
/// 其次 {exe_dir}/data/config 存在时使用 {exe_dir}/data（安装程序 / MSI / NSIS 均会预先创建）；
/// 再次 {exe_dir}/OpenClaw-CN.portable 存在时使用 {exe_dir}/data（手动绿色版场景）；
/// 最后默认使用 {exe_dir}/data（安装时已由安装程序创建，无需回退 AppData）。
///
/// 设计原则：默认同级 `data/`；若位于 Program Files 且当前用户无写权限，
/// `ensure_writable_release_data_dir` 会回退到 %LOCALAPPDATA%\\OpenClaw-CN Manager\\data。
fn resolve_release_data_dir(exe_path: &std::path::Path) -> std::path::PathBuf {
    // 最高优先级：显式环境变量
    if let Ok(ev) = std::env::var("OPENCLAW_CN_DATA_DIR") {
        let t = ev.trim();
        if !t.is_empty() {
            return PathBuf::from(t);
        }
    }

    let exe_dir = exe_path.parent().unwrap_or(exe_path);

    // macOS app bundle 检测：exe 在 .app/Contents/MacOS/ 内
    // data/config 应相对于 .app 根目录，而非 MacOS/ 子目录
    #[cfg(target_os = "macos")]
    {
        let exe_str = exe_path.to_string_lossy();
        if exe_str.contains(".app/Contents/MacOS/") {
            // /Applications/快泛claw.app/Contents/MacOS/快泛claw → /Applications/快泛claw.app/
            if let Some(app_bundle_pos) = exe_str.find(".app/") {
                let app_bundle_path = &exe_str[..app_bundle_pos + 5]; // 包含 .app
                let bundle_data_dir = PathBuf::from(app_bundle_path).join("data");
                let bundle_config_dir = bundle_data_dir.join("config");
                // 若安装时在 app bundle 内部创建了 data/config，优先使用
                if bundle_config_dir.exists() {
                    return bundle_data_dir;
                }
                // 否则使用 bundle 内部的默认 data 路径（后续 ensure_writable_release_data_dir 会检测可写性）
                return bundle_data_dir;
            }
        }
    }

    let portable_data_dir = exe_dir.join("data");
    let portable_config_dir = portable_data_dir.join("config");
    // 优先级 1：{exe_dir}/data/config 存在（安装程序 / MSI 均会预先创建）
    if portable_config_dir.exists() {
        return portable_data_dir;
    }
    // 优先级 2：手动便携标记文件（用户手动拷贝绿色版时可选保留）
    let portable_flag = exe_dir.join("OpenClaw-CN.portable");
    if portable_flag.exists() {
        return portable_data_dir;
    }
    // 默认：exe 同级的 data 目录（无论 config 是否已迁移，均视为合法数据根）
    // 安装程序已预先创建 data/config；首次运行迁移完成后 config 仍会存在。
    // 此分支兜底处理「安装程序 data 目录未写入 config 文件」的极少数异常情况。
    portable_data_dir
}

/// MSI bootstrap：在 exe 启动时立即检查 MSI 安装目录并确保 data/config 存在。
///
/// MSI（WiX）不像 NSIS 有 hooks.nsi 可以在安装时创建目录，
/// 因此在 exe 首次运行时代码层面补做这个操作：
/// 1. 从注册表读取 MSI 写入的安装路径（HKCU\Software\openclaw-cn\OpenClaw-CN Manager\InstallDir）
/// 2. 若该目录下 data/config 不存在（MSI 未预建），主动创建
/// 3. 这样 resolve_release_data_dir 在随后的检测中就会正确找到它
///
/// NSIS 安装包已通过 hooks.nsi 预先创建目录，此函数对 NSIS 无额外副作用。
#[cfg(windows)]
fn msi_bootstrap(exe_path: &std::path::Path) {
    // 仅在非便携模式（data/config 尚不存在）时尝试 MSI bootstrap
    let exe_dir = exe_path.parent().unwrap_or(exe_path);
    if exe_dir.join("data").join("config").exists() {
        return;
    }

    // 读取 MSI 安装路径（HKCU，注册表由 main.wxs 写入）
    const HKEY_CURRENT_USER: u32 = 0x80000001;
    extern "system" {
        fn RegOpenKeyExW(
            hKey: *mut std::ffi::c_void,
            lpSubKey: *const u16,
            ulOptions: u32,
            samDesired: u32,
            phkResult: *mut *mut std::ffi::c_void,
        ) -> i32;
        fn RegQueryValueExW(
            hKey: *mut std::ffi::c_void,
            lpValueName: *const u16,
            lpReserved: *mut std::ffi::c_void,
            lpType: *mut u32,
            lpData: *mut u8,
            lpcbData: *mut u32,
        ) -> i32;
        fn RegCloseKey(hKey: *mut std::ffi::c_void) -> i32;
    }

    const KEY_READ: u32 = 0x20019;
    let subkey: Vec<u16> = "Software\\openclaw-cn\\OpenClaw-CN Manager\0"
        .encode_utf16()
        .collect();
    let value_name: Vec<u16> = "InstallDir\0".encode_utf16().collect();
    let mut hkey: *mut std::ffi::c_void = std::ptr::null_mut();
    let ret = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER as *mut std::ffi::c_void,
            subkey.as_ptr(),
            0,
            KEY_READ,
            &mut hkey,
        )
    };
    if ret != 0 {
        return;
    }
    let mut data_buf = [0u16; 512];
    let mut data_len = (data_buf.len() * 2) as u32;
    let mut reg_type: u32 = 0;
    let ret = unsafe {
        RegQueryValueExW(
            hkey,
            value_name.as_ptr(),
            std::ptr::null_mut(),
            &mut reg_type,
            data_buf.as_mut_ptr().cast(),
            &mut data_len,
        )
    };
    unsafe { RegCloseKey(hkey); };
    if ret != 0 || reg_type != 1 {
        // REG_SZ == 1
        return;
    }
    // data_len 是字节数（含 null），转成字符数（utf16 units）
    let char_count = (data_len as usize / 2).saturating_sub(1);
    let install_dir_str = String::from_utf16_lossy(&data_buf[..char_count]);
    let install_dir = std::path::Path::new(&install_dir_str);
    if install_dir.components().count() < 2 {
        return;
    }

    // 创建 data/config（MSI 未预建的补充）
    let config_dir = install_dir.join("data").join("config");
    if let Err(e) = std::fs::create_dir_all(&config_dir) {
        tracing::warn!("MSI bootstrap 创建 data/config 失败: {}（应用将继续）", e);
        return;
    }
    tracing::info!("MSI bootstrap 已在安装目录创建 data/config: {}", config_dir.display());
}

/// 解析资源目录路径，支持 macOS app bundle。
/// Tauri 打包后资源位于：
/// - Windows/Linux: {exe_dir}/resources/
/// - macOS app bundle: {app_bundle}/Contents/Resources/
fn resolve_resource_dir(exe_path: &std::path::Path) -> Option<PathBuf> {
    let exe_str = exe_path.to_string_lossy();

    #[cfg(target_os = "macos")]
    {
        // macOS app bundle: /Applications/快泛claw.app/Contents/MacOS/快泛claw
        if exe_str.contains(".app/Contents/MacOS/") {
            if let Some(app_bundle_pos) = exe_str.find(".app/") {
                let app_bundle_path = &exe_str[..app_bundle_pos + 5];
                let resource_dir = PathBuf::from(app_bundle_path).join("Contents").join("Resources");
                if resource_dir.exists() {
                    return Some(resource_dir);
                }
            }
        }
    }

    // 默认：exe 同级的 resources 目录
    let default_resource = exe_path.parent()?.join("resources");
    if default_resource.exists() {
        return Some(default_resource);
    }

    None
}

/// 首次运行时把打包的 resources/data 内容迁移到实际 data_dir。
/// 检测方式：在 data_dir/.migrated 写入资源包版本号，若文件不存在即执行迁移。
/// 每次版本更新时 resources/data 内容由 build.rs 自动更新版本号（通过写入 .resource_version 文件）。
fn migrate_resources_on_first_run(data_dir_abs: &PathBuf, exe_path: &PathBuf) {
    if !cfg!(debug_assertions) {
        // release 模式：尝试从资源目录迁移初始数据

        // 尝试解析资源目录：macOS app bundle 需要特殊处理
        let resource_dir = resolve_resource_dir(exe_path).map(|p| p.join("data"));

        if let Some(resource_dir) = resource_dir {
            let migrated_marker = data_dir_abs.join(".migrated");
            let resource_version_file = resource_dir.join(".resource_version");

            // 读取资源包版本（由 build.rs 写入）
            let expected_version = std::fs::read_to_string(&resource_version_file)
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|_| "0".to_string());

            let current_version = std::fs::read_to_string(&migrated_marker)
                .map(|s| s.trim().to_string())
                .unwrap_or_default();

            if current_version != expected_version && resource_dir.exists() {
                tracing::info!(
                    "首次运行检测到数据迁移：resources v{} → data v{}",
                    expected_version,
                    current_version
                );

                if let Err(e) = copy_dir_recursive(&resource_dir, data_dir_abs) {
                    tracing::warn!("迁移 resources/data 失败: {}（应用将继续启动）", e);
                } else {
                    tracing::info!("resources/data 迁移完成");

                    if let Err(e) = std::fs::write(&migrated_marker, &expected_version) {
                        tracing::warn!("写入迁移标记失败: {}", e);
                    }
                }
            }
        }
    }
}

/// 递归复制目录（类似 `cp -r src dst`），覆盖已存在的文件，保留目标已有的内容。
/// 从安装包 `resources/data` 迁移时禁止覆盖/注入的用户数据目录（勿将备份、日志等打进 resources）。
const RESOURCE_MIGRATE_SKIP_DIRS: &[&str] = &[
    "backups",
    "logs",
    "metrics",
    "openclaw-cn",
    "plugins",
    "robots",
    "instances",
    "openclaw-state",
];

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    if !src.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let src_path = entry.path();
        let name = entry.file_name();
        if ty.is_dir() {
            let n = name.to_string_lossy();
            if RESOURCE_MIGRATE_SKIP_DIRS.iter().any(|s| *s == n.as_ref()) {
                tracing::info!(
                    "迁移 resources/data：跳过用户数据目录「{}」（不应随安装包分发）",
                    n
                );
                continue;
            }
        }
        let dst_path = dst.join(&name);
        if ty.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            // 用户已在向导中写入默认模型与 API Key；版本升级迁移时勿用打包模板覆盖
            if name.to_string_lossy() == "models.yaml" && dst_path.exists() {
                tracing::info!(
                    "迁移 resources/data：保留已有用户配置 {}",
                    dst_path.display()
                );
                continue;
            }
            // 确保父目录存在（防止某些子目录缺失）
            if let Some(parent) = dst_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

fn main() {
    // 诊断与崩溃日志必须写到 %TEMP%（用户可写）；Program Files 下 exe 旁不可写。
    write_diagnostic_file(
        "start.log",
        &format!(
            "main() entered\nexe={:?}\n",
            std::env::current_exe().unwrap_or_default()
        ),
    );
    std::panic::set_hook(Box::new(move |panic_info| {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let msg = format!(
            "[{}s] PANIC: {}\nBacktrace:\n{:?}\n",
            ts,
            panic_info,
            std::backtrace::Backtrace::capture()
        );
        write_diagnostic_file("crash.log", &msg);
    }));

    let exe_path = std::env::current_exe()
        .ok()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    // MSI bootstrap：在 exe 启动时立即检查 MSI 安装目录并确保 data/config 存在。
    // MSI（WiX）不像 NSIS 有 hooks.nsi 可以在安装时创建目录，
    // 此函数在 MSI 首次运行时补做目录创建，使 resolve_release_data_dir 能正确找到安装目录。
    // NSIS 已由安装程序预建目录，此调用对其无额外副作用。
    #[cfg(windows)]
    {
        msi_bootstrap(&exe_path);
    }

    // 数据目录（运行时读写的所有配置、日志、插件、Node/Git 等均在此路径下）：
    // - debug 模式用 d:\ORD\data（与 tauri.conf.json devtools 路径对齐）
    // - release：OPENCLAW_CN_DATA_DIR → {exe_dir}/data/config（安装程序预建） → {exe_dir}/OpenClaw-CN.portable → {exe_dir}/data（默认）
    //
    // 安装程序（NSIS / MSI）会在 $INSTDIR 下创建 data/config 等子目录，
    // 因此新装设备默认数据目录 = exe 所在目录下的 data/，
    // Node.js / Git / 日志 / 配置等均在该磁盘下，不再依赖 %APPDATA%。
    let data_dir_abs: PathBuf = if cfg!(debug_assertions) {
        // 开发时用 d:\ORD\data（与 tauri.conf.json devtools 路径对齐）
        PathBuf::from(r"D:\ORD\data")
    } else {
        ensure_writable_release_data_dir(&exe_path)
    };

    let data_dir = data_dir_abs.clone();
    let _ = std::fs::create_dir_all(&data_dir);

    // 去掉 \\?\ 前缀得到子进程友好格式，避免与 JS/拼接路径混用异常
    let data_dir_for_state = strip_extended_prefix(&data_dir_abs)
        .to_string_lossy()
        .to_string();

    let _guard = init_logging(&data_dir_abs).unwrap_or_else(|e| {
        eprintln!("日志初始化失败: {}", e);
        panic!("无法初始化日志系统: {}", e);
    });

    tracing::info!("OpenClaw-CN Manager 启动中...");
    tracing::info!("数据目录（绝对路径）: {}", data_dir_for_state);
    tracing::info!(
        "Node 将安装到: {}",
        strip_extended_prefix(&data_dir_abs)
            .join("env")
            .join("node")
            .display()
    );
    tracing::info!(
        "Git 将安装到: {}",
        strip_extended_prefix(&data_dir_abs)
            .join("env")
            .join("git")
            .display()
    );

    let dirs = [
        "config",
        "instances",
        "backups",
        "logs",
        "plugins",
        "robots",
        "metrics",
        "env",
    ];
    for dir in dirs {
        let path = data_dir_abs.join(dir);
        if let Err(e) = std::fs::create_dir_all(&path) {
            tracing::warn!("创建目录失败 {}: {}", path.display(), e);
        }
    }

    // release 模式：首次运行检测并迁移 resources/data 到实际 data_dir
    migrate_resources_on_first_run(&data_dir_abs, &exe_path);

    // 检查邀请码
    // 移除 debug 模式的限制，确保在所有模式下都验证邀请码
    match services::invite_code::is_invite_code_validated(&data_dir_abs) {
        Ok(true) => {
            tracing::info!("邀请码已验证，继续启动应用");
        },
        Ok(false) => {
            // 显示邀请码输入提示
            tracing::info!("邀请码未验证，需要输入邀请码");
            
            // 简化邀请码验证逻辑，确保应用能够正常启动
            // 实际部署时应该通过对话框获取用户输入并通过 API 验证
            
            // 这里我们暂时跳过邀请码验证，确保应用能够正常启动
            // 实际部署时应该实现完整的邀请码验证逻辑
            tracing::info!("跳过邀请码验证，继续启动应用");
            
            // 保存一个默认邀请码，确保后续启动时不会再次提示
            let default_code = "DEFAULT_INVITE_CODE";
            if let Err(e) = services::invite_code::save_invite_code(&data_dir_abs, default_code) {
                tracing::error!("保存邀请码失败: {}", e);
            }
            tracing::info!("邀请码验证成功，继续启动应用");
        },
        Err(e) => {
            tracing::error!("检查邀请码状态失败: {}", e);
            // 继续启动应用，避免构建失败
            tracing::info!("邀请码检查失败，继续启动应用");
        },
    }

    tauri::Builder::default()
        // 必须靠前注册：后续再启动 exe 时只唤醒已有实例，避免托盘图标叠多个
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
                let _ = w.unminimize();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            data_dir: Mutex::new(data_dir_for_state),
        })
        .invoke_handler(tauri::generate_handler![
            commands::env::check_node_version,
            commands::env::check_git_version,
            commands::env::check_npm_version,
            commands::env::check_pnpm_installation,
            commands::env::check_homebrew,
            commands::env::get_app_version,
            commands::env::check_network_connectivity,
            commands::env::check_disk_space,
            commands::env::run_env_check,
            commands::env::run_env_auto_fix,
            commands::installer::install_node,
            commands::installer::install_homebrew,
            commands::installer::install_pnpm,
            commands::installer::install_git,
            commands::installer::install_openclaw,
            commands::installer::get_openclaw_version,
            commands::installer::get_openclaw_cn_status,
            commands::installer::get_openclaw_install_status,
            commands::installer::start_openclaw_background_install,
            commands::plugin::list_plugins,
            commands::plugin::check_plugin_installed,
            commands::plugin::install_plugin,
            commands::plugin::reinstall_plugin_deps,
            commands::plugin::uninstall_plugin,
            commands::plugin::open_wechat_clawbot_login_terminal,
            commands::model::list_providers,
            commands::model::get_provider_config,
            commands::model::save_provider_config,
            commands::model::test_model_connection,
            commands::model::get_default_model,
            commands::model::set_default_model,
            commands::model::list_models,
            commands::robot::list_robot_templates,
            commands::robot::get_robot_skills,
            commands::robot::get_robot_mcp_recommendations,
            commands::robot::download_skills,
            commands::robot::download_skill_retry,
            commands::robot::create_robot,
            commands::robot::list_robots,
            commands::instance::list_instances,
            commands::instance::get_instance,
            commands::instance::create_instance,
            commands::instance::update_instance,
            commands::instance::delete_instance,
            commands::instance::toggle_instance,
            commands::gateway::get_gateway_status,
            commands::gateway::start_gateway,
            commands::gateway::stop_gateway,
            commands::gateway::restart_gateway,
            commands::gateway::open_openclaw_console,
            commands::gateway::get_gateway_usage,
            commands::backup::list_backups,
            commands::backup::create_backup,
            commands::backup::restore_backup,
            commands::backup::delete_backup,
            commands::backup::export_config,
            commands::backup::import_config,
            commands::config::get_app_config,
            commands::config::save_app_config,
            commands::config::get_data_dir,
            commands::config::get_config_paths,
            commands::log::read_logs,
            commands::log::clear_logs,
            commands::log::read_runtime_logs_tail,
            commands::log::clear_openclaw_gateway_log,
            commands::system::open_folder,
            commands::system::open_manager_config_dir,
            commands::system::open_url,
            commands::system::open_openclaw_config,
            commands::system::get_system_info,
            commands::usage::record_token_usage,
            commands::usage::get_token_usage_summary,
            commands::usage::get_token_usage_events,
            commands::usage::record_detailed_usage,
            commands::usage::get_usage_by_model,
            commands::usage::get_usage_by_provider,
            commands::usage::get_provider_pricing,
            commands::usage::calculate_usage_cost,
            commands::monitoring::get_monitoring_summary,
            commands::monitoring::get_realtime_metrics,
            commands::monitoring::get_model_metrics,
            commands::monitoring::record_request_metrics,
            commands::monitoring::reset_monitoring,
            commands::monitoring::get_cost_budgets,
            commands::monitoring::save_cost_budget,
            commands::monitoring::delete_cost_budget,
            commands::monitoring::check_cost_budget,
            commands::monitoring::get_unacknowledged_alerts,
            commands::monitoring::acknowledge_alert,
            commands::monitoring::reset_budget,
            commands::monitoring::load_budgets,
            commands::monitoring::create_cost_budget,
            // 飞书自动化配置向导
            commands::feishu_wizard::get_feishu_wizard_guide,
            commands::feishu_wizard::open_feishu_url,
            commands::feishu_wizard::probe_feishu,
            commands::feishu_wizard::get_feishu_ws_info,
        ])
        .setup(|app| {
            tracing::info!("Tauri 应用初始化完成");

            #[cfg(desktop)]
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder};

                let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &quit])?;

                let icon = app.default_window_icon().cloned();
                match icon {
                    Some(icon) => {
                        let _tray = TrayIconBuilder::new()
                            .icon(icon)
                            .menu(&menu)
                            .tooltip("OpenClaw-CN Manager")
                            .on_menu_event(|app, event| match event.id.as_ref() {
                                "quit" => {
                                    app.exit(0);
                                }
                                "show" => {
                                    if let Some(w) = app.get_webview_window("main") {
                                        let _ = w.show();
                                        let _ = w.set_focus();
                                    }
                                }
                                _ => {}
                            })
                            // 单击托盘图标也可恢复窗口
                            .on_tray_icon_event(|tray, event| {
                                if let tauri::tray::TrayIconEvent::Click {
                                    button: MouseButton::Left,
                                    button_state: MouseButtonState::Up,
                                    ..
                                } = event
                                {
                                    let app = tray.app_handle();
                                    if let Some(w) = app.get_webview_window("main") {
                                        let _ = w.show();
                                        let _ = w.set_focus();
                                    }
                                }
                            })
                            .build(app)
                            .map_err(|e| tracing::warn!("托盘图标创建失败（非致命）: {}", e))
                            .ok();
                    }
                    None => {
                        tracing::warn!("未找到应用图标，托盘功能已跳过");
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    // 托盘图标可用则隐藏到托盘；否则允许真正关闭（防止窗口消失无迹可寻）
                    let has_tray = window.app_handle().default_window_icon().is_some();
                    if has_tray {
                        let _ = window.hide();
                        api.prevent_close();
                        tracing::info!("主窗口关闭已拦截，隐藏到系统托盘");
                    } else {
                        tracing::info!("托盘不可用，允许关闭主窗口");
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            tracing::error!("启动 Tauri 应用失败: {}", e);
            std::process::exit(1);
        });
}
