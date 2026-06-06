mod sftp_utils;
mod ssh;

use crate::ssh::{ClientHandler, SshSession};
use bytes::Bytes;
use russh::ChannelId;
use std::collections::HashMap;
use tauri::{AppHandle, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

pub struct AppState {
    pub ssh_sessions: Mutex<
        HashMap<
            String,
            (
                russh::client::Handle<ClientHandler>,
                ChannelId,
                russh::Channel<russh::client::Msg>,
            ),
        >,
    >,
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
    private_key_path: Option<String>,
) -> Result<String, String> {
    log::info!("Attempting to connect to {}:{} as {}", host, port, user);

    let connect_future = SshSession::connect(
        app_handle,
        session_id.clone(),
        host,
        port,
        user,
        password,
        private_key_path,
    );

    // Add a 15-second timeout to the connection attempt
    let (handle, channel_id, channel, sftp) =
        match tokio::time::timeout(std::time::Duration::from_secs(15), connect_future).await {
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
async fn ssh_disconnect(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
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
        let res: Result<(), russh::Error> = channel.window_change(cols, rows, 0, 0).await;
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
    state: State<'_, AppState>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    log::info!("Downloading {} to {}", remote_path, local_path);
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
    tokio::fs::write(&local_path, &data)
        .await
        .map_err(|e| format!("Failed to save local file: {e:?}"))?;

    Ok(())
}

#[tauri::command]
async fn sftp_upload_file(
    state: State<'_, AppState>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    log::info!("Uploading {} to {}", local_path, remote_path);
    let sftp_sessions = state.sftp_sessions.lock().await;
    let sftp = sftp_sessions
        .get(&session_id)
        .ok_or("SFTP session not found")?;

    let data = tokio::fs::read(&local_path)
        .await
        .map_err(|e| format!("Failed to read local file: {e:?}"))?;

    let mut remote_file = sftp
        .create(&remote_path)
        .await
        .map_err(|e| format!("Failed to create remote file: {e:?}"))?;
    remote_file
        .write_all(&data)
        .await
        .map_err(|e| format!("Write failed: {e:?}"))?;

    Ok(())
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
) -> Result<serde_json::Value, String> {
    let mut sessions = state.ssh_sessions.lock().await;
    let (handle, _channel_id, _channel) =
        sessions.get_mut(&session_id).ok_or("Session not found")?;

    let exec_channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open health channel: {e}"))?;

    // Line 1: load avg (1min)
    // Line 2: Mem used_mb total_mb
    // Line 3: Swap used_mb total_mb
    // Line 4: disk used %
    let cmd = "cat /proc/loadavg | awk '{print $1}'; free -m | grep Mem | awk '{print $3,$2}'; free -m | grep Swap | awk '{print $3,$2}'; df -h / | tail -1 | awk '{print $5}' | sed 's/%//'";

    exec_channel
        .exec(true, cmd)
        .await
        .map_err(|e| format!("Failed to exec health cmd: {e}"))?;

    let mut output = String::new();
    let mut stream = exec_channel.into_stream();
    use tokio::io::AsyncReadExt;
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        stream.read_to_string(&mut output),
    )
    .await
    .map_err(|_| "Health check timed out".to_string())?;

    let lines: Vec<&str> = output.lines().collect();
    if lines.len() >= 4 {
        let load = lines[0].parse::<f32>().unwrap_or(0.0);

        let mem_parts: Vec<&str> = lines[1].split_whitespace().collect();
        let mut ram_used: f32 = 0.0;
        let mut ram_total: f32 = 1.0;
        let mut ram_pct: f32 = 0.0;
        if mem_parts.len() == 2 {
            ram_used = mem_parts[0].parse::<f32>().unwrap_or(0.0);
            ram_total = mem_parts[1].parse::<f32>().unwrap_or(1.0);
            ram_pct = (ram_used / ram_total) * 100.0;
        }

        let swap_parts: Vec<&str> = lines[2].split_whitespace().collect();
        let mut swap_used: f32 = 0.0;
        let mut swap_total: f32 = 0.0;
        let mut swap_pct: f32 = 0.0;
        if swap_parts.len() == 2 {
            swap_used = swap_parts[0].parse::<f32>().unwrap_or(0.0);
            swap_total = swap_parts[1].parse::<f32>().unwrap_or(0.0);
            if swap_total > 0.0 {
                swap_pct = (swap_used / swap_total) * 100.0;
            }
        }

        let disk = lines[3].parse::<f32>().unwrap_or(0.0);
        let cpu_pct = (load * 100.0).min(100.0);

        Ok(serde_json::json!({
            "cpu": cpu_pct,
            "ram": ram_pct,
            "ram_used": ram_used,
            "ram_total": ram_total,
            "swap": swap_pct,
            "swap_used": swap_used,
            "swap_total": swap_total,
            "disk": disk
        }))
    } else {
        Err(format!("Unexpected health output: {}", output))
    }
}

#[tauri::command]
async fn ssh_detect_os(state: State<'_, AppState>, session_id: String) -> Result<String, String> {
    let mut sessions = state.ssh_sessions.lock().await;
    let (handle, _channel_id, _channel) =
        sessions.get_mut(&session_id).ok_or("Session not found")?;

    let exec_channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open exec channel: {e}"))?;

    let cmd = "OS_ID=$(cat /etc/os-release 2>/dev/null | grep '^ID=' | cut -d= -f2 | tr -d '\"'); if [ -n \"$OS_ID\" ]; then echo \"$OS_ID\"; else uname -s 2>/dev/null || echo \"unknown\"; fi";

    exec_channel
        .exec(true, cmd)
        .await
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            ssh_sessions: Mutex::new(HashMap::new()),
            sftp_sessions: Mutex::new(HashMap::new()),
        })
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
            read_text_file
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
