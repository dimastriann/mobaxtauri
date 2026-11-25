//! Opt-in plain-text session logs.
//!
//! Each opted-in session gets one `.log` file under the app data
//! `logs/session-logs` directory. Raw shell bytes stream through a stateful
//! ANSI stripper so the log stays readable plain text: escape sequences are
//! removed (including ones split across chunk boundaries), carriage returns
//! and backspaces are normalized the way a terminal renders them, and only
//! printable text survives. Retention keeps the newest 30 files and at most
//! 50 MB; pruning runs when a session starts logging.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt;

/// Newest log files kept by retention pruning.
const MAX_LOG_FILES: usize = 30;

/// Total bytes across all log files kept by retention pruning.
const MAX_TOTAL_BYTES: u64 = 50 * 1024 * 1024;

/// Safety cap for one logical line so a newline-free stream (for example a
/// progress animation that never resets) cannot grow the buffer forever.
const MAX_LINE_BYTES: usize = 8 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLogEntry {
    pub file_name: String,
    pub size: u64,
    /// Seconds since the Unix epoch, when the filesystem exposes it.
    pub modified: Option<u64>,
}

/// Directory under the app data root that holds every session log.
pub fn logs_dir(app_data: &Path) -> PathBuf {
    app_data.join("logs").join("session-logs")
}

/// Keep only characters that are safe in file names, and cap the length.
pub fn sanitize_session_id(session_id: &str) -> String {
    let sanitized: String = session_id
        .chars()
        .take(64)
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "session".to_string()
    } else {
        sanitized
    }
}

/// Parse the embedded creation timestamp of a log file name.
fn log_timestamp(file_name: &str) -> Option<u128> {
    file_name
        .strip_suffix(".log")
        .and_then(|stem| stem.split_once('-'))
        .and_then(|(timestamp, _)| timestamp.parse().ok())
}

/// One output stream stripping terminal escape sequences into plain text.
///
/// Lines are buffered so `\r` can reset them and `\b` can erase the last
/// character; a completed line is emitted with a normalized `\n`.
#[derive(Default)]
pub struct AnsiStripper {
    state: AnsiState,
    /// A carriage return is a line restart, but `\r\n` is a line end. The
    /// decision needs the byte after the CR, so the CR is parked here.
    cr_pending: bool,
    line: Vec<u8>,
}

#[derive(Default)]
enum AnsiState {
    #[default]
    Ground,
    /// ESC was seen; the next byte picks the sequence type.
    Escape,
    /// ESC [ parameters ... final byte.
    Csi,
    /// ESC ] payload ... BEL or ESC \.
    Osc,
    /// ESC seen inside an OSC payload; either terminates the OSC (ESC \)
    /// or starts a nested escape.
    OscEscape,
}

impl AnsiStripper {
    /// Strip `data` and append the completed plain-text lines to `out`.
    /// Sequence and control state carries across calls.
    pub fn push(&mut self, data: &[u8], out: &mut Vec<u8>) {
        for byte in data {
            self.state = match self.state {
                AnsiState::Ground => self.handle_ground(*byte, out),
                AnsiState::Escape => match byte {
                    b'[' => AnsiState::Csi,
                    b']' => AnsiState::Osc,
                    _ => AnsiState::Ground,
                },
                AnsiState::Csi => {
                    if (0x40..=0x7e).contains(byte) {
                        AnsiState::Ground
                    } else {
                        AnsiState::Csi
                    }
                }
                AnsiState::Osc => match byte {
                    0x07 => AnsiState::Ground,
                    0x1b => AnsiState::OscEscape,
                    _ => AnsiState::Osc,
                },
                AnsiState::OscEscape => match byte {
                    b'\\' => AnsiState::Ground,
                    _ => AnsiState::Osc,
                },
            };
        }
    }

    /// Flush the buffered line; called when the stream ends.
    pub fn finish(&mut self, out: &mut Vec<u8>) {
        self.cr_pending = false;
        if !self.line.is_empty() {
            out.extend_from_slice(&self.line);
            out.push(b'\n');
            self.line.clear();
        }
    }

