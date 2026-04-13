// 备份恢复命令

use crate::models::BackupInfo;
use std::collections::HashSet;
use std::fs::File;
use std::io::Write;
use std::time::UNIX_EPOCH;
use tracing::info;
use zip::write::SimpleFileOptions;
use zip::ZipArchive;

/// Zip 内路径统一为正斜杠、小写（Windows 上避免 OpenClaw/openclaw.json 与 openclaw/openclaw.json 视为不同却写入同一条目）
fn zip_entry_key(name: &str) -> String {
    name.replace('\\', "/").to_lowercase()
}

#[tauri::command]
pub async fn list_backups(
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<Vec<BackupInfo>, String> {
    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let backups_dir = format!("{}/backups", data_dir);

    let mut backups = Vec::new();

    let entries =
        std::fs::read_dir(&backups_dir).map_err(|e| format!("读取备份目录失败: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "zip").unwrap_or(false) {
            let metadata =
                std::fs::metadata(&path).map_err(|e| format!("读取文件信息失败: {}", e))?;
            let filename = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "unknown".to_string());

            let created_at = metadata
                .modified()
                .ok()
                .and_then(|t| {
                    t.duration_since(UNIX_EPOCH).ok().map(|d| {
                        chrono::DateTime::from_timestamp(d.as_secs() as i64, 0)
                            .map(|dt| dt.to_rfc3339())
                            .unwrap_or_default()
                    })
                })
                .unwrap_or_default();

            backups.push(BackupInfo {
                id: filename.clone(),
                filename,
                created_at,
                size_bytes: metadata.len(),
                description: None,
            });
        }
    }

    // 按时间倒序排列
    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(backups)
}

