//! SFTP destination-conflict policy shared by upload and copy.

use russh_sftp::client::SftpSession;

/// Error marker the frontend matches to open the overwrite/rename/skip
/// dialog. It is followed by the existing destination path; the client
/// depends only on the marker itself.
pub const TARGET_EXISTS: &str = "SFTP TARGET EXISTS";

/// Error marker the frontend matches when a remotely edited file changed
/// between read and save. Followed by the file path; the client depends
/// only on the marker.
pub const FILE_CHANGED: &str = "SFTP FILE CHANGED";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConflictPolicy {
    Overwrite,
    Rename,
    Skip,
}

pub fn parse_conflict_policy(policy: Option<&str>) -> Option<ConflictPolicy> {
    match policy {
        Some("overwrite") => Some(ConflictPolicy::Overwrite),
        Some("rename") => Some(ConflictPolicy::Rename),
        Some("skip") => Some(ConflictPolicy::Skip),
        _ => None,
    }
}

pub fn conflict_error(target: &str) -> String {
    format!("{TARGET_EXISTS}: {target}")
}

pub fn file_changed_error(target: &str) -> String {
    format!("{FILE_CHANGED}: {target}")
}

/// Insert " (N)" before the extension of the final path segment, so
/// `report.pdf` with N=2 becomes `report (2).pdf` while a dotfile like
/// `.env` keeps its leading dot out of the suffix position.
pub fn suffixed_target(target: &str, n: u32) -> String {
    let (dir, file) = match target.rfind('/') {
        Some(idx) => (&target[..=idx], &target[idx + 1..]),
        None => ("", target),
    };
    let (stem, ext) = match file.rfind('.') {
        Some(dot) if dot > 0 => (&file[..dot], &file[dot..]),
        _ => (file, ""),
    };
    format!("{dir}{stem} ({n}){ext}")
}

/// Resolve a destination that may already exist according to the policy.
///
/// Returns the path to write (possibly a suffixed variant), or `None`
/// when the policy says to skip the operation. An absent policy surfaces
/// the TARGET EXISTS marker so the caller can prompt the user.
pub async fn resolve_destination(
    sftp: &SftpSession,
    dest_path: &str,
    policy: Option<ConflictPolicy>,
) -> Result<Option<String>, String> {
    let exists = sftp.metadata(dest_path).await.is_ok();
    if !exists {
        return Ok(Some(dest_path.to_string()));
    }
    match policy {
        Some(ConflictPolicy::Overwrite) => Ok(Some(dest_path.to_string())),
        Some(ConflictPolicy::Rename) => {
            for n in 2..1000 {
                let candidate = suffixed_target(dest_path, n);
                if sftp.metadata(&candidate).await.is_err() {
                    return Ok(Some(candidate));
                }
            }
            Err(conflict_error(dest_path))
        }
        Some(ConflictPolicy::Skip) => Ok(None),
        None => Err(conflict_error(dest_path)),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        conflict_error, file_changed_error, parse_conflict_policy, suffixed_target, ConflictPolicy,
        FILE_CHANGED, TARGET_EXISTS,
    };

    #[test]
    fn parses_policies() {
        assert_eq!(
            parse_conflict_policy(Some("overwrite")),
            Some(ConflictPolicy::Overwrite)
        );
        assert_eq!(
            parse_conflict_policy(Some("rename")),
            Some(ConflictPolicy::Rename)
        );
        assert_eq!(
            parse_conflict_policy(Some("skip")),
            Some(ConflictPolicy::Skip)
        );
        assert_eq!(parse_conflict_policy(Some("bogus")), None);
        assert_eq!(parse_conflict_policy(None), None);
    }

    #[test]
    fn suffixes_names_with_extensions() {
        assert_eq!(suffixed_target("/srv/report.pdf", 2), "/srv/report (2).pdf");
        assert_eq!(
            suffixed_target("/srv/archive.tar.gz", 3),
            "/srv/archive.tar (3).gz"
        );
        assert_eq!(suffixed_target("/srv/.env", 2), "/srv/.env (2)");
        assert_eq!(suffixed_target("notes.md", 10), "notes (10).md");
        assert_eq!(suffixed_target("/srv/binary", 2), "/srv/binary (2)");
    }

    #[test]
    fn conflict_error_carries_marker_and_target() {
        let error = conflict_error("/srv/report.pdf");
        assert!(error.starts_with(TARGET_EXISTS));
        assert!(error.ends_with("/srv/report.pdf"));
    }

    #[test]
    fn file_changed_error_carries_marker_and_target() {
        let error = file_changed_error("/srv/notes.md");
        assert!(error.starts_with(FILE_CHANGED));
        assert!(error.ends_with("/srv/notes.md"));
    }
}
