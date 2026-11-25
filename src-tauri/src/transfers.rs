use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::{oneshot, Mutex, Notify};
use tokio::time::Instant;

pub const SFTP_TRANSFER_EVENT: &str = "sftp-transfer";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferStatus {
    Queued,
    Running,
    Completed,
    Cancelled,
    Failed,
}

/// What a transfer is doing, so a queue view can label and group rows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferKind {
    Upload,
    Download,
    Copy,
    FolderUpload,
    FolderDownload,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferEvent {
    pub transfer_id: String,
    pub session_id: String,
    pub kind: TransferKind,
    /// Human-readable subject (file or folder name).
    pub label: String,
    pub status: TransferStatus,
    pub transferred: u64,
    pub total: Option<u64>,
    pub resumed: bool,
    pub percent: Option<f32>,
    pub bytes_per_sec: Option<f64>,
    pub eta_seconds: Option<u64>,
    pub message: Option<String>,
}

pub fn calculate_percentage(transferred: u64, total: Option<u64>) -> Option<f32> {
    match total {
        Some(total_bytes) if total_bytes > 0 => {
            let pct = (transferred as f64 / total_bytes as f64 * 100.0) as f32;
            Some((pct * 10.0).round() / 10.0)
        }
        _ => None,
    }
}

/// Bytes per second, sampled only after a short warm-up so the first
/// chunk does not produce a noisy spike.
pub fn calculate_transfer_rate(transferred: u64, elapsed: Duration) -> Option<f64> {
    if transferred == 0 || elapsed < Duration::from_millis(100) {
        return None;
    }
    let seconds = elapsed.as_secs_f64();
    if seconds <= 0.0 {
        return None;
    }
    Some(transferred as f64 / seconds)
}

/// Remaining wall-clock seconds for a transfer with a known byte total.
pub fn calculate_eta(
    total: Option<u64>,
    transferred: u64,
    bytes_per_sec: Option<f64>,
) -> Option<u64> {
    let total = total?;
    if transferred >= total {
        return Some(0);
    }
    let rate = bytes_per_sec?;
    if rate <= 0.0 {
        return None;
    }
    Some(((total - transferred) as f64 / rate).ceil() as u64)
}

#[derive(Clone)]
pub struct TransferHandle {
    cancellation: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    wake: Arc<Notify>,
    cancel_wake: Arc<Notify>,
    slot_acquired: Arc<AtomicBool>,
}

impl TransferHandle {
    pub fn is_cancelled(&self) -> bool {
        self.cancellation.load(Ordering::Acquire)
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Acquire)
    }

    /// Waits until a queued transfer is cancelled. Used while waiting for a
    /// concurrency slot so cancellation does not have to wait for a slot.
    pub async fn cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        self.cancel_wake.notified().await;
    }

    /// Blocks while the transfer is paused. Cancellation is checked by the
    /// caller after this returns, so a paused transfer can still be cancelled.
    pub async fn wait_until_resumed(&self) {
        while self.is_paused() {
            self.wake.notified().await;
        }
    }
}

const DEFAULT_CONCURRENCY: usize = 3;
const MAX_CONCURRENCY: usize = 4;
const MIN_CONCURRENCY: usize = 1;

struct TransferQueue {
    running: usize,
    limit: usize,
    waiters: VecDeque<oneshot::Sender<()>>,
}

impl Default for TransferQueue {
    fn default() -> Self {
        Self {
            running: 0,
            limit: DEFAULT_CONCURRENCY,
            waiters: VecDeque::new(),
        }
    }
}

#[derive(Debug)]
struct BandwidthBudget {
    /// Bytes per second; zero means unlimited.
    limit: u64,
    tokens: f64,
    last: Instant,
}

impl BandwidthBudget {
    fn new(limit: u64) -> Self {
        Self {
            limit,
            tokens: 0.0,
            last: Instant::now(),
        }
    }

    fn refill(&mut self, now: Instant) {
        let elapsed = now.duration_since(self.last).as_secs_f64();
        self.last = now;
        self.tokens = (self.tokens + elapsed * self.limit as f64).min(self.limit as f64);
    }

