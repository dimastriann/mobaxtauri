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

    // std::fs::rename replaces an existing destination on every platform
    // (Windows uses MoveFileEx with MOVEFILE_REPLACE_EXISTING), so the
    // old copy-backup/remove dance is unnecessary. The old file remains
    // intact if the write or rename fails midway.
    if let Err(error) = std::fs::rename(&temporary, path) {
        let _ = std::fs::remove_file(&temporary);
        return Err(format!("Failed to commit app data: {error}"));
    }

    // Leftovers from writes made by older versions using a .backup file.
    if backup.exists() {
        let _ = std::fs::remove_file(&backup);
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
                "healthHistory",
                "hasBell",
            ] {
                object.remove(field);
            }
        }
    }
}

/// What a selective backup export should carry: one session (plus its
/// parent folder for membership restore) or one folder with all members.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BackupSelection {
    Session(String),
    Folder(String),
}

/// Reflect the shape `useExportImport.ts` writes for full backups, so the
/// existing merge import accepts the filtered file unchanged.
pub fn build_backup_export(
    document: &AppDataDocument,
    selection: &BackupSelection,
    exported_at: &str,
) -> Option<(Value, usize)> {
    let selected_sessions: Vec<Value> = match selection {
        BackupSelection::Folder(folder_id) => document
            .sessions
            .iter()
            .filter(|session| session.get("folderId").and_then(Value::as_str) == Some(folder_id))
            .cloned()
            .collect(),
        BackupSelection::Session(session_id) => document
            .sessions
            .iter()
            .filter(|session| session.get("id").and_then(Value::as_str) == Some(session_id))
            .cloned()
            .collect(),
    };
    if selected_sessions.is_empty() {
        return None;
    }

    let selected_folders: Vec<Value> = match selection {
        BackupSelection::Folder(folder_id) => document
            .folders
            .iter()
            .filter(|folder| folder.get("id").and_then(Value::as_str) == Some(folder_id))
            .cloned()
            .collect(),
        BackupSelection::Session(_) => {
            let parent_folder_id = selected_sessions
                .first()
                .and_then(|session| session.get("folderId"))
                .and_then(Value::as_str);
            match parent_folder_id {
                Some(folder_id) => document
                    .folders
                    .iter()
                    .filter(|folder| folder.get("id").and_then(Value::as_str) == Some(folder_id))
                    .cloned()
                    .collect(),
                None => Vec::new(),
            }
        }
    };

    let mut sessions = selected_sessions;
    strip_transient_session_fields(&mut sessions);

    let export = serde_json::json!({
        "version": 1,
        "app": "mobaxtauri",
        "exportedAt": exported_at,
        "sessions": sessions,
        "folders": selected_folders,
    });
    Some((export, sessions.len()))
}

#[cfg(test)]
mod tests {
    use super::{
        build_backup_export, strip_transient_session_fields, validate, AppDataDocument,
        BackupSelection,
    };
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

    fn sample_document() -> AppDataDocument {
        let mut doc = document(1);
        doc.folders = vec![json!({ "id": "f1", "name": "Prod" })];
        doc.sessions = vec![
            json!({
                "id": "s1",
                "folderId": "f1",
                "password": "secret",
                "status": "connected",
                "healthHistory": [],
                "host": "h1"
            }),
            json!({ "id": "s2", "folderId": "f1", "host": "h2" }),
            json!({ "id": "s3", "host": "h3" }),
        ];
        doc
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

    #[test]
    fn session_selection_exports_session_and_parent_folder() {
        let (export, count) = build_backup_export(
            &sample_document(),
            &BackupSelection::Session("s1".to_string()),
            "2026-01-01T00:00:00.000Z",
        )
        .expect("selection must match a session");

        assert_eq!(count, 1);
        let sessions = export["sessions"].as_array().expect("sessions array");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0]["id"], "s1");
        assert!(sessions[0].get("password").is_none());
        assert!(sessions[0].get("healthHistory").is_none());
        let folders = export["folders"].as_array().expect("folders array");
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0]["id"].as_str(), Some("f1"));
        assert_eq!(export["app"], "mobaxtauri");
        assert_eq!(export["version"], 1);
    }

    #[test]
    fn folder_selection_exports_folder_and_members() {
        let (export, count) = build_backup_export(
            &sample_document(),
            &BackupSelection::Folder("f1".to_string()),
            "2026-01-01T00:00:00.000Z",
        )
        .expect("selection must match a folder");

        assert_eq!(count, 2);
        let sessions = export["sessions"].as_array().expect("sessions array");
        assert_eq!(sessions.len(), 2);
        let folders = export["folders"].as_array().expect("folders array");
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0]["id"].as_str(), Some("f1"));
    }

    #[test]
    fn unknown_selections_export_nothing() {
        assert!(build_backup_export(
            &sample_document(),
            &BackupSelection::Session("missing".to_string()),
            "2026-01-01T00:00:00.000Z"
        )
        .is_none());
        assert!(build_backup_export(
            &sample_document(),
            &BackupSelection::Folder("missing".to_string()),
            "2026-01-01T00:00:00.000Z"
        )
        .is_none());
    }
}
