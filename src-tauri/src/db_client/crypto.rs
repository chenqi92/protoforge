// 凭证加密 — AES-256-GCM + HKDF-SHA256 密钥派生 + OS 安全随机数

use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::Aead,
};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;
use std::path::Path;

/// 获取机器特征种子（用于派生加密密钥）
fn machine_seed() -> Vec<u8> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if line.contains("IOPlatformUUID") {
                    if let Some(uuid) = line.split('"').nth(3) {
                        return uuid.as_bytes().to_vec();
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = std::process::Command::new("reg")
            .args([
                "query",
                r"HKLM\SOFTWARE\Microsoft\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if line.contains("MachineGuid") {
                    if let Some(guid) = line.split_whitespace().last() {
                        return guid.as_bytes().to_vec();
                    }
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(id) = std::fs::read_to_string("/etc/machine-id") {
            return id.trim().as_bytes().to_vec();
        }
    }

    // Fallback — 日志警告
    log::warn!("Could not retrieve machine-specific seed; using fallback (less secure)");
    b"protoforge-fallback-seed-v1".to_vec()
}

/// 使用 HKDF-SHA256 从机器种子 + 应用路径派生 256 位密钥
fn derive_key(app_data_dir: &Path) -> [u8; 32] {
    let ikm = machine_seed();
    let salt = app_data_dir.to_string_lossy().as_bytes().to_vec();
    let info = b"protoforge-db-credential-encryption-v1";

    let hk = Hkdf::<Sha256>::new(Some(&salt), &ikm);
    let mut okm = [0u8; 32];
    hk.expand(info, &mut okm)
        .expect("HKDF expand failed (should never happen with 32-byte output)");
    okm
}

/// AES-256-GCM 加密
/// 返回 base64(nonce_12bytes || ciphertext || tag_16bytes)
pub fn encrypt(plaintext: &str, app_data_dir: &Path) -> Result<String, String> {
    use base64::Engine;

    let key = derive_key(app_data_dir);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("Cipher init failed: {}", e))?;

    // 使用 OS 安全随机数生成 nonce
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    // 格式: nonce (12) || ciphertext+tag
    let mut output = Vec::with_capacity(12 + ciphertext.len());
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);

    Ok(base64::engine::general_purpose::STANDARD.encode(&output))
}

/// AES-256-GCM 解密
pub fn decrypt(encrypted: &str, app_data_dir: &Path) -> Result<String, String> {
    use base64::Engine;

    if encrypted.is_empty() {
        return Ok(String::new());
    }

    let key = derive_key(app_data_dir);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("Cipher init failed: {}", e))?;

    let data = base64::engine::general_purpose::STANDARD
        .decode(encrypted)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;

    // nonce (12) + ciphertext (≥1) + tag (16) = 至少 29 字节
    if data.len() < 28 {
        return Err("Invalid encrypted data: too short".to_string());
    }

    let nonce = Nonce::from_slice(&data[..12]);
    let ciphertext_with_tag = &data[12..];

    let plaintext = cipher
        .decrypt(nonce, ciphertext_with_tag)
        .map_err(|_| "Decryption failed: invalid key or corrupted data".to_string())?;

    String::from_utf8(plaintext).map_err(|e| format!("UTF-8 decode failed: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let app_dir = PathBuf::from("/tmp/test-protoforge");
        let plaintext = "my-secret-password-123!@#$%^&*()";
        let encrypted = encrypt(plaintext, &app_dir).unwrap();
        assert_ne!(encrypted, plaintext); // 确保不是明文
        let decrypted = decrypt(&encrypted, &app_dir).unwrap();
        assert_eq!(plaintext, decrypted);
    }

    #[test]
    fn test_empty_string() {
        let app_dir = PathBuf::from("/tmp/test-protoforge");
        let encrypted = encrypt("", &app_dir).unwrap();
        let decrypted = decrypt(&encrypted, &app_dir).unwrap();
        assert_eq!("", decrypted);
    }

    #[test]
    fn test_different_nonces() {
        let app_dir = PathBuf::from("/tmp/test-protoforge");
        let enc1 = encrypt("same", &app_dir).unwrap();
        let enc2 = encrypt("same", &app_dir).unwrap();
        assert_ne!(enc1, enc2); // 不同 nonce 应产生不同密文
    }

    #[test]
    fn test_tampered_data_fails() {
        let app_dir = PathBuf::from("/tmp/test-protoforge");
        let encrypted = encrypt("secret", &app_dir).unwrap();
        use base64::Engine;
        let mut data = base64::engine::general_purpose::STANDARD.decode(&encrypted).unwrap();
        if let Some(byte) = data.last_mut() {
            *byte ^= 0xff; // 篡改最后一个字节
        }
        let tampered = base64::engine::general_purpose::STANDARD.encode(&data);
        assert!(decrypt(&tampered, &app_dir).is_err()); // 应该验证失败
    }
}