    /// Consumes bytes and returns how long the caller must sleep, if any.
    fn consume(&mut self, bytes: u64, now: Instant) -> Option<Duration> {
        if self.limit == 0 {
            return None;
        }
        self.refill(now);
        let bytes = bytes as f64;
        if self.tokens >= bytes {
            self.tokens -= bytes;
            return None;
        }
        let missing = bytes - self.tokens;
        self.tokens -= bytes;
        Some(Duration::from_secs_f64(missing / self.limit as f64))
    }
}

pub struct TransferManager {
    transfers: Mutex<HashMap<String, ActiveTransfer>>,
    queue: Mutex<TransferQueue>,
    bandwidth: Mutex<BandwidthBudget>,
}

impl Default for TransferManager {
    fn default() -> Self {
        Self {
            transfers: Mutex::new(HashMap::new()),
            queue: Mutex::new(TransferQueue::default()),
            bandwidth: Mutex::new(BandwidthBudget::new(0)),
        }
    }
}

impl TransferManager {
    pub async fn set_bandwidth_limit(&self, limit_kbps: u64) {
        let mut budget = self.bandwidth.lock().await;
        budget.limit = limit_kbps.saturating_mul(1024);
        budget.tokens = 0.0;
        budget.last = Instant::now();
    }

    pub async fn throttle(&self, bytes: u64) {
        if bytes == 0 {
            return;
        }
        let mut budget = self.bandwidth.lock().await;
        if budget.limit == 0 {
            return;
        }
        let now = Instant::now();
        let Some(duration) = budget.consume(bytes, now) else {
            return;
        };
        drop(budget);
        tokio::time::sleep(duration).await;
    }
}

struct ActiveTransfer {
    session_id: String,
    handle: TransferHandle,
}

impl TransferManager {
    pub async fn begin(&self, transfer_id: String, session_id: String) -> TransferHandle {
        let handle = TransferHandle {
            cancellation: Arc::new(AtomicBool::new(false)),
            paused: Arc::new(AtomicBool::new(false)),
            wake: Arc::new(Notify::new()),
            cancel_wake: Arc::new(Notify::new()),
            slot_acquired: Arc::new(AtomicBool::new(false)),
        };
        let mut transfers = self.transfers.lock().await;
        // Transfers queue up independently: starting one must not cancel
        // the session's other in-flight transfers.
        if let Some(previous) = transfers.insert(
            transfer_id,
            ActiveTransfer {
                session_id,
                handle: handle.clone(),
            },
        ) {
            previous.handle.cancellation.store(true, Ordering::Release);
            previous.handle.cancel_wake.notify_one();
        }
        drop(transfers);

        let receiver = {
            let mut queue = self.queue.lock().await;
            if queue.running < queue.limit {
                queue.running += 1;
                handle.slot_acquired.store(true, Ordering::Release);
                None
            } else {
                let (sender, receiver) = oneshot::channel();
                queue.waiters.push_back(sender);
                Some(receiver)
            }
        };
        if let Some(receiver) = receiver {
            tokio::select! {
                result = receiver => {
                    if result.is_ok() {
                        handle.slot_acquired.store(true, Ordering::Release);
                    }
                }
                _ = handle.cancelled() => {}
            }
        }
        handle
    }

    pub async fn finish(&self, transfer_id: &str) {
        let removed = self.transfers.lock().await.remove(transfer_id);
        let acquired = removed
            .map(|transfer| transfer.handle.slot_acquired.load(Ordering::Acquire))
            .unwrap_or(false);
        if !acquired {
            return;
        }
        let mut queue = self.queue.lock().await;
        queue.running = queue.running.saturating_sub(1);
        while let Some(waiter) = queue.waiters.pop_front() {
            if waiter.send(()).is_ok() {
                queue.running += 1;
                break;
            }
        }
    }

