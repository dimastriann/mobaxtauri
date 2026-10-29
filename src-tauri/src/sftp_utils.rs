/// SFTP Path Utility for consistent across-platform path joining
use tokio::io::AsyncReadExt;

pub fn join_sftp_path(base: &str, name: &str) -> String {
    if base.is_empty() || base == "/" {
        format!("/{}", name)
    } else if base.ends_with('/') {
        format!("{}{}", base, name)
    } else {
        format!("{}/{}", base, name)
    }
}

/// Soft cap for files the in-app editor may load into memory.
pub const EDITOR_MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
/// Soft cap for files opened in an external application via the OS opener.
pub const OPEN_MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;

pub fn humanize_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * KB;
    if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{bytes} B")
    }
}

/// Returns a user-facing error when `size` exceeds `limit`;
/// `None` when the size is unknown or within the limit.
pub fn file_too_large_error(size: Option<u64>, limit: u64) -> Option<String> {
    let size = size?;
    if size <= limit {
        return None;
    }
    Some(format!(
        "File is {} which exceeds the {} limit. Download it instead.",
        humanize_bytes(size),
        humanize_bytes(limit)
    ))
}

/// The final path segment, ignoring a trailing slash.
pub fn final_segment(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(idx) => trimmed[idx + 1..].to_string(),
        None => trimmed.to_string(),
    }
}

/// Path relative to the user's home, rendered with `~`, or `None` when the
/// path is not under the home directory or the home is the degenerate "/".
pub fn relative_to_home(path: &str, home: Option<&str>) -> Option<String> {
    let home = home?.trim_end_matches('/');
    if home.is_empty() {
        return None;
    }
    let trimmed = path.trim_end_matches('/');
    if trimmed == home {
        return Some("~".to_string());
    }
    trimmed
        .strip_prefix(&format!("{home}/"))
        .map(|rest| format!("~/{rest}"))
}

/// The part of `path` that comes after `root`, without a leading slash;
/// empty when `path` is the root itself. Assumes both are absolute POSIX
/// paths sharing the root as a prefix.
pub fn relative_remote_path(root: &str, path: &str) -> String {
    let root = root.trim_end_matches('/');
    let path = path.trim_end_matches('/');
    if path == root {
        return String::new();
    }
    path.strip_prefix(&format!("{root}/"))
        .unwrap_or(path)
        .to_string()
}

#[allow(dead_code)]
pub fn get_parent_path(path: &str) -> String {
    if path == "/" || path.is_empty() {
        return "/".to_string();
    }

    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) => "/".to_string(),
        Some(idx) => trimmed[..idx].to_string(),
        None => "/".to_string(),
    }
}

/// Convert Unix mode permissions to standard rwxr-xr-x string format
pub fn format_permissions(permissions: Option<u32>, is_dir: bool) -> String {
    let mode = match permissions {
        Some(m) => m,
        None => return "—".to_string(),
    };

    let dir_char = if is_dir { 'd' } else { '-' };
    let u_r = if mode & 0o400 != 0 { 'r' } else { '-' };
    let u_w = if mode & 0o200 != 0 { 'w' } else { '-' };
    let u_x = if mode & 0o100 != 0 { 'x' } else { '-' };
    let g_r = if mode & 0o040 != 0 { 'r' } else { '-' };
    let g_w = if mode & 0o020 != 0 { 'w' } else { '-' };
    let g_x = if mode & 0o010 != 0 { 'x' } else { '-' };
    let o_r = if mode & 0o004 != 0 { 'r' } else { '-' };
    let o_w = if mode & 0o002 != 0 { 'w' } else { '-' };
    let o_x = if mode & 0o001 != 0 { 'x' } else { '-' };

    format!("{dir_char}{u_r}{u_w}{u_x}{g_r}{g_w}{g_x}{o_r}{o_w}{o_x}")
}

