/// SFTP Path Utility for consistent across-platform path joining
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
}
