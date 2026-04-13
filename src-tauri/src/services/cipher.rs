// 凭据加密服务 — AES-256-GCM，机器绑定密钥
// 密钥由机器指纹（CPU ID / 主板序列 / MAC 等派生） + 应用密钥盐生成
// 确保同一台机器上能解密，其他机器即使复制文件也无法读取

use std::path::PathBuf;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// 加密凭据前缀（用于判断是否已加密）
pub const CIPHER_PREFIX: &str = "enc:";

/// AES-256-GCM 加密后的凭据格式：`enc:<base64-nonce>:<base64-ciphertext>`
/// 每个凭据独立随机 nonce，无法通过相同明文推出模式
pub fn encrypt_credential(plain: &str, key: &[u8; 32]) -> String {
    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Nonce,
    };
    use rand::RngCore;
    let cipher = Aes256Gcm::new_from_slice(key).expect("valid 256-bit key");
    let mut nonce_bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plain.as_bytes())
        .expect("encryption should not fail");
    format!(
        "{}{}:{}",
        CIPHER_PREFIX,
        base64_encode(nonce_bytes.as_slice()),
        base64_encode(&ciphertext)
    )
}

/// 解密凭据，格式：`enc:<nonce>:<ciphertext>`
pub fn decrypt_credential(encoded: &str, key: &[u8; 32]) -> Option<String> {
    let encoded = encoded.trim();
    if !encoded.starts_with(CIPHER_PREFIX) {
        return None; // 非加密格式，原样返回
    }
    let rest = &encoded[CIPHER_PREFIX.len()..];
    let parts: Vec<&str> = rest.splitn(2, ':').collect();
    if parts.len() != 2 {
        return None;
    }
    let nonce_bytes = base64_decode(parts[0]).ok()?;
    let ciphertext = base64_decode(parts[1]).ok()?;

    if nonce_bytes.len() != 12 || ciphertext.len() < 16 {
        return None;
    }

    use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Nonce};
    let cipher = Aes256Gcm::new_from_slice(key).expect("valid 256-bit key");
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher.decrypt(nonce, ciphertext.as_ref()).ok()?;
    String::from_utf8(plaintext).ok()
}

/// 基础64编码（URL-safe）
fn base64_encode(data: &[u8]) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    URL_SAFE_NO_PAD.encode(data)
}

/// 基础64解码（URL-safe）
fn base64_decode(s: &str) -> Result<Vec<u8>, base64::DecodeError> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    URL_SAFE_NO_PAD.decode(s)
}

/// 从机器指纹派生 32 字节密钥（多轮 Hash 混合，100000 轮）
fn derive_key(fingerprint: &str, salt: &[u8]) -> [u8; 32] {
    let mut combined = fingerprint.as_bytes().to_vec();
    combined.extend_from_slice(salt);

    let mut prev = combined.clone();
    const ROUNDS: usize = 100_000;
    for i in 0..ROUNDS {
        let mut hasher = DefaultHasher::new();
        prev.hash(&mut hasher);
        hasher.write_u64(i as u64);
        let h = hasher.finish();
        let new: Vec<u8> = prev
            .iter()
            .enumerate()
            .map(|(j, b)| b ^ ((h >> ((j % 8) * 8)) as u8 & 0xFF))
            .collect();
        prev = new;
    }

    let mut key = [0u8; 32];
    let mut h1 = DefaultHasher::new();
    prev.hash(&mut h1);
    let v1 = h1.finish();
    prev.reverse();
    let mut h2 = DefaultHasher::new();
    prev.hash(&mut h2);
    let v2 = h2.finish();
    key[0..8].copy_from_slice(&v1.to_le_bytes());
    key[8..16].copy_from_slice(&v2.to_le_bytes());
    key[16..24].copy_from_slice(&v1.to_be_bytes());
    key[24..32].copy_from_slice(&v2.to_be_bytes());
    key
}

/// 获取机器指纹：组合 CPU 信息、主机名、用户名
async fn get_machine_fingerprint() -> String {
    tokio::task::spawn_blocking(|| get_machine_fingerprint_sync())
        .await
        .unwrap_or_else(|_| "fingerprint_fallback".to_string())
}

fn get_machine_fingerprint_sync() -> String {
    fn try_run(cmd: &str, args: &[&str]) -> String {
        std::process::Command::new(cmd)
            .args(args)
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                } else {
                    None
                }
            })
            .unwrap_or_else(|| "unknown".to_string())
    }

    let parts = vec![
        try_run("powershell", &["-NoProfile", "-Command", "(Get-WmiObject Win32_Processor | Select -First 1).ProcessorId"]),
        try_run("powershell", &["-NoProfile", "-Command", "(Get-WmiObject Win32_BaseBoard | Select -First 1).SerialNumber"]),
        hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "host_unknown".to_string()),
        std::env::var("USERNAME").unwrap_or_else(|_| std::env::var("USER").unwrap_or_else(|_| "user_unknown".to_string())),
        std::env::var("COMPUTERNAME").unwrap_or_else(|_| "pc_unknown".to_string()),
    ];

    parts.join("|")
}

