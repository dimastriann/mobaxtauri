use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

pub const SFTP_TRANSFER_EVENT: &str = "sftp-transfer";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferStatus {
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferEvent {
    pub transfer_id: String,
    pub session_id: String,
    pub status: TransferStatus,
    pub transferred: u64,
    pub total: Option<u64>,
    pub message: Option<String>,
}

#[derive(Default)]
pub struct TransferManager {
    transfers: Mutex<HashMap<String, ActiveTransfer>>,
}

struct ActiveTransfer {
    session_id: String,
    cancellation: Arc<AtomicBool>,
}

impl TransferManager {
    pub async fn begin(&self, transfer_id: String, session_id: String) -> Arc<AtomicBool> {
        let cancellation = Arc::new(AtomicBool::new(false));
        let mut transfers = self.transfers.lock().await;
        for transfer in transfers.values() {
            if transfer.session_id == session_id {
                transfer.cancellation.store(true, Ordering::Release);
            }
        }
        if let Some(previous) = transfers.insert(
            transfer_id,
            ActiveTransfer {
                session_id,
                cancellation: Arc::clone(&cancellation),
            },
        ) {
            previous.cancellation.store(true, Ordering::Release);
        }
        cancellation
    }

    pub async fn finish(&self, transfer_id: &str) {
        self.transfers.lock().await.remove(transfer_id);
    }

    pub async fn cancel(&self, transfer_id: &str) -> bool {
        if let Some(transfer) = self.transfers.lock().await.get(transfer_id) {
            transfer.cancellation.store(true, Ordering::Release);
            true
        } else {
            false
        }
    }

    pub async fn cancel_session(&self, session_id: &str) {
        for transfer in self.transfers.lock().await.values() {
            if transfer.session_id == session_id {
                transfer.cancellation.store(true, Ordering::Release);
            }
        }
    }
}

pub fn is_cancelled(cancellation: &AtomicBool) -> bool {
    cancellation.load(Ordering::Acquire)
}

pub fn emit_transfer(app_handle: &AppHandle, event: TransferEvent) {
    if let Err(error) = app_handle.emit(SFTP_TRANSFER_EVENT, event) {
        log::warn!("Failed to emit SFTP transfer progress: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::{is_cancelled, TransferManager};

    #[tokio::test]
    async fn cancels_an_active_transfer() {
        let manager = TransferManager::default();
        let cancellation = manager.begin("transfer-1".into(), "session-1".into()).await;

        assert!(manager.cancel("transfer-1").await);
        assert!(is_cancelled(&cancellation));
        manager.finish("transfer-1").await;
        assert!(!manager.cancel("transfer-1").await);
    }

    #[tokio::test]
    async fn starting_another_transfer_cancels_the_same_session() {
        let manager = TransferManager::default();
        let first = manager.begin("transfer-1".into(), "session-1".into()).await;

        manager.begin("transfer-2".into(), "session-1".into()).await;

        assert!(is_cancelled(&first));
    }
}
