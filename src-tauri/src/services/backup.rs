// 备份服务
use std::fs::File;
use std::io::Write;
use zip::write::SimpleFileOptions;
use zip::ZipArchive;

#[allow(dead_code)]
pub fn create_backup(source_dir: &str, dest_path: &str) -> anyhow::Result<u64> {
    let file = File::create(dest_path)?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let entries = std::fs::read_dir(source_dir)?;
    let mut total_size = 0u64;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let filename = path.file_name().unwrap().to_string_lossy();
            zip.start_file(filename.as_ref(), options)?;
            let content = std::fs::read(&path)?;
            zip.write_all(&content)?;
            total_size += content.len() as u64;
        }
    }

    zip.finish()?;
    Ok(total_size)
}

#[allow(dead_code)]
pub fn restore_backup(zip_path: &str, dest_dir: &str) -> anyhow::Result<()> {
    std::fs::create_dir_all(dest_dir)?;
    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let out_path = format!("{}/{}", dest_dir, file.name());
        // 路径穿越防护：验证解压路径在目标目录内
        let canonical_base = std::path::Path::new(dest_dir)
            .canonicalize()
            .map_err(|e| anyhow::anyhow!("非法目标目录: {}", e))?;
        let canonical_out = std::path::Path::new(&out_path)
            .canonicalize()
            .map_err(|e| anyhow::anyhow!("非法解压路径: {}", e))?;
        if !canonical_out.starts_with(&canonical_base) {
            anyhow::bail!(
                "路径穿越检测到: 试图写入 {}（基础目录: {}）",
                file.name(),
                dest_dir
            );
        }
        let mut outfile = File::create(&out_path)?;
        std::io::copy(&mut file, &mut outfile)?;
    }

    Ok(())
}