    fn handle_ground(&mut self, byte: u8, out: &mut Vec<u8>) -> AnsiState {
        match byte {
            0x1b => AnsiState::Escape,
            b'\r' => {
                self.cr_pending = true;
                AnsiState::Ground
            }
            b'\n' => {
                self.cr_pending = false;
                out.extend_from_slice(&self.line);
                out.push(b'\n');
                self.line.clear();
                AnsiState::Ground
            }
            _ => {
                // Any byte after a CR (other than LF) confirms the CR was a
                // line restart: what was buffered is overwritten.
                if self.cr_pending {
                    self.cr_pending = false;
                    self.line.clear();
                }
                match byte {
                    0x08 => {
                        self.line.pop();
                    }
                    0x00..=0x08 | 0x0a..=0x1f | 0x7f => {}
                    _ => self.append_line(byte, out),
                }
                AnsiState::Ground
            }
        }
    }

    fn append_line(&mut self, byte: u8, out: &mut Vec<u8>) {
        self.line.push(byte);
        if self.line.len() >= MAX_LINE_BYTES {
            out.extend_from_slice(&self.line);
            out.push(b'\n');
            self.line.clear();
        }
    }
}

/// One session's plain-text log file.
pub struct SessionLogWriter {
    file: tokio::fs::File,
    stripper: AnsiStripper,
}

impl SessionLogWriter {
    /// Strip the chunk and write the resulting plain text.
    pub async fn write_bytes(&mut self, data: &[u8]) -> Result<(), String> {
        let mut out = Vec::new();
        self.stripper.push(data, &mut out);
        self.write_plain(&out).await
    }

    /// Flush the trailing partial line and the OS buffers. Idempotent.
    pub async fn close(&mut self) -> Result<(), String> {
        let mut out = Vec::new();
        self.stripper.finish(&mut out);
        self.write_plain(&out).await?;
        self.file
            .flush()
            .await
            .map_err(|error| format!("Failed to flush session log: {error}"))?;
        Ok(())
    }

    async fn write_plain(&mut self, out: &[u8]) -> Result<(), String> {
        if out.is_empty() {
            return Ok(());
        }
        self.file
            .write_all(out)
            .await
            .map_err(|error| format!("Failed to write session log: {error}"))
    }
}

/// Owns the log directory: starts sessions, prunes retention, lists and
/// clears saved logs.
pub struct SessionLogService {
    dir: PathBuf,
}

impl SessionLogService {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// Create the log file for one session and apply retention afterwards
    /// so the newest file (this session) survives within the budget.
    pub async fn start(&self, session_id: &str) -> Result<SessionLogWriter, String> {
        tokio::fs::create_dir_all(&self.dir)
            .await
            .map_err(|error| format!("Failed to create session log directory: {error}"))?;

        let file_name = format!(
            "{}-{}.log",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or_default(),
            sanitize_session_id(session_id)
        );
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(self.dir.join(&file_name))
            .await
            .map_err(|error| format!("Failed to create session log: {error}"))?;
        self.prune().await;
        Ok(SessionLogWriter {
            file,
            stripper: AnsiStripper::default(),
        })
    }

    /// Saved logs, newest first.
    pub async fn list(&self) -> Result<Vec<SessionLogEntry>, String> {
        let mut entries: Vec<SessionLogEntry> = Vec::new();
        let mut dir = match tokio::fs::read_dir(&self.dir).await {
            Ok(dir) => dir,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(entries);
            }
            Err(error) => return Err(format!("Failed to read session log directory: {error}")),
        };
        while let Some(entry) = dir
            .next_entry()
            .await
            .map_err(|error| format!("Failed to enumerate session logs: {error}"))?
        {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".log") {
                continue;
            }
            let metadata = entry
                .metadata()
                .await
                .map_err(|error| format!("Failed to inspect session log {name}: {error}"))?;
            entries.push(SessionLogEntry {
                modified: metadata
                    .modified()
                    .ok()
                    .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_secs()),
                file_name: name,
                size: metadata.len(),
            });
        }
        entries.sort_by(|left, right| {
            log_timestamp(&right.file_name)
                .cmp(&log_timestamp(&left.file_name))
                .then_with(|| right.file_name.cmp(&left.file_name))
        });
        Ok(entries)
    }

    /// Delete every log file and report how many were removed.
    pub async fn clear(&self) -> Result<usize, String> {
        let entries = self.list().await?;
        let mut removed = 0;
        for entry in entries {
            match tokio::fs::remove_file(self.dir.join(&entry.file_name)).await {
                Ok(()) => removed += 1,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!(
                        "Failed to delete session log {}: {error}",
                        entry.file_name
                    ))
                }
            }
        }
        Ok(removed)
    }

    async fn prune(&self) {
        if let Err(error) = prune_dir(&self.dir, MAX_LOG_FILES, MAX_TOTAL_BYTES).await {
            log::warn!("Failed to prune session logs: {error}");
        }
    }
}

