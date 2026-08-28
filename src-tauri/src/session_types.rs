use crate::health::HealthSnapshot;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const SSH_SESSION_STATE_EVENT: &str = "ssh-session-state";
pub const SSH_HEALTH_EVENT: &str = "ssh-health";

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
pub struct SshHealthEvent {
    pub session_id: String,
    pub health: Option<HealthSnapshot>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SshDisconnectReason {
    Requested,
    RemoteEof,
    RemoteClosed,
    KeepaliveFailed,
}

pub fn emit_ssh_health(
    app_handle: &AppHandle,
    session_id: impl Into<String>,
    health: Option<HealthSnapshot>,
) {
    let payload = SshHealthEvent {
        session_id: session_id.into(),
        health,
    };

    if let Err(error) = app_handle.emit(SSH_HEALTH_EVENT, payload) {
        log::warn!("Failed to emit SSH health: {error}");
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSessionStateEvent {
    pub session_id: String,
    pub status: SshSessionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<SshDisconnectReason>,
}

pub fn emit_ssh_session_state(
    app_handle: &AppHandle,
    session_id: impl Into<String>,
    status: SshSessionStatus,
    message: Option<String>,
    reason: Option<SshDisconnectReason>,
) {
    let payload = SshSessionStateEvent {
        session_id: session_id.into(),
        status,
        message,
        reason,
    };

    if let Err(error) = app_handle.emit(SSH_SESSION_STATE_EVENT, payload) {
        log::warn!("Failed to emit SSH session state: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::{SshDisconnectReason, SshSessionStateEvent, SshSessionStatus};

    #[test]
    fn serializes_session_state_for_the_frontend_contract() {
        let event = SshSessionStateEvent {
            session_id: "ssh-production".into(),
            status: SshSessionStatus::Connecting,
            message: Some("Opening connection".into()),
            reason: None,
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
            reason: None,
        };

        let value = serde_json::to_value(event).expect("session event should serialize");

        assert!(value.get("message").is_none());
    }

    #[test]
    fn serializes_a_disconnect_reason() {
        let event = SshSessionStateEvent {
            session_id: "ssh-production".into(),
            status: SshSessionStatus::Disconnected,
            message: Some("SSH keepalive failed".into()),
            reason: Some(SshDisconnectReason::KeepaliveFailed),
        };

        let value = serde_json::to_value(event).expect("session event should serialize");

        assert_eq!(value["reason"], "keepalive_failed");
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
