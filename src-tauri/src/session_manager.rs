use crate::health::collect_health;
use crate::session_types::emit_ssh_health;
use crate::ssh::ClientHandler;
use russh::ChannelId;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
use tauri::AppHandle;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

struct ManagedSshSession {
    handle: Arc<russh::client::Handle<ClientHandler>>,
    channel_id: ChannelId,
    channel: Arc<russh::Channel<russh::client::Msg>>,
    write_lock: Arc<Mutex<()>>,
    health_task: JoinHandle<()>,
}

pub struct SessionManager {
    sessions: Mutex<HashMap<String, ManagedSshSession>>,
    health_interval_secs: Arc<AtomicU64>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            health_interval_secs: Arc::new(AtomicU64::new(5)),
        }
    }
}

impl SessionManager {
    pub fn set_health_interval(&self, seconds: u64) {
        self.health_interval_secs.store(seconds, Ordering::Relaxed);
    }

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
        let health_task = spawn_health_monitor(
            app_handle,
            session_id.clone(),
            Arc::clone(&handle),
            Arc::clone(&self.health_interval_secs),
        );

        let replaced = self.sessions.lock().await.insert(
            session_id,
            ManagedSshSession {
                handle,
                channel_id,
                channel,
                write_lock: Arc::new(Mutex::new(())),
                health_task,
            },
        );

        if let Some(previous) = replaced {
            previous.health_task.abort();
        }
    }

    pub async fn remove(&self, session_id: &str) -> bool {
        let removed = self.sessions.lock().await.remove(session_id);
        if let Some(session) = removed {
            session.health_task.abort();
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
    ) -> Result<
        (
            Arc<russh::client::Handle<ClientHandler>>,
            ChannelId,
            Arc<Mutex<()>>,
        ),
        String,
    > {
        self.sessions
            .lock()
            .await
            .get(session_id)
            .map(|session| {
                (
                    Arc::clone(&session.handle),
                    session.channel_id,
                    Arc::clone(&session.write_lock),
                )
            })
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

fn spawn_health_monitor(
    app_handle: AppHandle,
    session_id: String,
    handle: Arc<russh::client::Handle<ClientHandler>>,
    interval_secs: Arc<AtomicU64>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(
                interval_secs.load(Ordering::Relaxed).max(2),
            ))
            .await;
            match collect_health(Arc::clone(&handle)).await {
                Ok(health) => emit_ssh_health(&app_handle, session_id.clone(), Some(health)),
                Err(error) => log::debug!("Health check failed for {session_id}: {error}"),
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