/// Retention policy: keep the newest `max_files` logs, then drop the oldest
/// until the total size is at most `max_bytes`. File names embed their
/// creation timestamp, so name order is age order.
async fn prune_dir(dir: &Path, max_files: usize, max_bytes: u64) -> Result<(), String> {
    let mut files: Vec<(PathBuf, u64)> = Vec::new();
    let mut dir_entries = match tokio::fs::read_dir(dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Failed to read session log directory: {error}")),
    };
    while let Some(entry) = dir_entries
        .next_entry()
        .await
        .map_err(|error| format!("Failed to enumerate session logs: {error}"))?
    {
        let name = entry.file_name();
        if !name.to_string_lossy().ends_with(".log") {
            continue;
        }
        if !matches!(
            entry.file_type().await,
            Ok(kind) if kind.is_file()
        ) {
            continue;
        }
        let size = entry
            .metadata()
            .await
            .map_err(|error| format!("Failed to inspect {}: {error}", name.to_string_lossy()))?
            .len();
        files.push((entry.path(), size));
    }
    files.sort_by(|left, right| {
        log_timestamp(&right.0.file_name().unwrap_or_default().to_string_lossy())
            .cmp(&log_timestamp(
                &left.0.file_name().unwrap_or_default().to_string_lossy(),
            ))
            .then_with(|| right.0.cmp(&left.0))
    });

    let mut kept = files;
    let overflow = kept.split_off(max_files.min(kept.len()));
    for (path, _) in overflow {
        let _ = tokio::fs::remove_file(path).await;
    }
    let mut total: u64 = kept.iter().map(|(_, size)| size).sum();
    for (path, size) in kept.iter().rev() {
        if total <= max_bytes {
            break;
        }
        if tokio::fs::remove_file(path).await.is_ok() {
            total = total.saturating_sub(*size);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strip(chunks: Vec<&[u8]>) -> String {
        let mut stripper = AnsiStripper::default();
        let mut out = Vec::new();
        for chunk in chunks {
            stripper.push(chunk, &mut out);
        }
        stripper.finish(&mut out);
        String::from_utf8(out).expect("stripped output is valid UTF-8")
    }

    #[test]
    fn strips_sequences_split_across_chunk_boundaries() {
        // CSI split inside its parameters, OSC split inside its payload.
        // A trailing partial line is flushed by `finish`.
        let stripped = strip(vec![
            b"a\x1b[3".as_slice(),
            b"8;5;196mred\x1b]0;ti".as_slice(),
            b"tle\x07rest".as_slice(),
        ]);
        assert_eq!(stripped, "aredrest\n");
    }

    #[test]
    fn strips_osc_terminated_by_the_string_ender() {
        let stripped = strip(vec![b"a\x1b]2;title\x1b\\b".as_slice()]);
        assert_eq!(stripped, "ab\n");
    }

    #[test]
    fn normalizes_carriage_returns_and_backspaces() {
        assert_eq!(strip(vec![b"hello\r\nworld\n"]), "hello\nworld\n");
        // A bare CR restarts the line like a terminal overwrite.
        assert_eq!(strip(vec![b"50%\r100%\n"]), "100%\n");
        // Backspace erases the previous character.
        assert_eq!(strip(vec![b"ab\x08c\n"]), "ac\n");
        // Backspace on an empty line erases nothing.
        assert_eq!(strip(vec![b"\x08\n"]), "\n");
    }

    #[test]
    fn keeps_printable_text_and_tabs() {
        assert_eq!(
            strip(vec![b"a\tb \xc3\xa9\n"]).as_bytes(),
            b"a\tb \xc3\xa9\n"
        );
    }

    #[test]
    fn drops_other_control_characters() {
        // The byte right after a bare ESC is consumed as the escape's
        // final character, so the second `b` here is part of a sequence.
        assert_eq!(strip(vec![b"a\x00\x07\x0b\x1bb\n"]), "a\n");
    }

    #[test]
    fn flushes_the_partial_line_on_finish() {
        assert_eq!(strip(vec![b"partial"]), "partial\n");
        assert_eq!(strip(vec![]), "");
    }

    #[test]
    fn flushes_an_overlong_line_to_stay_bounded() {
        let mut stripper = AnsiStripper::default();
        let mut out = Vec::new();
        stripper.push(&vec![b'x'; MAX_LINE_BYTES + 1], &mut out);
        stripper.finish(&mut out);
        // The capped line, its newline, the overflow character, and the
        // trailing newline flushed by `finish`.
        assert_eq!(out.len(), MAX_LINE_BYTES + 3);
        assert_eq!(out[out.len() - 1], b'\n');
    }

    #[test]
    fn sanitizes_session_ids_for_file_names() {
        assert_eq!(sanitize_session_id("ssh-prod_01"), "ssh-prod_01");
        assert_eq!(sanitize_session_id("host:22/user"), "host-22-user");
        assert_eq!(sanitize_session_id(""), "session");
        assert_eq!(sanitize_session_id(&"x".repeat(100)).len(), 64);
    }

    fn prune_test_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("moba-session-log-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create prune dir");
        dir
    }

    /// One fake log with an embedded, distinct timestamp in its name.
    fn write_fake_log(dir: &Path, timestamp: u128, size: usize) {
        let file_name = format!("{timestamp}-session.log");
        std::fs::write(dir.join(&file_name), vec![b'a'; size]).expect("write fake log");
    }

    #[tokio::test]
    async fn prune_keeps_the_newest_files() {
        let dir = prune_test_dir("count");
        for timestamp in 1..=35_u128 {
            write_fake_log(&dir, timestamp, 10);
        }
        prune_dir(&dir, 5, u64::MAX).await.expect("prune succeeds");
        let mut remaining: Vec<u128> = std::fs::read_dir(&dir)
            .expect("read dir")
            .map(|entry| {
                let name = entry.expect("entry").file_name();
                log_timestamp(&name.to_string_lossy()).expect("timestamp")
            })
            .collect();
        remaining.sort_unstable();
        assert_eq!(remaining, (31..=35).collect::<Vec<u128>>());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn prune_keeps_the_size_budget_dropping_oldest_first() {
        let dir = prune_test_dir("size");
        // Three 6-byte files and one 1-byte file: budget 10 bytes keeps the
        // two newest large files plus the small one.
        write_fake_log(&dir, 1, 6);
        write_fake_log(&dir, 2, 6);
        write_fake_log(&dir, 3, 6);
        write_fake_log(&dir, 4, 1);
        prune_dir(&dir, usize::MAX, 10)
            .await
            .expect("prune succeeds");
        let remaining: Vec<u128> = std::fs::read_dir(&dir)
            .expect("read dir")
            .map(|entry| {
                let name = entry.expect("entry").file_name();
                log_timestamp(&name.to_string_lossy()).expect("timestamp")
            })
            .collect();
        assert_eq!(remaining, vec![3, 4]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn prune_ignores_non_log_files() {
        let dir = prune_test_dir("other");
        std::fs::write(dir.join("notes.txt"), b"keep").expect("write txt");
        std::fs::create_dir_all(dir.join("subdir.log")).expect("create dir with log suffix");
        prune_dir(&dir, 10, u64::MAX).await.expect("prune succeeds");
        assert!(dir.join("notes.txt").exists());
        assert!(dir.join("subdir.log").is_dir());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn start_writes_stripped_text_to_a_new_file() {
        let dir = prune_test_dir("start");
        let service = SessionLogService::new(dir.clone());
        let mut writer = service.start("ssh-test:1").await.expect("start logging");
        writer
            .write_bytes(b"\x1b[31mhello\r\n")
            .await
            .expect("write");
        writer.close().await.expect("close");
        // On Windows the directory entry reports the final size only after
        // the handle is released.
        drop(writer);

        let logs = service.list().await.expect("list logs");
        assert_eq!(logs.len(), 1);
        assert!(logs[0].file_name.ends_with("ssh-test-1.log"));
        assert!(logs[0].size > 0);
        assert_eq!(
            std::fs::read(dir.join(&logs[0].file_name)).expect("log content"),
            b"hello\n"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn start_prunes_older_logs_and_clear_empties_the_folder() {
        let dir = prune_test_dir("clear");
        let service = SessionLogService::new(dir.clone());
        for timestamp in 1..=35_u128 {
            write_fake_log(&dir, timestamp, 10);
        }

        service.start("fresh").await.expect("start prunes first");
        let logs = service.list().await.expect("list logs");
        assert_eq!(logs.len(), 30, "retention keeps the newest 30");

        let removed = service.clear().await.expect("clear logs");
        assert_eq!(removed, 30);
        assert!(service.list().await.expect("list after clear").is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn list_is_empty_when_the_directory_does_not_exist() {
        let dir = prune_test_dir("missing");
        let service = SessionLogService::new(dir.join("never-created"));
        assert!(service.list().await.expect("list logs").is_empty());
    }
}
