use std::fs::File;
use std::io::{self, Read, Write};
use std::path::PathBuf;

/// 验证邀请码
/// 
/// # Arguments
/// * `invite_code` - 要验证的邀请码
/// * `api_url` - 代理后端 API 地址
/// 
/// # Returns
/// * `Ok(bool)` - 验证结果，true 表示邀请码有效
/// * `Err(String)` - 验证过程中发生的错误
pub fn validate_invite_code(invite_code: &str, api_url: &str) -> Result<bool, String> {
    use reqwest::blocking::Client;
    
    // 创建 HTTP 客户端
    let client = Client::new();
    
    // 构建请求体
    let request_body = serde_json::json!({
        "code": invite_code,
        "platform": "desktop"
    });
    
    // 发送验证请求
    let response = client
        .post(format!("{}/api/invite-codes/validate", api_url))
        .json(&request_body)
        .send()
        .map_err(|e| format!("网络请求失败: {}", e))?;
    
    // 检查响应状态
    if !response.status().is_success() {
        return Err(format!("API 响应失败: {} {}", response.status(), response.text().unwrap_or_default()));
    }
    
    // 解析响应
    let response_data: serde_json::Value = response.json().map_err(|e| format!("解析响应失败: {}", e))?;
    
    // 检查验证结果
    let valid = response_data.get("valid").and_then(|v: &serde_json::Value| v.as_bool()).unwrap_or(false);
    
    Ok(valid)
}

/// 保存邀请码到本地文件
/// 
/// # Arguments
/// * `data_dir` - 数据目录路径
/// * `invite_code` - 要保存的邀请码
/// 
/// # Returns
/// * `Ok(())` - 保存成功
/// * `Err(String)` - 保存过程中发生的错误
pub fn save_invite_code(data_dir: &PathBuf, invite_code: &str) -> Result<(), String> {
    let invite_code_file = data_dir.join("invite_code.txt");
    
    // 写入邀请码到文件
    let mut file = File::create(&invite_code_file).map_err(|e| format!("创建邀请码文件失败: {}", e))?;
    file.write_all(invite_code.as_bytes()).map_err(|e| format!("写入邀请码文件失败: {}", e))?;
    
    Ok(())
}

/// 读取本地保存的邀请码
/// 
/// # Arguments
/// * `data_dir` - 数据目录路径
/// 
/// # Returns
/// * `Ok(Option<String>)` - 邀请码，如果不存在返回 None
/// * `Err(String)` - 读取过程中发生的错误
pub fn read_invite_code(data_dir: &PathBuf) -> Result<Option<String>, String> {
    let invite_code_file = data_dir.join("invite_code.txt");
    
    // 检查文件是否存在
    if !invite_code_file.exists() {
        return Ok(None);
    }
    
    // 读取邀请码
    let mut file = File::open(&invite_code_file).map_err(|e| format!("打开邀请码文件失败: {}", e))?;
    let mut invite_code = String::new();
    file.read_to_string(&mut invite_code).map_err(|e| format!("读取邀请码文件失败: {}", e))?;
    
    Ok(Some(invite_code.trim().to_string()))
}

/// 检查是否已经验证过邀请码
///
/// # Arguments
/// * `data_dir` - 数据目录路径
///
/// # Returns
/// * `Ok(bool)` - 是否已验证过邀请码
/// * `Err(String)` - 检查过程中发生的错误
pub fn is_invite_code_validated(data_dir: &PathBuf) -> Result<bool, String> {
    match read_invite_code(data_dir) {
        Ok(Some(_)) => Ok(true),
        Ok(None) => Ok(false),
        Err(e) => Err(e),
    }
}

/// 保存设备指纹到本地文件
///
/// # Arguments
/// * `data_dir` - 数据目录路径
/// * `fingerprint` - 设备指纹
///
/// # Returns
/// * `Ok(())` - 保存成功
/// * `Err(String)` - 保存过程中发生的错误
pub fn save_device_fingerprint(data_dir: &PathBuf, fingerprint: &str) -> Result<(), String> {
    let fingerprint_file = data_dir.join("device_fingerprint.txt");

    let mut file = File::create(&fingerprint_file).map_err(|e| format!("创建设备指纹文件失败: {}", e))?;
    file.write_all(fingerprint.as_bytes()).map_err(|e| format!("写入设备指纹文件失败: {}", e))?;

    Ok(())
}

/// 读取本地保存的设备指纹
///
/// # Arguments
/// * `data_dir` - 数据目录路径
///
/// # Returns
/// * `Ok(Option<String>)` - 设备指纹，如果不存在返回 None
/// * `Err(String)` - 读取过程中发生的错误
pub fn read_device_fingerprint(data_dir: &PathBuf) -> Result<Option<String>, String> {
    let fingerprint_file = data_dir.join("device_fingerprint.txt");

    if !fingerprint_file.exists() {
        return Ok(None);
    }

    let mut file = File::open(&fingerprint_file).map_err(|e| format!("打开设备指纹文件失败: {}", e))?;
    let mut fingerprint = String::new();
    file.read_to_string(&mut fingerprint).map_err(|e| format!("读取设备指纹文件失败: {}", e))?;

    Ok(Some(fingerprint.trim().to_string()))
}
