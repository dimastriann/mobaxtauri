//! SFTP permission changes, shared by the Tauri command and integration
//! tests. File-type bits are preserved from the current metadata so chmod
//! only changes access bits.

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::FileAttributes;

/// Apply `requested` access bits (0000-7777) to `path`, preserving the
/// file-type bits already present on the remote entry.
pub async fn set_permissions(sftp: &SftpSession, path: &str, requested: u32) -> Result<(), String> {
    let metadata = sftp
        .metadata(path)
        .await
        .map_err(|error| format!("Failed to read remote permissions: {error:?}"))?;
    let mode = crate::sftp_utils::merge_permission_mode(metadata.permissions, requested)?;

    let mut attributes = FileAttributes::empty();
    attributes.permissions = Some(mode);
    sftp.set_metadata(path, attributes)
        .await
        .map_err(|error| format!("Failed to set remote permissions: {error:?}"))
}
