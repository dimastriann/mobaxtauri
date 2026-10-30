mod credentials;
mod health;
pub mod known_hosts;
mod persistence;
mod recording;
mod session_manager;
mod session_types;
mod sftp_conflict;
pub mod sftp_transfer;
mod sftp_utils;
pub mod ssh;
pub mod transfers;
mod vault_key;

use crate::credentials::CredentialService;
use crate::health::{collect_health, HealthSnapshot};
use crate::known_hosts::KnownHostsService;
use crate::persistence::{AppDataDocument, PersistenceService};
use crate::session_manager::SessionManager;
use crate::session_types::{
    emit_ssh_health, emit_ssh_session_state, SshConnectRequest, SshDisconnectReason,
    SshSessionStatus,
};
use crate::ssh::SshSession;
use crate::transfers::TransferManager;
use bytes::Bytes;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

pub struct AppState {
    pub ssh_sessions: SessionManager,
    pub sftp_sessions: Mutex<HashMap<String, std::sync::Arc<russh_sftp::client::SftpSession>>>,
    pub sftp_homes: Mutex<HashMap<String, String>>,
}

#[tauri::command]
fn set_health_interval(state: State<'_, AppState>, seconds: u64) -> Result<(), String> {
    if seconds != 0 && !matches!(seconds, 2 | 5 | 15 | 60) {
        return Err("Health interval must be 0, 2, 5, 15, or 60 seconds".into());
    }
    state
        .ssh_sessions
        .set_health_interval(if seconds == 0 { 86_400 } else { seconds });
    Ok(())
}

#[tauri::command]
fn set_health_visibility(state: State<'_, AppState>, visible: bool) -> Result<(), String> {
    state.ssh_sessions.set_health_visibility(visible);
    Ok(())
}

#[tauri::command]
async fn ssh_trust_host_key(
    app_handle: AppHandle,
    known_hosts: State<'_, KnownHostsService>,
    host: String,
    port: u16,
    key_type: String,
    fingerprint: String,
) -> Result<(), String> {
    known_hosts
        .trust(&app_handle, &host, port, key_type, fingerprint)
        .await
}

#[tauri::command]
async fn credential_unlock(
    app_handle: AppHandle,
    credentials: State<'_, CredentialService>,
) -> Result<(), String> {
    credentials.unlock(&app_handle).await
}

#[tauri::command]
async fn credential_save(
    app_handle: AppHandle,
    credentials: State<'_, CredentialService>,
    session_id: String,
    secret: String,
) -> Result<(), String> {
    credentials.save(&app_handle, &session_id, secret).await
}

#[tauri::command]
async fn credential_delete(
    app_handle: AppHandle,
    credentials: State<'_, CredentialService>,
    session_id: String,
) -> Result<(), String> {
    credentials.delete(&app_handle, &session_id).await
}

#[tauri::command]
async fn load_app_data(
    app_handle: AppHandle,
    persistence: State<'_, PersistenceService>,
) -> Result<Option<AppDataDocument>, String> {
    persistence.load(&app_handle).await
}

#[tauri::command]
async fn save_app_data(
    app_handle: AppHandle,
    persistence: State<'_, PersistenceService>,
    document: AppDataDocument,
) -> Result<(), String> {
    persistence.save(&app_handle, document).await
}

