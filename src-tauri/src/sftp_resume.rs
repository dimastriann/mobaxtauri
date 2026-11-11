//! Resume guards for interrupted SFTP transfers.
//!
//! A `.mobaxtauri-part` file is only reused when its sidecar matches the
//! current source path, size, and mtime. Anything else restarts from zero
//! rather than risking a corrupted concatenation.

use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use std::time::UNIX_EPOCH;
use tokio::io::AsyncWriteExt;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeSource {
    pub path: String,
    pub size: u64,
    pub modified: Option<u64>,
}

/// Sidecar path for a `.mobaxtauri-part` file.
pub fn sidecar_path(partial: &str) -> String {
    format!("{partial}.json")
}

pub fn local_source(path: &str, metadata: &std::fs::Metadata) -> ResumeSource {
    ResumeSource {
        path: path.to_string(),
        size: metadata.len(),
        modified: metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs()),
    }
}

pub fn remote_source(path: &str, size: u64, modified: Option<u32>) -> ResumeSource {
    ResumeSource {
        path: path.to_string(),
        size,
        modified: modified.map(u64::from),
    }
}

pub fn can_resume(sidecar: Option<ResumeSource>, source: &ResumeSource, partial_size: u64) -> bool {
    sidecar.as_ref().is_some_and(|stored| stored == source) && partial_size <= source.size
}

pub async fn read_local_sidecar(partial: &str) -> Option<ResumeSource> {
    let json = tokio::fs::read_to_string(sidecar_path(partial))
        .await
        .ok()?;
    serde_json::from_str(&json).ok()
}

pub async fn write_local_sidecar(partial: &str, source: &ResumeSource) -> Result<(), String> {
    let json = serde_json::to_string(source)
        .map_err(|error| format!("Failed to encode resume metadata: {error}"))?;
    tokio::fs::write(sidecar_path(partial), json)
        .await
        .map_err(|error| format!("Failed to write resume metadata: {error}"))
}

pub async fn remove_local_sidecar(partial: &str) {
    let _ = tokio::fs::remove_file(sidecar_path(partial)).await;
}

pub async fn read_remote_sidecar(sftp: &SftpSession, partial: &str) -> Option<ResumeSource> {
    let bytes = sftp.read(sidecar_path(partial)).await.ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub async fn write_remote_sidecar(
    sftp: &SftpSession,
    partial: &str,
    source: &ResumeSource,
) -> Result<(), String> {
    let json = serde_json::to_vec(source)
        .map_err(|error| format!("Failed to encode resume metadata: {error}"))?;
    let path = sidecar_path(partial);
    let mut file = sftp
        .create(&path)
        .await
        .map_err(|error| format!("Failed to create resume metadata: {error:?}"))?;
    file.write_all(&json)
        .await
        .map_err(|error| format!("Failed to write resume metadata: {error:?}"))?;
    file.close()
        .await
        .map_err(|error| format!("Failed to close resume metadata: {error:?}"))
}

pub async fn remove_remote_sidecar(sftp: &SftpSession, partial: &str) {
    let _ = sftp.remove_file(sidecar_path(partial)).await;
}

#[cfg(test)]
mod tests {
    use super::{can_resume, remote_source, sidecar_path, ResumeSource};

    fn source() -> ResumeSource {
        remote_source("/srv/report.bin", 1024, Some(1_700_000_000))
    }

    #[test]
    fn sidecar_path_is_stable() {
        assert_eq!(
            sidecar_path("/tmp/report.bin.mobaxtauri-part"),
            "/tmp/report.bin.mobaxtauri-part.json"
        );
    }

    #[test]
    fn resumes_only_matching_sources() {
        assert!(can_resume(Some(source()), &source(), 512));
        assert!(!can_resume(None, &source(), 512));
        assert!(!can_resume(
            Some(remote_source("/srv/report.bin", 1024, Some(1_700_000_001))),
            &source(),
            512
        ));
        assert!(!can_resume(Some(source()), &source(), 2048));
    }
}
