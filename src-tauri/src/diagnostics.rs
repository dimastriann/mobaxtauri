//! Public connection diagnostics for troubleshooting.
//!
//! Reports contain timings, negotiated server identity, host-key fingerprint,
//! and auth method names. Passwords, OTPs, private keys, and key bodies are
//! never included.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectTimings {
    pub tcp_ms: u64,
    pub auth_ms: u64,
    pub shell_ms: u64,
    pub sftp_ms: u64,
    pub total_ms: u64,
}

#[derive(Clone, Debug, Default)]
pub struct ConnectReport {
    pub timings: ConnectTimings,
    pub auth_attempted: Vec<String>,
    pub auth_used: Option<String>,
    pub server_banner: String,
    pub host_key_type: Option<String>,
    pub host_key_fingerprint: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionDiagnostics {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub connected_at: u64,
    pub timings: ConnectTimings,
    pub auth_attempted: Vec<String>,
    pub auth_used: Option<String>,
    pub server_banner: String,
    pub host_key_type: Option<String>,
    pub host_key_fingerprint: Option<String>,
    pub jump_session_id: Option<String>,
    pub sftp_home: Option<String>,
}

#[derive(Clone, Default)]
pub struct DiagnosticsService {
    reports: Arc<Mutex<HashMap<String, ConnectionDiagnostics>>>,
}

impl DiagnosticsService {
    pub async fn record(&self, report: ConnectionDiagnostics) {
        self.reports
            .lock()
            .await
            .insert(report.session_id.clone(), report);
    }

    pub async fn get(&self, session_id: &str) -> Option<ConnectionDiagnostics> {
        self.reports.lock().await.get(session_id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::{ConnectTimings, ConnectionDiagnostics, DiagnosticsService};

    fn report() -> ConnectionDiagnostics {
        ConnectionDiagnostics {
            session_id: "ssh-1".into(),
            host: "example.com".into(),
            port: 22,
            user: "operator".into(),
            connected_at: 1_700_000_000,
            timings: ConnectTimings {
                tcp_ms: 10,
                auth_ms: 20,
                shell_ms: 5,
                sftp_ms: 7,
                total_ms: 42,
            },
            auth_attempted: vec!["publickey".into()],
            auth_used: Some("publickey".into()),
            server_banner: "SSH-2.0-test".into(),
            host_key_type: Some("ssh-ed25519".into()),
            host_key_fingerprint: Some("SHA256:test".into()),
            jump_session_id: None,
            sftp_home: Some("/home/operator".into()),
        }
    }

    #[tokio::test]
    async fn stores_and_returns_the_last_report() {
        let service = DiagnosticsService::default();
        service.record(report()).await;
        assert_eq!(service.get("ssh-1").await, Some(report()));
        assert!(service.get("missing").await.is_none());
    }
}
