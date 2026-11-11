//! Keyboard-interactive authentication prompt bridge.
//!
//! Rust owns the SSH handshake, but the user types OTP/password responses in
//! the webview. The service parks a pending prompt per session, emits a
//! `ssh-auth-prompt` event, and waits for `ssh_auth_respond` or
//! `ssh_auth_cancel`. Responses are never logged or persisted.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::{oneshot, Mutex};
use tokio::time::{timeout, Duration};

pub const SSH_AUTH_PROMPT_EVENT: &str = "ssh-auth-prompt";
const AUTH_PROMPT_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshAuthPromptField {
    pub prompt: String,
    /// `false` means the UI must mask the input (OTP/password).
    pub echo: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshAuthPromptEvent {
    pub session_id: String,
    pub name: String,
    pub instructions: String,
    pub prompts: Vec<SshAuthPromptField>,
}

#[derive(Clone, Default)]
pub struct AuthPromptService {
    pending: Arc<Mutex<HashMap<String, PendingPrompt>>>,
}

struct PendingPrompt {
    expected: usize,
    sender: oneshot::Sender<AuthPromptResponse>,
}

enum AuthPromptResponse {
    Responses(Vec<String>),
    Cancelled,
}

impl AuthPromptService {
    /// Ask the webview for one keyboard-interactive round and wait for the
    /// answer. A second request for the same session cancels the first.
    pub async fn request<R: Runtime>(
        &self,
        app_handle: &AppHandle<R>,
        session_id: &str,
        name: String,
        instructions: String,
        prompts: Vec<SshAuthPromptField>,
    ) -> Result<Vec<String>, String> {
        let (sender, receiver) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            if let Some(previous) = pending.remove(session_id) {
                let _ = previous.sender.send(AuthPromptResponse::Cancelled);
            }
            pending.insert(
                session_id.to_string(),
                PendingPrompt {
                    expected: prompts.len(),
                    sender,
                },
            );
        }

        let event = SshAuthPromptEvent {
            session_id: session_id.to_string(),
            name,
            instructions,
            prompts,
        };
        if let Err(error) = app_handle.emit(SSH_AUTH_PROMPT_EVENT, event) {
            self.pending.lock().await.remove(session_id);
            return Err(format!("Failed to request authentication input: {error}"));
        }

        match timeout(AUTH_PROMPT_TIMEOUT, receiver).await {
            Ok(Ok(AuthPromptResponse::Responses(responses))) => Ok(responses),
            Ok(Ok(AuthPromptResponse::Cancelled)) => Err("Authentication prompt cancelled".into()),
            Ok(Err(_)) => Err("Authentication prompt closed unexpectedly".into()),
            Err(_) => {
                self.pending.lock().await.remove(session_id);
                Err("Authentication prompt timed out".into())
            }
        }
    }

    pub async fn respond(&self, session_id: &str, responses: Vec<String>) -> Result<(), String> {
        let pending = {
            let mut pending = self.pending.lock().await;
            let expected = pending
                .get(session_id)
                .map(|entry| entry.expected)
                .ok_or("No authentication prompt is pending")?;
            if responses.len() != expected {
                return Err(format!(
                    "Expected {expected} authentication responses, got {}",
                    responses.len()
                ));
            }
            pending
                .remove(session_id)
                .ok_or("No authentication prompt is pending")?
        };
        pending
            .sender
            .send(AuthPromptResponse::Responses(responses))
            .map_err(|_| "Authentication prompt is no longer waiting".to_string())
    }

    pub async fn cancel(&self, session_id: &str) -> Result<(), String> {
        let pending = self.pending.lock().await.remove(session_id);
        match pending {
            Some(pending) => pending
                .sender
                .send(AuthPromptResponse::Cancelled)
                .map_err(|_| "Authentication prompt is no longer waiting".to_string()),
            None => Ok(()),
        }
    }

    pub async fn cancel_all(&self) {
        let pending = std::mem::take(&mut *self.pending.lock().await);
        for entry in pending.into_values() {
            let _ = entry.sender.send(AuthPromptResponse::Cancelled);
        }
    }

    pub async fn is_pending(&self, session_id: &str) -> bool {
        self.pending.lock().await.contains_key(session_id)
    }
}

#[cfg(test)]
mod tests {
    use super::AuthPromptService;

    #[tokio::test]
    async fn respond_validates_the_response_count() {
        let service = AuthPromptService::default();
        let (sender, _receiver) = tokio::sync::oneshot::channel();
        service.pending.lock().await.insert(
            "session-1".into(),
            super::PendingPrompt {
                expected: 2,
                sender,
            },
        );

        let error = service
            .respond("session-1", vec!["only-one".into()])
            .await
            .expect_err("wrong response count must fail");
        assert!(error.contains("Expected 2 authentication responses"));
        assert!(service.is_pending("session-1").await);
    }

    #[tokio::test]
    async fn respond_delivers_the_responses() {
        let service = AuthPromptService::default();
        let (sender, receiver) = tokio::sync::oneshot::channel();
        service.pending.lock().await.insert(
            "session-1".into(),
            super::PendingPrompt {
                expected: 1,
                sender,
            },
        );

        service
            .respond("session-1", vec!["123456".into()])
            .await
            .unwrap();

        match receiver.await.unwrap() {
            super::AuthPromptResponse::Responses(responses) => {
                assert_eq!(responses, vec!["123456".to_string()]);
            }
            super::AuthPromptResponse::Cancelled => panic!("expected responses"),
        }
        assert!(!service.is_pending("session-1").await);
    }

    #[tokio::test]
    async fn cancel_wakes_a_pending_prompt() {
        let service = AuthPromptService::default();
        let (sender, receiver) = tokio::sync::oneshot::channel();
        service.pending.lock().await.insert(
            "session-1".into(),
            super::PendingPrompt {
                expected: 1,
                sender,
            },
        );

        service.cancel("session-1").await.unwrap();

        assert!(matches!(
            receiver.await.unwrap(),
            super::AuthPromptResponse::Cancelled
        ));
        assert!(!service.is_pending("session-1").await);
    }
}
