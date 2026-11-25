//! Planning and applying one-way directory synchronization.
//!
//! A sync is always push (local → remote) or pull (remote → local). The
//! planner compares trees by relative path, size, and mtime; the applier
//! revalidates the source plan before touching anything.

use crate::sftp_utils::{collect_local_tree, LocalFile, LocalTree, RemoteTree};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncDirection {
    Push,
    Pull,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncAction {
    Create,
    Update,
    Delete,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncConflictPolicy {
    Overwrite,
    Skip,
    Rename,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncEntry {
    pub relative_path: String,
    pub action: SyncAction,
    pub kind: SyncEntryKind,
    pub source_size: Option<u64>,
    pub source_modified: Option<u64>,
    pub target_size: Option<u64>,
    pub target_modified: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncEntryKind {
    File,
    Directory,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlan {
    pub direction: SyncDirection,
    pub local_root: String,
    pub remote_root: String,
    pub conflict_policy: SyncConflictPolicy,
    pub delete_target_only: bool,
    pub entries: Vec<SyncEntry>,
    pub create_count: usize,
    pub update_count: usize,
    pub delete_count: usize,
}

fn is_safe_relative_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.starts_with('\\')
        && !path.contains('\\')
        && !path.contains('\0')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn local_entry_metadata(file: &LocalFile) -> (u64, Option<u64>) {
    (file.size, file.modified)
}

fn local_file_map(local_tree: &LocalTree) -> std::collections::HashMap<&str, &LocalFile> {
    local_tree
        .files
        .iter()
        .map(|file| (file.relative_path.as_str(), file))
        .collect()
}

fn remote_file_map(
    remote_tree: &RemoteTree,
) -> std::collections::HashMap<&str, &crate::sftp_utils::RemoteFile> {
    remote_tree
        .files
        .iter()
        .map(|file| (file.relative_path.as_str(), file))
        .collect()
}

fn push_entry(
    relative_path: &str,
    action: SyncAction,
    source: &LocalFile,
    target: Option<&crate::sftp_utils::RemoteFile>,
) -> SyncEntry {
    let (source_size, source_modified) = local_entry_metadata(source);
    SyncEntry {
        relative_path: relative_path.to_string(),
        action,
        kind: SyncEntryKind::File,
        source_size: Some(source_size),
        source_modified,
        target_size: target.map(|file| file.size),
        target_modified: target.and_then(|file| file.modified),
    }
}

fn pull_entry(
    relative_path: &str,
    action: SyncAction,
    target: &crate::sftp_utils::RemoteFile,
    existing: Option<&LocalFile>,
) -> SyncEntry {
    let (target_size, target_modified) = existing.map(local_entry_metadata).unwrap_or((0, None));
    SyncEntry {
        relative_path: relative_path.to_string(),
        action,
        kind: SyncEntryKind::File,
        source_size: Some(target.size),
        source_modified: target.modified,
        target_size: Some(target_size),
        target_modified,
    }
}

fn same_fingerprint(
    source_size: u64,
    source_modified: Option<u64>,
    target_size: u64,
    target_modified: Option<u64>,
) -> bool {
    source_size == target_size && source_modified == target_modified
}

/// Compare the two trees and produce a validated plan. The planner itself is
/// pure; the caller is responsible for resolving absolute roots.
pub async fn plan_sync(
    local_root: &Path,
    remote_root: &str,
    remote_tree: RemoteTree,
    direction: SyncDirection,
    conflict_policy: SyncConflictPolicy,
    delete_target_only: bool,
) -> Result<SyncPlan, String> {
    let local_tree = collect_local_tree(local_root).await?;
    plan_sync_from_trees(
        local_root.to_string_lossy().into_owned(),
        local_tree,
        remote_root,
        remote_tree,
        direction,
        conflict_policy,
        delete_target_only,
    )
}

/// Pure comparison used by both the command path and unit tests.
pub fn plan_sync_from_trees(
    local_root: String,
    local_tree: LocalTree,
    remote_root: &str,
    remote_tree: RemoteTree,
    direction: SyncDirection,
    conflict_policy: SyncConflictPolicy,
    delete_target_only: bool,
) -> Result<SyncPlan, String> {
    let mut entries: Vec<SyncEntry> = Vec::new();

    match direction {
        SyncDirection::Push => {
            let remote_files = remote_file_map(&remote_tree);
            for file in &local_tree.files {
                if !is_safe_relative_path(&file.relative_path) {
                    return Err(format!("Unsafe sync path: {:?}", file.relative_path));
                }
                let existing = remote_files.get(file.relative_path.as_str()).copied();
                let action = match existing {
                    None => SyncAction::Create,
                    Some(remote) => {
                        let (source_size, source_modified) = local_entry_metadata(file);
                        if same_fingerprint(
                            source_size,
                            source_modified,
                            remote.size,
                            remote.modified,
                        ) {
                            continue;
                        }
                        SyncAction::Update
                    }
                };
                entries.push(push_entry(&file.relative_path, action, file, existing));
            }
            if delete_target_only {
                let local_files = local_file_map(&local_tree);
                for remote_file in &remote_tree.files {
                    if !local_files.contains_key(remote_file.relative_path.as_str()) {
                        entries.push(SyncEntry {
                            relative_path: remote_file.relative_path.clone(),
                            action: SyncAction::Delete,
                            kind: SyncEntryKind::File,
                            source_size: None,
                            source_modified: None,
                            target_size: Some(remote_file.size),
                            target_modified: remote_file.modified,
                        });
                    }
                }
                let local_dirs: std::collections::HashSet<&str> =
                    local_tree.dirs.iter().map(|dir| dir.as_str()).collect();
                let mut target_dirs: Vec<&str> = remote_tree
                    .dirs
                    .iter()
                    .filter(|dir| !dir.is_empty() && !local_dirs.contains(&dir.as_str()))
                    .map(|dir| dir.as_str())
                    .collect();
                target_dirs.sort_unstable();
                target_dirs.reverse();
                for relative in target_dirs {
                    entries.push(SyncEntry {
                        relative_path: relative.to_string(),
                        action: SyncAction::Delete,
                        kind: SyncEntryKind::Directory,
                        source_size: None,
                        source_modified: None,
                        target_size: None,
                        target_modified: None,
                    });
                }
            }
        }
        SyncDirection::Pull => {
            let local_files = local_file_map(&local_tree);
            for file in &remote_tree.files {
                if !is_safe_relative_path(&file.relative_path) {
                    return Err(format!("Unsafe sync path: {:?}", file.relative_path));
                }
                let existing = local_files.get(file.relative_path.as_str()).copied();
                let action = match existing {
                    None => SyncAction::Create,
                    Some(local) => {
                        let (target_size, target_modified) = local_entry_metadata(local);
                        if same_fingerprint(file.size, file.modified, target_size, target_modified)
                        {
                            continue;
                        }
                        SyncAction::Update
                    }
                };
                entries.push(pull_entry(&file.relative_path, action, file, existing));
            }
            if delete_target_only {
                let remote_files = remote_file_map(&remote_tree);
                for local_file in &local_tree.files {
                    if !remote_files.contains_key(local_file.relative_path.as_str()) {
                        entries.push(SyncEntry {
                            relative_path: local_file.relative_path.clone(),
                            action: SyncAction::Delete,
                            kind: SyncEntryKind::File,
                            source_size: Some(local_file.size),
                            source_modified: local_file.modified,
                            target_size: None,
                            target_modified: None,
                        });
                    }
                }
                let remote_dirs: std::collections::HashSet<&str> =
                    remote_tree.dirs.iter().map(|dir| dir.as_str()).collect();
                let mut target_dirs: Vec<&str> = local_tree
                    .dirs
                    .iter()
                    .filter(|dir| !dir.is_empty() && !remote_dirs.contains(&dir.as_str()))
                    .map(|dir| dir.as_str())
                    .collect();
                target_dirs.sort_unstable();
                target_dirs.reverse();
                for relative in target_dirs {
                    entries.push(SyncEntry {
                        relative_path: relative.to_string(),
                        action: SyncAction::Delete,
                        kind: SyncEntryKind::Directory,
                        source_size: None,
                        source_modified: None,
                        target_size: None,
                        target_modified: None,
                    });
                }
            }
        }
    }

    entries.sort_by(|left, right| {
        right
            .action
            .cmp(&left.action)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });

    let create_count = entries
        .iter()
        .filter(|entry| entry.action == SyncAction::Create)
        .count();
    let update_count = entries
        .iter()
        .filter(|entry| entry.action == SyncAction::Update)
        .count();
    let delete_count = entries
        .iter()
        .filter(|entry| entry.action == SyncAction::Delete)
        .count();

    Ok(SyncPlan {
        direction,
        local_root,
        remote_root: remote_root.to_string(),
        conflict_policy,
        delete_target_only,
        entries,
        create_count,
        update_count,
        delete_count,
    })
}

#[cfg(test)]
mod tests {
    use super::{plan_sync_from_trees, SyncAction, SyncConflictPolicy, SyncDirection};
    use crate::sftp_utils::{LocalFile, LocalTree, RemoteFile, RemoteTree};

    fn temp_root(name: &str) -> std::path::PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("moba-sync-{name}-{}-{unique}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("create test root");
        root
    }

    fn remote_tree(files: Vec<RemoteFile>, dirs: Vec<&str>) -> RemoteTree {
        RemoteTree {
            files,
            dirs: dirs.into_iter().map(str::to_string).collect(),
        }
    }

    fn remote_file(relative: &str, size: u64, modified: Option<u64>) -> RemoteFile {
        RemoteFile {
            path: format!("/{relative}"),
            relative_path: relative.to_string(),
            size,
            modified,
        }
    }

    fn local_file(relative: &str, size: u64, modified: Option<u64>) -> LocalFile {
        LocalFile {
            relative_path: relative.to_string(),
            size,
            modified,
        }
    }

    fn local_tree(files: Vec<LocalFile>, dirs: Vec<&str>) -> LocalTree {
        LocalTree {
            files,
            dirs: dirs.into_iter().map(str::to_string).collect(),
        }
    }

    #[tokio::test]
    async fn push_plans_create_update_and_delete() {
        let root = temp_root("push");
        std::fs::create_dir_all(root.join("sub")).expect("create local dir");
        std::fs::write(root.join("new.txt"), b"new").expect("write new");
        std::fs::write(root.join("changed.txt"), b"changed").expect("write changed");
        std::fs::write(root.join("same.txt"), b"same").expect("write same");

        let local = local_tree(
            vec![
                local_file("new.txt", 3, Some(10)),
                local_file("changed.txt", 8, Some(20)),
                local_file("same.txt", 4, Some(30)),
            ],
            vec![],
        );
        let remote = remote_tree(
            vec![
                remote_file("changed.txt", 3, Some(10)),
                remote_file("same.txt", 4, Some(30)),
                remote_file("target-only.txt", 7, Some(30)),
            ],
            vec![],
        );
        let plan = plan_sync_from_trees(
            root.to_string_lossy().into_owned(),
            local,
            "/remote",
            remote,
            SyncDirection::Push,
            SyncConflictPolicy::Overwrite,
            true,
        )
        .expect("plan succeeds");

        assert_eq!(plan.direction, SyncDirection::Push);
        assert_eq!(plan.create_count, 1);
        assert_eq!(plan.update_count, 1);
        assert_eq!(plan.delete_count, 1);
        assert!(plan
            .entries
            .iter()
            .any(|entry| entry.action == SyncAction::Create && entry.relative_path == "new.txt"));
        assert!(plan.entries.iter().any(
            |entry| entry.action == SyncAction::Update && entry.relative_path == "changed.txt"
        ));
        assert!(plan
            .entries
            .iter()
            .any(|entry| entry.action == SyncAction::Delete
                && entry.relative_path == "target-only.txt"));
        assert!(
            !plan
                .entries
                .iter()
                .any(|entry| entry.relative_path == "same.txt"),
            "same fingerprint must be skipped"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn pull_plans_create_update_and_delete() {
        let root = temp_root("pull");
        std::fs::create_dir_all(root.join("sub")).expect("create local dir");
        std::fs::write(root.join("changed.txt"), b"old").expect("write changed");
        std::fs::write(root.join("same.txt"), b"same").expect("write same");
        std::fs::write(root.join("target-only.txt"), b"old").expect("write target-only");

        let local = local_tree(
            vec![
                local_file("changed.txt", 3, Some(10)),
                local_file("same.txt", 4, Some(20)),
                local_file("target-only.txt", 7, Some(30)),
            ],
            vec![],
        );
        let remote = remote_tree(
            vec![
                remote_file("new.txt", 4, Some(10)),
                remote_file("changed.txt", 5, Some(20)),
                remote_file("same.txt", 4, Some(20)),
            ],
            vec![],
        );
        let plan = plan_sync_from_trees(
            root.to_string_lossy().into_owned(),
            local,
            "/remote",
            remote,
            SyncDirection::Pull,
            SyncConflictPolicy::Overwrite,
            true,
        )
        .expect("plan succeeds");

        assert_eq!(plan.direction, SyncDirection::Pull);
        assert_eq!(plan.create_count, 1);
        assert_eq!(plan.update_count, 1);
        assert_eq!(plan.delete_count, 1);
        assert!(plan
            .entries
            .iter()
            .any(|entry| entry.action == SyncAction::Create && entry.relative_path == "new.txt"));
        assert!(plan.entries.iter().any(
            |entry| entry.action == SyncAction::Update && entry.relative_path == "changed.txt"
        ));
        assert!(plan
            .entries
            .iter()
            .any(|entry| entry.action == SyncAction::Delete
                && entry.relative_path == "target-only.txt"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn delete_target_only_is_opt_in() {
        let root = temp_root("delete-off");
        let remote = remote_tree(vec![remote_file("target.txt", 1, Some(1))], vec![]);
        let plan = plan_sync_from_trees(
            root.to_string_lossy().into_owned(),
            local_tree(vec![], vec![]),
            "/remote",
            remote,
            SyncDirection::Push,
            SyncConflictPolicy::Overwrite,
            false,
        )
        .expect("plan succeeds");
        assert_eq!(plan.delete_count, 0);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_unsafe_paths() {
        let result = plan_sync_from_trees(
            "/local".to_string(),
            local_tree(vec![local_file("../escape.txt", 1, Some(1))], vec![]),
            "/remote",
            remote_tree(vec![], vec![]),
            SyncDirection::Push,
            SyncConflictPolicy::Overwrite,
            false,
        );
        assert!(result.is_err());
    }
}
