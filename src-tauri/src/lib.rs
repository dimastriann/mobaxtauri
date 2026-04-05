mod ssh;

use std::collections::HashMap;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;
use crate::ssh::{ClientHandler, SshSession};
use bytes::Bytes;
use russh::{ChannelId};

pub struct AppState {
    pub ssh_sessions: Mutex<HashMap<String, (russh::client::Handle<ClientHandler>, ChannelId, russh::Channel<russh::client::Msg>)>>,
    pub sftp_sessions: Mutex<HashMap<String, std::sync::Arc<russh_sftp::client::SftpSession>>>,
}

#[tauri::command]
async fn ssh_connect(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    host: String,
    port: u16,
    user: String,
    password: Option<String>,
) -> Result<String, String> {
    log::info!("Attempting to connect to {}:{} as {}", host, port, user);
    
    let connect_future = SshSession::connect(app_handle, session_id.clone(), host, port, user, password);
    
    // Add a 15-second timeout to the connection attempt
    let (handle, channel_id, channel, sftp) = match tokio::time::timeout(std::time::Duration::from_secs(15), connect_future).await {
        Ok(Ok(res)) => res,
        Ok(Err(e)) => {
            log::error!("Connection error: {}", e);
            return Err(format!("Connection failed: {}", e));
        }
        Err(_) => {
            log::error!("Connection timed out after 15s");
            return Err("Connection timed out".into());
        }
    };
    
    log::info!("Successfully connected to session {}", session_id);
    let mut ssh_sessions = state.ssh_sessions.lock().await;
    let mut sftp_sessions = state.sftp_sessions.lock().await;
    
    // Clean up any existing session with the same ID
    ssh_sessions.remove(&session_id);
    sftp_sessions.remove(&session_id);
    
    ssh_sessions.insert(session_id.clone(), (handle, channel_id, channel));
    sftp_sessions.insert(session_id.clone(), std::sync::Arc::new(sftp));
    
    Ok(format!("Connected to session {}", session_id))
}

#[tauri::command]
async fn ssh_send_data(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state.ssh_sessions.lock().await;
    if let Some((handle, channel_id, _channel)) = sessions.get(&session_id) {
        handle
            .data(*channel_id, Bytes::from(data.as_bytes().to_vec()))
            .await
            .map_err(|_| "Send failed".to_string())?;
        Ok(())
    } else {
        Err("Session not found".into())
    }
}

#[tauri::command]
async fn ssh_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let mut ssh_sessions = state.ssh_sessions.lock().await;
    let mut sftp_sessions = state.sftp_sessions.lock().await;
    
    ssh_sessions.remove(&session_id);
    sftp_sessions.remove(&session_id);
    
    Ok(())
}

#[tauri::command]
async fn ssh_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let sessions = state.ssh_sessions.lock().await;
    if let Some((_handle, _channel_id, channel)) = sessions.get(&session_id) {
        let res: Result<(), russh::Error> = channel
            .window_change(cols, rows, 0, 0)
            .await;
        res.map_err(|e| format!("Resize failed: {e:?}"))?;
        Ok(())
    } else {
        Err("Session not found".into())
    }
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
        let entries = sftp
            .read_dir(path)
            .await
            .map_err(|e| format!("Failed to read directory: {e:?}"))?;

        let mut result = Vec::new();
        for entry in entries {
            let metadata = entry.metadata();
            let modified = metadata.modified().ok().and_then(|t| {
                t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            ssh_sessions: Mutex::new(HashMap::new()),
            sftp_sessions: Mutex::new(HashMap::new()),
        })
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_stronghold::Builder::new(|_pass| {
            todo!("Implement secure key derivation")
        }).build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            ssh_connect,
            ssh_send_data,
            ssh_disconnect,
            ssh_resize,
            sftp_list_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
