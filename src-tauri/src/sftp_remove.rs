//! Batch removal for SFTP selections. Each path is classified from its
//! current metadata so a stale client-side `is_dir` flag cannot pick the
//! wrong removal operation.

use russh_sftp::client::SftpSession;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveFailure {
    pub path: String,
    pub message: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveManyResult {
    pub removed: Vec<String>,
    pub failures: Vec<RemoveFailure>,
}

/// Remove every path, continuing after individual failures so one bad
/// entry does not strand the rest of the selection.
pub async fn remove_many(sftp: &SftpSession, paths: Vec<String>) -> RemoveManyResult {
    let mut result = RemoveManyResult::default();
    for path in paths {
        let metadata = match sftp.metadata(&path).await {
            Ok(metadata) => metadata,
            Err(error) => {
                result.failures.push(RemoveFailure {
                    path,
                    message: format!("Failed to inspect remote entry: {error:?}"),
                });
                continue;
            }
        };

        let outcome = if metadata.is_dir() {
            sftp.remove_dir(&path).await
        } else {
            sftp.remove_file(&path).await
        };
        match outcome {
            Ok(()) => result.removed.push(path),
            Err(error) => result.failures.push(RemoveFailure {
                path,
                message: format!("Remove failed: {error:?}"),
            }),
        }
    }
    result
}