// 统一使用同步版本避免重复代码
fn zip_dir_recursive(
    zip: &mut zip::ZipWriter<File>,
    options: zip::write::SimpleFileOptions,
    source_dir: &str,
    prefix: &str,
    seen_names: &mut HashSet<String>,
) -> Result<(), String> {
    let entries =
        std::fs::read_dir(source_dir).map_err(|e| format!("读取目录失败 {}: {}", source_dir, e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let name_in_zip = if prefix.is_empty() {
            path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "<unknown>".to_string())
        } else {
            format!(
                "{}/{}",
                prefix,
                path.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "<unknown>".to_string())
            )
        };

        // config/openclaw/openclaw.json 与 openclaw-cn/openclaw.json 内容相同（后者是实际使用的运行文件），
        // 打包时会以 openclaw/openclaw.json 形式出现，与后面显式写入的 openclaw/openclaw.json 重名冲突，
        // 所以跳过这一文件，保留 config/openclaw/ 下其他内容（instances.yaml / models.yaml 等）。
        let key = zip_entry_key(&name_in_zip);
        if key == "openclaw/openclaw.json" {
            continue;
        }

        if path.is_file() {
            let key = zip_entry_key(&name_in_zip);
            if !seen_names.insert(key) {
                info!("备份跳过重复 zip 条目: {}", name_in_zip);
                continue;
            }
            zip.start_file(&name_in_zip, options)
                .map_err(|e| format!("写入文件失败 {}: {}", name_in_zip, e))?;
            let content =
                std::fs::read(&path).map_err(|e| format!("读取文件失败 {}: {}", name_in_zip, e))?;
            zip.write_all(&content)
                .map_err(|e| format!("写入内容失败 {}: {}", name_in_zip, e))?;
        } else if path.is_dir() {
            zip_dir_recursive(
                zip,
                options,
                path.to_str().unwrap_or(""),
                &name_in_zip,
                seen_names,
            )?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn create_backup(
    data_dir: tauri::State<'_, crate::AppState>,
    description: Option<String>,
) -> Result<BackupInfo, String> {
    info!("创建备份...");

    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let backups_dir = format!("{}/backups", data_dir);
    tokio::fs::create_dir_all(&backups_dir)
        .await
        .map_err(|e| format!("创建备份目录失败: {}", e))?;

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let backup_filename = format!("backup_{}.zip", timestamp);
    let backup_path = format!("{}/{}", backups_dir, backup_filename);
    let config_dir = format!("{}/config", data_dir);

    let file = File::create(&backup_path).map_err(|e| format!("创建备份文件失败: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut seen_zip_names: HashSet<String> = HashSet::new();

    // 递归打包 config/（含子目录）以及 openclaw-cn/openclaw.json
    if std::path::Path::new(&config_dir).exists() {
        zip_dir_recursive(&mut zip, options, &config_dir, "", &mut seen_zip_names)?;
    }

    let openclaw_cfg = format!("{}/openclaw-cn/openclaw.json", data_dir);
    if std::path::Path::new(&openclaw_cfg).exists() {
        let content = tokio::fs::read(&openclaw_cfg)
            .await
            .map_err(|e| format!("读取 openclaw.json 失败: {}", e))?;
        let oc_name = "openclaw/openclaw.json";
        let key = zip_entry_key(oc_name);
        if seen_zip_names.insert(key) {
            zip.start_file(oc_name, options)
                .map_err(|e| format!("写入 openclaw.json 失败: {}", e))?;
            zip.write_all(&content)
                .map_err(|e| format!("写入 openclaw.json 内容失败: {}", e))?;
        } else {
            info!("openclaw/openclaw.json 已在 config 打包中出现，跳过重复写入");
        }
    }

    zip.finish()
        .map_err(|e| format!("完成 ZIP 写入失败: {}", e))?;

    let metadata =
        std::fs::metadata(&backup_path).map_err(|e| format!("读取备份信息失败: {}", e))?;

    let backup_info = BackupInfo {
        id: backup_filename.clone(),
        filename: backup_filename,
        created_at: chrono::Local::now().to_rfc3339(),
        size_bytes: metadata.len(),
        description,
    };

    info!("备份创建成功: {}", backup_info.filename);
    Ok(backup_info)
}

#[tauri::command]
pub async fn restore_backup(
    data_dir: tauri::State<'_, crate::AppState>,
    backup_filename: String,
) -> Result<String, String> {
    info!("恢复备份: {}", backup_filename);

    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let backups_dir = format!("{}/backups", data_dir);
    let backup_path = format!("{}/{}", backups_dir, backup_filename);

    if !std::path::Path::new(&backup_path).exists() {
        return Err("备份文件不存在".to_string());
    }

    // 先创建恢复前的备份
    let pre_backup_dir = data_dir.clone();
    let pre_backups_dir = format!("{}/backups", pre_backup_dir);
    tokio::fs::create_dir_all(&pre_backups_dir)
        .await
        .map_err(|e| format!("创建备份目录失败: {}", e))?;
    let pre_timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let pre_backup_path = format!(
        "{}/backup_before_restore_{}.zip",
        pre_backups_dir, pre_timestamp
    );

    let pre_config_dir = format!("{}/config", pre_backup_dir);
    let pre_file = File::create(&pre_backup_path).map_err(|e| format!("创建预备份失败: {}", e))?;
    let mut pre_zip = zip::ZipWriter::new(pre_file);
    let pre_options =
        SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut pre_seen = HashSet::new();
    if std::path::Path::new(&pre_config_dir).exists() {
        zip_dir_recursive(
            &mut pre_zip,
            pre_options,
            &pre_config_dir,
            "",
            &mut pre_seen,
        )
        .map_err(|e| format!("预备份目录打包失败: {}", e))?;
    }
    pre_zip
        .finish()
        .map_err(|e| format!("预备份 ZIP 完成失败: {}", e))?;

    let config_dir = format!("{}/config", data_dir);
    tokio::fs::create_dir_all(&config_dir)
        .await
        .map_err(|e| format!("创建配置目录失败: {}", e))?;

    let file = File::open(&backup_path).map_err(|e| format!("打开备份文件失败: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("读取 ZIP 失败: {}", e))?;

    for i in 0..archive.len() {
        let mut zip_file = archive
            .by_index(i)
            .map_err(|e| format!("读取 ZIP 条目失败: {}", e))?;
        let filename = zip_file.name().to_string();
        // 跳过 zip 内目录条目（如 "openclaw/"）
        if filename.ends_with('/') {
            continue;
        }
        // 跳过 openclaw/openclaw.json（保留给下面单独恢复），防止 config/openclaw/ 下误匹配
        let lower = filename.to_lowercase();
        if lower == "openclaw/openclaw.json" || lower.ends_with("/openclaw/openclaw.json") {
            continue;
        }
        let out_path = format!("{}/{}", config_dir, filename);
        // 路径穿越防护：验证解压路径在配置目录内
        let canonical_base = std::path::Path::new(&config_dir)
            .canonicalize()
            .map_err(|e| format!("非法配置目录: {}", e))?;
        let canonical_out = std::path::Path::new(&out_path)
            .canonicalize()
            .map_err(|e| format!("非法解压路径: {}", e))?;
        if !canonical_out.starts_with(&canonical_base) {
            return Err(format!(
                "路径穿越检测到: 试图写入 {}（基础目录: {}）",
                filename, config_dir
            ));
        }
        if let Some(parent) = std::path::Path::new(&out_path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut outfile =
            File::create(&out_path).map_err(|e| format!("创建文件失败 {}: {}", out_path, e))?;
        std::io::copy(&mut zip_file, &mut outfile)
            .map_err(|e| format!("复制文件失败 {}: {}", out_path, e))?;
    }

    // 恢复 openclaw/openclaw.json（全程同步，避免 ZipFile 跨 await 导致 Future 非 Send）
    // 恢复后清理旧版 systemPrompt 键，防止网关启动报 "Unrecognized key: systemPrompt"
    let openclaw_dir = format!("{}/openclaw-cn", data_dir);
    let openclaw_path = format!("{}/openclaw.json", openclaw_dir);
    let openclaw_entry = "openclaw/openclaw.json";
    let file2 = File::open(&backup_path).map_err(|e| format!("打开备份文件失败: {}", e))?;
    let mut archive2 = ZipArchive::new(file2).map_err(|e| format!("读取 ZIP 失败: {}", e))?;
    if let Ok(mut zf) = archive2.by_name(openclaw_entry) {
        std::fs::create_dir_all(&openclaw_dir).map_err(|e| format!("创建目录失败: {}", e))?;
        let mut content = Vec::new();
        std::io::copy(&mut zf, &mut content).map_err(|e| format!("读取备份内容失败: {}", e))?;

        // 解析 JSON，清理 agents.list 中的 systemPrompt 键
        if let Ok(json_str) = String::from_utf8(content.clone()) {
            if let Ok(mut json_val) = serde_json::from_str::<serde_json::Value>(&json_str) {
                if let Some(list) = json_val
                    .get_mut("agents")
                    .and_then(|a| a.get_mut("list"))
                    .and_then(|l| l.as_array_mut())
                {
                    for entry in list {
                        if let serde_json::Value::Object(obj) = entry {
                            obj.remove("systemPrompt");
                        }
                    }
                    info!("已从备份的 openclaw.json 中移除 systemPrompt 键");
                }
                if let Ok(clean) = serde_json::to_vec_pretty(&json_val) {
                    std::fs::write(&openclaw_path, clean)
                        .map_err(|e| format!("写入 openclaw.json 失败: {}", e))?;
                } else {
                    std::fs::write(&openclaw_path, content)
                        .map_err(|e| format!("写入 openclaw.json 失败: {}", e))?;
                }
            } else {
                std::fs::write(&openclaw_path, content)
                    .map_err(|e| format!("写入 openclaw.json 失败: {}", e))?;
            }
        } else {
            std::fs::write(&openclaw_path, content)
                .map_err(|e| format!("写入 openclaw.json 失败: {}", e))?;
        }
    }

    // 恢复完成后自动重启网关（若正在运行），使其立即加载新配置
    if let Err(e) =
        crate::commands::gateway::restart_gateway_if_running_for_wechat_config(&data_dir).await
    {
        info!("网关重启失败（可能未运行）: {}", e);
    }

    info!("备份恢复成功");
    Ok("备份恢复成功，网关正在重新加载配置".to_string())
}

#[tauri::command]
pub async fn delete_backup(
    data_dir: tauri::State<'_, crate::AppState>,
    backup_filename: String,
) -> Result<String, String> {
    info!("删除备份: {}", backup_filename);

    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let backup_path = format!("{}/backups/{}", data_dir, backup_filename);

    if !std::path::Path::new(&backup_path).exists() {
        return Err("备份文件不存在".to_string());
    }

    tokio::fs::remove_file(&backup_path)
        .await
        .map_err(|e| format!("删除备份失败: {}", e))?;

    info!("备份已删除");
    Ok(format!("备份 {} 已删除", backup_filename))
}

#[tauri::command]
pub async fn export_config(data_dir: tauri::State<'_, crate::AppState>) -> Result<String, String> {
    info!("导出配置...");

    let backup = create_backup(data_dir, Some("手动导出".to_string())).await?;
    Ok(backup.filename)
}

#[tauri::command]
pub async fn import_config(
    data_dir: tauri::State<'_, crate::AppState>,
    backup_path: String,
) -> Result<String, String> {
    info!("导入配置: {}", backup_path);

    let data_dir = data_dir.inner().data_dir.lock().unwrap().clone();
    let backups_dir = format!("{}/backups", data_dir);

    let filename = std::path::Path::new(&backup_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "import.zip".to_string());
    let dest_path = format!("{}/{}", backups_dir, filename);

    tokio::fs::copy(&backup_path, &dest_path)
        .await
        .map_err(|e| format!("复制文件失败: {}", e))?;

    // 直接恢复，不调用函数
    let config_dir = format!("{}/config", data_dir);
    tokio::fs::create_dir_all(&config_dir)
        .await
        .map_err(|e| format!("创建配置目录失败: {}", e))?;
    let file = File::open(&dest_path).map_err(|e| format!("打开备份文件失败: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("读取 ZIP 失败: {}", e))?;
    for i in 0..archive.len() {
        let mut zip_file = archive
            .by_index(i)
            .map_err(|e| format!("读取 ZIP 条目失败: {}", e))?;
        let filename = zip_file.name().to_string();
        if filename.ends_with('/') {
            continue;
        }
        // 跳过 openclaw/openclaw.json，由下面单独写入 openclaw-cn/
        let lower = filename.to_lowercase();
        if lower == "openclaw/openclaw.json" || lower.ends_with("/openclaw/openclaw.json") {
            continue;
        }
        let out_path = format!("{}/{}", config_dir, filename);
        // 路径穿越防护：验证解压路径在配置目录内
        let canonical_base = std::path::Path::new(&config_dir)
            .canonicalize()
            .map_err(|e| format!("非法配置目录: {}", e))?;
        let canonical_out = std::path::Path::new(&out_path)
            .canonicalize()
            .map_err(|e| format!("非法解压路径: {}", e))?;
        if !canonical_out.starts_with(&canonical_base) {
            return Err(format!(
                "路径穿越检测到: 试图写入 {}（基础目录: {}）",
                filename, config_dir
            ));
        }
        if let Some(parent) = std::path::Path::new(&out_path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut outfile =
            File::create(&out_path).map_err(|e| format!("创建文件失败 {}: {}", out_path, e))?;
        std::io::copy(&mut zip_file, &mut outfile)
            .map_err(|e| format!("复制文件失败 {}: {}", out_path, e))?;
    }

    // 恢复 openclaw/openclaw.json 并清理 systemPrompt（与 restore_backup 保持一致）
    let openclaw_dir = format!("{}/openclaw-cn", data_dir);
    let openclaw_path = format!("{}/openclaw.json", openclaw_dir);
    let openclaw_entry = "openclaw/openclaw.json";
    let file2 = File::open(&dest_path).map_err(|e| format!("打开备份文件失败: {}", e))?;
    let mut archive2 = ZipArchive::new(file2).map_err(|e| format!("读取 ZIP 失败: {}", e))?;
    if let Ok(mut zf) = archive2.by_name(openclaw_entry) {
        std::fs::create_dir_all(&openclaw_dir).map_err(|e| format!("创建目录失败: {}", e))?;
        let mut content = Vec::new();
        std::io::copy(&mut zf, &mut content).map_err(|e| format!("读取备份内容失败: {}", e))?;
        if let Ok(json_str) = String::from_utf8(content.clone()) {
            if let Ok(mut json_val) = serde_json::from_str::<serde_json::Value>(&json_str) {
                if let Some(list) = json_val
                    .get_mut("agents")
                    .and_then(|a| a.get_mut("list"))
                    .and_then(|l| l.as_array_mut())
                {
                    for entry in list {
                        if let serde_json::Value::Object(obj) = entry {
                            obj.remove("systemPrompt");
                        }
                    }
                }
                if let Ok(clean) = serde_json::to_vec_pretty(&json_val) {
                    std::fs::write(&openclaw_path, clean)
                        .map_err(|e| format!("写入 openclaw.json 失败: {}", e))?;
                } else {
                    std::fs::write(&openclaw_path, content)
                        .map_err(|e| format!("写入 openclaw.json 失败: {}", e))?;
                }
            } else {
                std::fs::write(&openclaw_path, content)
                    .map_err(|e| format!("写入 openclaw.json 失败: {}", e))?;
            }
        } else {
            std::fs::write(&openclaw_path, content)
                .map_err(|e| format!("写入 openclaw.json 失败: {}", e))?;
        }
    }

    // 导入完成后自动重启网关（若正在运行），使其立即加载新配置
    if let Err(e) =
        crate::commands::gateway::restart_gateway_if_running_for_wechat_config(&data_dir).await
    {
        info!("网关重启失败（可能未运行）: {}", e);
    }

    Ok("导入并恢复成功，网关正在重新加载配置".to_string())
}
