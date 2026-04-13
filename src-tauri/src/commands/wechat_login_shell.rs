// 跨平台稳定启动微信扫码登录：写临时脚本，按平台标准方式弹出终端执行。
// - Windows: 写 %TEMP%\openclaw-weixin-login-<pid>.bat，cmd /c start "" "batpath"
// - macOS:   写 *.command (bash)，chmod +x，open -a Terminal / osascript
// - Linux:   依次尝试 xdg-terminal / gnome-terminal / konsole / xfce4-terminal / xterm
//   全部失败时返回带可复制命令的错误（不崩溃）

use crate::env_paths::resolve_node;
use std::path::PathBuf;
use std::process::Command;

/// 构建扫码登录所需的 node 与 entry.js 路径，并验证它们存在。
/// 返回 (node_path, entry_js_path, openclaw_dir)
pub fn build_login_command(data_dir: &str) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let openclaw_dir = PathBuf::from(data_dir).join("openclaw-cn");
    let entry = openclaw_dir.join("dist").join("entry.js");
    if !entry.is_file() {
        return Err(
            "未找到 OpenClaw-CN（data/openclaw-cn/dist/entry.js）。请先完成向导安装 OpenClaw-CN。"
                .to_string(),
        );
    }
    let (node, _) = resolve_node(data_dir);
    // PATH 中的 "node" 视为有效（PathBuf::from("node")）
    let node_valid = node == PathBuf::from("node") || node.is_file();
    if !node_valid {
        return Err(
            "未找到 Node.js（data/env/node 或 PATH 中均未找到）。请先在环境检查中安装 Node。"
                .to_string(),
        );
    }
    Ok((node, entry, openclaw_dir))
}

/// 生成临时脚本文件路径（用 PID 避免并发冲突）。
fn temp_script_path(suffix: &str) -> PathBuf {
    let base = std::env::temp_dir();
    let pid = std::process::id();
    base.join(format!("openclaw-weixin-login-{}{}", pid, suffix))
}

/// 从 openclaw_dir（data/openclaw-cn）推导与网关进程一致的配置/状态路径。
/// 网关 spawn 时通过 OPENCLAW_CONFIG_PATH / OPENCLAW_STATE_DIR 指定同目录，
/// 若扫码登录使用默认 ~/.openclaw，登录凭证会与网关配置不一致，导致微信通道无法工作。
fn login_env_vars(openclaw_dir: &PathBuf) -> (String, String) {
    let config_path = openclaw_dir.join("openclaw.json");
    let state_path = openclaw_dir.join("openclaw-state");
    let abs_config = std::fs::canonicalize(&config_path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| config_path.to_string_lossy().to_string());
    let abs_state = std::fs::canonicalize(&state_path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| state_path.to_string_lossy().to_string());
    (abs_config, abs_state)
}

// ── Windows ──────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub fn spawn_windows(
    openclaw_dir: &PathBuf,
    node: &PathBuf,
    entry: &PathBuf,
) -> Result<String, String> {
    let bat_path = temp_script_path(".bat");

    let openclaw_s = openclaw_dir.to_string_lossy();
    let node_s = node.to_string_lossy();
    let entry_s = entry.to_string_lossy();
    let (config_path, state_path) = login_env_vars(openclaw_dir);

    const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];
    let content = format!(
        "@echo off\r\n\
         chcp 65001 >nul\r\n\
         title OpenClaw-CN 微信扫码登录\r\n\
         echo.\r\n\
         echo 【提示】终端内二维码可能因字体变形无法扫描。\r\n\
         echo 请优先使用运行后出现的「用浏览器打开以下链接」在手机或电脑浏览器中打开，再用微信扫码。\r\n\
         echo.\r\n\
         set \"OPENCLAW_CONFIG_PATH={}\"\r\n\
         set \"OPENCLAW_STATE_DIR={}\"\r\n\
         cd /d \"{}\"\r\n\
         \"{}\" \"{}\" channels login --channel openclaw-weixin\r\n\
         echo.\r\n\
         echo 扫码完成后，关闭此窗口即可。\r\n\
         pause\r\n",
        config_path, state_path, openclaw_s, node_s, entry_s
    );

    let with_bom = [UTF8_BOM, content.as_bytes()].concat();
    std::fs::write(&bat_path, with_bom).map_err(|e| format!("写入临时 bat 脚本失败: {}", e))?;

    // start "" 语法：空标题必须占位，否则 title 内容被误当作可执行文件名。
    // 第一个参数必须是引号包围的窗口标题（可为空字符串）。
    let bat_path_str = bat_path.to_string_lossy();
    Command::new("cmd")
        .args(["/C", "start", "", &bat_path_str])
        .spawn()
        .map_err(|e| format!("启动 CMD 窗口失败: {}", e))?;

    Ok(format!(
        "已打开新窗口执行微信登录。\n\
         若终端二维码不清晰，请以窗口内随后出现的「浏览器链接」扫码（推荐）。\n\
         完成后可关闭该窗口。"
    ))
}