#[tauri::command]
async fn ssh_connect(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    credentials: State<'_, CredentialService>,
    known_hosts: State<'_, KnownHostsService>,
    request: SshConnectRequest,
) -> Result<String, String> {
    let connection_timeout = request.connection_timeout()?;
    let SshConnectRequest {
        session_id,
        host,
        port,
        user,
        password,
        private_key_path,
        key_passphrase,
        use_saved_credential,
        use_agent,
        connection_timeout_secs: _,
    } = request;
    log::info!("Attempting to connect to {}:{} as {}", host, port, user);
    emit_ssh_session_state(
        &app_handle,
        session_id.clone(),
        SshSessionStatus::Connecting,
        None,
        None,
    );

    let password = if password.is_none() && use_saved_credential {
        match credentials.get(&app_handle, &session_id).await? {
            Some(secret) => Some(secret),
            None => {
                let message = "Saved credential is unavailable".to_string();
                emit_ssh_session_state(
                    &app_handle,
                    session_id,
                    SshSessionStatus::Failed,
                    Some(message.clone()),
                    None,
                );
                return Err(message);
            }
        }
    } else {
        password
    };

    let connect_future = SshSession::connect(
        app_handle.clone(),
        session_id.clone(),
        host,
        port,
        user,
        password,
        private_key_path,
        key_passphrase,
        use_agent,
        Arc::new(known_hosts.inner().clone()),
    );

    let (handle, channel_id, channel, sftp) =
        match tokio::time::timeout(connection_timeout, connect_future).await {
            Ok(Ok(res)) => res,
            Ok(Err(e)) => {
                log::error!("Connection error: {}", e);
                let message = format!("Connection failed: {e}");
                emit_ssh_session_state(
                    &app_handle,
                    session_id,
                    SshSessionStatus::Failed,
                    Some(message.clone()),
                    None,
                );
                return Err(message);
            }
            Err(_) => {
                let timeout_secs = connection_timeout.as_secs();
                log::error!("Connection timed out after {timeout_secs}s");
                let message = format!("Connection timed out after {timeout_secs} seconds");
                emit_ssh_session_state(
                    &app_handle,
                    session_id,
                    SshSessionStatus::Failed,
                    Some(message.clone()),
                    None,
                );
                return Err(message);
            }
        };

    log::info!("Successfully connected to session {}", session_id);

    // Clean up any existing session with the same ID
    state.ssh_sessions.remove(&session_id).await;
    state.sftp_sessions.lock().await.remove(&session_id);
    state.sftp_homes.lock().await.remove(&session_id);
    emit_ssh_health(&app_handle, session_id.clone(), None);

    state
        .ssh_sessions
        .insert(
            app_handle.clone(),
            session_id.clone(),
            handle,
            channel_id,
            channel,
        )
        .await;
    state
        .sftp_sessions
        .lock()
        .await
        .insert(session_id.clone(), std::sync::Arc::new(sftp));

    emit_ssh_session_state(
        &app_handle,
        session_id.clone(),
        SshSessionStatus::Connected,
        None,
        None,
    );

    Ok(format!("Connected to session {}", session_id))
}

#[tauri::command]
async fn ssh_send_data(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let (handle, channel_id, write_lock) = state.ssh_sessions.shell_target(&session_id).await?;
    let _write_guard = write_lock.lock().await;
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        handle.data(channel_id, Bytes::from(data.as_bytes().to_vec())),
    )
    .await
    .map_err(|_| "Send timed out".to_string())?
    .map_err(|_| "Send failed".to_string())
}

#[tauri::command]
async fn ssh_disconnect(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    transfers: State<'_, TransferManager>,
    session_id: String,
) -> Result<(), String> {
    state.ssh_sessions.remove(&session_id).await;
    transfers.cancel_session(&session_id).await;
    state.sftp_sessions.lock().await.remove(&session_id);
    state.sftp_homes.lock().await.remove(&session_id);

    emit_ssh_session_state(
        &app_handle,
        session_id,
        SshSessionStatus::Disconnected,
        Some("Disconnected by request".into()),
        Some(SshDisconnectReason::Requested),
    );

    Ok(())
}

#[tauri::command]
async fn ssh_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let channel = state.ssh_sessions.shell_write_half(&session_id).await?;
    tokio::time::timeout(
        std::time::Duration::from_secs(3),
        channel.window_change(cols, rows, 0, 0),
    )
    .await
    .map_err(|_| "Resize timed out".to_string())?
    .map_err(|e| format!("Resize failed: {e:?}"))
}

#[tauri::command]
async fn sftp_list_dir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<Vec<serde_json::Value>, String> {
    let sftp_sessions = state.sftp_sessions.lock().await;
    if let Some(sftp) = sftp_sessions.get(&session_id) {
        let path = if path.is_empty() { "." } else { &path };
        let entries = tokio::time::timeout(std::time::Duration::from_secs(30), sftp.read_dir(path))
            .await
            .map_err(|_| "Failed to read directory: Operation timed out after 30s".to_string())?
            .map_err(|e| format!("Failed to read directory: {e:?}"))?;

        let mut result = Vec::new();
        for entry in entries {
            let metadata = entry.metadata();
            let modified = metadata.modified().ok().and_then(|t| {
                t.duration_since(std::time::UNIX_EPOCH)
                    .ok()
                    .map(|d| d.as_secs())
            });

            let is_dir = metadata.is_dir();
            let permissions_str =
                crate::sftp_utils::format_permissions(metadata.permissions, is_dir);

            result.push(serde_json::json!({
                "name": entry.file_name(),
                "is_dir": is_dir,
                "is_file": !is_dir,
                "size": metadata.len(),
                "modified": modified,
                "uid": metadata.uid,
                "gid": metadata.gid,
                "permissions": permissions_str,
            }));
        }
        Ok(result)
    } else {
        Err("SFTP session not found".into())
    }
}

