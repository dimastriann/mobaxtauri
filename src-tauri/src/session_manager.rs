use crate::session_types::{emit_ssh_session_state, SshSessionStatus};
use crate::ssh::ClientHandler;
use bytes::Bytes;
use russh::ChannelId;
use std::{collections::HashMap, sync::Arc};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

struct ManagedSshSession {
    handle: Arc<russh::client::Handle<ClientHandler>>,
    channel_id: ChannelId,
    channel: Arc<russh::Channel<russh::client::Msg>>,
    keepalive_task: JoinHandle<()>,
}

#[derive(Default)]
pub struct SessionManager {
    sessions: Mutex<HashMap<String, ManagedSshSession>>,
}

impl SessionManager {
    pub async fn insert(
        &self,
        app_handle: AppHandle,
        session_id: String,
        handle: russh::client::Handle<ClientHandler>,
        channel_id: ChannelId,
        channel: russh::Channel<russh::client::Msg>,
    ) {
        let handle = Arc::new(handle);
        let channel = Arc::new(channel);
        let keepalive_task = spawn_keepalive(
            app_handle,
            session_id.clone(),
            Arc::clone(&handle),
            channel_id,
        );

        let replaced = self.sessions.lock().await.insert(
            session_id,
            ManagedSshSession {
                handle,
                channel_id,
                channel,
                keepalive_task,
            },
        );

        if let Some(previous) = replaced {
            previous.keepalive_task.abort();
        }
    }

    pub async fn remove(&self, session_id: &str) -> bool {
        let removed = self.sessions.lock().await.remove(session_id);
        if let Some(session) = removed {
            session.keepalive_task.abort();
            true
        } else {
            false
        }
    }

    pub async fn connection_handle(
        &self,
        session_id: &str,
    ) -> Result<Arc<russh::client::Handle<ClientHandler>>, String> {
        self.sessions
            .lock()
            .await
            .get(session_id)
            .map(|session| Arc::clone(&session.handle))
            .ok_or_else(|| "Session not found".to_string())
    }

    pub async fn shell_target(
        &self,
        session_id: &str,
    ) -> Result<(Arc<russh::client::Handle<ClientHandler>>, ChannelId), String> {
        self.sessions
            .lock()
            .await
            .get(session_id)
            .map(|session| (Arc::clone(&session.handle), session.channel_id))
            .ok_or_else(|| "Session not found".to_string())
    }

    pub async fn shell_channel(
        &self,
        session_id: &str,
    ) -> Result<Arc<russh::Channel<russh::client::Msg>>, String> {
        self.sessions
            .lock()
            .await
            .get(session_id)
            .map(|session| Arc::clone(&session.channel))
            .ok_or_else(|| "Session not found".to_string())
    }

    #[cfg(test)]
    pub async fn is_empty(&self) -> bool {
        self.sessions.lock().await.is_empty()
    }
}

fn spawn_keepalive(
    app_handle: AppHandle,
    session_id: String,
    handle: Arc<russh::client::Handle<ClientHandler>>,
    channel_id: ChannelId,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
        interval.tick().await;

        loop {
            interval.tick().await;
            let result = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                handle.data(channel_id, Bytes::new()),
            )
            .await;

            if !matches!(result, Ok(Ok(()))) {
                emit_ssh_session_state(
                    &app_handle,
                    session_id.clone(),
                    SshSessionStatus::Disconnected,
                    Some("SSH keepalive failed".into()),
                );
                let _ = app_handle.emit(&format!("ssh-disconnected-{session_id}"), ());
                break;
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::SessionManager;

    #[tokio::test]
    async fn starts_without_managed_sessions() {
        assert!(SessionManager::default().is_empty().await);
    }
}