    pub async fn cancel(&self, transfer_id: &str) -> bool {
        if let Some(transfer) = self.transfers.lock().await.get(transfer_id) {
            transfer.handle.cancellation.store(true, Ordering::Release);
            transfer.handle.cancel_wake.notify_one();
            true
        } else {
            false
        }
    }

    pub async fn set_concurrency(&self, limit: usize) {
        let mut queue = self.queue.lock().await;
        queue.limit = limit.clamp(MIN_CONCURRENCY, MAX_CONCURRENCY);
        while queue.running < queue.limit {
            let Some(waiter) = queue.waiters.pop_front() else {
                break;
            };
            if waiter.send(()).is_ok() {
                queue.running += 1;
            }
        }
    }

    pub async fn pause(&self, transfer_id: &str) -> bool {
        if let Some(transfer) = self.transfers.lock().await.get(transfer_id) {
            transfer.handle.paused.store(true, Ordering::Release);
            true
        } else {
            false
        }
    }

    pub async fn resume(&self, transfer_id: &str) -> bool {
        if let Some(transfer) = self.transfers.lock().await.get(transfer_id) {
            transfer.handle.paused.store(false, Ordering::Release);
            transfer.handle.wake.notify_one();
            true
        } else {
            false
        }
    }

    pub async fn cancel_session(&self, session_id: &str) {
        for transfer in self.transfers.lock().await.values() {
            if transfer.session_id == session_id {
                transfer.handle.cancellation.store(true, Ordering::Release);
                transfer.handle.cancel_wake.notify_one();
            }
        }
    }
}