#[tauri::command]
async fn sftp_download_file(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    transfers: State<'_, TransferManager>,
    session_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
) -> Result<(), String> {
    let sftp = state
        .sftp_sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or("SFTP session not found")?;
    crate::sftp_transfer::download_file(
        &app_handle,
        &sftp,
        &transfers,
        session_id,
        remote_path,
        local_path,
        transfer_id,
    )
    .await
}

#[tauri::command]
// Tauri commands receive named keyword arguments over IPC, so a params
// struct would change the wire contract; the argument list mirrors the
// event/transfer contract instead.
#[allow(clippy::too_many_arguments)]
async fn sftp_upload_file(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    transfers: State<'_, TransferManager>,
    session_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
    conflict_policy: Option<String>,
) -> Result<(), String> {
    let sftp = state
        .sftp_sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or("SFTP session not found")?;
    crate::sftp_transfer::upload_file(
        &app_handle,
        &sftp,
        &transfers,
        session_id,
        local_path,
        remote_path,
        transfer_id,
        conflict_policy,
    )
    .await
}

#[tauri::command]
async fn sftp_cancel_transfer(
    transfers: State<'_, TransferManager>,
    transfer_id: String,
) -> Result<(), String> {
    if transfers.cancel(&transfer_id).await {
        Ok(())
    } else {
        Err("Transfer not found".into())
    }
}

#[tauri::command]
// Tauri commands receive named keyword arguments over IPC, so a params
// struct would change the wire contract; the argument list mirrors the
// event/transfer contract instead.
#[allow(clippy::too_many_arguments)]
async fn sftp_copy_file(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    transfers: State<'_, TransferManager>,
    session_id: String,
    source_path: String,
    dest_path: String,
    transfer_id: String,
    conflict_policy: Option<String>,
) -> Result<(), String> {
    let sftp = state
        .sftp_sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or("SFTP session not found")?;
    crate::sftp_transfer::copy_file(
        &app_handle,
        &sftp,
        &transfers,
        session_id,
        source_path,
        dest_path,
        transfer_id,
        conflict_policy,
    )
    .await
}

