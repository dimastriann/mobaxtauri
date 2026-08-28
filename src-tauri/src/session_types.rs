use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const SSH_SESSION_STATE_EVENT: &str = "ssh-session-state";

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SshSessionStatus {
    Connecting,
    Connected,
    Disconnected,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSessionStateEvent {
    pub session_id: String,
    pub status: SshSessionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

pub fn emit_ssh_session_state(
    app_handle: &AppHandle,
    session_id: impl Into<String>,
    status: SshSessionStatus,
    message: Option<String>,
) {
    let payload = SshSessionStateEvent {
        session_id: session_id.into(),
        status,
        message,
    };

    if let Err(error) = app_handle.emit(SSH_SESSION_STATE_EVENT, payload) {
        log::warn!("Failed to emit SSH session state: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::{SshSessionStateEvent, SshSessionStatus};

    #[test]
    fn serializes_session_state_for_the_frontend_contract() {
        let event = SshSessionStateEvent {
            session_id: "ssh-production".into(),
            status: SshSessionStatus::Connecting,
            message: Some("Opening connection".into()),
        };

        let value = serde_json::to_value(event).expect("session event should serialize");

        assert_eq!(value["sessionId"], "ssh-production");
        assert_eq!(value["status"], "connecting");
        assert_eq!(value["message"], "Opening connection");
    }

    #[test]
    fn omits_an_absent_message() {
        let event = SshSessionStateEvent {
            session_id: "ssh-development".into(),
            status: SshSessionStatus::Connected,
            message: None,
        };

        let value = serde_json::to_value(event).expect("session event should serialize");

        assert!(value.get("message").is_none());
    }

    #[test]
    fn serializes_every_supported_status() {
        let statuses = [
            (SshSessionStatus::Connecting, "connecting"),
            (SshSessionStatus::Connected, "connected"),
            (SshSessionStatus::Disconnected, "disconnected"),
            (SshSessionStatus::Failed, "failed"),
        ];

        for (status, expected) in statuses {
            let value = serde_json::to_value(status).expect("status should serialize");
            assert_eq!(value, expected);
        }
    }
}
