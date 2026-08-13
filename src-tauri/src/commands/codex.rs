use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::{Mutex, OnceLock};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct InstallerProcess {
    child: Child,
    exit_code: Option<i32>,
}

static INSTALLER: OnceLock<Mutex<Option<InstallerProcess>>> = OnceLock::new();

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexInstallStatus {
    pub installed: bool,
    pub executable_path: Option<String>,
    pub installer_available: bool,
    pub installer_path: Option<String>,
    pub installer_running: bool,
    pub installer_exit_code: Option<i32>,
}

pub fn first_existing_file(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.is_file()).cloned()
}

pub fn resolve_chatgpt_installer(roots: &[PathBuf]) -> Option<PathBuf> {
    first_existing_file(
        &roots
            .iter()
            .map(|root| root.join("bundled-codex").join("ChatGPT Installer.exe"))
            .collect::<Vec<_>>(),
    )
}

fn installer_roots() -> Vec<PathBuf> {
    let mut roots = vec![PathBuf::from(env!("CARGO_MANIFEST_DIR"))];
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            roots.push(directory.to_path_buf());
            roots.push(directory.join("resources"));
        }
    }
    roots
}

fn chatgpt_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let base = PathBuf::from(local_app_data);
        candidates.push(base.join("Programs").join("ChatGPT").join("ChatGPT.exe"));
        candidates.push(base.join("ChatGPT").join("ChatGPT.exe"));
    }
    candidates
}

pub fn find_store_chatgpt_package(local_app_data: &Path) -> Option<PathBuf> {
    let packages = local_app_data.join("Packages");
    std::fs::read_dir(packages)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .is_some_and(|name| {
                        let name = name.to_string_lossy();
                        name.starts_with("OpenAI.Codex_") || name.starts_with("OpenAI.ChatGPT_")
                    })
        })
}

#[cfg(windows)]
pub fn store_detection_creation_flags() -> u32 {
    CREATE_NO_WINDOW
}

fn registered_store_chatgpt_package() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let script = concat!(
            "$packages = Get-AppxPackage -ErrorAction SilentlyContinue | ",
            "Where-Object { $_.Name -in @('OpenAI.Codex', 'OpenAI.ChatGPT') -and $_.Status -eq 'Ok' }; ",
            "$packages | Select-Object -First 1 -ExpandProperty InstallLocation"
        );
        let mut command = Command::new("powershell.exe");
        command
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .creation_flags(store_detection_creation_flags());
        let output = command.output().ok()?;
        if !output.status.success() {
            return None;
        }
        return String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .find(|path| !path.is_empty())
            .map(PathBuf::from);
    }

    #[cfg(not(windows))]
    {
        None
    }
}

fn chatgpt_installation() -> Option<PathBuf> {
    first_existing_file(&chatgpt_candidates())
        .or_else(registered_store_chatgpt_package)
        .or_else(|| {
            std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .and_then(|local_app_data| find_store_chatgpt_package(&local_app_data))
        })
}

fn installer_state() -> &'static Mutex<Option<InstallerProcess>> {
    INSTALLER.get_or_init(|| Mutex::new(None))
}

fn read_installer_state() -> (bool, Option<i32>) {
    let mut guard = installer_state().lock().unwrap_or_else(|error| error.into_inner());
    let Some(process) = guard.as_mut() else { return (false, None); };
    if process.exit_code.is_none() {
        if let Ok(Some(status)) = process.child.try_wait() {
            process.exit_code = status.code();
        }
    }
    (process.exit_code.is_none(), process.exit_code)
}

#[tauri::command]
pub fn get_codex_install_status() -> CodexInstallStatus {
    let executable = chatgpt_installation();
    let installer = resolve_chatgpt_installer(&installer_roots());
    let (installer_running, installer_exit_code) = read_installer_state();
    CodexInstallStatus {
        installed: executable.is_some(),
        executable_path: executable.map(|path| path.to_string_lossy().to_string()),
        installer_available: installer.is_some(),
        installer_path: installer.map(|path| path.to_string_lossy().to_string()),
        installer_running,
        installer_exit_code,
    }
}

#[tauri::command]
pub fn start_codex_chatgpt_install() -> Result<CodexInstallStatus, String> {
    let installer = resolve_chatgpt_installer(&installer_roots())
        .ok_or_else(|| "未找到内置 ChatGPT Installer.exe".to_string())?;
    let mut guard = installer_state().lock().unwrap_or_else(|error| error.into_inner());
    if guard.as_ref().is_some_and(|process| process.exit_code.is_none()) {
        return Ok(get_codex_install_status());
    }
    let child = Command::new(&installer)
        .spawn()
        .map_err(|error| format!("启动 ChatGPT 安装程序失败: {error}"))?;
    *guard = Some(InstallerProcess { child, exit_code: None });
    drop(guard);
    Ok(get_codex_install_status())
}

#[cfg(test)]
mod tests {
    use super::{first_existing_file, resolve_chatgpt_installer};

    #[test]
    fn resolves_development_bundle_path() {
        let root = tempfile::tempdir().unwrap();
        let installer = root.path().join("bundled-codex").join("ChatGPT Installer.exe");
        std::fs::create_dir_all(installer.parent().unwrap()).unwrap();
        std::fs::write(&installer, b"test").unwrap();
        assert_eq!(resolve_chatgpt_installer(&[root.path().to_path_buf()]), Some(installer));
    }

    #[test]
    fn ignores_missing_candidates() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(first_existing_file(&[root.path().join("missing.exe")]), None);
    }
}
