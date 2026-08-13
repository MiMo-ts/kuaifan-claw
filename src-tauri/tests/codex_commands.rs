#[path = "../src/commands/codex.rs"]
mod codex;

#[test]
fn finds_the_first_existing_chatgpt_executable() {
    let root = tempfile::tempdir().unwrap();
    let executable = root.path().join("ChatGPT.exe");
    std::fs::write(&executable, b"test").unwrap();

    assert_eq!(
        codex::first_existing_file(&[root.path().join("missing.exe"), executable.clone()]),
        Some(executable),
    );
}

#[test]
fn resolves_a_bundled_chatgpt_installer() {
    let root = tempfile::tempdir().unwrap();
    let installer = root.path().join("bundled-codex").join("ChatGPT Installer.exe");
    std::fs::create_dir_all(installer.parent().unwrap()).unwrap();
    std::fs::write(&installer, b"test").unwrap();

    assert_eq!(
        codex::resolve_chatgpt_installer(&[root.path().to_path_buf()]),
        Some(installer),
    );
}

#[test]
fn detects_the_store_installed_chatgpt_package() {
    let local_app_data = tempfile::tempdir().unwrap();
    let package = local_app_data
        .path()
        .join("Packages")
        .join("OpenAI.Codex_2p2nqsd0c76g0");
    std::fs::create_dir_all(&package).unwrap();
    std::fs::write(package.join("AppxManifest.xml"), "<Package />").unwrap();

    assert_eq!(
        codex::find_store_chatgpt_package(local_app_data.path()),
        Some(package)
    );
}

#[cfg(windows)]
#[test]
fn hides_the_store_installation_detection_process() {
    assert_eq!(codex::store_detection_creation_flags(), 0x0800_0000);
}
