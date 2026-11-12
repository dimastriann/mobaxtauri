//! Folder transfer resume state.
//!
//! A folder transfer writes a snapshot of the source tree before copying
//! files, then appends every finalized relative path to a journal. On retry
//! the snapshot must exactly match the freshly collected tree; otherwise the
//! artifacts are discarded and the folder restarts from zero. Per-file
//! partial files still use the single-file sidecars in [`crate::sftp_resume`].

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;

/// Snapshot kept at the resolved target root while a folder transfer runs.
pub const FOLDER_MANIFEST_FILE: &str = ".mobaxtauri-folder-resume.json";
/// Append-only list of completed relative paths, one JSON string per line.
pub const FOLDER_JOURNAL_FILE: &str = ".mobaxtauri-folder-resume.log";
const SNAPSHOT_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FolderDirection {
    Upload,
    Download,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderFile {
    pub relative_path: String,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSnapshot {
    pub version: u32,
    pub direction: FolderDirection,
    pub source_root: String,
    pub target_root: String,
    pub files: Vec<FolderFile>,
}

impl FolderSnapshot {
    /// Build a normalized snapshot. Paths are sorted so tree walks with
    /// different directory iteration order still compare equal.
    pub fn new(
        direction: FolderDirection,
        source_root: impl Into<String>,
        target_root: impl Into<String>,
        mut files: Vec<FolderFile>,
    ) -> Result<Self, String> {
        for file in &files {
            validate_relative_path(&file.relative_path)?;
        }
        files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        for pair in files.windows(2) {
            if pair[0].relative_path == pair[1].relative_path {
                return Err(format!(
                    "Duplicate folder source entry: {}",
                    pair[0].relative_path
                ));
            }
        }
        Ok(Self {
            version: SNAPSHOT_VERSION,
            direction,
            source_root: source_root.into(),
            target_root: target_root.into(),
            files,
        })
    }

    /// Whether the persisted snapshot still describes the current source.
    pub fn matches(&self, current: &Self) -> bool {
        self == current
    }

    /// Completed-file skipping needs reliable mtimes on every source file.
    /// When a server omits them, partial files may still resume, but finalized
    /// files are copied again to avoid trusting a size-only fingerprint.
    pub fn supports_completed_skip(&self) -> bool {
        self.files.iter().all(|file| file.modified.is_some())
    }

    pub fn total_bytes(&self) -> u64 {
        self.files.iter().map(|file| file.size).sum()
    }

    /// Bytes represented by journal entries that still exist in the snapshot.
    pub fn completed_bytes(&self, completed: &HashSet<String>) -> u64 {
        self.files
            .iter()
            .filter(|file| completed.contains(&file.relative_path))
            .map(|file| file.size)
            .sum()
    }

    /// Intersect a journal with this snapshot, dropping stale entries.
    pub fn completed_paths(&self, journal: &HashSet<String>) -> HashSet<String> {
        self.files
            .iter()
            .filter(|file| journal.contains(&file.relative_path))
            .map(|file| file.relative_path.clone())
            .collect()
    }

    fn is_valid(&self) -> bool {
        self.version == SNAPSHOT_VERSION
            && self
                .files
                .iter()
                .all(|file| is_safe_relative_path(&file.relative_path))
    }
}

/// A relative path from a tree walk must not escape the transfer root.
pub fn is_safe_relative_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.starts_with('\\')
        && !path.contains('\\')
        && !path.contains('\0')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn validate_relative_path(path: &str) -> Result<(), String> {
    if is_safe_relative_path(path) {
        Ok(())
    } else {
        Err(format!("Unsafe folder transfer path: {path:?}"))
    }
}

/// Serialize one journal entry, including its trailing newline.
pub fn journal_line(relative_path: &str) -> Result<String, String> {
    validate_relative_path(relative_path)?;
    let encoded = serde_json::to_string(relative_path)
        .map_err(|error| format!("Failed to encode folder resume journal: {error}"))?;
    Ok(format!("{encoded}\n"))
}

/// Parse JSON-lines journal entries, ignoring corrupt or unsafe lines.
pub fn parse_journal(content: &str) -> HashSet<String> {
    content
        .lines()
        .filter_map(|line| serde_json::from_str::<String>(line).ok())
        .filter(|path| is_safe_relative_path(path))
        .collect()
}

pub fn local_manifest_path(root: &Path) -> PathBuf {
    root.join(FOLDER_MANIFEST_FILE)
}

pub fn local_journal_path(root: &Path) -> PathBuf {
    root.join(FOLDER_JOURNAL_FILE)
}

pub async fn read_local_snapshot(root: &Path) -> Option<FolderSnapshot> {
    let json = tokio::fs::read_to_string(local_manifest_path(root))
        .await
        .ok()?;
    serde_json::from_str::<FolderSnapshot>(&json)
        .ok()
        .filter(FolderSnapshot::is_valid)
}

pub async fn write_local_snapshot(root: &Path, snapshot: &FolderSnapshot) -> Result<(), String> {
    tokio::fs::create_dir_all(root)
        .await
        .map_err(|error| format!("Failed to create local folder root: {error}"))?;
    let json = serde_json::to_vec_pretty(snapshot)
        .map_err(|error| format!("Failed to encode folder resume snapshot: {error}"))?;
    tokio::fs::write(local_manifest_path(root), json)
        .await
        .map_err(|error| format!("Failed to write folder resume snapshot: {error}"))
}

pub async fn read_local_journal(root: &Path) -> HashSet<String> {
    match tokio::fs::read_to_string(local_journal_path(root)).await {
        Ok(content) => parse_journal(&content),
        Err(_) => HashSet::new(),
    }
}

pub async fn append_local_journal(root: &Path, relative_path: &str) -> Result<(), String> {
    let line = journal_line(relative_path)?;
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(local_journal_path(root))
        .await
        .map_err(|error| format!("Failed to open folder resume journal: {error}"))?;
    file.write_all(line.as_bytes())
        .await
        .map_err(|error| format!("Failed to append folder resume journal: {error}"))?;
    file.flush()
        .await
        .map_err(|error| format!("Failed to flush folder resume journal: {error}"))
}

pub async fn remove_local_resume_artifacts(root: &Path) {
    let _ = tokio::fs::remove_file(local_manifest_path(root)).await;
    let _ = tokio::fs::remove_file(local_journal_path(root)).await;
}

pub fn remote_manifest_path(root: &str) -> String {
    join_remote_path(root, FOLDER_MANIFEST_FILE)
}

pub fn remote_journal_path(root: &str) -> String {
    join_remote_path(root, FOLDER_JOURNAL_FILE)
}

fn join_remote_path(root: &str, name: &str) -> String {
    if root.is_empty() || root == "/" {
        format!("/{name}")
    } else if root.ends_with('/') {
        format!("{root}{name}")
    } else {
        format!("{root}/{name}")
    }
}

pub async fn read_remote_snapshot(sftp: &SftpSession, root: &str) -> Option<FolderSnapshot> {
    let bytes = sftp.read(remote_manifest_path(root)).await.ok()?;
    serde_json::from_slice::<FolderSnapshot>(&bytes)
        .ok()
        .filter(FolderSnapshot::is_valid)
}

pub async fn write_remote_snapshot(
    sftp: &SftpSession,
    root: &str,
    snapshot: &FolderSnapshot,
) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(snapshot)
        .map_err(|error| format!("Failed to encode folder resume snapshot: {error}"))?;
    let mut file = sftp
        .create(remote_manifest_path(root))
        .await
        .map_err(|error| format!("Failed to create folder resume snapshot: {error:?}"))?;
    file.write_all(&json)
        .await
        .map_err(|error| format!("Failed to write folder resume snapshot: {error:?}"))?;
    file.close()
        .await
        .map_err(|error| format!("Failed to close folder resume snapshot: {error:?}"))
}

pub async fn read_remote_journal(sftp: &SftpSession, root: &str) -> HashSet<String> {
    match sftp.read(remote_journal_path(root)).await {
        Ok(bytes) => parse_journal(&String::from_utf8_lossy(&bytes)),
        Err(_) => HashSet::new(),
    }
}

pub async fn append_remote_journal(
    sftp: &SftpSession,
    root: &str,
    relative_path: &str,
) -> Result<(), String> {
    let line = journal_line(relative_path)?;
    let mut file = sftp
        .open_with_flags(
            remote_journal_path(root),
            OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::APPEND,
        )
        .await
        .map_err(|error| format!("Failed to open folder resume journal: {error:?}"))?;
    file.write_all(line.as_bytes())
        .await
        .map_err(|error| format!("Failed to append folder resume journal: {error:?}"))?;
    file.flush()
        .await
        .map_err(|error| format!("Failed to flush folder resume journal: {error:?}"))?;
    file.close()
        .await
        .map_err(|error| format!("Failed to close folder resume journal: {error:?}"))
}

pub async fn remove_remote_resume_artifacts(sftp: &SftpSession, root: &str) {
    let _ = sftp.remove_file(remote_manifest_path(root)).await;
    let _ = sftp.remove_file(remote_journal_path(root)).await;
}

#[cfg(test)]
mod tests {
    use super::{
        append_local_journal, is_safe_relative_path, journal_line, parse_journal,
        read_local_journal, read_local_snapshot, remove_local_resume_artifacts,
        write_local_snapshot, FolderDirection, FolderFile, FolderSnapshot,
    };
    use std::collections::HashSet;
    use std::path::PathBuf;

    fn file(path: &str, size: u64, modified: Option<u64>) -> FolderFile {
        FolderFile {
            relative_path: path.to_string(),
            size,
            modified,
        }
    }

    fn snapshot(files: Vec<FolderFile>) -> FolderSnapshot {
        FolderSnapshot::new(FolderDirection::Upload, "/source", "/target", files)
            .expect("snapshot should be valid")
    }

    fn temp_root(name: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "moba-folder-resume-{name}-{}-{unique}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        root
    }

    #[test]
    fn sorts_files_and_rejects_duplicates() {
        let snapshot = snapshot(vec![file("b.txt", 2, Some(2)), file("a.txt", 1, Some(1))]);
        assert_eq!(snapshot.files[0].relative_path, "a.txt");
        assert_eq!(snapshot.files[1].relative_path, "b.txt");

        let duplicate = FolderSnapshot::new(
            FolderDirection::Upload,
            "/source",
            "/target",
            vec![file("a.txt", 1, Some(1)), file("a.txt", 2, Some(2))],
        );
        assert!(duplicate.is_err());
    }

    #[test]
    fn rejects_paths_that_escape_the_transfer_root() {
        for path in [
            "",
            "/etc/passwd",
            "../secret",
            "a/../b",
            "a//b",
            "a\\b",
            "a\0b",
        ] {
            assert!(!is_safe_relative_path(path), "{path:?} must be rejected");
        }
        assert!(is_safe_relative_path("sub/dir/file.txt"));
    }

    #[test]
    fn matches_only_identical_snapshots() {
        let current = snapshot(vec![file("a.txt", 1, Some(1))]);
        assert!(current.matches(&current));
        assert!(!current.matches(&snapshot(vec![file("a.txt", 2, Some(1))])));
        assert!(!current.matches(&snapshot(vec![file("a.txt", 1, Some(2))])));
        assert!(!current.matches(&snapshot(vec![file("b.txt", 1, Some(1))])));
        assert!(!current.matches(
            &FolderSnapshot::new(
                FolderDirection::Download,
                "/source",
                "/target",
                vec![file("a.txt", 1, Some(1))]
            )
            .expect("valid snapshot")
        ));
    }

    #[test]
    fn completed_skipping_requires_mtimes() {
        assert!(snapshot(vec![file("a.txt", 1, Some(1))]).supports_completed_skip());
        assert!(!snapshot(vec![file("a.txt", 1, None)]).supports_completed_skip());
    }

    #[test]
    fn counts_only_journal_entries_still_in_the_snapshot() {
        let snapshot = snapshot(vec![file("a.txt", 10, Some(1)), file("b.txt", 20, Some(2))]);
        let journal = HashSet::from([
            "a.txt".to_string(),
            "removed.txt".to_string(),
            "b.txt".to_string(),
        ]);
        let completed = snapshot.completed_paths(&journal);
        assert_eq!(
            completed,
            HashSet::from(["a.txt".to_string(), "b.txt".to_string()])
        );
        assert_eq!(snapshot.completed_bytes(&completed), 30);
        assert_eq!(snapshot.total_bytes(), 30);
    }

    #[test]
    fn parses_journals_without_trusting_bad_lines() {
        let content = concat!(r#""a.txt""#, "\n", "not-json\n", r#""../escape""#, "\n");
        assert_eq!(parse_journal(content), HashSet::from(["a.txt".to_string()]));
        assert!(journal_line("../escape").is_err());
    }

    #[tokio::test]
    async fn round_trips_local_snapshot_and_journal() {
        let root = temp_root("roundtrip");
        let snapshot = snapshot(vec![
            file("a.txt", 10, Some(1)),
            file("nested/b.txt", 20, Some(2)),
        ]);

        write_local_snapshot(&root, &snapshot)
            .await
            .expect("write snapshot");
        assert_eq!(read_local_snapshot(&root).await, Some(snapshot.clone()));

        append_local_journal(&root, "a.txt")
            .await
            .expect("append first");
        append_local_journal(&root, "nested/b.txt")
            .await
            .expect("append second");
        assert_eq!(
            read_local_journal(&root).await,
            HashSet::from(["a.txt".to_string(), "nested/b.txt".to_string()])
        );

        remove_local_resume_artifacts(&root).await;
        assert!(read_local_snapshot(&root).await.is_none());
        assert!(read_local_journal(&root).await.is_empty());
        let _ = std::fs::remove_dir_all(root);
    }
}
