//! Managed SSH key metadata and key generation.
//!
//! Private key bodies never leave Rust. Commands return only public key
//! material, fingerprints, and filesystem paths.

use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use ssh_key::{rand_core::OsRng, Algorithm, LineEnding, PrivateKey};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};

pub const SSH_KEYS_FILE: &str = "ssh_keys.json";
pub const MANAGED_KEYS_DIR: &str = "keys";
const MAX_KEY_FILE_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyMetadata {
    pub id: String,
    pub name: String,
    pub path: String,
    pub key_type: String,
    pub fingerprint: String,
    pub public_key: String,
    pub comment: String,
    pub encrypted: bool,
    pub managed: bool,
    pub created_at: u64,
}

#[derive(Clone, Default)]
pub struct SshKeyService {
    state: Arc<tokio::sync::Mutex<Option<SshKeyState>>>,
}

struct SshKeyState {
    path: PathBuf,
    keys_dir: PathBuf,
    entries: Vec<SshKeyMetadata>,
}

impl SshKeyService {
    /// Pre-pointed store for tests.
    pub fn with_path(path: PathBuf, keys_dir: PathBuf) -> Self {
        Self {
            state: Arc::new(tokio::sync::Mutex::new(Some(SshKeyState {
                path,
                keys_dir,
                entries: Vec::new(),
            }))),
        }
    }