/// 同步版本：从机器指纹派生 32 字节加密密钥
pub fn get_or_create_cipher_key_sync(data_dir: &str) -> Result<[u8; 32], String> {
    let key_file = PathBuf::from(data_dir).join(".machine_key");

    if key_file.exists() {
        if let Ok(bytes) = std::fs::read(&key_file) {
            if let Ok(decoded) = base64_decode(String::from_utf8_lossy(&bytes).trim()) {
                if decoded.len() == 32 {
                    let mut key = [0u8; 32];
                    key.copy_from_slice(&decoded);
                    return Ok(key);
                }
            }
        }
        let _ = std::fs::remove_file(&key_file);
    }

    let fingerprint = get_machine_fingerprint_sync();
    let salt = b"OpenClaw-CN-Manager-v1-credential-encryption";
    let key = derive_key(&fingerprint, salt);
    let _ = std::fs::create_dir_all(PathBuf::from(data_dir));
    let _ = std::fs::write(&key_file, base64_encode(&key));

    tracing::info!("已生成并保存机器绑定加密密钥（sync）");
    Ok(key)
}

/// 异步版本：从机器指纹派生 32 字节加密密钥
pub async fn get_or_create_cipher_key(data_dir: &str) -> Result<[u8; 32], String> {
    let key_file = PathBuf::from(data_dir).join(".machine_key");

    if key_file.exists() {
        let bytes = tokio::fs::read(&key_file)
            .await
            .map_err(|e| format!("读取机器密钥失败: {}", e))?;
        if let Ok(decoded) = base64_decode(String::from_utf8_lossy(&bytes).trim()) {
            if decoded.len() == 32 {
                let mut key = [0u8; 32];
                key.copy_from_slice(&decoded);
                return Ok(key);
            }
        }
        tracing::warn!("机器密钥文件损坏，重新生成");
        let _ = tokio::fs::remove_file(&key_file).await;
    }

    let machine_fingerprint = get_machine_fingerprint().await;
    let salt = b"OpenClaw-CN-Manager-v1-credential-encryption";
    let key = derive_key(&machine_fingerprint, salt);

    tokio::fs::create_dir_all(PathBuf::from(data_dir))
        .await
        .map_err(|e| format!("创建目录失败: {}", e))?;
    tokio::fs::write(&key_file, base64_encode(&key))
        .await
        .map_err(|e| format!("写入机器密钥失败: {}", e))?;

    tracing::info!("已生成并保存机器绑定加密密钥");
    Ok(key)
}

/// 加密字段名列表（models.yaml / instances.yaml 中的凭据 key）
pub const CREDENTIAL_KEYS: &[&str] = &[
    "api_key",
    "appSecret",
    "clientSecret",
    "verificationToken",
    "encryptKey",
    "token",
    "secret",
];

/// 判断字段名是否为敏感凭据字段
pub fn is_credential_field(key: &str) -> bool {
    CREDENTIAL_KEYS.iter().any(|&k| k == key)
}

/// 对 YAML 内容中的凭据字段加密（用于保存到文件前）
pub async fn encrypt_yaml_credentials(data_dir: &str, content: &str) -> Result<String, String> {
    let key = get_or_create_cipher_key(data_dir).await?;
    Ok(encrypt_yaml_content(content, &key, true))
}

/// 对 YAML 内容中的凭据字段解密（用于读取文件后）
pub async fn decrypt_yaml_credentials(data_dir: &str, content: &str) -> Result<String, String> {
    let key = get_or_create_cipher_key(data_dir).await?;
    Ok(encrypt_yaml_content(content, &key, false))
}

/// 对 YAML 内容批量加/解密凭据字段
fn encrypt_yaml_content(content: &str, key: &[u8; 32], encrypt: bool) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let mut result = Vec::with_capacity(lines.len());

    for line in lines {
        let trimmed = line.trim();
        if !trimmed.contains(':') {
            result.push(line.to_string());
            continue;
        }

        let colon_pos = trimmed.find(':').unwrap();
        let field_key = trimmed[..colon_pos].trim();
        if !is_credential_field(field_key) {
            result.push(line.to_string());
            continue;
        }

        let after_colon = &trimmed[colon_pos + 1..];
        let value = after_colon.trim().trim_matches('"').trim_matches('\'').to_string();

        if value.is_empty() {
            result.push(line.to_string());
            continue;
        }

        let already_encrypted = value.starts_with(CIPHER_PREFIX);
        if encrypt && already_encrypted {
            result.push(line.to_string());
            continue;
        }
        if !encrypt && !already_encrypted {
            result.push(line.to_string());
            continue;
        }

        let new_value = if encrypt {
            encrypt_credential(&value, key)
        } else {
            decrypt_credential(&value, key).unwrap_or_else(|| value)
        };

        let indent = line.len() - line.trim_start().len();
        let indent_str = " ".repeat(indent);
        result.push(format!("{}{}: \"{}\"", indent_str, field_key, new_value));
    }

    result.join("\n")
}
