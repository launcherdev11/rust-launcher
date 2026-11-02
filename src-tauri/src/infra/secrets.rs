use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
#[cfg(not(windows))]
use base64::engine::general_purpose::STANDARD as B64;
#[cfg(not(windows))]
use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;

use crate::infra::fs_atomic::write_atomic;

const VAULT_MAGIC: &[u8; 4] = b"16V1";
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

type VaultKey = [u8; KEY_LEN];

static MASTER_KEY: Mutex<Option<VaultKey>> = Mutex::new(None);
static KEYRING_FAILED: AtomicBool = AtomicBool::new(false);

fn new_key() -> VaultKey {
    let mut key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    key
}

#[cfg(windows)]
mod dpapi {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    const ENTROPY: &[u8] = b"16Launcher/secrets.key";

    fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        }
    }

    fn run(data: &[u8], protect: bool) -> windows::core::Result<Vec<u8>> {
        let input = blob(data);
        let entropy = blob(ENTROPY);
        let mut output = CRYPT_INTEGER_BLOB::default();
        unsafe {
            if protect {
                CryptProtectData(
                    &input,
                    PCWSTR::null(),
                    Some(&entropy as *const _),
                    None,
                    None,
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )?;
            } else {
                CryptUnprotectData(
                    &input,
                    None,
                    Some(&entropy as *const _),
                    None,
                    None,
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )?;
            }
            let out = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
            LocalFree(Some(HLOCAL(output.pbData.cast())));
            Ok(out)
        }
    }

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        run(data, true).map_err(|e| format!("Не удалось зашифровать ключ хранилища: {e}"))
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        run(data, false).map_err(|e| format!("Не удалось расшифровать ключ хранилища: {e}"))
    }
}

#[cfg(windows)]
fn load_or_create_key() -> Result<VaultKey, String> {
    let path = crate::app::paths::launcher_secrets_key_path()?;
    if let Ok(stored) = std::fs::read(&path) {
        let key = dpapi::unprotect(&stored).and_then(|raw| {
            VaultKey::try_from(raw.as_slice())
                .map_err(|_| "Повреждён ключ хранилища: неверная длина".to_string())
        });
        match key {
            Ok(key) => return Ok(key),
            Err(e) => eprintln!("[Secrets] {e}, создаётся новый ключ"),
        }
    }
    let key = new_key();
    write_atomic(&path, dpapi::protect(&key)?)?;
    Ok(key)
}

#[cfg(not(windows))]
const KEYRING_SERVICE: &str = "16Launcher";
#[cfg(not(windows))]
const KEYRING_USER: &str = "account-vault-key";

#[cfg(not(windows))]
fn decode_key(s: &str) -> Result<VaultKey, String> {
    let raw = B64
        .decode(s.trim())
        .map_err(|e| format!("Повреждён ключ хранилища: {e}"))?;
    raw.try_into()
        .map_err(|_| "Повреждён ключ хранилища: неверная длина".to_string())
}

#[cfg(not(windows))]
fn load_or_create_key() -> Result<VaultKey, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| format!("Системное хранилище недоступно: {e}"))?;
    match entry.get_password() {
        Ok(s) => decode_key(&s),
        Err(keyring::Error::NoEntry) => {
            let key = new_key();
            entry
                .set_password(&B64.encode(key))
                .map_err(|e| format!("Не удалось сохранить ключ в системном хранилище: {e}"))?;
            let stored = entry
                .get_password()
                .map_err(|e| format!("Не удалось проверить ключ в системном хранилище: {e}"))?;
            if decode_key(&stored)? != key {
                return Err("Системное хранилище вернуло другой ключ".to_string());
            }
            Ok(key)
        }
        Err(e) => Err(format!("Не удалось прочитать ключ из системного хранилища: {e}")),
    }
}

fn master_key() -> Result<VaultKey, String> {
    let mut cached = MASTER_KEY.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(key) = *cached {
        return Ok(key);
    }
    if KEYRING_FAILED.load(Ordering::Relaxed) {
        return Err("Системное хранилище недоступно".to_string());
    }
    let result = std::thread::spawn(load_or_create_key)
        .join()
        .unwrap_or_else(|_| Err("Сбой при обращении к системному хранилищу".to_string()));
    match result {
        Ok(key) => {
            *cached = Some(key);
            Ok(key)
        }
        Err(e) => {
            KEYRING_FAILED.store(true, Ordering::Relaxed);
            Err(e)
        }
    }
}

fn seal(key: &VaultKey, plain: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce), plain)
        .map_err(|_| "Не удалось зашифровать данные".to_string())?;
    let mut out = Vec::with_capacity(VAULT_MAGIC.len() + NONCE_LEN + encrypted.len());
    out.extend_from_slice(VAULT_MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&encrypted);
    Ok(out)
}

fn open(key: &VaultKey, blob: &[u8]) -> Result<Vec<u8>, String> {
    let header = VAULT_MAGIC.len() + NONCE_LEN;
    if blob.len() <= header || &blob[..VAULT_MAGIC.len()] != VAULT_MAGIC {
        return Err("Неизвестный формат хранилища".to_string());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&blob[VAULT_MAGIC.len()..header]);
    cipher
        .decrypt(nonce, &blob[header..])
        .map_err(|_| "Не удалось расшифровать хранилище".to_string())
}

pub fn read_vault(path: &Path) -> Result<Option<Vec<u8>>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let blob = std::fs::read(path).map_err(|e| format!("Не удалось прочитать хранилище: {e}"))?;
    let key = master_key()?;
    match open(&key, &blob) {
        Ok(plain) => Ok(Some(plain)),
        Err(e) => {
            eprintln!("[Secrets] {e}: {}", path.display());
            Ok(None)
        }
    }
}

pub fn write_vault(path: &Path, plain: &[u8]) -> Result<(), String> {
    let key = master_key()?;
    write_atomic(path, seal(&key, plain)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: VaultKey = [7u8; KEY_LEN];

    #[test]
    fn seal_open_roundtrip() {
        let blob = seal(&KEY, b"token-value").unwrap();
        assert!(!blob.windows(11).any(|w| w == b"token-value"));
        assert_eq!(open(&KEY, &blob).unwrap(), b"token-value");
    }

    #[test]
    fn open_rejects_wrong_key_and_tampering() {
        let blob = seal(&KEY, b"secret").unwrap();
        assert!(open(&[8u8; KEY_LEN], &blob).is_err());

        let mut tampered = blob.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 1;
        assert!(open(&KEY, &tampered).is_err());

        assert!(open(&KEY, b"nope").is_err());
    }

    #[test]
    #[ignore]
    fn vault_roundtrip_with_system_keyring() {
        let dir = std::env::temp_dir().join(format!("secrets_vault_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("secrets.vault");
        let payload = "x".repeat(20_000).into_bytes();
        write_vault(&path, &payload).unwrap();
        assert_eq!(read_vault(&path).unwrap().unwrap(), payload);
        assert!(!std::fs::read(&path).unwrap().windows(64).any(|w| w == &payload[..64]));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_roundtrip() {
        let key = new_key();
        let sealed = dpapi::protect(&key).unwrap();
        assert!(!sealed.windows(KEY_LEN).any(|w| w == key));
        assert_eq!(dpapi::unprotect(&sealed).unwrap(), key);
        assert!(dpapi::unprotect(b"garbage").is_err());
    }

    #[test]
    fn seal_uses_fresh_nonce() {
        assert_ne!(seal(&KEY, b"same").unwrap(), seal(&KEY, b"same").unwrap());
    }
}
