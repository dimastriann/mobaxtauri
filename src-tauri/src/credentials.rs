use crate::vault_key::VaultKeyService;
use iota_stronghold::Client;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_stronghold::stronghold::Stronghold;
use tokio::sync::Mutex as TokioMutex;

const VAULT_FILE: &str = "mobaxtauri-v3.hold";
const CLIENT_NAME: &[u8] = b"mobaxtauri_client";

#[derive(Default)]
pub struct CredentialService {
    vault: TokioMutex<Option<CredentialVault>>,
    /// Singleton service for managing the encryption key.
    vault_key: VaultKeyService,
}

struct CredentialVault {
    stronghold: Stronghold,
    client: Client,
}

impl CredentialService {
    pub async fn unlock(&self, app_handle: &AppHandle) -> Result<(), String> {
        let mut vault = self.vault.lock().await;
        if vault.is_some() {
            return Ok(());
        }

        // Get the encryption key from the keychain (or generate and store it).
        let key_bytes = self.vault_key.get_key(app_handle).await?;

        let path = vault_path(app_handle)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create app data directory: {error}"))?;
        }

        let loaded = tokio::task::spawn_blocking(move || {
            // Create a Stronghold instance using the key from the keychain.
            let stronghold = Stronghold::new(path, key_bytes)
                .map_err(|error| format!("Failed to open credential vault: {error}"))?;
            let client = match stronghold.load_client(CLIENT_NAME) {
                Ok(client) => client,
                Err(_) => stronghold
                    .create_client(CLIENT_NAME)
                    .map_err(|error| format!("Failed to create credential client: {error}"))?,
            };
            Ok::<CredentialVault, String>(CredentialVault { stronghold, client })
        })
        .await
        .map_err(|error| format!("Credential vault task failed: {error}"))??;

        *vault = Some(loaded);
        Ok(())
    }

    pub async fn save(
        &self,
        app_handle: &AppHandle,
        session_id: &str,
        secret: String,
    ) -> Result<(), String> {
        self.unlock(app_handle).await?;
        let vault = self.vault.lock().await;
        let loaded = vault.as_ref().ok_or("Credential vault is locked")?;
        loaded
            .client
            .store()
            .insert(session_id.as_bytes().to_vec(), secret.into_bytes(), None)
            .map_err(|error| format!("Failed to save credential: {error}"))?;
        loaded
            .stronghold
            .save()
            .map_err(|error| format!("Failed to persist credential vault: {error}"))
    }

    pub async fn get(
        &self,
        app_handle: &AppHandle,
        session_id: &str,
    ) -> Result<Option<String>, String> {
        self.unlock(app_handle).await?;
        let vault = self.vault.lock().await;
        let loaded = vault.as_ref().ok_or("Credential vault is locked")?;
        let secret = loaded
            .client
            .store()
            .get(session_id.as_bytes())
            .map_err(|error| format!("Failed to read credential: {error}"))?;

        secret
            .map(|bytes| {
                String::from_utf8(bytes)
                    .map_err(|_| "Stored credential is not valid UTF-8".to_string())
            })
            .transpose()
    }

    pub async fn delete(&self, app_handle: &AppHandle, session_id: &str) -> Result<(), String> {
        self.unlock(app_handle).await?;
        let vault = self.vault.lock().await;
        let loaded = vault.as_ref().ok_or("Credential vault is locked")?;
        loaded
            .client
            .store()
            .delete(session_id.as_bytes())
            .map_err(|error| format!("Failed to delete credential: {error}"))?;
        loaded
            .stronghold
            .save()
            .map_err(|error| format!("Failed to persist credential vault: {error}"))
    }
}

fn vault_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map(|directory| directory.join(VAULT_FILE))
        .map_err(|error| format!("Failed to resolve vault path: {error}"))
}
