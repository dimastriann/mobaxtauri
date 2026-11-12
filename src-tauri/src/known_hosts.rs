use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};

pub const KNOWN_HOSTS_FILE: &str = "known_hosts.json";

/// A trusted SSH host key. A host may hold several entries when different
/// key algorithms are negotiated across connections.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHost {
    pub host: String,
    pub port: u16,
    #[serde(alias = "key_type")]
    pub key_type: String,
    /// SSH fingerprint in `SHA256:<base64>` form.
    pub fingerprint: String,
    /// Unix timestamp of first acceptance.
    #[serde(alias = "first_seen")]
    pub first_seen: u64,
}

/// Verification outcome for a presented host key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostKeyAction {
    /// Host and fingerprint match a stored entry.
    Accept,
    /// The host has stored keys and none match the presented one — possible
    /// man-in-the-middle.
    Mismatch,
    /// First contact with this host:port.
    Unknown,
}

/// Decide how to treat a presented host key against the stored entries.
pub fn resolve_host_key(
    entries: &[KnownHost],
    host: &str,
    port: u16,
    fingerprint: &str,
) -> HostKeyAction {
    let mut has_other_key = false;
    for entry in entries {
        if entry.host == host && entry.port == port {
            if entry.fingerprint == fingerprint {
                return HostKeyAction::Accept;
            }
            has_other_key = true;
        }
    }
    if has_other_key {
        HostKeyAction::Mismatch
    } else {
        HostKeyAction::Unknown
    }
}

/// Replace any stored keys for `host:port` with a single trusted entry.
pub fn upsert_host(entries: &mut Vec<KnownHost>, known: KnownHost) {
    entries.retain(|entry| !(entry.host == known.host && entry.port == known.port));
    entries.push(known);
}

/// Remove all stored keys for `host:port`. Returns whether anything was
/// removed.
pub fn remove_host(entries: &mut Vec<KnownHost>, host: &str, port: u16) -> bool {
    let before = entries.len();
    entries.retain(|entry| !(entry.host == host && entry.port == port));
    entries.len() != before
}

/// Merge imported entries without duplicating an identical host/key pair.
/// Returns how many new entries were added. A malformed entry is skipped so
/// one bad line cannot block the rest of a backup.
pub fn merge_known_hosts(entries: &mut Vec<KnownHost>, imported: Vec<KnownHost>) -> usize {
    let mut added = 0;
    for host in imported {
        if host.host.trim().is_empty()
            || host.key_type.trim().is_empty()
            || !host.fingerprint.starts_with("SHA256:")
        {
            continue;
        }
        if entries.iter().any(|entry| {
            entry.host == host.host
                && entry.port == host.port
                && entry.key_type == host.key_type
                && entry.fingerprint == host.fingerprint
        }) {
            continue;
        }
        entries.push(host);
        added += 1;
    }
    added
}

/// Stable display order for the trusted-hosts manager.
pub fn sorted_hosts(entries: &[KnownHost]) -> Vec<KnownHost> {
    let mut entries = entries.to_vec();
    entries.sort_by(|a, b| {
        a.host
            .cmp(&b.host)
            .then(a.port.cmp(&b.port))
            .then(a.key_type.cmp(&b.key_type))
    });
    entries
}

pub fn parse_known_hosts(json: &str) -> Result<Vec<KnownHost>, String> {
    serde_json::from_str(json).map_err(|error| format!("Failed to parse known hosts: {error}"))
}

pub fn serialize_known_hosts(entries: &[KnownHost]) -> Result<String, String> {
    serde_json::to_string_pretty(entries)
        .map_err(|error| format!("Failed to serialize known hosts: {error}"))
}

/// JSON-file-backed store of trusted host keys, resolved lazily against
/// the app data directory like `CredentialService`.
#[derive(Clone, Default)]
pub struct KnownHostsService {
    state: Arc<tokio::sync::Mutex<Option<KnownHostsState>>>,
}

struct KnownHostsState {
    path: PathBuf,
    entries: Vec<KnownHost>,
}

impl KnownHostsService {
    /// Store pre-pointed at `path` — used by integration tests so host-key
    /// flows never depend on the mock runtime's path resolution.
    pub fn with_path(path: std::path::PathBuf) -> Self {
        Self {
            state: Arc::new(tokio::sync::Mutex::new(Some(KnownHostsState {
                path,
                entries: Vec::new(),
            }))),
        }
    }

    pub async fn resolve<R: Runtime>(
        &self,
        app_handle: &AppHandle<R>,
        host: &str,
        port: u16,
        fingerprint: &str,
    ) -> Result<HostKeyAction, String> {
        self.ensure_loaded(app_handle).await?;
        let state = self.state.lock().await;
        let loaded = state.as_ref().ok_or("Known hosts store is locked")?;
        Ok(resolve_host_key(&loaded.entries, host, port, fingerprint))
    }

