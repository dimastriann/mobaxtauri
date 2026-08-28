use crate::ssh::ClientHandler;
use russh::ChannelId;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;

struct ManagedSshSession {
    handle: Arc<russh::client::Handle<ClientHandler>>,
    channel_id: ChannelId,
    channel: Arc<russh::Channel<russh::client::Msg>>,
}

#[derive(Default)]
pub struct SessionManager {
    sessions: Mutex<HashMap<String, ManagedSshSession>>,
}

impl SessionManager {
    pub async fn insert(
        &self,
        session_id: String,
        handle: russh::client::Handle<ClientHandler>,
        channel_id: ChannelId,
        channel: russh::Channel<russh::client::Msg>,
    ) {
        self.sessions.lock().await.insert(
            session_id,
            ManagedSshSession {
                handle: Arc::new(handle),
                channel_id,
                channel: Arc::new(channel),
            },
        );
    }

    pub async fn remove(&self, session_id: &str) -> bool {
        self.sessions.lock().await.remove(session_id).is_some()
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

#[cfg(test)]
mod tests {
    use super::SessionManager;

    #[tokio::test]
    async fn starts_without_managed_sessions() {
        assert!(SessionManager::default().is_empty().await);
    }
}
