mod credentials;
mod health;
mod persistence;
mod recording;
mod session_manager;
mod session_types;
mod sftp_utils;
mod ssh;
mod transfers;

use crate::credentials::CredentialService;
use crate::health::{collect_health, HealthSnapshot};
use crate::persistence::{AppDataDocument, PersistenceService};
use crate::session_manager::SessionManager;
use crate::session_types::{
    emit_ssh_health, emit_ssh_session_state, SshConnectRequest, SshDisconnectReason,
    SshSessionStatus,
};
use crate::ssh::SshSession;
use crate::transfers::{
    emit_transfer, is_cancelled, TransferEvent, TransferManager, TransferStatus,
};
use bytes::Bytes;
use std::collections::HashMap;
use tauri::{AppHandle, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

pub struct AppState {
    pub ssh_sessions: SessionManager,
    pub sftp_sessions: Mutex<HashMap<String, std::sync::Arc<russh_sftp::client::SftpSession>>>,
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
        use_saved_credential,
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
    let channel = state.ssh_sessions.shell_channel(&session_id).await?;
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

            result.push(serde_json::json!({
                "name": entry.file_name(),
                "is_dir": metadata.is_dir(),
                "is_file": !metadata.is_dir(),
                "size": metadata.len(),
                "modified": modified,
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
    log::info!("Downloading {} to {}", remote_path, local_path);
    let sftp = state
        .sftp_sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or("SFTP session not found")?;
    let mut remote_file = sftp
        .open(&remote_path)
        .await
        .map_err(|e| format!("Failed to open remote file: {e:?}"))?;
    let total = remote_file
        .metadata()
        .await
        .ok()
        .map(|metadata| metadata.len());
    let partial_path = format!("{local_path}.mobaxtauri-part");
    let mut local_file = tokio::fs::File::create(&partial_path)
        .await
        .map_err(|e| format!("Failed to create local file: {e:?}"))?;
    let cancellation = transfers
        .begin(transfer_id.clone(), session_id.clone())
        .await;
    let mut buffer = vec![0_u8; 64 * 1024];
    let mut transferred = 0_u64;

    emit_transfer(
        &app_handle,
        TransferEvent {
            transfer_id: transfer_id.clone(),
            session_id: session_id.clone(),
            status: TransferStatus::Running,
            transferred,
            total,
            message: None,
        },
    );

    let result = async {
        loop {
            if is_cancelled(&cancellation) {
                return Err("Transfer cancelled".to_string());
            }
            let count = remote_file
                .read(&mut buffer)
                .await
                .map_err(|e| format!("Read failed: {e:?}"))?;
            if count == 0 {
                break;
            }
            local_file
                .write_all(&buffer[..count])
                .await
                .map_err(|e| format!("Write failed: {e:?}"))?;
            transferred += count as u64;
            emit_transfer(
                &app_handle,
                TransferEvent {
                    transfer_id: transfer_id.clone(),
                    session_id: session_id.clone(),
                    status: TransferStatus::Running,
                    transferred,
                    total,
                    message: None,
                },
            );
        }
        local_file
            .flush()
            .await
            .map_err(|e| format!("Failed to flush local file: {e:?}"))?;
        if tokio::fs::try_exists(&local_path).await.unwrap_or(false) {
            tokio::fs::remove_file(&local_path)
                .await
                .map_err(|e| format!("Failed to replace local file: {e:?}"))?;
        }
        tokio::fs::rename(&partial_path, &local_path)
            .await
            .map_err(|e| format!("Failed to finalize local file: {e:?}"))
    }
    .await;

    transfers.finish(&transfer_id).await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&partial_path).await;
    }
    emit_transfer(
        &app_handle,
        TransferEvent {
            transfer_id,
            session_id,
            status: match &result {
                Ok(()) => TransferStatus::Completed,
                Err(error) if error == "Transfer cancelled" => TransferStatus::Cancelled,
                Err(_) => TransferStatus::Failed,
            },
            transferred,
            total,
            message: result.as_ref().err().cloned(),
        },
    );
    result
}

#[tauri::command]
async fn sftp_upload_file(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    transfers: State<'_, TransferManager>,
    session_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
) -> Result<(), String> {
    log::info!("Uploading {} to {}", local_path, remote_path);
    let sftp = state
        .sftp_sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or("SFTP session not found")?;
    let mut local_file = tokio::fs::File::open(&local_path)
        .await
        .map_err(|e| format!("Failed to read local file: {e:?}"))?;
    let total = local_file
        .metadata()
        .await
        .ok()
        .map(|metadata| metadata.len());
    let partial_path = format!("{remote_path}.mobaxtauri-part");
    let mut remote_file = sftp
        .create(&partial_path)
        .await
        .map_err(|e| format!("Failed to create remote file: {e:?}"))?;
    let cancellation = transfers
        .begin(transfer_id.clone(), session_id.clone())
        .await;
    let mut buffer = vec![0_u8; 64 * 1024];
    let mut transferred = 0_u64;

    let result = async {
        loop {
            if is_cancelled(&cancellation) {
                return Err("Transfer cancelled".to_string());
            }
            let count = local_file
                .read(&mut buffer)
                .await
                .map_err(|e| format!("Read failed: {e:?}"))?;
            if count == 0 {
                break;
            }
            remote_file
                .write_all(&buffer[..count])
                .await
                .map_err(|e| format!("Write failed: {e:?}"))?;
            transferred += count as u64;
            emit_transfer(
                &app_handle,
                TransferEvent {
                    transfer_id: transfer_id.clone(),
                    session_id: session_id.clone(),
                    status: TransferStatus::Running,
                    transferred,
                    total,
                    message: None,
                },
            );
        }
        remote_file
            .flush()
            .await
            .map_err(|e| format!("Failed to flush remote file: {e:?}"))?;
        let _ = sftp.remove_file(&remote_path).await;
        sftp.rename(&partial_path, &remote_path)
            .await
            .map_err(|e| format!("Failed to finalize remote file: {e:?}"))
    }
    .await;

    transfers.finish(&transfer_id).await;
    if result.is_err() {
        let _ = sftp.remove_file(&partial_path).await;
    }
    emit_transfer(
        &app_handle,
        TransferEvent {
            transfer_id,
            session_id,
            status: match &result {
                Ok(()) => TransferStatus::Completed,
                Err(error) if error == "Transfer cancelled" => TransferStatus::Cancelled,
                Err(_) => TransferStatus::Failed,
            },
            transferred,
            total,
            message: result.as_ref().err().cloned(),
        },
    );
    result
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
async fn sftp_copy_file(
    state: State<'_, AppState>,
    session_id: String,
    source_path: String,
    dest_path: String,
) -> Result<(), String> {
    log::info!("Copying {} to {}", source_path, dest_path);
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or("SFTP session not found")?;

    let mut source_file = sftp
        .open(&source_path)
        .await
        .map_err(|e| format!("Failed to open source file: {e:?}"))?;
    let mut data: Vec<u8> = Vec::new();
    source_file
        .read_to_end(&mut data)
        .await
        .map_err(|e| format!("Read failed: {e:?}"))?;

    let mut dest_file = sftp
        .create(&dest_path)
        .await
        .map_err(|e| format!("Failed to create dest file: {e:?}"))?;
    dest_file
        .write_all(&data)
        .await
        .map_err(|e| format!("Write failed: {e:?}"))?;

    Ok(())
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
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or("SFTP session not found")?;

    let mut remote_file = sftp
        .open(&remote_path)
        .await
        .map_err(|e| format!("Failed to open remote file: {e:?}"))?;
    let mut data: Vec<u8> = Vec::new();
    remote_file
        .read_to_end(&mut data)
        .await
        .map_err(|e| format!("Read failed: {e:?}"))?;

    let file_name = std::path::Path::new(&remote_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("temp_sftp_file");

    let mut temp_path = std::env::temp_dir();
    temp_path.push(file_name);

    tokio::fs::write(&temp_path, &data)
        .await
        .map_err(|e| format!("Failed to write temp file: {e:?}"))?;

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
) -> Result<String, String> {
    log::info!("Reading file content {}", remote_path);
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or("SFTP session not found")?;

    let mut remote_file = sftp
        .open(&remote_path)
        .await
        .map_err(|e| format!("Failed to open remote file: {e:?}"))?;
    let mut data: Vec<u8> = Vec::new();
    remote_file
        .read_to_end(&mut data)
        .await
        .map_err(|e| format!("Read failed: {e:?}"))?;

    String::from_utf8(data).map_err(|e| format!("File is not valid UTF-8: {e:?}"))
}

#[tauri::command]
async fn sftp_write_file_content(
    state: State<'_, AppState>,
    session_id: String,
    remote_path: String,
    content: String,
) -> Result<(), String> {
    log::info!("Writing file content {}", remote_path);
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or("SFTP session not found")?;

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
        })
        .manage(PersistenceService::default())
        .manage(CredentialService::default())
        .manage(TransferManager::default())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(
            tauri_plugin_stronghold::Builder::new(|_pass| {
                let mut key = [0u8; 32];
                if _pass.is_empty() {
                    let dummy = b"mobaxtauri_stronghold_secure_key";
                    key.copy_from_slice(&dummy[..32]);
                } else {
                    use argon2::{Argon2, Params, Version};
                    let salt = b"mobaxtaurisaltval"; // 17 bytes (min 8)
                    let params = Params::new(
                        Params::DEFAULT_M_COST,
                        Params::DEFAULT_T_COST,
                        Params::DEFAULT_P_COST,
                        Some(32),
                    )
                    .unwrap();
                    let argon_instance =
                        Argon2::new(argon2::Algorithm::Argon2id, Version::default(), params);
                    let mut hash = [0u8; 32];
                    if argon_instance
                        .hash_password_into(_pass.as_bytes(), salt, &mut hash)
                        .is_ok()
                    {
                        key.copy_from_slice(&hash);
                    } else {
                        let dummy = b"mobaxtauri_stronghold_secure_key";
                        key.copy_from_slice(&dummy[..32]);
                    }
                }
                key.to_vec()
            })
            .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            ssh_connect,
            set_health_interval,
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
            write_text_file,
            read_text_file,
            load_app_data,
            save_app_data,
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
