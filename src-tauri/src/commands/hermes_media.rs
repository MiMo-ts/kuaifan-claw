use std::path::{Path, PathBuf};

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "webm", "mov"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ManagedMediaKind {
    Image,
    Video,
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn media_kind(path: &Path) -> Option<ManagedMediaKind> {
    let ext = extension_of(path);
    if IMAGE_EXTENSIONS.iter().any(|allowed| *allowed == ext) {
        Some(ManagedMediaKind::Image)
    } else if VIDEO_EXTENSIONS.iter().any(|allowed| *allowed == ext) {
        Some(ManagedMediaKind::Video)
    } else {
        None
    }
}

pub fn managed_hermes_image_root(data_dir: &Path) -> PathBuf {
    data_dir
        .join("modules")
        .join("hermes")
        .join("image_cache")
        .join("kuaifan-image")
}

pub fn managed_hermes_video_root(data_dir: &Path) -> PathBuf {
    data_dir
        .join("modules")
        .join("hermes")
        .join("video_cache")
        .join("kuaifan-video")
}

fn managed_roots(data_dir: &Path, kind: ManagedMediaKind) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    match kind {
        ManagedMediaKind::Image => roots.push(managed_hermes_image_root(data_dir)),
        ManagedMediaKind::Video => roots.push(managed_hermes_video_root(data_dir)),
    }
    // Hermes skill scripts write under HERMES_HOME when that env is set.
    if let Ok(home) = std::env::var("HERMES_HOME") {
        let home = PathBuf::from(home);
        let root = match kind {
            ManagedMediaKind::Image => home.join("image_cache").join("kuaifan-image"),
            ManagedMediaKind::Video => home.join("video_cache").join("kuaifan-video"),
        };
        if !roots.iter().any(|existing| existing == &root) {
            roots.push(root);
        }
    }
    roots
}

pub fn validate_managed_source(data_dir: &Path, source: &Path) -> Result<PathBuf, String> {
    let kind = media_kind(source).ok_or_else(|| {
        "仅支持导出 PNG、JPG、GIF、WEBP 图片或 MP4/WEBM/MOV 视频".to_string()
    })?;
    let canonical = source
        .canonicalize()
        .map_err(|_| "生成的媒体文件已不存在或无法读取".to_string())?;
    if !canonical.is_file() {
        return Err("生成的媒体文件不是有效文件".to_string());
    }

    let mut last_error = "Hermes 媒体缓存目录不存在，请重新生成".to_string();
    for root in managed_roots(data_dir, kind) {
        match root.canonicalize() {
            Ok(root) => {
                if canonical.starts_with(&root) {
                    return Ok(canonical);
                }
                last_error = "只允许导出 Hermes 受管媒体缓存中的文件".to_string();
            }
            Err(_) => {
                last_error = "Hermes 媒体缓存目录不存在，请重新生成".to_string();
            }
        }
    }
    Err(last_error)
}

fn image_mime_type(path: &Path) -> &'static str {
    match extension_of(path).as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/png",
    }
}

fn video_mime_type(path: &Path) -> &'static str {
    match extension_of(path).as_str() {
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        _ => "video/mp4",
    }
}

fn media_mime_type(path: &Path) -> Result<&'static str, String> {
    match media_kind(path) {
        Some(ManagedMediaKind::Image) => Ok(image_mime_type(path)),
        Some(ManagedMediaKind::Video) => Ok(video_mime_type(path)),
        None => Err("不支持的媒体类型".to_string()),
    }
}

pub fn managed_image_data_url(data_dir: &Path, source: &Path) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let source = validate_managed_source(data_dir, source)?;
    if media_kind(&source) != Some(ManagedMediaKind::Image) {
        return Err("仅支持读取图片数据 URL".to_string());
    }
    let bytes = std::fs::read(&source).map_err(|_| "Unable to read generated image".to_string())?;
    Ok(format!(
        "data:{};base64,{}",
        image_mime_type(&source),
        STANDARD.encode(bytes),
    ))
}

pub fn managed_media_data_url(data_dir: &Path, source: &Path) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let source = validate_managed_source(data_dir, source)?;
    let mime = media_mime_type(&source)?;
    let bytes = std::fs::read(&source).map_err(|_| "Unable to read generated media".to_string())?;
    Ok(format!("data:{};base64,{}", mime, STANDARD.encode(bytes)))
}

pub fn allocate_destination(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("media");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    for index in 1..10_000 {
        let candidate = if extension.is_empty() {
            parent.join(format!("{} ({})", stem, index))
        } else {
            parent.join(format!("{} ({}).{}", stem, index, extension))
        };
        if !candidate.exists() {
            return candidate;
        }
    }
    path.to_path_buf()
}

#[tauri::command]
pub async fn export_hermes_image(
    app: tauri::AppHandle,
    data_dir: tauri::State<'_, crate::AppState>,
    source_path: String,
    suggested_dir: Option<String>,
) -> Result<String, String> {
    export_hermes_media(app, data_dir, source_path, suggested_dir).await
}