#[tauri::command]
async fn sftp_open_file(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    remote_path: String,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    log::info!("Opening file locally {}", remote_path);
    let sftp = state
        .sftp_sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or("SFTP session not found")?;

    let metadata = sftp
        .metadata(&remote_path)
        .await
        .map_err(|e| format!("Failed to stat remote file: {e:?}"))?;
    if let Some(error) = crate::sftp_utils::file_too_large_error(
        metadata.size,
        crate::sftp_utils::OPEN_MAX_FILE_BYTES,
    ) {
        return Err(error);
    }

    let mut remote_file = sftp
        .open(&remote_path)
        .await
        .map_err(|e| format!("Failed to open remote file: {e:?}"))?;

    let file_name = std::path::Path::new(&remote_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("temp_sftp_file");

    let mut temp_path = std::env::temp_dir();
    temp_path.push(file_name);

    let mut temp_file = tokio::fs::File::create(&temp_path)
        .await
        .map_err(|e| format!("Failed to create temp file: {e:?}"))?;
    let mut buffer = vec![0_u8; 64 * 1024];

    let result = async {
        loop {
            let count = remote_file
                .read(&mut buffer)
                .await
                .map_err(|e| format!("Read failed: {e:?}"))?;
            if count == 0 {
                break;
            }
            temp_file
                .write_all(&buffer[..count])
                .await
                .map_err(|e| format!("Failed to write temp file: {e:?}"))?;
        }
        temp_file
            .flush()
            .await
            .map_err(|e| format!("Failed to flush temp file: {e:?}"))
    }
    .await;

    if result.is_err() {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return result;
    }

    app_handle
        .opener()
        .open_path(temp_path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Failed to open: {e:?}"))?;

    Ok(())
}

#[tauri::command]
async fn sftp_rename(
    state: State<'_, AppState>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    log::info!("Renaming SFTP {} to {}", old_path, new_path);
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or("SFTP session not found")?;

    sftp.rename(&old_path, &new_path)
        .await
        .map_err(|e| format!("Rename failed: {e:?}"))?;

    Ok(())
}

#[tauri::command]
async fn sftp_read_file_content(
    state: State<'_, AppState>,
    session_id: String,
    remote_path: String,
) -> Result<SftpReadFileContent, String> {
    log::info!("Reading file content {}", remote_path);
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or("SFTP session not found")?;

    let metadata = sftp
        .metadata(&remote_path)
        .await
        .map_err(|e| format!("Failed to stat remote file: {e:?}"))?;
    if let Some(error) = crate::sftp_utils::file_too_large_error(
        metadata.size,
        crate::sftp_utils::EDITOR_MAX_FILE_BYTES,
    ) {
        return Err(error);
    }

    let mut remote_file = sftp
        .open(&remote_path)
        .await
        .map_err(|e| format!("Failed to open remote file: {e:?}"))?;
    let mut data: Vec<u8> = Vec::new();
    remote_file
        .read_to_end(&mut data)
        .await
        .map_err(|e| format!("Read failed: {e:?}"))?;

    String::from_utf8(data)
        .map(|content| SftpReadFileContent {
            content,
            mtime: metadata.mtime,
        })
        .map_err(|e| format!("File is not valid UTF-8: {e:?}"))
}

#[tauri::command]
// Tauri commands receive named keyword arguments over IPC, so a params
// struct would change the wire contract; the argument list mirrors the
// event/transfer contract instead.
#[allow(clippy::too_many_arguments)]
async fn sftp_download_folder(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    transfers: State<'_, TransferManager>,
    session_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
    conflict_policy: Option<String>,
) -> Result<(), String> {
    let sftp = state
        .sftp_sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or("SFTP session not found")?;
    crate::sftp_transfer::download_folder(
        &app_handle,
        &sftp,
        &transfers,
        session_id,
        remote_path,
        local_path,
        transfer_id,
        conflict_policy,
    )
    .await
}

#[tauri::command]
// Tauri commands receive named keyword arguments over IPC, so a params
// struct would change the wire contract; the argument list mirrors the
// event/transfer contract instead.
#[allow(clippy::too_many_arguments)]
async fn sftp_upload_folder(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    transfers: State<'_, TransferManager>,
    session_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
    conflict_policy: Option<String>,
) -> Result<(), String> {
    let sftp = state
        .sftp_sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or("SFTP session not found")?;
    crate::sftp_transfer::upload_folder(
        &app_handle,
        &sftp,
        &transfers,
        session_id,
        local_path,
        remote_path,
        transfer_id,
        conflict_policy,
    )
    .await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SftpReadFileContent {
    content: String,
    mtime: Option<u32>,
}

#[tauri::command]
async fn sftp_write_file_content(
    state: State<'_, AppState>,
    session_id: String,
    remote_path: String,
    content: String,
    expected_mtime: Option<u32>,
) -> Result<(), String> {
    log::info!("Writing file content {}", remote_path);
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or("SFTP session not found")?;

    if let Ok(metadata) = sftp.metadata(&remote_path).await {
        if let (Some(expected), Some(current)) = (expected_mtime, metadata.mtime) {
            if expected != current {
                return Err(crate::sftp_conflict::file_changed_error(&remote_path));
            }
        }
    }

    let mut remote_file = sftp
        .create(&remote_path)
        .await
        .map_err(|e| format!("Failed to create remote file: {e:?}"))?;
    remote_file
        .write_all(content.as_bytes())
        .await
        .map_err(|e| format!("Write failed: {e:?}"))?;

    Ok(())
}

#[tauri::command]
async fn sftp_remove(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    log::info!("Removing SFTP path: {} (is_dir: {})", path, is_dir);
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or("SFTP session not found")?;

    if is_dir {
        // Simple recursive delete implementation
        async fn recursive_remove(
            sftp: &russh_sftp::client::SftpSession,
            path: &str,
        ) -> Result<(), String> {
            let entries = sftp
                .read_dir(path)
                .await
                .map_err(|e| format!("Read dir failed during delete: {e:?}"))?;

            for entry in entries {
                let name = entry.file_name();
                if name == "." || name == ".." {
                    continue;
                }

                let full_path = crate::sftp_utils::join_sftp_path(path, &name);
                let meta = entry.metadata();

                if meta.is_dir() {
                    Box::pin(recursive_remove(sftp, &full_path)).await?;
                } else {
                    sftp.remove_file(&full_path)
                        .await
                        .map_err(|e| format!("Remove file failed: {e:?}"))?;
                }
            }
            sftp.remove_dir(path)
                .await
                .map_err(|e| format!("Remove directory failed: {e:?}"))?;
            Ok(())
        }

        recursive_remove(sftp, &path).await?;
    } else {
        sftp.remove_file(&path)
            .await
            .map_err(|e| format!("Remove file failed: {e:?}"))?;
    }

    Ok(())
}

#[tauri::command]
async fn sftp_create_file(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    conflict_policy: Option<String>,
) -> Result<(), String> {
    log::info!("Creating SFTP file {}", path);
    let sftp = state
        .sftp_sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or("SFTP session not found")?;
    let target_path = crate::sftp_conflict::resolve_destination(
        &sftp,
        &path,
        crate::sftp_conflict::parse_conflict_policy(conflict_policy.as_deref()),
    )
    .await?;
    let Some(target_path) = target_path else {
        return Ok(());
    };

    let _remote_file = sftp
        .create(&target_path)
        .await
        .map_err(|e| format!("Failed to create file: {e:?}"))?;

    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SftpPathVariants {
    full_path: String,
    relative_to_home: String,
    name: String,
}

#[tauri::command]
async fn sftp_path_variants(
    state: State<'_, AppState>,
    session_id: String,
    remote_path: String,
) -> Result<SftpPathVariants, String> {
    let sftp = state
        .sftp_sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or("SFTP session not found")?;
    let cached_home = state.sftp_homes.lock().await.get(&session_id).cloned();
    let home = match cached_home {
        Some(home) => Some(home),
        None => {
            let resolved = sftp.canonicalize(".").await.ok();
            if let Some(home) = &resolved {
                state
                    .sftp_homes
                    .lock()
                    .await
                    .insert(session_id.clone(), home.clone());
            }
            resolved
        }
    };
    let name = crate::sftp_utils::final_segment(&remote_path);
    let relative_to_home = crate::sftp_utils::relative_to_home(&remote_path, home.as_deref())
        .unwrap_or_else(|| remote_path.clone());
    Ok(SftpPathVariants {
        full_path: remote_path,
        relative_to_home,
        name,
    })
}

#[tauri::command]
async fn sftp_create_dir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    log::info!("Creating SFTP directory: {}", path);
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or("SFTP session not found")?;

    sftp.create_dir(&path)
        .await
        .map_err(|e| format!("Create directory failed: {e:?}"))?;

    Ok(())
}

#[tauri::command]
async fn sftp_local_entries(
    paths: Vec<String>,
) -> Result<Vec<crate::sftp_utils::LocalEntry>, String> {
    log::info!("Classifying {} dropped paths", paths.len());
    crate::sftp_utils::classify_local_paths(paths).await
}

#[tauri::command]
async fn ssh_agent_list_keys() -> Result<Vec<SshAgentKey>, String> {
    let mut agent = crate::ssh::connect_agent_client().await?;
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| format!("Failed to query the SSH agent: {e}"))?;
    Ok(identities
        .into_iter()
        .map(|identity| {
            let key = identity.public_key().into_owned();
            SshAgentKey {
                fingerprint: key.fingerprint(russh::keys::HashAlg::Sha256).to_string(),
                algorithm: key.algorithm().to_string(),
                comment: identity.comment().to_string(),
            }
        })
        .collect())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SshAgentKey {
    fingerprint: String,
    algorithm: String,
    comment: String,
}

#[tauri::command]
async fn ssh_health_check(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<HealthSnapshot, String> {
    let handle = state.ssh_sessions.connection_handle(&session_id).await?;
    collect_health(handle).await
}

#[tauri::command]
async fn ssh_detect_os(state: State<'_, AppState>, session_id: String) -> Result<String, String> {
    let handle = state.ssh_sessions.connection_handle(&session_id).await?;

    let exec_channel = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        handle.channel_open_session(),
    )
    .await
    .map_err(|_| "Timed out opening OS detection channel".to_string())?
    .map_err(|e| format!("Failed to open exec channel: {e}"))?;

    let cmd = "OS_ID=$(cat /etc/os-release 2>/dev/null | grep '^ID=' | cut -d= -f2 | tr -d '\"'); if [ -n \"$OS_ID\" ]; then echo \"$OS_ID\"; else uname -s 2>/dev/null || echo \"unknown\"; fi";

    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        exec_channel.exec(true, cmd),
    )
    .await
    .map_err(|_| "Timed out starting OS detection".to_string())?
    .map_err(|e| format!("Failed to exec detect cmd: {e}"))?;

    let mut output = String::new();
    let mut stream = exec_channel.into_stream();
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        stream.read_to_string(&mut output),
    )
    .await
    .map_err(|_| "OS detection timed out".to_string())?;

    let os = output.trim().to_lowercase();
    if os.is_empty() {
        Ok("unknown".to_string())
    } else {
        Ok(os)
    }
}

#[tauri::command]
async fn export_app_data_backup(
    app_handle: AppHandle,
    persistence: State<'_, PersistenceService>,
    path: String,
    session_id: Option<String>,
    folder_id: Option<String>,
    exported_at: String,
) -> Result<usize, String> {
    let selection = match (session_id, folder_id) {
        (Some(id), None) => crate::persistence::BackupSelection::Session(id),
        (None, Some(id)) => crate::persistence::BackupSelection::Folder(id),
        (Some(_), Some(_)) | (None, None) => {
            return Err("Provide exactly one of sessionId or folderId".to_string())
        }
    };
    let document = persistence
        .load(&app_handle)
        .await?
        .ok_or("No saved session data found")?;
    let (export, count) =
        crate::persistence::build_backup_export(&document, &selection, &exported_at)
            .ok_or_else(|| "No matching session data to export".to_string())?;
    let content = serde_json::to_string_pretty(&export)
        .map_err(|e| format!("Failed to serialize backup: {e}"))?;
    std::fs::write(&path, content).map_err(|e| format!("Failed to write backup file: {e}"))?;
    Ok(count)
}

#[tauri::command]
async fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("Failed to write file: {e}"))
}