/// Local filesystem tree collected by the recursive folder-upload walker.
pub struct LocalTree {
    /// Files as `(relative path with '/' separators, size in bytes)`.
    pub files: Vec<(String, u64)>,
    /// Directories as relative paths with `/` separators; the empty string
    /// is the root itself. Sorted, so a parent always precedes its children
    /// (a parent path is a strict prefix of each child path).
    pub dirs: Vec<String>,
}

/// Walk `root` recursively, collecting regular files with their sizes and
/// every directory, including empty ones. Symlinks and special files are
/// skipped, mirroring the remote walker used by folder downloads.
pub async fn collect_local_tree(root: &std::path::Path) -> Result<LocalTree, String> {
    let mut files: Vec<(String, u64)> = Vec::new();
    let mut dirs: Vec<String> = vec![String::new()];
    let mut stack: Vec<(std::path::PathBuf, String)> = vec![(root.to_path_buf(), String::new())];
    while let Some((dir, rel)) = stack.pop() {
        let mut entries = tokio::fs::read_dir(&dir)
            .await
            .map_err(|e| format!("Failed to read local directory {}: {e}", dir.display()))?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| format!("Failed to enumerate {}: {e}", dir.display()))?
        {
            let file_type = entry
                .file_type()
                .await
                .map_err(|e| format!("Failed to inspect {}: {e}", entry.path().display()))?;
            let name = entry.file_name().to_string_lossy().to_string();
            let child_rel = if rel.is_empty() {
                name
            } else {
                format!("{rel}/{name}")
            };
            if file_type.is_dir() {
                dirs.push(child_rel.clone());
                stack.push((entry.path(), child_rel));
            } else if file_type.is_file() {
                let metadata = entry
                    .metadata()
                    .await
                    .map_err(|e| format!("Failed to stat {}: {e}", entry.path().display()))?;
                files.push((child_rel, metadata.len()));
            }
        }
    }
    dirs.sort();
    Ok(LocalTree { files, dirs })
}

/// One dropped filesystem path classified for upload dispatch: directories
/// go to `sftp_upload_folder`, files to `sftp_upload_file`.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
}

/// Classify dropped paths for the SFTP upload dispatcher. A path that no
/// longer exists (deleted between drop and dispatch) is reported as an
/// error so the frontend can surface it instead of guessing.
pub async fn classify_local_paths(paths: Vec<String>) -> Result<Vec<LocalEntry>, String> {
    let mut entries = Vec::with_capacity(paths.len());
    for path in paths {
        let metadata = tokio::fs::metadata(&path)
            .await
            .map_err(|e| local_file_error("Failed to inspect", &path, &e))?;
        let name = std::path::Path::new(&path)
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        entries.push(LocalEntry {
            path,
            name,
            is_dir: metadata.is_dir(),
        });
    }
    Ok(entries)
}

/// Windows error for an online-only cloud placeholder whose provider
/// (OneDrive and similar) is not running — common right after a drag &
/// drop while hydration of the placeholder is still starting.
const CLOUD_FILE_PROVIDER_NOT_RUNNING: i32 = 362;

/// Retry budget for uploads racing cloud-placeholder hydration: ~3.75 s
/// total before the actionable hint is surfaced.
pub const CLOUD_RETRY_DELAYS_MS: &[u64] = &[250, 500, 1000, 2000];

/// User-facing message for a local file operation failure, adding an
/// actionable hint when the failure is a cloud placeholder file.
pub fn local_file_error(prefix: &str, path: &str, error: &std::io::Error) -> String {
    if error.raw_os_error() == Some(CLOUD_FILE_PROVIDER_NOT_RUNNING) {
        format!(
            "{prefix} {path}: this is an online-only cloud file and its provider is not running. \
             Wait for the cloud app (e.g. OneDrive) to finish downloading it, or right-click the \
             file in Explorer and choose 'Always keep on this device', then try again."
        )
    } else {
        format!("{prefix} {path}: {error}")
    }
}

