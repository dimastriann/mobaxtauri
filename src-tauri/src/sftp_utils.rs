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
}
