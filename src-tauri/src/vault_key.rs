use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tokio::sync::OnceCell;

use argon2::{Algorithm, Argon2, Params, Version};
use keyring::Entry;
use serde::{Deserialize, Serialize};

/// Sentinel the frontend matches to prompt for the vault master password.
/// Followed by nothing the client depends on.
pub const MASTER_PASSWORD_REQUIRED: &str = "VAULT MASTER PASSWORD REQUIRED";

const KEYCHAIN_SERVICE: &str = "com.dn201.mobaxtauri";
const KEYCHAIN_ACCOUNT: &str = "vault-key";
const MASTER_KEY_FILE: &str = "vault-key.json";
const SALT_BYTES: usize = 16;
const DEFAULT_M_COST: u32 = 19_456; // 19 MiB, OWASP minimum
const DEFAULT_T_COST: u32 = 2;
const DEFAULT_P_COST: u32 = 1;

/// Argon2id parameters persisted alongside the salt so future tuning keeps
/// opening existing vaults.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct MasterKeyParams {
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
}

impl Default for MasterKeyParams {
    fn default() -> Self {
        Self {
            m_cost: DEFAULT_M_COST,
            t_cost: DEFAULT_T_COST,
            p_cost: DEFAULT_P_COST,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct MasterKeyFile {
    version: u32,
    salt: String,
    params: MasterKeyParams,
}

/// Derives the 32-byte vault key from a master password. Deterministic for
/// one (password, salt, params) triple.
fn derive_master_key(
    password: &str,
    salt: &[u8],
    params: MasterKeyParams,
) -> Result<Vec<u8>, String> {
    let params = Params::new(params.m_cost, params.t_cost, params.p_cost, Some(32))
        .map_err(|error| format!("Invalid vault key parameters: {error}"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0_u8; 32];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|error| format!("Failed to derive the vault key: {error}"))?;
    Ok(key.to_vec())
}

fn master_key_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map(|directory| directory.join(MASTER_KEY_FILE))
        .map_err(|error| format!("Failed to resolve the vault key path: {error}"))
}

fn read_master_key_file(path: &Path) -> Result<Option<MasterKeyFile>, String> {
    match std::fs::read_to_string(path) {
        Ok(json) => serde_json::from_str(&json)
            .map(Some)
            .map_err(|error| format!("Failed to parse {MASTER_KEY_FILE}: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Failed to read {MASTER_KEY_FILE}: {error}")),
    }
}

fn write_master_key_file(path: &Path, file: &MasterKeyFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create the app data directory: {error}"))?;
    }
    let json = serde_json::to_string_pretty(file)
        .map_err(|error| format!("Failed to serialize {MASTER_KEY_FILE}: {error}"))?;
    std::fs::write(path, json)
        .map_err(|error| format!("Failed to write {MASTER_KEY_FILE}: {error}"))
}

/// Service that manages the encryption key for the credential vault.
///
/// The key is a random 32-byte value stored in the OS keychain
/// (Windows Credential Manager, macOS Keychain, or Linux Secret Service).
/// On first unlock, a key is generated and stored; subsequent unlocks
/// read it back. When the keychain is unavailable (minimal Linux without
/// a Secret Service), the key is instead derived from a user master
/// password with Argon2id, with the salt kept next to the app data.
#[derive(Default)]
pub struct VaultKeyService {
    /// Cached key bytes, or None if not yet loaded/generated.
    key: Mutex<Option<Vec<u8>>>,
    /// Ensures we only attempt to load/generate the key once per AppHandle.
    init: OnceCell<()>,
}

impl VaultKeyService {
    /// Asynchronously ensures the key is loaded or generated.
    ///
    /// This method is idempotent and safe to call concurrently. A failed
    /// attempt (for example a missing master password) is not cached, so
    /// the caller can retry with the password.
    async fn ensure_key(
        &self,
        app_handle: &AppHandle,
        master_password: Option<&str>,
        vault_exists: bool,
    ) -> Result<(), String> {
        self.init
            .get_or_try_init(|| async {
                let master_path = master_key_path(app_handle)?;

                // Master-password mode wins whenever it is configured: the
                // vault was created while no keychain was available.
                if let Some(file) = read_master_key_file(&master_path)? {
                    let Some(password) = master_password else {
                        return Err(MASTER_PASSWORD_REQUIRED.to_string());
                    };
                    let key = derive_master_key(password, &hex_decode(&file.salt)?, file.params)?;
                    *self.key.lock().unwrap() = Some(key);
                    log::info!("Vault key derived from the master password");
                    return Ok::<(), String>(());
                }

                match self.load_key_from_keychain().await {
                    Ok(Some(key_bytes)) => {
                        *self.key.lock().unwrap() = Some(key_bytes);
                        return Ok(());
                    }
                    Ok(None) => {}
                    Err(error) => {
                        log::warn!("OS keychain unavailable: {error}");
                        return self
                            .master_password_fallback(master_path, master_password, vault_exists)
                            .await;
                    }
                }

                // Keychain reachable but empty: generate and persist.
                let mut key_bytes = [0u8; 32];
                getrandom::fill(&mut key_bytes)
                    .map_err(|e| format!("Failed to generate random key: {e}"))?;
                let key_vec = key_bytes.to_vec();
                match self.store_key_in_keychain(&key_vec).await {
                    Ok(()) => {
                        *self.key.lock().unwrap() = Some(key_vec);
                        Ok(())
                    }
                    Err(error) => {
                        log::warn!("OS keychain cannot store the vault key: {error}");
                        self.master_password_fallback(master_path, master_password, vault_exists)
                            .await
                    }
                }
            })
            .await?;
        Ok(())
    }