/// One buffered read for local upload sources, retrying briefly when a
/// cloud placeholder is not hydrated yet: the drop can beat OneDrive's
/// hydration, and the first reads fail with
/// ERROR_CLOUD_FILE_PROVIDER_NOT_RUNNING while the provider spins up.
/// `delays` paces the retries (pass `CLOUD_RETRY_DELAYS_MS` in production).
pub async fn read_upload_chunk<R: tokio::io::AsyncRead + Unpin>(
    path: &str,
    delays: &[u64],
    file: &mut R,
    buffer: &mut [u8],
) -> Result<usize, String> {
    let mut attempt = 0_usize;
    loop {
        match file.read(buffer).await {
            Ok(count) => return Ok(count),
            Err(error) => {
                if error.raw_os_error() != Some(CLOUD_FILE_PROVIDER_NOT_RUNNING) {
                    return Err(local_file_error("Read failed for", path, &error));
                }
                let Some(delay_ms) = delays.get(attempt) else {
                    return Err(local_file_error("Read failed for", path, &error));
                };
                attempt += 1;
                log::warn!("Cloud placeholder {path} not hydrated yet; retrying in {delay_ms} ms");
                tokio::time::sleep(std::time::Duration::from_millis(*delay_ms)).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_join_sftp_path() {
        assert_eq!(join_sftp_path("/", "test"), "/test");
        assert_eq!(join_sftp_path("/home", "user"), "/home/user");
        assert_eq!(join_sftp_path("/home/", "user"), "/home/user");
        assert_eq!(join_sftp_path("", "root_file"), "/root_file");
        // Edge cases
        assert_eq!(join_sftp_path("/home//", "user"), "/home//user"); // We preserve double slashes if provided, or could clean them
    }

    #[test]
    fn test_get_parent_path() {
        assert_eq!(get_parent_path("/home/user/test"), "/home/user");
        assert_eq!(get_parent_path("/home/user"), "/home");
        assert_eq!(get_parent_path("/home"), "/");
        assert_eq!(get_parent_path("/"), "/");
        assert_eq!(get_parent_path("/home/"), "/");
        assert_eq!(get_parent_path(""), "/");
        assert_eq!(get_parent_path("/etc/docker/daemon.json"), "/etc/docker");
    }

    #[test]
    fn test_humanize_bytes() {
        assert_eq!(humanize_bytes(512), "512 B");
        assert_eq!(humanize_bytes(2048), "2.0 KB");
        assert_eq!(humanize_bytes(5 * 1024 * 1024), "5.0 MB");
        assert_eq!(humanize_bytes(3 * 1024 * 1024 * 1024), "3072.0 MB");
    }

    #[test]
    fn test_file_too_large_error() {
        assert!(file_too_large_error(None, EDITOR_MAX_FILE_BYTES).is_none());
        assert!(file_too_large_error(Some(1024), EDITOR_MAX_FILE_BYTES).is_none());
        assert_eq!(
            file_too_large_error(Some(6 * 1024 * 1024), EDITOR_MAX_FILE_BYTES).as_deref(),
            Some("File is 6.0 MB which exceeds the 5.0 MB limit. Download it instead.")
        );
    }

    #[test]
    fn test_final_segment() {
        assert_eq!(final_segment("/srv/report.pdf"), "report.pdf");
        assert_eq!(final_segment("/srv/dir/"), "dir");
        assert_eq!(final_segment("notes.md"), "notes.md");
        assert_eq!(final_segment("/srv/notes (2).pdf"), "notes (2).pdf");
    }

    #[test]
    fn test_relative_to_home() {
        assert_eq!(
            relative_to_home("/root/a/b.txt", Some("/root")),
            Some("~/a/b.txt".to_string())
        );
        assert_eq!(
            relative_to_home("/root", Some("/root")),
            Some("~".to_string())
        );
        assert_eq!(
            relative_to_home("/root/", Some("/root")),
            Some("~".to_string())
        );
        assert_eq!(relative_to_home("/etc/hosts", Some("/root")), None);
        assert_eq!(relative_to_home("/rootfoo/x", Some("/root")), None);
        assert_eq!(relative_to_home("/root/a", None), None);
        assert_eq!(relative_to_home("/root/a", Some("/")), None);
    }

    #[test]
    fn test_relative_remote_path() {
        assert_eq!(relative_remote_path("/srv/app", "/srv/app"), "");
        assert_eq!(relative_remote_path("/srv/app", "/srv/app/"), "");
        assert_eq!(
            relative_remote_path("/srv/app", "/srv/app/logs/run.log"),
            "logs/run.log"
        );
        assert_eq!(relative_remote_path("/srv/app", "/etc/hosts"), "/etc/hosts");
    }

    #[test]
    fn test_format_permissions() {
        assert_eq!(format_permissions(Some(0o755), true), "drwxr-xr-x");
        assert_eq!(format_permissions(Some(0o644), false), "-rw-r--r--");
        assert_eq!(format_permissions(Some(0o700), false), "-rwx------");
        assert_eq!(format_permissions(None, false), "—");
    }

    fn temp_tree(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("moba-tree-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create fixture root");
        dir
    }

    #[tokio::test]
    async fn collects_files_sizes_and_directories() {
        let root = temp_tree("flat");
        std::fs::write(root.join("a.txt"), b"12345").expect("write a.txt");
        std::fs::create_dir_all(root.join("sub")).expect("create sub");
        std::fs::write(root.join("sub").join("b.bin"), b"xyz").expect("write b.bin");
        std::fs::create_dir_all(root.join("empty")).expect("create empty");

        let tree = collect_local_tree(&root).await.expect("walk succeeds");
        let mut names: Vec<&str> = tree.files.iter().map(|(p, _)| p.as_str()).collect();
        names.sort_unstable();
        assert_eq!(names, vec!["a.txt", "sub/b.bin"]);
        let sizes: Vec<u64> = tree.files.iter().map(|(_, s)| *s).collect();
        assert!(sizes.contains(&5) && sizes.contains(&3));
        assert_eq!(
            tree.dirs,
            vec![String::new(), "empty".to_string(), "sub".to_string()]
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn orders_directories_parent_before_child() {
        let root = temp_tree("nested");
        std::fs::create_dir_all(root.join("a/b/c")).expect("create nested");
        std::fs::write(root.join("a/b/c/deep.txt"), b"deep").expect("write deep");

        let tree = collect_local_tree(&root).await.expect("walk succeeds");
        assert_eq!(
            tree.dirs,
            vec![
                String::new(),
                "a".to_string(),
                "a/b".to_string(),
                "a/b/c".to_string()
            ]
        );
        assert_eq!(tree.files, vec![("a/b/c/deep.txt".to_string(), 4)]);
        assert_eq!(
            tree.files.iter().map(|(_, s)| *s).sum::<u64>(),
            4,
            "total size feeds the upload progress bar"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn missing_root_reports_error() {
        let missing =
            std::env::temp_dir().join(format!("moba-tree-missing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&missing);
        assert!(collect_local_tree(&missing).await.is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn skips_symlinks() {
        let root = temp_tree("symlink");
        std::fs::write(root.join("real.txt"), b"real").expect("write real");
        std::os::unix::fs::symlink(root.join("real.txt"), root.join("link.txt"))
            .expect("create symlink");

        let tree = collect_local_tree(&root).await.expect("walk succeeds");
        assert_eq!(tree.files, vec![("real.txt".to_string(), 4)]);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn classifies_dropped_paths() {
        let root = temp_tree("classify");
        std::fs::write(root.join("file.txt"), b"data").expect("write file");
        std::fs::create_dir_all(root.join("folder")).expect("create folder");

        let entries = classify_local_paths(vec![
            root.join("file.txt").to_string_lossy().into_owned(),
            root.join("folder").to_string_lossy().into_owned(),
        ])
        .await
        .expect("classification succeeds");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "file.txt");
        assert!(!entries[0].is_dir);
        assert_eq!(entries[1].name, "folder");
        assert!(entries[1].is_dir);
        assert_eq!(entries[0].path, root.join("file.txt").to_string_lossy());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn classification_fails_for_missing_paths() {
        let missing =
            std::env::temp_dir().join(format!("moba-classify-missing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&missing);
        assert!(
            classify_local_paths(vec![missing.to_string_lossy().into_owned()])
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn retries_cloud_placeholder_reads_until_hydrated() {
        let mut reader = ScriptedReader::new(vec![
            Err(std::io::Error::from_raw_os_error(362)),
            Err(std::io::Error::from_raw_os_error(362)),
            Ok(7),
        ]);
        let mut buffer = [0_u8; 16];

        let count = read_upload_chunk("C:/placeholder.xlsx", &[1, 1], &mut reader, &mut buffer)
            .await
            .expect("hydration completes within the retry budget");

        assert_eq!(count, 7);
        assert_eq!(reader.reads, 3);
    }

    #[tokio::test]
    async fn cloud_placeholder_failure_gets_actionable_hint() {
        let mut reader = ScriptedReader::new(vec![
            Err(std::io::Error::from_raw_os_error(362)),
            Err(std::io::Error::from_raw_os_error(362)),
            Err(std::io::Error::from_raw_os_error(362)),
        ]);
        let mut buffer = [0_u8; 16];

        let result = read_upload_chunk("C:/report.xlsx", &[1, 1], &mut reader, &mut buffer)
            .await
            .expect_err("provider never starts");

        assert!(result.contains("online-only cloud file"), "{result}");
        assert!(result.contains("Always keep on this device"), "{result}");
        assert!(result.contains("C:/report.xlsx"), "{result}");
        assert_eq!(reader.reads, 3, "retries stop once the budget is spent");
    }

    #[tokio::test]
    async fn other_read_errors_fail_without_retry() {
        let mut reader = ScriptedReader::new(vec![Err(std::io::Error::from_raw_os_error(13))]);
        let mut buffer = [0_u8; 16];

        let result = read_upload_chunk("C:/secret.txt", &[1, 1], &mut reader, &mut buffer)
            .await
            .expect_err("permission errors are not retried");

        assert!(result.contains("Read failed for C:/secret.txt"), "{result}");
        assert!(result.contains("os error 13"), "{result}");
        assert_eq!(reader.reads, 1);
    }

    #[test]
    fn local_file_error_maps_cloud_provider_failures() {
        let cloud = std::io::Error::from_raw_os_error(362);
        let message = local_file_error("Failed to read local file", "C:/a.png", &cloud);
        assert!(message.contains("online-only cloud file"), "{message}");

        let other = std::io::Error::from_raw_os_error(2);
        let message = local_file_error("Failed to read local file", "C:/a.png", &other);
        assert!(message.contains("os error 2"), "{message}");
    }

    /// Minimal reader returning scripted results, so upload reads can be
    /// tested without a filesystem or a live cloud provider.
    struct ScriptedReader {
        steps: std::collections::VecDeque<std::io::Result<usize>>,
        reads: usize,
    }

    impl ScriptedReader {
        fn new(steps: Vec<std::io::Result<usize>>) -> Self {
            Self {
                steps: std::collections::VecDeque::from(steps),
                reads: 0,
            }
        }
    }

    impl tokio::io::AsyncRead for ScriptedReader {
        fn poll_read(
            mut self: std::pin::Pin<&mut Self>,
            _cx: &mut std::task::Context<'_>,
            buf: &mut tokio::io::ReadBuf<'_>,
        ) -> std::task::Poll<std::io::Result<()>> {
            self.reads += 1;
            match self.steps.pop_front() {
                Some(Ok(count)) => {
                    buf.put_slice(&vec![0x41; count]);
                    std::task::Poll::Ready(Ok(()))
                }
                Some(Err(error)) => std::task::Poll::Ready(Err(error)),
                None => std::task::Poll::Ready(Ok(())),
            }
        }
    }
}