// ── macOS ─────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub fn spawn_macos(
    openclaw_dir: &PathBuf,
    node: &PathBuf,
    entry: &PathBuf,
) -> Result<String, String> {
    let cmd_path = temp_script_path(".command");

    let openclaw_s = sh_escape(openclaw_dir.to_string_lossy().as_ref());
    let node_s = if node == PathBuf::from("node") {
        "node".to_string()
    } else {
        sh_escape(node.to_string_lossy().as_ref())
    };
    let entry_s = sh_escape(entry.to_string_lossy().as_ref());
    let (config_path, state_path) = login_env_vars(openclaw_dir);

    let content = format!(
        "#!/bin/bash\n\
         echo ''\n\
         echo '【提示】终端内二维码可能因字体变形无法扫描，请以程序输出的「浏览器链接」在手机浏览器中打开后扫码。'\n\
         echo ''\n\
         export \"OPENCLAW_CONFIG_PATH={}\"\n\
         export \"OPENCLAW_STATE_DIR={}\"\n\
         cd {}\n\
         exec {} {} channels login --channel openclaw-weixin\n\
         read -p '扫码完成后按 Enter 键退出...'\n",
        sh_escape(&config_path),
        sh_escape(&state_path),
        openclaw_s, node_s, entry_s
    );

    std::fs::write(&cmd_path, content.as_bytes())
        .map_err(|e| format!("写入临时 .command 脚本失败: {}", e))?;

    // chmod +x
    Command::new("chmod")
        .arg("+x")
        .arg(cmd_path.as_os_str())
        .output()
        .map_err(|e| format!("chmod +x 失败: {}", e))?;

    let cmd_str = cmd_path.to_string_lossy();

    // 优先 open -a Terminal（支持非沙盒 App）
    let r = Command::new("open")
        .args(["-a", "Terminal", &cmd_str])
        .output();

    match r {
        Ok(out) if out.status.success() => {
            return Ok(format!(
                "已在 Terminal 中打开微信扫码登录。\n\
                 请在 Terminal 窗口内用微信扫一扫。\n\
                 扫码完成后关闭该窗口即可。"
            ));
        }
        _ => {
            // 降级：osascript AppleScript 方式（shell 脚本会自动 export，AppleScript do script 里用 bash -lc 注入）
            let (config_path, state_path) = login_env_vars(openclaw_dir);
            let script = format!(
                "tell application \"Terminal\"\n\
                 activate\n\
                 do script \"export 'OPENCLAW_CONFIG_PATH={}' && export 'OPENCLAW_STATE_DIR={}' && cd {} && {} {} channels login --channel openclaw-weixin\"\n\
                 end tell",
                sh_escape_single(&config_path),
                sh_escape_single(&state_path),
                sh_escape_single(openclaw_dir.to_string_lossy().as_ref()),
                node_s,
                entry_s
            );
            Command::new("osascript")
                .args(["-e", &script])
                .spawn()
                .map_err(|e| format!("osascript 启动 Terminal 失败: {}", e))?;
            return Ok(format!(
                "已在 Terminal 中打开微信扫码登录。\n\
                 请在 Terminal 窗口内用微信扫一扫。"
            ));
        }
    }
}

// ── Linux ─────────────────────────────────────────────────────────────────────