    pub async fn list<R: Runtime>(
        &self,
        app_handle: &AppHandle<R>,
    ) -> Result<Vec<SshKeyMetadata>, String> {
        self.ensure_loaded(app_handle).await?;
        let state = self.state.lock().await;
        let loaded = state.as_ref().ok_or("SSH key store is locked")?;
        let mut entries = loaded.entries.clone();
        entries.sort_by(|a, b| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then(a.created_at.cmp(&b.created_at))
        });
        Ok(entries)
    }

    pub async fn generate<R: Runtime>(
        &self,
        app_handle: &AppHandle<R>,
        name: String,
        algorithm: String,
        comment: String,
        passphrase: Option<String>,
    ) -> Result<SshKeyMetadata, String> {
        self.ensure_loaded(app_handle).await?;
        let mut state = self.state.lock().await;
        let loaded = state.as_mut().ok_or("SSH key store is locked")?;

        tokio::fs::create_dir_all(&loaded.keys_dir)
            .await
            .map_err(|error| format!("Failed to create the SSH key folder: {error}"))?;

        let id = format!("key-{}-{}", now_unix_secs(), short_random_suffix());
        let path = loaded.keys_dir.join(&id);
        let (key, public, fingerprint, key_type, comment, encrypted) =
            generate_key_pair(&algorithm, &comment, passphrase.as_deref())?;
        write_private_key(&path, &key)?;

        let metadata = SshKeyMetadata {
            id,
            name: if name.trim().is_empty() {
                "SSH Key".to_string()
            } else {
                name.trim().to_string()
            },
            path: path.to_string_lossy().into_owned(),
            key_type,
            fingerprint,
            public_key: public,
            comment,
            encrypted,
            managed: true,
            created_at: now_unix_secs(),
        };
        loaded.entries.push(metadata.clone());
        persist(loaded).await?;
        Ok(metadata)
    }

    pub async fn register<R: Runtime>(
        &self,
        app_handle: &AppHandle<R>,
        name: String,
        path: String,
    ) -> Result<SshKeyMetadata, String> {
        self.ensure_loaded(app_handle).await?;
        let mut state = self.state.lock().await;
        let loaded = state.as_mut().ok_or("SSH key store is locked")?;

        let key_path = PathBuf::from(&path);
        let key = read_private_key(&key_path)?;
        let public = public_key_openssh(&key)?;
        let fingerprint = fingerprint_of(&key);
        let metadata = SshKeyMetadata {
            id: format!("key-{}-{}", now_unix_secs(), short_random_suffix()),
            name: if name.trim().is_empty() {
                key_path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("SSH Key")
                    .to_string()
            } else {
                name.trim().to_string()
            },
            path,
            key_type: key.algorithm().to_string(),
            fingerprint,
            public_key: public,
            comment: key.comment().to_string(),
            encrypted: key.is_encrypted(),
            managed: false,
            created_at: now_unix_secs(),
        };
        loaded.entries.push(metadata.clone());
        persist(loaded).await?;
        Ok(metadata)
    }

    pub async fn remove<R: Runtime>(
        &self,
        app_handle: &AppHandle<R>,
        id: &str,
    ) -> Result<(), String> {
        self.ensure_loaded(app_handle).await?;
        let mut state = self.state.lock().await;
        let loaded = state.as_mut().ok_or("SSH key store is locked")?;
        let Some(metadata) = loaded.entries.iter().find(|entry| entry.id == id).cloned() else {
            return Err("SSH key not found".into());
        };
        loaded.entries.retain(|entry| entry.id != id);
        if metadata.managed {
            if let Err(error) = tokio::fs::remove_file(&metadata.path).await {
                if error.kind() != std::io::ErrorKind::NotFound {
                    return Err(format!("Failed to delete the SSH key file: {error}"));
                }
            }
        }
        persist(loaded).await
    }

    pub async fn export<R: Runtime>(
        &self,
        app_handle: &AppHandle<R>,
        id: &str,
        destination: &str,
    ) -> Result<(), String> {
        self.ensure_loaded(app_handle).await?;
        let state = self.state.lock().await;
        let loaded = state.as_ref().ok_or("SSH key store is locked")?;
        let metadata = loaded
            .entries
            .iter()
            .find(|entry| entry.id == id)
            .ok_or("SSH key not found")?;
        tokio::fs::copy(&metadata.path, destination)
            .await
            .map(|_| ())
            .map_err(|error| format!("Failed to export the SSH key: {error}"))
    }

    pub async fn public_key<R: Runtime>(
        &self,
        app_handle: &AppHandle<R>,
        id: &str,
    ) -> Result<String, String> {
        self.ensure_loaded(app_handle).await?;
        let state = self.state.lock().await;
        let loaded = state.as_ref().ok_or("SSH key store is locked")?;
        loaded
            .entries
            .iter()
            .find(|entry| entry.id == id)
            .map(|entry| entry.public_key.clone())
            .ok_or_else(|| "SSH key not found".to_string())
    }

    async fn ensure_loaded<R: Runtime>(&self, app_handle: &AppHandle<R>) -> Result<(), String> {
        let mut state = self.state.lock().await;
        if state.is_some() {
            return Ok(());
        }
        let app_data = app_handle
            .path()
            .app_data_dir()
            .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
        let path = app_data.join(SSH_KEYS_FILE);
        let keys_dir = app_data.join(MANAGED_KEYS_DIR);
        let entries = match tokio::fs::read_to_string(&path).await {
            Ok(json) => match serde_json::from_str(&json) {
                Ok(entries) => entries,
                Err(error) => {
                    log::warn!("Failed to parse {SSH_KEYS_FILE}: {error}; starting empty");
                    Vec::new()
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(format!("Failed to read SSH key metadata: {error}")),
        };
        *state = Some(SshKeyState {
            path,
            keys_dir,
            entries,
        });
        Ok(())
    }
}

pub fn generate_key_pair(
    algorithm: &str,
    comment: &str,
    passphrase: Option<&str>,
) -> Result<(PrivateKey, String, String, String, String, bool), String> {
    let algorithm = match algorithm.to_lowercase().as_str() {
        "ed25519" => Algorithm::Ed25519,
        "rsa" => Algorithm::Rsa { hash: None },
        other => return Err(format!("Unsupported SSH key algorithm: {other}")),
    };
    let mut key = PrivateKey::random(&mut OsRng, algorithm)
        .map_err(|error| format!("Key generation failed: {error}"))?;
    if !comment.trim().is_empty() {
        key.set_comment(comment.trim());
    }
    let encrypted = match passphrase {
        Some(passphrase) if !passphrase.is_empty() => {
            key = key
                .encrypt(&mut OsRng, passphrase)
                .map_err(|error| format!("Key encryption failed: {error}"))?;
            true
        }
        _ => false,
    };
    let public = public_key_openssh(&key)?;
    let fingerprint = fingerprint_of(&key);
    let key_type = key.algorithm().to_string();
    let comment = key.comment().to_string();
    Ok((key, public, fingerprint, key_type, comment, encrypted))
}

pub fn read_private_key(path: &Path) -> Result<PrivateKey, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|error| format!("Failed to read the SSH key file: {error}"))?;
    if metadata.len() > MAX_KEY_FILE_BYTES {
        return Err("SSH key file is too large".into());
    }
    let data = std::fs::read_to_string(path)
        .map_err(|error| format!("Failed to read the SSH key file: {error}"))?;
    PrivateKey::from_openssh(&data)
        .map_err(|error| format!("Unsupported or invalid SSH private key: {error}"))
}

fn public_key_openssh(key: &PrivateKey) -> Result<String, String> {
    key.public_key()
        .to_openssh()
        .map_err(|error| format!("Failed to encode the SSH public key: {error}"))
}

fn fingerprint_of(key: &PrivateKey) -> String {
    key.public_key()
        .fingerprint(ssh_key::HashAlg::Sha256)
        .to_string()
}

