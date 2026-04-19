//! 隐藏窗口的命令辅助模块
//! 所有 Windows 下的 cmd/powershell 命令都必须使用本模块创建的 Command，禁止弹出窗口

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Command;

/// Windows 隐藏窗口标志
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 创建隐藏窗口的 cmd 命令
#[cfg(windows)]
pub fn cmd() -> Command {
    let mut c = Command::new("cmd");
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

/// 创建隐藏窗口的 PowerShell 命令
#[cfg(windows)]
pub fn powershell() -> Command {
    let mut c = Command::new("powershell");
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

/// 创建任意可执行文件的隐藏窗口命令（Windows 有效）
#[cfg(windows)]
pub fn hidden_command(program: &std::path::Path) -> Command {
    let mut c = Command::new(program);
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

/// 创建隐藏窗口的 cmd 命令（同步执行命令，返回 output）
#[cfg(windows)]
pub fn run_cmd<S: AsRef<str>>(args: &[S]) -> std::process::Output {
    let mut cmd = cmd();
    for arg in args {
        cmd.arg(arg.as_ref());
    }
    cmd.output().expect("cmd execution failed")
}

/// 创建隐藏窗口的 PowerShell 命令（同步执行命令，返回 output）
#[cfg(windows)]
pub fn run_powershell<S: AsRef<str>>(args: &[S]) -> std::process::Output {
    let mut cmd = powershell();
    for arg in args {
        cmd.arg(arg.as_ref());
    }
    cmd.output().expect("powershell execution failed")
}

// Non-Windows platforms: just return regular Command
#[cfg(not(windows))]
pub fn cmd() -> Command {
    Command::new("cmd")
}

#[cfg(not(windows))]
pub fn powershell() -> Command {
    Command::new("powershell")
}

/// 创建任意可执行文件的命令（非 Windows 平台直接返回普通 Command）
#[cfg(not(windows))]
pub fn hidden_command(program: &std::path::Path) -> Command {
    Command::new(program)
}

