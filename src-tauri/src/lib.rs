mod ssh;

use std::collections::HashMap;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;
use crate::ssh::{ClientHandler, SshSession};
use bytes::Bytes;
use russh::ChannelId;

pub struct AppState {
    pub ssh_sessions: Mutex<HashMap<String, (russh::client::Handle<ClientHandler>, ChannelId, russh::Channel<russh::client::Msg>)>>,
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
    let (handle, channel_id, channel) = match tokio::time::timeout(std::time::Duration::from_secs(15), connect_future).await {
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
    let mut sessions = state.ssh_sessions.lock().await;
    sessions.insert(session_id.clone(), (handle, channel_id, channel));
    
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
        let _ = handle.data(*channel_id, Bytes::from(data.as_bytes().to_vec())).await;
    }
    Ok(())
}

#[tauri::command]
async fn ssh_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state.ssh_sessions.lock().await;
    if let Some(_session) = sessions.remove(&session_id) {
        // The session and channel will be dropped here, closing the connection
        Ok(())
    } else {
        Err("Session not found".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            ssh_sessions: Mutex::new(HashMap::new()),
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
            ssh_disconnect
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