    /// Uses a master-password-derived key when the keychain is unusable.
    /// A vault created with a keychain key cannot be opened this way; the
    /// error tells the user to restore the keychain instead of silently
    /// replacing the key (which would make the vault unreadable anyway).
    async fn master_password_fallback(
        &self,
        master_path: PathBuf,
        master_password: Option<&str>,
        vault_exists: bool,
    ) -> Result<(), String> {
        if vault_exists {
            return Err(
                "The OS keychain is unavailable and this vault was encrypted with a keychain                  key. Restore the system keychain (for example start GNOME Keyring or KWallet)                  to access saved credentials."
                    .to_string(),
            );
        }
        let Some(password) = master_password else {
            return Err(MASTER_PASSWORD_REQUIRED.to_string());
        };
        if password.trim().is_empty() {
            return Err("The vault master password cannot be empty.".to_string());
        }
        let mut salt = [0u8; SALT_BYTES];
        getrandom::fill(&mut salt)
            .map_err(|error| format!("Failed to generate a salt: {error}"))?;
        let params = MasterKeyParams::default();
        let key = derive_master_key(password, &salt, params)?;
        write_master_key_file(
            &master_path,
            &MasterKeyFile {
                version: 1,
                salt: hex_encode(&salt),
                params,
            },
        )?;
        *self.key.lock().unwrap() = Some(key);
        log::info!("Created a master-password vault key (OS keychain unavailable)");
        Ok(())
    }

    /// Returns the key bytes, loading/generating if necessary.
    ///
    /// `vault_exists` tells the fallback whether a vault file is already on
    /// disk; a keychain-encrypted vault cannot be re-keyed when the
    /// keychain disappears.
    pub async fn get_key(
        &self,
        app_handle: &AppHandle,
        master_password: Option<&str>,
        vault_exists: bool,
    ) -> Result<Vec<u8>, String> {
        self.ensure_key(app_handle, master_password, vault_exists)
            .await?;
        Ok(self
            .key
            .lock()
            .unwrap()
            .clone()
            .expect("Key should be loaded after ensure_key"))
    }

    /// Attempts to read the key from the OS keychain.
    async fn load_key_from_keychain(&self) -> Result<Option<Vec<u8>>, String> {
        let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
            .map_err(|e| format!("Failed to create keyring entry: {e}"))?;

        match entry.get_password() {
            Ok(password) => {
                let key_bytes = hex_decode(&password)?;
                if key_bytes.len() != 32 {
                    return Err(format!(
                        "Keychain key has wrong length: {} bytes (expected 32)",
                        key_bytes.len()
                    ));
                }
                Ok(Some(key_bytes))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Failed to read password from keychain: {e}")),
        }
    }

    /// Stores the key in the OS keychain as a hex string.
    async fn store_key_in_keychain(&self, key_bytes: &[u8]) -> Result<(), String> {
        let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
            .map_err(|e| format!("Failed to create keyring entry: {e}"))?;

        let hex_key = hex_encode(key_bytes);
        entry
            .set_password(&hex_key)
            .map_err(|e| format!("Failed to store key in keychain: {e}"))?;
        Ok(())
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    if !s.len().is_multiple_of(2) {
        return Err("Invalid hex string length".into());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&s[i..i + 2], 16)
                .map_err(|e| format!("Invalid hex byte at position {i}: {e}"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hex_roundtrip() {
        let original = vec![0x00, 0x12, 0xab, 0xcd, 0xef, 0xff];
        let encoded = hex_encode(&original);
        assert_eq!(encoded, "0012abcdefff");
        let decoded = hex_decode(&encoded).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn test_hex_decode_invalid() {
        assert!(hex_decode("123").is_err());
        assert!(hex_decode("1g").is_err());
    }

    #[test]
    fn test_vault_key_service_default() {
        let service = VaultKeyService::default();
        assert!(service.key.lock().unwrap().is_none());
    }

    /// Cheap parameters keep the derivation tests fast; production uses
    /// the OWASP baseline from MasterKeyParams::default().
    fn fast_params() -> MasterKeyParams {
        MasterKeyParams {
            m_cost: 8,
            t_cost: 1,
            p_cost: 1,
        }
    }

    #[test]
    fn master_key_derivation_is_deterministic_and_password_bound() {
        let salt = b"0123456789abcdef";
        let first = derive_master_key("correct horse", salt, fast_params()).unwrap();
        let second = derive_master_key("correct horse", salt, fast_params()).unwrap();
        assert_eq!(first, second, "derivation must be deterministic");
        assert_eq!(first.len(), 32);

        let other_password = derive_master_key("battery staple", salt, fast_params()).unwrap();
        assert_ne!(first, other_password, "password must change the key");

        let other_salt = b"fedcba9876543210";
        let other = derive_master_key("correct horse", other_salt, fast_params()).unwrap();
        assert_ne!(first, other, "salt must change the key");
    }

    #[test]
    fn master_key_file_round_trips_and_rejects_garbage() {
        let dir = std::env::temp_dir().join(format!("moba-vault-key-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(MASTER_KEY_FILE);

        assert!(read_master_key_file(&path).unwrap().is_none());

        let file = MasterKeyFile {
            version: 1,
            salt: hex_encode(&[0xab; SALT_BYTES]),
            params: fast_params(),
        };
        write_master_key_file(&path, &file).unwrap();
        assert_eq!(read_master_key_file(&path).unwrap(), Some(file));

        std::fs::write(&path, "not json").unwrap();
        assert!(read_master_key_file(&path).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