    pub async fn trust<R: Runtime>(
        &self,
        app_handle: &AppHandle<R>,
        host: &str,
        port: u16,
        key_type: String,
        fingerprint: String,
    ) -> Result<(), String> {
        self.ensure_loaded(app_handle).await?;
        let mut state = self.state.lock().await;
        let loaded = state.as_mut().ok_or("Known hosts store is locked")?;
        upsert_host(
            &mut loaded.entries,
            KnownHost {
                host: host.into(),
                port,
                key_type,
                fingerprint,
                first_seen: now_unix_secs(),
            },
        );
        persist(loaded).await
    }

    pub async fn export<R: Runtime>(
        &self,
        app_handle: &AppHandle<R>,
        path: &str,
    ) -> Result<usize, String> {
        self.ensure_loaded(app_handle).await?;
        let state = self.state.lock().await;
        let loaded = state.as_ref().ok_or("Known hosts store is locked")?;
        let hosts = sorted_hosts(&loaded.entries);
        let json = serialize_known_hosts(&hosts)?;
        tokio::fs::write(path, json)
            .await
            .map_err(|error| format!("Failed to export known hosts: {error}"))?;
        Ok(hosts.len())
    }

    pub async fn import<R: Runtime>(
        &self,
        app_handle: &AppHandle<R>,
        path: &str,
    ) -> Result<usize, String> {
        self.ensure_loaded(app_handle).await?;
        let json = tokio::fs::read_to_string(path)
            .await
            .map_err(|error| format!("Failed to read known hosts file: {error}"))?;
        let imported = parse_known_hosts(&json)?;
        let mut state = self.state.lock().await;
        let loaded = state.as_mut().ok_or("Known hosts store is locked")?;
        let added = merge_known_hosts(&mut loaded.entries, imported);
        if added > 0 {
            persist(loaded).await?;
        }
        Ok(added)
    }

    pub async fn remove<R: Runtime>(
        &self,
        app_handle: &AppHandle<R>,
        host: &str,
        port: u16,
    ) -> Result<bool, String> {
        self.ensure_loaded(app_handle).await?;
        let mut state = self.state.lock().await;
        let loaded = state.as_mut().ok_or("Known hosts store is locked")?;
        let removed = remove_host(&mut loaded.entries, host, port);
        if removed {
            persist(loaded).await?;
        }
        Ok(removed)
    }

    pub async fn list<R: Runtime>(
        &self,
        app_handle: &AppHandle<R>,
    ) -> Result<Vec<KnownHost>, String> {
        self.ensure_loaded(app_handle).await?;
        let state = self.state.lock().await;
        let loaded = state.as_ref().ok_or("Known hosts store is locked")?;
        Ok(sorted_hosts(&loaded.entries))
    }

    async fn ensure_loaded<R: Runtime>(&self, app_handle: &AppHandle<R>) -> Result<(), String> {
        let mut state = self.state.lock().await;
        if state.is_some() {
            return Ok(());
        }
        let path = known_hosts_path(app_handle)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create app data directory: {error}"))?;
        }
        let entries = match tokio::fs::read_to_string(&path).await {
            Ok(json) => match parse_known_hosts(&json) {
                Ok(entries) => entries,
                Err(error) => {
                    // A corrupt file must never make the app trust keys;
                    // starting fresh only causes re-prompting.
                    log::warn!("{error}; starting with an empty known-hosts store");
                    Vec::new()
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(format!("Failed to read known hosts: {error}")),
        };
        *state = Some(KnownHostsState { path, entries });
        Ok(())
    }
}

async fn persist(state: &KnownHostsState) -> Result<(), String> {
    let json = serialize_known_hosts(&state.entries)?;
    tokio::fs::write(&state.path, json)
        .await
        .map_err(|error| format!("Failed to write known hosts: {error}"))
}

fn known_hosts_path<R: Runtime>(app_handle: &AppHandle<R>) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map(|directory| directory.join(KNOWN_HOSTS_FILE))
        .map_err(|error| format!("Failed to resolve known hosts path: {error}"))
}

