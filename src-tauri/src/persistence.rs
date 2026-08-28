use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

const APP_DATA_FILE: &str = "mobaxtauri-data.json";
const CURRENT_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDataDocument {
    pub schema_version: u32,
    pub sessions: Vec<Value>,
    pub folders: Vec<Value>,
    pub snippets: Vec<Value>,
    pub workspaces: Vec<Value>,
    pub connection_history: Vec<Value>,
}

#[derive(Default)]
pub struct PersistenceService {
    write_lock: Mutex<()>,
}

impl PersistenceService {
    pub async fn load(&self, app_handle: &AppHandle) -> Result<Option<AppDataDocument>, String> {
        let path = data_path(app_handle)?;
        let backup_path = backup_path(&path);

        if path.exists() {
            return read_document(&path).map(Some);
        }
        if backup_path.exists() {
            return read_document(&backup_path).map(Some);
        }
        Ok(None)
    }

    pub async fn save(
        &self,
        app_handle: &AppHandle,
        mut document: AppDataDocument,
    ) -> Result<(), String> {
        let _guard = self.write_lock.lock().await;
        document.schema_version = CURRENT_SCHEMA_VERSION;
        strip_transient_session_fields(&mut document.sessions);

        let path = data_path(app_handle)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create app data directory: {error}"))?;
        }

        write_document_atomically(&path, &document)
    }
}

fn data_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map(|directory| directory.join(APP_DATA_FILE))
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.backup")
}

fn temporary_path(path: &Path) -> PathBuf {
    path.with_extension("json.tmp")
}

fn validate(document: AppDataDocument) -> Result<AppDataDocument, String> {
    if document.schema_version != CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported app data schema version: {}",
            document.schema_version
        ));
    }
    Ok(document)
}

fn read_document(path: &Path) -> Result<AppDataDocument, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|error| format!("Failed to read app data: {error}"))?;
    let document = serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse app data: {error}"))?;
    validate(document)
}

fn write_document_atomically(path: &Path, document: &AppDataDocument) -> Result<(), String> {
    let temporary = temporary_path(path);
    let backup = backup_path(path);
    let content = serde_json::to_vec_pretty(document)
        .map_err(|error| format!("Failed to serialize app data: {error}"))?;

    std::fs::write(&temporary, content)
        .map_err(|error| format!("Failed to write temporary app data: {error}"))?;

    if path.exists() {
        std::fs::copy(path, &backup)
            .map_err(|error| format!("Failed to back up app data: {error}"))?;
        std::fs::remove_file(path)
            .map_err(|error| format!("Failed to replace app data: {error}"))?;
    }

    if let Err(error) = std::fs::rename(&temporary, path) {
        if backup.exists() && !path.exists() {
            let _ = std::fs::rename(&backup, path);
        }
        return Err(format!("Failed to commit app data: {error}"));
    }

    if backup.exists() {
        let _ = std::fs::remove_file(backup);
    }
    Ok(())
}

fn strip_transient_session_fields(sessions: &mut [Value]) {
    for session in sessions {
        if let Some(object) = session.as_object_mut() {
            for field in [
                "password",
                "status",
                "error",
                "lastActivity",
                "health",
                "hasBell",
            ] {
                object.remove(field);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{strip_transient_session_fields, validate, AppDataDocument};
    use serde_json::json;

    fn document(schema_version: u32) -> AppDataDocument {
        AppDataDocument {
            schema_version,
            sessions: vec![],
            folders: vec![],
            snippets: vec![],
            workspaces: vec![],
            connection_history: vec![],
        }
    }

    #[test]
    fn rejects_unknown_schema_versions() {
        assert!(validate(document(2)).is_err());
    }

    #[test]
    fn strips_secrets_and_runtime_session_state() {
        let mut sessions = vec![json!({
            "id": "ssh-production",
            "name": "Production",
            "password": "secret",
            "status": "connected",
            "health": { "cpu": 10 },
            "host": "example.com"
        })];

        strip_transient_session_fields(&mut sessions);

        assert_eq!(
            sessions[0],
            json!({
                "id": "ssh-production",
                "name": "Production",
                "host": "example.com"
            })
        );
    }
}
