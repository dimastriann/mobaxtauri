use crate::health::HealthSnapshot;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const SSH_SESSION_STATE_EVENT: &str = "ssh-session-state";
pub const SSH_HEALTH_EVENT: &str = "ssh-health";
const DEFAULT_CONNECTION_TIMEOUT_SECS: u64 = 15;
const MIN_CONNECTION_TIMEOUT_SECS: u64 = 5;
const MAX_CONNECTION_TIMEOUT_SECS: u64 = 120;

fn default_connection_timeout_secs() -> u64 {
    DEFAULT_CONNECTION_TIMEOUT_SECS
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectRequest {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub use_saved_credential: bool,
    #[serde(default = "default_connection_timeout_secs")]
    pub connection_timeout_secs: u64,
}

impl SshConnectRequest {
    pub fn connection_timeout(&self) -> Result<Duration, String> {
        if !(MIN_CONNECTION_TIMEOUT_SECS..=MAX_CONNECTION_TIMEOUT_SECS)
            .contains(&self.connection_timeout_secs)
        {
            return Err(format!(
                "Connection timeout must be between {MIN_CONNECTION_TIMEOUT_SECS} and {MAX_CONNECTION_TIMEOUT_SECS} seconds"
            ));
        }

        Ok(Duration::from_secs(self.connection_timeout_secs))
    }
}

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
    use super::{SshConnectRequest, SshSessionStateEvent, SshSessionStatus};
    use std::time::Duration;

    fn connect_request(timeout: u64) -> SshConnectRequest {
        SshConnectRequest {
            session_id: "ssh-production".into(),
            host: "example.com".into(),
            port: 22,
            user: "operator".into(),
            password: None,
            private_key_path: None,
            use_saved_credential: false,
            connection_timeout_secs: timeout,
        }
    }

    #[test]
    fn validates_connection_timeout_bounds() {
        assert_eq!(
            connect_request(30).connection_timeout().unwrap(),
            Duration::from_secs(30)
        );
        assert!(connect_request(4).connection_timeout().is_err());
        assert!(connect_request(121).connection_timeout().is_err());
    }

    #[test]
    fn defaults_connection_timeout_for_older_clients() {
        let request: SshConnectRequest = serde_json::from_value(serde_json::json!({
            "sessionId": "ssh-production",
            "host": "example.com",
            "port": 22,
            "user": "operator",
            "password": null,
            "privateKeyPath": null,
            "useSavedCredential": false
        }))
        .expect("request should deserialize");

        assert_eq!(request.connection_timeout(), Ok(Duration::from_secs(15)));
    }

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