pub fn emit_transfer<R: Runtime>(app_handle: &AppHandle<R>, event: TransferEvent) {
    if let Err(error) = app_handle.emit(SFTP_TRANSFER_EVENT, event) {
        log::warn!("Failed to emit SFTP transfer progress: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::{BandwidthBudget, TransferManager};
    use std::sync::Arc;

    #[tokio::test]
    async fn cancels_an_active_transfer() {
        let manager = TransferManager::default();
        let handle = manager.begin("transfer-1".into(), "session-1".into()).await;

        assert!(manager.cancel("transfer-1").await);
        assert!(handle.is_cancelled());
        manager.finish("transfer-1").await;
        assert!(!manager.cancel("transfer-1").await);
    }

    #[tokio::test]
    async fn transfers_in_the_same_session_run_independently() {
        let manager = TransferManager::default();
        let first = manager.begin("transfer-1".into(), "session-1".into()).await;

        manager.begin("transfer-2".into(), "session-1".into()).await;

        assert!(
            !first.is_cancelled(),
            "a queued transfer must not cancel its session peers"
        );
        assert!(
            manager.cancel("transfer-1").await,
            "each transfer stays individually cancellable"
        );
        assert!(first.is_cancelled());
    }

    #[tokio::test]
    async fn pauses_and_resumes_a_transfer() {
        let manager = TransferManager::default();
        let handle = manager.begin("transfer-1".into(), "session-1".into()).await;

        assert!(manager.pause("transfer-1").await);
        assert!(handle.is_paused());

        let waiter = tokio::spawn({
            let handle = handle.clone();
            async move {
                handle.wait_until_resumed().await;
                handle.is_paused()
            }
        });
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        assert!(manager.resume("transfer-1").await);

        assert!(!waiter.await.expect("waiter task"));
        assert!(!handle.is_paused());
    }

    #[tokio::test]
    async fn limits_concurrent_transfers_and_wakes_waiters() {
        let manager = Arc::new(TransferManager::default());
        manager.set_concurrency(1).await;
        let first = manager.begin("transfer-1".into(), "session-1".into()).await;

        let mut second = tokio::spawn({
            let manager = Arc::clone(&manager);
            async move { manager.begin("transfer-2".into(), "session-1".into()).await }
        });
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), &mut second)
                .await
                .is_err(),
            "the second transfer must wait for a slot"
        );

        manager.finish("transfer-1").await;
        let second = second.await.expect("second transfer should start");
        assert!(!first.is_cancelled());
        assert!(!second.is_cancelled());
        manager.finish("transfer-2").await;
    }

    #[test]
    fn unlimited_bandwidth_bypasses_throttling() {
        let mut budget = BandwidthBudget::new(0);
        let now = tokio::time::Instant::now();
        assert_eq!(budget.consume(1024, now), None);
        assert_eq!(budget.consume(2048, now), None);
    }

    #[test]
    fn limited_budget_consumes_tokens_and_schedules_sleep() {
        let mut budget = BandwidthBudget::new(1024);
        let now = tokio::time::Instant::now();
        let first = budget.consume(512, now).expect("empty budget must sleep");
        assert!(
            first.as_millis() >= 499,
            "first sleep should be about 512 ms: {first:?}"
        );
        let second = budget
            .consume(1024, now)
            .expect("second consume must sleep");
        assert!(second.as_millis() > 500);
    }

    #[tokio::test(start_paused = true)]
    async fn budget_refills_with_elapsed_time_and_caps_at_one_second() {
        let mut budget = BandwidthBudget::new(1024);
        tokio::time::advance(std::time::Duration::from_millis(500)).await;
        assert_eq!(
            budget.consume(512, tokio::time::Instant::now()),
            None,
            "half a second of accrued tokens covers 512 bytes without sleeping"
        );
        tokio::time::advance(std::time::Duration::from_secs(10)).await;
        assert_eq!(
            budget.consume(1024, tokio::time::Instant::now()),
            None,
            "accrued tokens must cap at one second's worth of the limit"
        );
        let sleep = budget
            .consume(512, tokio::time::Instant::now())
            .expect("spending beyond the cap must schedule a sleep");
        assert_eq!(sleep.as_millis(), 500);
    }

    #[tokio::test(start_paused = true)]
    async fn throttle_sleeps_for_the_overdraft() {
        let manager = TransferManager::default();
        manager.set_bandwidth_limit(1024).await;
        let start = tokio::time::Instant::now();
        manager.throttle(2 * 1024 * 1024).await;
        let elapsed = start.elapsed();
        assert!(
            elapsed >= std::time::Duration::from_secs(2),
            "a 2 MB burst at 1024 KB/s must sleep about 2 s: {elapsed:?}"
        );
    }

    #[tokio::test]
    async fn shared_transfers_use_one_budget() {
        let manager = Arc::new(TransferManager::default());
        manager.set_bandwidth_limit(1024).await;
        let first = tokio::spawn({
            let manager = Arc::clone(&manager);
            async move { manager.throttle(512).await }
        });
        let second = tokio::spawn({
            let manager = Arc::clone(&manager);
            async move { manager.throttle(512).await }
        });
        first.await.expect("first throttle");
        second.await.expect("second throttle");
    }

    #[test]
    fn test_calculate_percentage() {
        use super::calculate_percentage;
        assert_eq!(calculate_percentage(50, Some(100)), Some(50.0));
        assert_eq!(calculate_percentage(1, Some(3)), Some(33.3));
        assert_eq!(calculate_percentage(100, None), None);
        assert_eq!(calculate_percentage(100, Some(0)), None);
    }

    #[test]
    fn calculates_transfer_rate_after_warmup() {
        use super::calculate_transfer_rate;
        use std::time::Duration;

        assert_eq!(calculate_transfer_rate(0, Duration::from_secs(1)), None);
        assert_eq!(
            calculate_transfer_rate(100, Duration::from_millis(50)),
            None
        );
        assert_eq!(
            calculate_transfer_rate(2048, Duration::from_secs(2)),
            Some(1024.0)
        );
    }

    #[test]
    fn estimates_remaining_time() {
        use super::calculate_eta;

        assert_eq!(calculate_eta(Some(4096), 1024, Some(1024.0)), Some(3));
        assert_eq!(calculate_eta(Some(1024), 1024, Some(1024.0)), Some(0));
        assert_eq!(calculate_eta(None, 1024, Some(1024.0)), None);
        assert_eq!(calculate_eta(Some(4096), 1024, None), None);
        assert_eq!(calculate_eta(Some(4096), 1024, Some(0.0)), None);
    }
}
