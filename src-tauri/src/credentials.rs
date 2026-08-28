use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use iota_stronghold::Client;
use tauri_plugin_stronghold::stronghold::Stronghold;
use tokio::sync::Mutex;

const VAULT_FILE: &str = "mobaxtauri-v2.hold";
const CLIENT_NAME: &[u8] = b"mobaxtauri_client";
const APPLICATION_KEY: &[u8; 32] = b"mobaxtauri_stronghold_secure_key";

#[derive(Default)]
pub struct CredentialService {
    vault: Mutex<Option<CredentialVault>>,
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

        let path = vault_path(app_handle)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create vault directory: {error}"))?;
        }

        let loaded = tokio::task::spawn_blocking(move || {
            let stronghold = Stronghold::new(path, APPLICATION_KEY.to_vec())
                .map_err(|error| format!("Failed to open credential vault: {error}"))?;
            ensure_client(&stronghold)?;
            let client = stronghold
                .load_client(CLIENT_NAME)
                .map_err(|error| format!("Failed to load credential client: {error}"))?;
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

fn ensure_client(stronghold: &Stronghold) -> Result<(), String> {
    if stronghold.load_client(CLIENT_NAME).is_ok() {
        return Ok(());
    }
    stronghold
        .create_client(CLIENT_NAME)
        .map(|_| ())
        .map_err(|error| format!("Failed to create credential client: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{APPLICATION_KEY, CLIENT_NAME, VAULT_FILE};

    #[test]
    fn keeps_the_existing_v2_vault_identity() {
        assert_eq!(VAULT_FILE, "mobaxtauri-v2.hold");
        assert_eq!(CLIENT_NAME, b"mobaxtauri_client");
        assert_eq!(APPLICATION_KEY.len(), 32);
    }
}