#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {e}"))
}

#[tauri::command]
async fn export_terminal_recording(
    path: String,
    title: String,
    lines: Vec<String>,
) -> Result<(), String> {
    recording::export_svg(path, title, lines).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            ssh_sessions: SessionManager::default(),
            sftp_sessions: Mutex::new(HashMap::new()),
            sftp_homes: Mutex::new(HashMap::new()),
        })
        .manage(PersistenceService::default())
        .manage(CredentialService::default())
        .manage(KnownHostsService::default())
        .manage(TransferManager::default())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            ssh_connect,
            ssh_agent_list_keys,
            set_health_interval,
            set_health_visibility,
            ssh_trust_host_key,
            ssh_send_data,
            ssh_disconnect,
            ssh_resize,
            sftp_list_dir,
            sftp_download_file,
            sftp_upload_file,
            sftp_copy_file,
            sftp_open_file,
            sftp_rename,
            sftp_remove,
            ssh_health_check,
            ssh_detect_os,
            sftp_read_file_content,
            sftp_write_file_content,
            sftp_create_dir,
            sftp_create_file,
            sftp_path_variants,
            sftp_download_folder,
            sftp_upload_folder,
            sftp_local_entries,
            write_text_file,
            read_text_file,
            load_app_data,
            save_app_data,
            export_app_data_backup,
            credential_unlock,
            credential_save,
            credential_delete,
            export_terminal_recording,
            sftp_cancel_transfer
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::sftp_utils::join_sftp_path;

    #[test]
    fn test_join_sftp_path_integration() {
        // Just verify it's correctly linked
        assert_eq!(join_sftp_path("/etc", "docker"), "/etc/docker");
    }
}