#[tauri::command]
pub async fn export_hermes_media(
    app: tauri::AppHandle,
    data_dir: tauri::State<'_, crate::AppState>,
    source_path: String,
    suggested_dir: Option<String>,
) -> Result<String, String> {
    let source =
        validate_managed_source(Path::new(&data_dir.inner().get_data_dir()), Path::new(&source_path))?;
    let default_name = match media_kind(&source) {
        Some(ManagedMediaKind::Video) => "video.mp4",
        _ => "image.png",
    };
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(default_name)
        .to_string();
    let title = match media_kind(&source) {
        Some(ManagedMediaKind::Video) => "保存视频",
        _ => "保存图片",
    }
    .to_string();
    let filters: Vec<(&str, &[&str])> = match media_kind(&source) {
        Some(ManagedMediaKind::Video) => vec![("视频", &["mp4", "webm", "mov"])],
        _ => vec![("图片", &["png", "jpg", "jpeg", "gif", "webp"])],
    };
    let selected = tokio::task::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let mut dialog = app.dialog().file().set_title(title).set_file_name(file_name);
        if let Some(directory) = suggested_dir.filter(|value| !value.trim().is_empty()) {
            dialog = dialog.set_directory(directory);
        }
        for (name, extensions) in filters {
            dialog = dialog.add_filter(name, extensions);
        }
        dialog
            .blocking_save_file()
            .map(|path| {
                path.into_path()
                    .map_err(|error| format!("无法解析保存路径: {}", error))
            })
            .transpose()
    })
    .await
    .map_err(|error| format!("打开保存对话框失败: {}", error))??;
    let Some(selected) = selected else {
        return Err("cancelled".to_string());
    };
    let selected = if selected.extension().is_none() {
        selected.with_extension(
            source
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("bin"),
        )
    } else {
        selected
    };
    let destination = allocate_destination(&selected);
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("创建保存目录失败: {}", error))?;
    }
    std::fs::copy(&source, &destination).map_err(|error| format!("复制文件失败: {}", error))?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn read_hermes_image_data_url(
    data_dir: tauri::State<'_, crate::AppState>,
    source_path: String,
) -> Result<String, String> {
    managed_image_data_url(
        Path::new(&data_dir.inner().get_data_dir()),
        Path::new(&source_path),
    )
}

#[tauri::command]
pub async fn read_hermes_media_data_url(
    data_dir: tauri::State<'_, crate::AppState>,
    source_path: String,
) -> Result<String, String> {
    managed_media_data_url(
        Path::new(&data_dir.inner().get_data_dir()),
        Path::new(&source_path),
    )
}

#[tauri::command]
pub async fn open_hermes_image_folder(
    data_dir: tauri::State<'_, crate::AppState>,
    source_path: String,
) -> Result<String, String> {
    open_hermes_media_folder(data_dir, source_path).await
}

#[tauri::command]
pub async fn open_hermes_media_folder(
    data_dir: tauri::State<'_, crate::AppState>,
    source_path: String,
) -> Result<String, String> {
    let source =
        validate_managed_source(Path::new(&data_dir.inner().get_data_dir()), Path::new(&source_path))?;
    let directory = source
        .parent()
        .ok_or_else(|| "媒体目录无效".to_string())?;
    #[cfg(windows)]
    std::process::Command::new("explorer")
        .arg(directory)
        .spawn()
        .map_err(|error| format!("打开媒体目录失败: {}", error))?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(directory)
        .spawn()
        .map_err(|error| format!("打开媒体目录失败: {}", error))?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(directory)
        .spawn()
        .map_err(|error| format!("打开媒体目录失败: {}", error))?;
    Ok(directory.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::{
        allocate_destination, managed_hermes_image_root, managed_hermes_video_root,
        managed_image_data_url, managed_media_data_url, validate_managed_source,
    };
    use std::fs;

    #[test]
    fn accepts_only_existing_supported_images_under_managed_root() {
        let temp = tempfile::tempdir().unwrap();
        let root = managed_hermes_image_root(temp.path());
        fs::create_dir_all(&root).unwrap();
        let source = root.join("result.jpg");
        fs::write(&source, b"image").unwrap();

        assert_eq!(
            validate_managed_source(temp.path(), &source).unwrap(),
            source.canonicalize().unwrap()
        );
        assert!(validate_managed_source(temp.path(), &root.join("missing.png")).is_err());
        assert!(validate_managed_source(temp.path(), &temp.path().join("outside.png")).is_err());
    }

    #[test]
    fn accepts_managed_videos() {
        let temp = tempfile::tempdir().unwrap();
        let root = managed_hermes_video_root(temp.path());
        fs::create_dir_all(&root).unwrap();
        let source = root.join("clip.mp4");
        fs::write(&source, b"\x00\x00\x00\x18ftypmp42video").unwrap();
        assert_eq!(
            validate_managed_source(temp.path(), &source).unwrap(),
            source.canonicalize().unwrap()
        );
        let data_url = managed_media_data_url(temp.path(), &source).unwrap();
        assert!(data_url.starts_with("data:video/mp4;base64,"));
    }

    #[test]
    fn rejects_non_media_extensions() {
        let temp = tempfile::tempdir().unwrap();
        let root = managed_hermes_image_root(temp.path());
        fs::create_dir_all(&root).unwrap();
        let source = root.join("result.txt");
        fs::write(&source, b"not image").unwrap();
        assert!(validate_managed_source(temp.path(), &source).is_err());
    }

    #[test]
    fn allocates_a_non_overwriting_collision_name() {
        let temp = tempfile::tempdir().unwrap();
        let destination = temp.path().join("result.jpg");
        fs::write(&destination, b"existing").unwrap();
        fs::write(temp.path().join("result (1).jpg"), b"existing").unwrap();
        assert_eq!(
            allocate_destination(&destination),
            temp.path().join("result (2).jpg"),
        );
    }

    #[test]
    fn reads_a_managed_image_as_a_data_url() {
        let temp = tempfile::tempdir().unwrap();
        let root = managed_hermes_image_root(temp.path());
        fs::create_dir_all(&root).unwrap();
        let source = root.join("result.png");
        fs::write(&source, b"\x89PNG\r\n\x1a\nimage").unwrap();

        assert_eq!(
            managed_image_data_url(temp.path(), &source).unwrap(),
            "data:image/png;base64,iVBORw0KGgppbWFnZQ==",
        );
    }
}
