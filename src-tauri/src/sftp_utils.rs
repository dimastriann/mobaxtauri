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
}