/// 尝试在 Linux 上依次打开终端执行扫码命令。
/// 全部失败时返回带可复制命令的错误字符串。
#[cfg(target_os = "linux")]
pub fn spawn_linux(
    openclaw_dir: &PathBuf,
    node: &PathBuf,
    entry: &PathBuf,
) -> Result<String, String> {
    let openclaw_s = sh_escape(openclaw_dir.to_string_lossy().as_ref());
    let node_s = if node == PathBuf::from("node") {
        "node".to_string()
    } else {
        sh_escape(node.to_string_lossy().as_ref())
    };
    let entry_s = sh_escape(entry.to_string_lossy().as_ref());
    let (config_path, state_path) = login_env_vars(openclaw_dir);

    // bash -lc 命令（供 gnome-terminal / konsole 等使用）；注入与网关一致的环境变量
    let bash_cmd = format!(
        "echo '【提示】终端二维码可能变形，请以程序输出的「浏览器链接」在手机浏览器中扫码。'; export 'OPENCLAW_CONFIG_PATH={}' && export 'OPENCLAW_STATE_DIR={}' && cd {} && exec {} {} channels login --channel openclaw-weixin",
        sh_escape(&config_path),
        sh_escape(&state_path),
        openclaw_s, node_s, entry_s
    );

    // 辅助：检查命令是否存在且可执行
    let which = |cmd: &str| -> bool {
        Command::new("which")
            .arg(cmd)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };

    // 1. $TERMINAL 环境变量
    if let Ok(term) = std::env::var("TERMINAL") {
        if !term.is_empty() && which(&term) {
            let r = Command::new(&term)
                .arg("-e")
                .arg("bash")
                .arg("-lc")
                .arg(&bash_cmd)
                .spawn();
            if r.is_ok() {
                return Ok(format!(
                    "已通过 $TERMINAL ({}) 打开微信扫码登录。\n\
                     请在终端窗口内用微信扫一扫。\n\
                     扫码完成后关闭该窗口即可。",
                    term
                ));
            }
        }
    }

    // 2. xdg-terminal
    if which("xdg-terminal") {
        let r = Command::new("xdg-terminal")
            .arg("-e")
            .arg("bash")
            .arg("-lc")
            .arg(&bash_cmd)
            .spawn();
        if r.is_ok() {
            return Ok("已通过 xdg-terminal 打开微信扫码登录。\n\
                      请在终端窗口内用微信扫一扫。\n\
                      扫码完成后关闭该窗口即可。"
                .to_string());
        }
    }

    // 3. gnome-terminal
    if which("gnome-terminal") {
        let r = Command::new("gnome-terminal")
            .arg("--")
            .arg("bash")
            .arg("-lc")
            .arg(&bash_cmd)
            .spawn();
        if r.is_ok() {
            return Ok("已通过 gnome-terminal 打开微信扫码登录。\n\
                      请在终端窗口内用微信扫一扫。\n\
                      扫码完成后关闭该窗口即可。"
                .to_string());
        }
    }

    // 4. konsole
    if which("konsole") {
        let r = Command::new("konsole")
            .arg("-e")
            .arg("bash")
            .arg("-lc")
            .arg(&bash_cmd)
            .spawn();
        if r.is_ok() {
            return Ok("已通过 konsole 打开微信扫码登录。\n\
                      请在终端窗口内用微信扫一扫。\n\
                      扫码完成后关闭该窗口即可。"
                .to_string());
        }
    }

    // 5. xfce4-terminal
    if which("xfce4-terminal") {
        let r = Command::new("xfce4-terminal")
            .arg("-e")
            .arg(format!("bash -lc '{}'", bash_cmd.replace('\'', "'\\''")))
            .spawn();
        if r.is_ok() {
            return Ok("已通过 xfce4-terminal 打开微信扫码登录。\n\
                      请在终端窗口内用微信扫一扫。\n\
                      扫码完成后关闭该窗口即可。"
                .to_string());
        }
    }

    // 6. xterm
    if which("xterm") {
        let r = Command::new("xterm")
            .arg("-e")
            .arg("bash")
            .arg("-lc")
            .arg(&bash_cmd)
            .spawn();
        if r.is_ok() {
            return Ok("已通过 xterm 打开微信扫码登录。\n\
                      请在终端窗口内用微信扫一扫。\n\
                      扫码完成后关闭该窗口即可。"
                .to_string());
        }
    }

    // 全部失败：返回可复制的命令（带上环境变量，与网关状态目录一致）
    let (config_path, state_path) = login_env_vars(openclaw_dir);
    let fallback = if node == PathBuf::from("node") {
        format!(
            "cd \"{}\" && export 'OPENCLAW_CONFIG_PATH={}' && export 'OPENCLAW_STATE_DIR={}' && node \"{}\" channels login --channel openclaw-weixin",
            openclaw_dir.display(),
            config_path,
            state_path,
            entry.display()
        )
    } else {
        format!(
            "cd \"{}\" && export 'OPENCLAW_CONFIG_PATH={}' && export 'OPENCLAW_STATE_DIR={}' && \"{}\" \"{}\" channels login --channel openclaw-weixin",
            openclaw_dir.display(),
            config_path,
            state_path,
            node.display(),
            entry.display()
        )
    };

    Err(format!(
        "未检测到可用的图形终端（gnome-terminal / konsole / xfce4-terminal / xterm 等）。\n\
         请在系统终端中执行以下命令完成微信扫码登录：\n\n\
         {}\n\n\
         扫码完成后关闭该窗口即可。",
        fallback
    ))
}

// ── helpers ───────────────────────────────────────────────────────────────────

/// shell 单引号转义（用于 .command / sh / Linux 脚本）。
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn sh_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// shell 双引号转义（用于 AppleScript do script 内的字符串，仅 macOS）。
#[cfg(target_os = "macos")]
fn sh_escape_single(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