fn now_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{
        merge_known_hosts, parse_known_hosts, remove_host, resolve_host_key, serialize_known_hosts,
        sorted_hosts, upsert_host, HostKeyAction, KnownHost,
    };

    fn entry(host: &str, port: u16, fingerprint: &str) -> KnownHost {
        KnownHost {
            host: host.into(),
            port,
            key_type: "ssh-ed25519".into(),
            fingerprint: fingerprint.into(),
            first_seen: 1_700_000_000,
        }
    }

    #[test]
    fn accepts_matching_fingerprint() {
        let entries = vec![entry("example.com", 22, "SHA256:abc")];
        assert_eq!(
            resolve_host_key(&entries, "example.com", 22, "SHA256:abc"),
            HostKeyAction::Accept
        );
    }

    #[test]
    fn unknown_when_host_not_stored() {
        let entries = vec![entry("example.com", 22, "SHA256:abc")];
        assert_eq!(
            resolve_host_key(&entries, "other.com", 22, "SHA256:abc"),
            HostKeyAction::Unknown
        );
        assert_eq!(
            resolve_host_key(&entries, "example.com", 2222, "SHA256:abc"),
            HostKeyAction::Unknown
        );
    }

    #[test]
    fn mismatch_when_port_has_different_key() {
        let entries = vec![entry("example.com", 22, "SHA256:abc")];
        assert_eq!(
            resolve_host_key(&entries, "example.com", 22, "SHA256:evil"),
            HostKeyAction::Mismatch
        );
    }

    #[test]
    fn accepts_any_stored_algorithm_for_host() {
        let mut ed25519 = entry("example.com", 22, "SHA256:abc");
        ed25519.key_type = "ssh-ed25519".into();
        let mut rsa = entry("example.com", 22, "SHA256:def");
        rsa.key_type = "rsa-sha2-512".into();
        let entries = vec![ed25519, rsa];
        assert_eq!(
            resolve_host_key(&entries, "example.com", 22, "SHA256:def"),
            HostKeyAction::Accept
        );
    }

    #[test]
    fn upsert_replaces_entries_for_host_port() {
        let mut entries = vec![
            entry("example.com", 22, "SHA256:old"),
            entry("other.com", 22, "SHA256:xyz"),
        ];
        upsert_host(&mut entries, entry("example.com", 22, "SHA256:new"));
        assert_eq!(entries.len(), 2);
        assert_eq!(
            resolve_host_key(&entries, "example.com", 22, "SHA256:new"),
            HostKeyAction::Accept
        );
        assert_eq!(
            resolve_host_key(&entries, "example.com", 22, "SHA256:old"),
            HostKeyAction::Mismatch
        );
        assert_eq!(
            resolve_host_key(&entries, "other.com", 22, "SHA256:xyz"),
            HostKeyAction::Accept
        );
    }

    #[test]
    fn remove_reports_whether_something_was_removed() {
        let mut entries = vec![entry("example.com", 22, "SHA256:abc")];
        assert!(remove_host(&mut entries, "example.com", 22));
        assert!(!remove_host(&mut entries, "example.com", 22));
        assert!(entries.is_empty());
    }

    #[test]
    fn serializes_and_parses_round_trip() {
        let entries = vec![entry("example.com", 22, "SHA256:abc")];
        let json = serialize_known_hosts(&entries).unwrap();
        assert_eq!(parse_known_hosts(&json).unwrap(), entries);
    }

    #[test]
    fn merge_skips_duplicates_and_malformed_entries() {
        let mut entries = vec![KnownHost {
            host: "a.example".into(),
            port: 22,
            key_type: "ssh-ed25519".into(),
            fingerprint: "SHA256:aaa".into(),
            first_seen: 1,
        }];
        let duplicate = entries[0].clone();
        let added = merge_known_hosts(
            &mut entries,
            vec![
                duplicate,
                KnownHost {
                    host: "b.example".into(),
                    port: 2222,
                    key_type: "ssh-ed25519".into(),
                    fingerprint: "SHA256:bbb".into(),
                    first_seen: 2,
                },
                KnownHost {
                    host: "bad.example".into(),
                    port: 22,
                    key_type: "ssh-ed25519".into(),
                    fingerprint: "not-a-fingerprint".into(),
                    first_seen: 3,
                },
            ],
        );
        assert_eq!(added, 1);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1].host, "b.example");
    }

    #[test]
    fn rejects_corrupt_known_hosts_file() {
        assert!(parse_known_hosts("not json").is_err());
    }

    #[test]
    fn sorts_trusted_hosts_by_host_and_port() {
        let hosts = sorted_hosts(&[
            entry("zeta.example", 22, "SHA256:z"),
            entry("alpha.example", 2222, "SHA256:a2"),
            entry("alpha.example", 22, "SHA256:a"),
        ]);

        assert_eq!(
            hosts
                .iter()
                .map(|host| (host.host.as_str(), host.port))
                .collect::<Vec<_>>(),
            vec![
                ("alpha.example", 22),
                ("alpha.example", 2222),
                ("zeta.example", 22)
            ]
        );
    }
}
