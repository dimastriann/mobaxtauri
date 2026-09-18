use crate::health::collect_health;
use crate::session_types::emit_ssh_health;
use crate::ssh::ClientHandler;
use russh::ChannelId;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
};
use tauri::AppHandle;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

const HEALTH_INTERVAL_DEFAULT_SECS: u64 = 5;
const HEALTH_INTERVAL_HIDDEN_SECS: u64 = 15;

struct ManagedSshSession {
    handle: Arc<russh::client::Handle<ClientHandler>>,
    channel_id: ChannelId,
    channel: Arc<russh::Channel<russh::client::Msg>>,
    write_lock: Arc<Mutex<()>>,
    health_task: JoinHandle<()>,
}

pub struct SessionManager {
    sessions: Mutex<HashMap<String, ManagedSshSession>>,
    // Live interval read by every monitor task.
    health_interval_secs: Arc<AtomicU64>,
    health_configured_secs: Arc<AtomicU64>,
    health_visible: Arc<AtomicBool>,
}

/// Interval actually used by monitors. A hidden health bar can only slow
/// polling down — it never polls faster than the user-configured rate, so
/// slow or disabled settings are preserved.
fn effective_interval(configured_secs: u64, visible: bool) -> u64 {
    if visible {
        configured_secs
    } else {
        configured_secs.max(HEALTH_INTERVAL_HIDDEN_SECS)
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            health_interval_secs: Arc::new(AtomicU64::new(HEALTH_INTERVAL_DEFAULT_SECS)),
            health_configured_secs: Arc::new(AtomicU64::new(HEALTH_INTERVAL_DEFAULT_SECS)),
            health_visible: Arc::new(AtomicBool::new(true)),
        }
    }
}

impl SessionManager {
    pub fn set_health_interval(&self, seconds: u64) {
        self.health_configured_secs
            .store(seconds, Ordering::Relaxed);
        self.refresh_interval();
    }

    pub fn set_health_visibility(&self, visible: bool) {
        self.health_visible.store(visible, Ordering::Relaxed);
        self.refresh_interval();
    }

    fn refresh_interval(&self) {
        let configured = self.health_configured_secs.load(Ordering::Relaxed);
        let visible = self.health_visible.load(Ordering::Relaxed);
        self.health_interval_secs
            .store(effective_interval(configured, visible), Ordering::Relaxed);
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
    use super::{effective_interval, SessionManager};

    #[tokio::test]
    async fn starts_without_managed_sessions() {
        assert!(SessionManager::default().is_empty().await);
    }

    #[test]
    fn hidden_health_bar_never_polls_faster_than_configured() {
        assert_eq!(effective_interval(5, false), 15);
        assert_eq!(effective_interval(2, false), 15);
        assert_eq!(effective_interval(60, false), 60);
        assert_eq!(effective_interval(86_400, false), 86_400);
        assert_eq!(effective_interval(5, true), 5);
        assert_eq!(effective_interval(2, true), 2);
    }
}
