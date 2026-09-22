use std::sync::Mutex;
use tauri::AppHandle;
use tokio::sync::OnceCell;

use keyring::Entry;

/// Service that manages the encryption key for the credential vault.
///
/// The key is a random 32-byte value stored in the OS keychain
/// (Windows Credential Manager, macOS Keychain, or Linux Secret Service).
/// On first unlock, a key is generated and stored; subsequent unlocks
/// read it back.
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
    /// This method is idempotent and safe to call concurrently.
    async fn ensure_key(&self, _app_handle: &AppHandle) -> Result<(), String> {
        self.init
            .get_or_try_init(|| async {
                // Try to load an existing key from the keychain.
                if let Ok(Some(key_bytes)) = self.load_key_from_keychain().await {
                    *self.key.lock().unwrap() = Some(key_bytes);
                    return Ok::<(), String>(());
                }

                // No existing key: generate a new random 32-byte key.
                let mut key_bytes = [0u8; 32];
                getrandom::fill(&mut key_bytes)
                    .map_err(|e| format!("Failed to generate random key: {e}"))?;
                let key_vec = key_bytes.to_vec();

                // Store it in the keychain for next time.
                self.store_key_in_keychain(&key_vec).await?;

                *self.key.lock().unwrap() = Some(key_vec);
                Ok(())
            })
            .await?;
        Ok(())
    }

    /// Returns the key bytes, loading/generating if necessary.
    pub async fn get_key(&self, app_handle: &AppHandle) -> Result<Vec<u8>, String> {
        self.ensure_key(app_handle).await?;
        Ok(self
            .key
            .lock()
            .unwrap()
            .clone()
            .expect("Key should be loaded after ensure_key"))
    }

    /// Attempts to read the key from the OS keychain.
    async fn load_key_from_keychain(&self) -> Result<Option<Vec<u8>>, String> {
        let entry = Entry::new("com.dn201.mobaxtauri", "vault-key")
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
        let entry = Entry::new("com.dn201.mobaxtauri", "vault-key")
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
}