fn write_private_key(path: &Path, key: &PrivateKey) -> Result<(), String> {
    let pem = key
        .to_openssh(LineEnding::LF)
        .map_err(|error| format!("Failed to encode the SSH private key: {error}"))?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|error| format!("Failed to write the SSH key: {error}"))?;
    file.write_all(pem.as_bytes())
        .map_err(|error| format!("Failed to write the SSH key: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Failed to secure the SSH key file: {error}"))?;
    }
    Ok(())
}

async fn persist(state: &SshKeyState) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&state.entries)
        .map_err(|error| format!("Failed to serialize SSH key metadata: {error}"))?;
    tokio::fs::write(&state.path, json)
        .await
        .map_err(|error| format!("Failed to write SSH key metadata: {error}"))
}

fn now_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn short_random_suffix() -> String {
    let mut bytes = [0_u8; 4];
    if getrandom::fill(&mut bytes).is_err() {
        return format!("{:x}", now_unix_secs());
    }
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Append a public key to the remote `authorized_keys`, creating and
/// securing `~/.ssh` first. Duplicate keys are a no-op.
pub async fn deploy_public_key(
    sftp: &SftpSession,
    home: &str,
    public_key: &str,
) -> Result<(), String> {
    let ssh_dir = crate::sftp_utils::join_sftp_path(home, ".ssh");
    if sftp.metadata(&ssh_dir).await.is_err() {
        sftp.create_dir(&ssh_dir)
            .await
            .map_err(|error| format!("Failed to create ~/.ssh: {error:?}"))?;
    }
    set_permissions(sftp, &ssh_dir, 0o700).await?;

    let authorized_keys = crate::sftp_utils::join_sftp_path(&ssh_dir, "authorized_keys");
    let key_line = public_key.trim();
    let mut content = match sftp.read(&authorized_keys).await {
        Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        Err(_) => String::new(),
    };
    if !content.lines().any(|line| line.trim() == key_line) {
        if !content.is_empty() && !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(key_line);
        content.push('\n');
        let mut file = sftp
            .create(&authorized_keys)
            .await
            .map_err(|error| format!("Failed to create authorized_keys: {error:?}"))?;
        use tokio::io::AsyncWriteExt;
        file.write_all(content.as_bytes())
            .await
            .map_err(|error| format!("Failed to update authorized_keys: {error:?}"))?;
        file.close()
            .await
            .map_err(|error| format!("Failed to close authorized_keys: {error:?}"))?;
    }
    set_permissions(sftp, &authorized_keys, 0o600).await
}

async fn set_permissions(sftp: &SftpSession, path: &str, mode: u32) -> Result<(), String> {
    let metadata = sftp
        .metadata(path)
        .await
        .map_err(|error| format!("Failed to inspect {path}: {error:?}"))?;
    let merged = crate::sftp_utils::merge_permission_mode(metadata.permissions, mode)?;
    let mut attributes = russh_sftp::protocol::FileAttributes::empty();
    attributes.permissions = Some(merged);
    sftp.set_metadata(path, attributes)
        .await
        .map_err(|error| format!("Failed to set permissions on {path}: {error:?}"))
}

#[cfg(test)]
mod tests {
    use super::generate_key_pair;

    #[test]
    fn generates_an_ed25519_key_with_a_fingerprint() {
        let (key, public, fingerprint, key_type, comment, encrypted) =
            generate_key_pair("ed25519", "mobaxtauri-test", None).expect("key generation");

        assert!(!encrypted);
        assert!(!key.is_encrypted());
        assert_eq!(comment, "mobaxtauri-test");
        assert_eq!(key_type, "ssh-ed25519");
        assert!(public.starts_with("ssh-ed25519 "));
        assert!(public.ends_with(" mobaxtauri-test"));
        assert!(fingerprint.starts_with("SHA256:"));
    }

    #[test]
    fn encrypts_generated_keys_with_a_passphrase() {
        let (key, _, _, _, _, encrypted) =
            generate_key_pair("ed25519", "encrypted", Some("correct horse"))
                .expect("key generation");

        assert!(encrypted);
        assert!(key.is_encrypted());
        assert!(key.decrypt("correct horse").is_ok());
        assert!(key.decrypt("wrong").is_err());
    }

    #[test]
    fn rejects_unknown_algorithms() {
        assert!(generate_key_pair("dsa", "", None).is_err());
    }

    #[test]
    fn writes_a_private_key_file_that_can_be_read_back() {
        let dir = std::env::temp_dir().join(format!("moba-ssh-key-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("id_ed25519");
        let (key, _, _, _, _, _) = generate_key_pair("ed25519", "roundtrip", None).unwrap();

        super::write_private_key(&path, &key).expect("write key");
        let loaded = super::read_private_key(&path).expect("read key");

        assert_eq!(loaded.public_key(), key.public_key());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
