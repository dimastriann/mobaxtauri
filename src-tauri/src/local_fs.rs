//! Local filesystem browsing and mutations for the dual-pane Files view.
//!
//! Paths are supplied by the user through the local pane; this module only
//! lists and mutates them. Symlinks are classified but recursive deletion
//! removes the link itself rather than following it.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRemoveRequest {
    pub path: String,
    pub recursive: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRemoveFailure {
    pub path: String,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRemoveManyResult {
    pub removed: Vec<String>,
    pub failures: Vec<LocalRemoveFailure>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalListing {
    pub path: String,
    pub parent: Option<String>,
    pub entries: Vec<LocalEntry>,
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn modified_seconds(metadata: &std::fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
}

fn require_path(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("Local path cannot be empty".into());
    }
    Ok(())
}

pub async fn list_dir(path: &Path) -> Result<LocalListing, String> {
    require_path(path)?;
    let mut entries = Vec::new();
    let mut reader = tokio::fs::read_dir(path)
        .await
        .map_err(|error| format!("Failed to open local directory {}: {error}", path.display()))?;

    while let Some(entry) = reader
        .next_entry()
        .await
        .map_err(|error| format!("Failed to read local directory {}: {error}", path.display()))?
    {
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let file_type = entry.file_type().await.map_err(|error| {
            format!(
                "Failed to inspect local entry {}: {error}",
                entry_path.display()
            )
        })?;
        let is_symlink = file_type.is_symlink();
        let metadata = match entry.metadata().await {
            Ok(metadata) => metadata,
            Err(_) => match tokio::fs::symlink_metadata(&entry_path).await {
                Ok(metadata) => metadata,
                Err(error) => {
                    log::warn!(
                        "Skipping unreadable local entry {}: {error}",
                        entry_path.display()
                    );
                    continue;
                }
            },
        };
        let is_dir = metadata.is_dir();
        entries.push(LocalEntry {
            name,
            path: path_string(&entry_path),
            is_dir,
            is_file: metadata.is_file(),
            is_symlink,
            size: if is_dir { 0 } else { metadata.len() },
            modified: modified_seconds(&metadata),
        });
    }

    entries.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(LocalListing {
        path: path_string(path),
        parent: path.parent().map(path_string),
        entries,
    })
}

pub async fn create_dir(path: &Path) -> Result<(), String> {
    require_path(path)?;
    tokio::fs::create_dir(path)
        .await
        .map_err(|error| format!("Failed to create local folder {}: {error}", path.display()))
}

pub async fn rename(old_path: &Path, new_path: &Path) -> Result<(), String> {
    require_path(old_path)?;
    require_path(new_path)?;
    if tokio::fs::try_exists(new_path).await.unwrap_or(false) {
        return Err(format!(
            "A local entry already exists at {}",
            new_path.display()
        ));
    }
    tokio::fs::rename(old_path, new_path)
        .await
        .map_err(|error| format!("Failed to rename local entry: {error}"))
}

pub async fn remove(path: &Path, recursive: bool) -> Result<(), String> {
    require_path(path)?;
    let metadata = tokio::fs::symlink_metadata(path)
        .await
        .map_err(|error| format!("Failed to inspect local entry {}: {error}", path.display()))?;
    let file_type = metadata.file_type();
    if file_type.is_symlink() || file_type.is_file() {
        return tokio::fs::remove_file(path)
            .await
            .map_err(|error| format!("Failed to remove local entry {}: {error}", path.display()));
    }
    if !file_type.is_dir() {
        return Err(format!(
            "Local entry {} is not a file or directory",
            path.display()
        ));
    }
    if recursive {
        tokio::fs::remove_dir_all(path)
            .await
            .map_err(|error| format!("Failed to remove local folder {}: {error}", path.display()))
    } else {
        tokio::fs::remove_dir(path).await.map_err(|error| {
            format!(
                "Failed to remove local folder {} (use recursive delete for non-empty folders): {error}",
                path.display()
            )
        })
    }
}

pub async fn remove_many(requests: Vec<LocalRemoveRequest>) -> LocalRemoveManyResult {
    let mut removed = Vec::new();
    let mut failures = Vec::new();
    for request in requests {
        match remove(Path::new(&request.path), request.recursive).await {
            Ok(()) => removed.push(request.path),
            Err(message) => failures.push(LocalRemoveFailure {
                path: request.path,
                message,
            }),
        }
    }
    LocalRemoveManyResult { removed, failures }
}

#[cfg(test)]
mod tests {
    use super::{create_dir, list_dir, remove, remove_many, rename, LocalRemoveRequest};

    fn temp_root(name: &str) -> std::path::PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "moba-local-fs-{name}-{}-{unique}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("create test root");
        root
    }

    #[tokio::test]
    async fn lists_directories_first_and_reports_metadata() {
        let root = temp_root("list");
        std::fs::write(root.join("z.txt"), b"hello").expect("write file");
        std::fs::write(root.join("a.txt"), b"hi").expect("write file");
        std::fs::create_dir(root.join("folder")).expect("create folder");

        let listing = list_dir(&root).await.expect("listing succeeds");
        let names: Vec<&str> = listing
            .entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        assert_eq!(names, vec!["folder", "a.txt", "z.txt"]);
        assert!(listing.entries[0].is_dir);
        assert_eq!(listing.entries[1].size, 2);
        assert!(listing.entries[1].modified.is_some());
        assert_eq!(listing.path, root.to_string_lossy());
        assert_eq!(
            listing.parent,
            root.parent()
                .map(|path| path.to_string_lossy().into_owned())
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn creates_renames_and_removes_entries() {
        let root = temp_root("mutate");
        let folder = root.join("folder");
        create_dir(&folder).await.expect("create folder");
        assert!(folder.is_dir());

        let renamed = root.join("renamed");
        rename(&folder, &renamed).await.expect("rename folder");
        assert!(renamed.is_dir());

        std::fs::write(renamed.join("file.txt"), b"data").expect("write file");
        assert!(remove(&renamed, false).await.is_err());
        remove(&renamed, true).await.expect("recursive remove");
        assert!(!renamed.exists());

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn rejects_renaming_onto_an_existing_path() {
        let root = temp_root("rename-conflict");
        std::fs::write(root.join("a.txt"), b"a").expect("write a");
        std::fs::write(root.join("b.txt"), b"b").expect("write b");
        assert!(rename(&root.join("a.txt"), &root.join("b.txt"))
            .await
            .is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn remove_many_continues_after_a_failure() {
        let root = temp_root("remove-many");
        std::fs::write(root.join("a.txt"), b"a").expect("write a");
        let missing = root.join("missing.txt");
        let result = remove_many(vec![
            LocalRemoveRequest {
                path: root.join("a.txt").to_string_lossy().into_owned(),
                recursive: false,
            },
            LocalRemoveRequest {
                path: missing.to_string_lossy().into_owned(),
                recursive: false,
            },
        ])
        .await;
        assert_eq!(result.removed.len(), 1);
        assert_eq!(result.failures.len(), 1);
        assert!(!root.join("a.txt").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn removes_a_symlink_without_touching_its_target() {
        let root = temp_root("symlink");
        let target = root.join("target");
        std::fs::create_dir(&target).expect("create target");
        std::fs::write(target.join("keep.txt"), b"keep").expect("write target file");
        std::os::unix::fs::symlink(&target, root.join("link")).expect("create symlink");

        let listing = list_dir(&root).await.expect("listing succeeds");
        let link = listing
            .entries
            .iter()
            .find(|entry| entry.name == "link")
            .expect("link listed");
        assert!(link.is_symlink);

        remove(&root.join("link"), true).await.expect("remove link");
        assert!(!root.join("link").exists());
        assert!(target.join("keep.txt").exists());

        let _ = std::fs::remove_dir_all(root);
    }
}
