//! SFTP transfer flows shared by the Tauri commands and the integration
//! tests: chunked reads/writes, `.mobaxtauri-part` finalization, conflict
//! policies, cancellation, and progress events. Commands stay thin; the
//! flows only need an SFTP session, a transfer manager, and an event sink.

use crate::sftp_folder_resume::{self, FolderDirection, FolderFile, FolderSnapshot};
use crate::sftp_resume;
use crate::sftp_utils;
use crate::transfers::{
    calculate_eta, calculate_percentage, calculate_transfer_rate, emit_transfer, is_cancelled,
    TransferEvent, TransferManager, TransferStatus,
};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use tauri::{AppHandle, Runtime};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom};

pub async fn download_file<R: Runtime>(
    app_handle: &AppHandle<R>,
    sftp: &SftpSession,
    transfers: &TransferManager,
    session_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
) -> Result<(), String> {
    log::info!("Downloading {} to {}", remote_path, local_path);
    let kind = crate::transfers::TransferKind::Download;
    let label = sftp_utils::final_segment(&remote_path);
    let mut remote_file = sftp
        .open(&remote_path)
        .await
        .map_err(|e| format!("Failed to open remote file: {e:?}"))?;
    let remote_metadata = sftp.metadata(&remote_path).await.ok();
    let total = remote_metadata.as_ref().map(|metadata| metadata.len());
    let source = sftp_resume::remote_source(
        &remote_path,
        total.unwrap_or(0),
        remote_metadata.as_ref().and_then(|metadata| metadata.mtime),
    );
    let partial_path = format!("{local_path}.mobaxtauri-part");
    let partial_size = tokio::fs::metadata(&partial_path)
        .await
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let resuming = sftp_resume::can_resume(
        sftp_resume::read_local_sidecar(&partial_path).await,
        &source,
        partial_size,
    );
    let mut local_file = if resuming {
        tokio::fs::OpenOptions::new()
            .append(true)
            .open(&partial_path)
            .await
            .map_err(|e| format!("Failed to reopen local file: {e:?}"))?
    } else {
        let file = tokio::fs::File::create(&partial_path)
            .await
            .map_err(|e| format!("Failed to create local file: {e:?}"))?;
        if let Err(error) = sftp_resume::write_local_sidecar(&partial_path, &source).await {
            log::warn!("Resume metadata unavailable for {partial_path}: {error}");
        }
        file
    };
    let mut transferred = if resuming { partial_size } else { 0 };
    if resuming {
        remote_file
            .seek(SeekFrom::Start(transferred))
            .await
            .map_err(|e| format!("Failed to seek remote file: {e:?}"))?;
        log::info!("Resuming download {remote_path} at {transferred} bytes");
    }
    let cancellation = transfers
        .begin(transfer_id.clone(), session_id.clone())
        .await;
    let mut buffer = vec![0_u8; 64 * 1024];
    let started = std::time::Instant::now();

    emit_transfer(
        app_handle,
        TransferEvent {
            transfer_id: transfer_id.clone(),
            session_id: session_id.clone(),
            kind,
            label: label.clone(),
            status: TransferStatus::Running,
            transferred,
            total,
            percent: calculate_percentage(transferred, total),
            bytes_per_sec: calculate_transfer_rate(transferred, started.elapsed()),
            eta_seconds: calculate_eta(
                total,
                transferred,
                calculate_transfer_rate(transferred, started.elapsed()),
            ),
            message: None,
        },
    );

    let result = async {
        loop {
            if is_cancelled(&cancellation) {
                return Err("Transfer cancelled".to_string());
            }
            let count = remote_file
                .read(&mut buffer)
                .await
                .map_err(|e| format!("Read failed: {e:?}"))?;
            if count == 0 {
                break;
            }
            local_file
                .write_all(&buffer[..count])
                .await
                .map_err(|e| format!("Write failed: {e:?}"))?;
            transferred += count as u64;
            emit_transfer(
                app_handle,
                TransferEvent {
                    transfer_id: transfer_id.clone(),
                    session_id: session_id.clone(),
                    kind,
                    label: label.clone(),
                    status: TransferStatus::Running,
                    transferred,
                    total,
                    percent: calculate_percentage(transferred, total),
                    bytes_per_sec: calculate_transfer_rate(transferred, started.elapsed()),
                    eta_seconds: calculate_eta(
                        total,
                        transferred,
                        calculate_transfer_rate(transferred, started.elapsed()),
                    ),
                    message: None,
                },
            );
        }
        local_file
            .flush()
            .await
            .map_err(|e| format!("Failed to flush local file: {e:?}"))?;
        if tokio::fs::try_exists(&local_path).await.unwrap_or(false) {
            tokio::fs::remove_file(&local_path)
                .await
                .map_err(|e| format!("Failed to replace local file: {e:?}"))?;
        }
        tokio::fs::rename(&partial_path, &local_path)
            .await
            .map_err(|e| format!("Failed to finalize local file: {e:?}"))?;
        sftp_resume::remove_local_sidecar(&partial_path).await;
        Ok(())
    }
    .await;

    transfers.finish(&transfer_id).await;
    if result
        .as_ref()
        .err()
        .is_some_and(|error| error == "Transfer cancelled")
    {
        let _ = tokio::fs::remove_file(&partial_path).await;
        sftp_resume::remove_local_sidecar(&partial_path).await;
    }
    emit_transfer(
        app_handle,
        TransferEvent {
            transfer_id,
            session_id,
            kind,
            label: label.clone(),
            status: match &result {
                Ok(()) => TransferStatus::Completed,
                Err(error) if error == "Transfer cancelled" => TransferStatus::Cancelled,
                Err(_) => TransferStatus::Failed,
            },
            transferred,
            total,
            percent: calculate_percentage(transferred, total),
            bytes_per_sec: calculate_transfer_rate(transferred, started.elapsed()),
            eta_seconds: calculate_eta(
                total,
                transferred,
                calculate_transfer_rate(transferred, started.elapsed()),
            ),
            message: result.as_ref().err().cloned(),
        },
    );
    result
}

// Tauri commands receive named keyword arguments over IPC, so a params
// struct would change the wire contract; the argument list mirrors the
// event/transfer contract instead.
#[allow(clippy::too_many_arguments)]
pub async fn upload_file<R: Runtime>(
    app_handle: &AppHandle<R>,
    sftp: &SftpSession,
    transfers: &TransferManager,
    session_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
    conflict_policy: Option<String>,
) -> Result<(), String> {
    log::info!("Uploading {} to {}", local_path, remote_path);
    let kind = crate::transfers::TransferKind::Upload;
    let label = sftp_utils::final_segment(&remote_path);
    let target_path = crate::sftp_conflict::resolve_destination(
        sftp,
        &remote_path,
        crate::sftp_conflict::parse_conflict_policy(conflict_policy.as_deref()),
    )
    .await?;
    let Some(target_path) = target_path else {
        return Ok(());
    };
    let mut local_file = tokio::fs::File::open(&local_path)
        .await
        .map_err(|e| sftp_utils::local_file_error("Failed to read local file", &local_path, &e))?;
    let local_metadata = local_file
        .metadata()
        .await
        .map_err(|e| format!("Failed to read local file metadata: {e:?}"))?;
    let total = Some(local_metadata.len());
    let source = sftp_resume::local_source(&local_path, &local_metadata);
    let partial_path = format!("{target_path}.mobaxtauri-part");
    let remote_partial_size = sftp
        .metadata(&partial_path)
        .await
        .ok()
        .filter(|metadata| metadata.is_regular())
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let resuming = sftp_resume::can_resume(
        sftp_resume::read_remote_sidecar(sftp, &partial_path).await,
        &source,
        remote_partial_size,
    );
    let mut remote_file = if resuming {
        let file = sftp
            .open_with_flags(&partial_path, OpenFlags::WRITE)
            .await
            .map_err(|e| format!("Failed to reopen remote file: {e:?}"))?;
        local_file
            .seek(SeekFrom::Start(remote_partial_size))
            .await
            .map_err(|e| format!("Failed to seek local file: {e:?}"))?;
        log::info!("Resuming upload {local_path} at {remote_partial_size} bytes");
        file
    } else {
        let file = sftp
            .create(&partial_path)
            .await
            .map_err(|e| format!("Failed to create remote file: {e:?}"))?;
        if let Err(error) = sftp_resume::write_remote_sidecar(sftp, &partial_path, &source).await {
            log::warn!("Resume metadata unavailable for {partial_path}: {error}");
        }
        file
    };
    let mut transferred = if resuming { remote_partial_size } else { 0 };
    if resuming {
        remote_file
            .seek(SeekFrom::Start(transferred))
            .await
            .map_err(|e| format!("Failed to seek remote file: {e:?}"))?;
    }
    let cancellation = transfers
        .begin(transfer_id.clone(), session_id.clone())
        .await;
    let mut buffer = vec![0_u8; 64 * 1024];
    let started = std::time::Instant::now();

    let result = async {
        loop {
            if is_cancelled(&cancellation) {
                return Err("Transfer cancelled".to_string());
            }
            let count = sftp_utils::read_upload_chunk(
                &local_path,
                sftp_utils::CLOUD_RETRY_DELAYS_MS,
                &mut local_file,
                &mut buffer,
            )
            .await?;
            if count == 0 {
                break;
            }
            remote_file
                .write_all(&buffer[..count])
                .await
                .map_err(|e| format!("Write failed: {e:?}"))?;
            transferred += count as u64;
            emit_transfer(
                app_handle,
                TransferEvent {
                    transfer_id: transfer_id.clone(),
                    session_id: session_id.clone(),
                    kind,
                    label: label.clone(),
                    status: TransferStatus::Running,
                    transferred,
                    total,
                    percent: calculate_percentage(transferred, total),
                    bytes_per_sec: calculate_transfer_rate(transferred, started.elapsed()),
                    eta_seconds: calculate_eta(
                        total,
                        transferred,
                        calculate_transfer_rate(transferred, started.elapsed()),
                    ),
                    message: None,
                },
            );
        }
        remote_file
            .flush()
            .await
            .map_err(|e| format!("Failed to flush remote file: {e:?}"))?;
        let _ = sftp.remove_file(&target_path).await;
        sftp.rename(&partial_path, &target_path)
            .await
            .map_err(|e| format!("Failed to finalize remote file: {e:?}"))?;
        sftp_resume::remove_remote_sidecar(sftp, &partial_path).await;
        Ok(())
    }
    .await;

    transfers.finish(&transfer_id).await;
    if result
        .as_ref()
        .err()
        .is_some_and(|error| error == "Transfer cancelled")
    {
        let _ = sftp.remove_file(&partial_path).await;
        sftp_resume::remove_remote_sidecar(sftp, &partial_path).await;
    }
    emit_transfer(
        app_handle,
        TransferEvent {
            transfer_id,
            session_id,
            kind,
            label: label.clone(),
            status: match &result {
                Ok(()) => TransferStatus::Completed,
                Err(error) if error == "Transfer cancelled" => TransferStatus::Cancelled,
                Err(_) => TransferStatus::Failed,
            },
            transferred,
            total,
            percent: calculate_percentage(transferred, total),
            bytes_per_sec: calculate_transfer_rate(transferred, started.elapsed()),
            eta_seconds: calculate_eta(
                total,
                transferred,
                calculate_transfer_rate(transferred, started.elapsed()),
            ),
            message: result.as_ref().err().cloned(),
        },
    );
    result
}

// Tauri commands receive named keyword arguments over IPC, so a params
// struct would change the wire contract; the argument list mirrors the
// event/transfer contract instead.
#[allow(clippy::too_many_arguments)]
pub async fn copy_file<R: Runtime>(
    app_handle: &AppHandle<R>,
    sftp: &SftpSession,
    transfers: &TransferManager,
    session_id: String,
    source_path: String,
    dest_path: String,
    transfer_id: String,
    conflict_policy: Option<String>,
) -> Result<(), String> {
    log::info!("Copying {} to {}", source_path, dest_path);
    let kind = crate::transfers::TransferKind::Copy;
    let label = sftp_utils::final_segment(&source_path);
    let mut source_file = sftp
        .open(&source_path)
        .await
        .map_err(|e| format!("Failed to open source file: {e:?}"))?;
    let total = source_file
        .metadata()
        .await
        .ok()
        .map(|metadata| metadata.len());
    let target_path = crate::sftp_conflict::resolve_destination(
        sftp,
        &dest_path,
        crate::sftp_conflict::parse_conflict_policy(conflict_policy.as_deref()),
    )
    .await?;
    let Some(target_path) = target_path else {
        return Ok(());
    };
    let partial_path = format!("{target_path}.mobaxtauri-part");
    let mut dest_file = sftp
        .create(&partial_path)
        .await
        .map_err(|e| format!("Failed to create dest file: {e:?}"))?;
    let cancellation = transfers
        .begin(transfer_id.clone(), session_id.clone())
        .await;
    let mut buffer = vec![0_u8; 64 * 1024];
    let mut transferred = 0_u64;
    let started = std::time::Instant::now();

    let result = async {
        loop {
            if is_cancelled(&cancellation) {
                return Err("Transfer cancelled".to_string());
            }
            let count = source_file
                .read(&mut buffer)
                .await
                .map_err(|e| format!("Read failed: {e:?}"))?;
            if count == 0 {
                break;
            }
            dest_file
                .write_all(&buffer[..count])
                .await
                .map_err(|e| format!("Write failed: {e:?}"))?;
            transferred += count as u64;
            emit_transfer(
                app_handle,
                TransferEvent {
                    transfer_id: transfer_id.clone(),
                    session_id: session_id.clone(),
                    kind,
                    label: label.clone(),
                    status: TransferStatus::Running,
                    transferred,
                    total,
                    percent: calculate_percentage(transferred, total),
                    bytes_per_sec: calculate_transfer_rate(transferred, started.elapsed()),
                    eta_seconds: calculate_eta(
                        total,
                        transferred,
                        calculate_transfer_rate(transferred, started.elapsed()),
                    ),
                    message: None,
                },
            );
        }
        dest_file
            .flush()
            .await
            .map_err(|e| format!("Failed to flush dest file: {e:?}"))?;
        let _ = sftp.remove_file(&target_path).await;
        sftp.rename(&partial_path, &target_path)
            .await
            .map_err(|e| format!("Failed to finalize dest file: {e:?}"))
    }
    .await;

    transfers.finish(&transfer_id).await;
    if result.is_err() {
        let _ = sftp.remove_file(&partial_path).await;
    }
    emit_transfer(
        app_handle,
        TransferEvent {
            transfer_id,
            session_id,
            kind,
            label: label.clone(),
            status: match &result {
                Ok(()) => TransferStatus::Completed,
                Err(error) if error == "Transfer cancelled" => TransferStatus::Cancelled,
                Err(_) => TransferStatus::Failed,
            },
            transferred,
            total,
            percent: calculate_percentage(transferred, total),
            bytes_per_sec: calculate_transfer_rate(transferred, started.elapsed()),
            eta_seconds: calculate_eta(
                total,
                transferred,
                calculate_transfer_rate(transferred, started.elapsed()),
            ),
            message: result.as_ref().err().cloned(),
        },
    );
    result
}

struct RemoteFile {
    path: String,
    relative_path: String,
    size: u64,
    modified: Option<u64>,
}

// Tauri commands receive named keyword arguments over IPC, so a params
// struct would change the wire contract; the argument list mirrors the
// event/transfer contract instead.
#[allow(clippy::too_many_arguments)]
pub async fn download_folder<R: Runtime>(
    app_handle: &AppHandle<R>,
    sftp: &SftpSession,
    transfers: &TransferManager,
    session_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
    conflict_policy: Option<String>,
) -> Result<(), String> {
    log::info!("Downloading folder {} to {}", remote_path, local_path);
    let kind = crate::transfers::TransferKind::FolderDownload;
    let label = sftp_utils::final_segment(&remote_path);
    let target_root = crate::sftp_conflict::resolve_destination_local(
        std::path::Path::new(&local_path),
        crate::sftp_conflict::parse_conflict_policy(conflict_policy.as_deref()),
    )
    .await?;
    let Some(target_root) = target_root else {
        return Ok(());
    };
    let remote_root = remote_path.trim_end_matches('/').to_string();

    // Collect the full file list and byte total up front so the progress
    // percentage is stable for the whole walk. Every directory — including
    // empty ones — is created locally so downloads preserve the structure
    // exactly like the upload side.
    async fn collect_files(
        sftp: &SftpSession,
        root: &str,
    ) -> Result<(Vec<RemoteFile>, Vec<String>), String> {
        let mut files: Vec<RemoteFile> = Vec::new();
        let mut dirs: Vec<String> = vec![String::new()];
        let mut stack: Vec<(String, String)> = vec![(root.to_string(), String::new())];
        while let Some((dir, rel)) = stack.pop() {
            let entries = sftp
                .read_dir(&dir)
                .await
                .map_err(|e| format!("Failed to read remote directory {dir}: {e:?}"))?;
            for entry in entries {
                let name = entry.file_name();
                if name == "." || name == ".." {
                    continue;
                }
                let child = sftp_utils::join_sftp_path(&dir, &name);
                let child_rel = if rel.is_empty() {
                    name.clone()
                } else {
                    format!("{rel}/{name}")
                };
                let metadata = entry.metadata();
                if metadata.is_dir() {
                    dirs.push(child_rel.clone());
                    stack.push((child, child_rel));
                } else if metadata.is_regular() {
                    files.push(RemoteFile {
                        path: child,
                        relative_path: child_rel,
                        size: metadata.len(),
                        modified: metadata.mtime.map(u64::from),
                    });
                }
            }
        }
        dirs.sort();
        Ok((files, dirs))
    }

    let cancellation = transfers
        .begin(transfer_id.clone(), session_id.clone())
        .await;
    let mut transferred = 0_u64;
    let started = std::time::Instant::now();
    let mut final_total: Option<u64> = None;
    let mut partial_paths: Vec<String> = Vec::new();
    let mut resumed = false;

    let result = async {
        let (files, dirs) = collect_files(sftp, &remote_root).await?;
        let total = files.iter().map(|file| file.size).sum::<u64>();
        final_total = Some(total);

        // The sorted dir list guarantees each parent exists before its
        // children are touched; the empty relative path creates the root.
        for relative in &dirs {
            if is_cancelled(&cancellation) {
                return Err("Transfer cancelled".to_string());
            }
            let local_dir_path = target_root.join(relative);
            tokio::fs::create_dir_all(&local_dir_path)
                .await
                .map_err(|e| format!("Failed to create local directory: {e}"))?;
        }

        let snapshot = FolderSnapshot::new(
            FolderDirection::Download,
            remote_root.clone(),
            target_root.to_string_lossy().to_string(),
            files
                .iter()
                .map(|file| FolderFile {
                    relative_path: file.relative_path.clone(),
                    size: file.size,
                    modified: file.modified,
                })
                .collect(),
        )?;
        let stored = sftp_folder_resume::read_local_snapshot(&target_root).await;
        let stored_matches = stored
            .as_ref()
            .is_some_and(|stored| stored.matches(&snapshot));
        let mut completed = if stored_matches {
            let journal = sftp_folder_resume::read_local_journal(&target_root).await;
            if snapshot.supports_completed_skip() {
                snapshot.completed_paths(&journal)
            } else {
                std::collections::HashSet::new()
            }
        } else {
            sftp_folder_resume::remove_local_resume_artifacts(&target_root).await;
            if let Err(error) =
                sftp_folder_resume::write_local_snapshot(&target_root, &snapshot).await
            {
                log::warn!(
                    "Folder resume state unavailable for {}: {error}",
                    target_root.display()
                );
            }
            std::collections::HashSet::new()
        };

        // A journal entry is only trusted when the destination still exists
        // with the recorded size; otherwise the file is copied again.
        let mut verified = std::collections::HashSet::new();
        for file in &snapshot.files {
            if !completed.contains(&file.relative_path) {
                continue;
            }
            let local_file_path = target_root.join(&file.relative_path);
            if let Ok(metadata) = tokio::fs::metadata(&local_file_path).await {
                if metadata.is_file() && metadata.len() == file.size {
                    verified.insert(file.relative_path.clone());
                }
            }
        }
        completed = verified;
        transferred = snapshot.completed_bytes(&completed);
        resumed = !completed.is_empty();

        for file in &files {
            if is_cancelled(&cancellation) {
                return Err("Transfer cancelled".to_string());
            }
            if completed.contains(&file.relative_path) {
                continue;
            }

            let local_file_path = target_root.join(&file.relative_path);
            let partial_path = format!("{}.mobaxtauri-part", local_file_path.display());
            let partial_size = tokio::fs::metadata(&partial_path)
                .await
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            let source = sftp_resume::remote_source(
                &file.path,
                file.size,
                file.modified.map(|value| value as u32),
            );
            let resuming_file = sftp_resume::can_resume(
                sftp_resume::read_local_sidecar(&partial_path).await,
                &source,
                partial_size,
            );

            let mut remote_file = sftp
                .open(&file.path)
                .await
                .map_err(|e| format!("Failed to open remote file {}: {e:?}", file.path))?;
            let mut local_file = if resuming_file {
                remote_file
                    .seek(SeekFrom::Start(partial_size))
                    .await
                    .map_err(|e| format!("Failed to seek remote file: {e:?}"))?;
                transferred += partial_size;
                resumed = true;
                tokio::fs::OpenOptions::new()
                    .append(true)
                    .open(&partial_path)
                    .await
                    .map_err(|e| format!("Failed to reopen local file: {e}"))?
            } else {
                let file = tokio::fs::File::create(&partial_path)
                    .await
                    .map_err(|e| format!("Failed to create local file: {e}"))?;
                if let Err(error) = sftp_resume::write_local_sidecar(&partial_path, &source).await {
                    log::warn!("Resume metadata unavailable for {partial_path}: {error}");
                }
                file
            };
            partial_paths.push(partial_path.clone());
            let mut buffer = vec![0_u8; 64 * 1024];

            let mut file_error = None;
            loop {
                if is_cancelled(&cancellation) {
                    file_error = Some("Transfer cancelled".to_string());
                    break;
                }
                let count = match remote_file.read(&mut buffer).await {
                    Ok(count) => count,
                    Err(e) => {
                        file_error = Some(format!("Read failed for {}: {e:?}", file.path));
                        break;
                    }
                };
                if count == 0 {
                    break;
                }
                if let Err(e) = local_file.write_all(&buffer[..count]).await {
                    file_error = Some(format!("Write failed for {}: {e}", file.path));
                    break;
                }
                transferred += count as u64;
                emit_transfer(
                    app_handle,
                    TransferEvent {
                        transfer_id: transfer_id.clone(),
                        session_id: session_id.clone(),
                        kind,
                        label: label.clone(),
                        status: TransferStatus::Running,
                        transferred,
                        total: Some(total),
                        percent: calculate_percentage(transferred, Some(total)),
                        bytes_per_sec: calculate_transfer_rate(transferred, started.elapsed()),
                        eta_seconds: calculate_eta(
                            Some(total),
                            transferred,
                            calculate_transfer_rate(transferred, started.elapsed()),
                        ),
                        message: Some(file.relative_path.clone()),
                    },
                );
            }
            let flushed = local_file.flush().await;
            drop(local_file);
            if let Some(error) = file_error {
                if error == "Transfer cancelled" {
                    let _ = tokio::fs::remove_file(&partial_path).await;
                    sftp_resume::remove_local_sidecar(&partial_path).await;
                }
                return Err(error);
            }
            flushed.map_err(|e| format!("Failed to flush local file: {e}"))?;
            if tokio::fs::try_exists(&local_file_path)
                .await
                .unwrap_or(false)
            {
                tokio::fs::remove_file(&local_file_path)
                    .await
                    .map_err(|e| format!("Failed to replace local file: {e}"))?;
            }
            tokio::fs::rename(&partial_path, &local_file_path)
                .await
                .map_err(|e| format!("Failed to finalize local file: {e}"))?;
            sftp_resume::remove_local_sidecar(&partial_path).await;
            if let Err(error) =
                sftp_folder_resume::append_local_journal(&target_root, &file.relative_path).await
            {
                log::warn!("Folder resume journal unavailable: {error}");
            }
        }
        sftp_folder_resume::remove_local_resume_artifacts(&target_root).await;
        Ok(())
    }
    .await;

    transfers.finish(&transfer_id).await;
    if result
        .as_ref()
        .err()
        .is_some_and(|error| error == "Transfer cancelled")
    {
        sftp_folder_resume::remove_local_resume_artifacts(&target_root).await;
        for partial_path in &partial_paths {
            let _ = tokio::fs::remove_file(partial_path).await;
            sftp_resume::remove_local_sidecar(partial_path).await;
        }
    }
    if resumed {
        log::info!("Folder download resumed from saved progress");
    }
    emit_transfer(
        app_handle,
        TransferEvent {
            transfer_id,
            session_id,
            kind,
            label: label.clone(),
            status: match &result {
                Ok(()) => TransferStatus::Completed,
                Err(error) if error == "Transfer cancelled" => TransferStatus::Cancelled,
                Err(_) => TransferStatus::Failed,
            },
            transferred,
            total: final_total,
            percent: calculate_percentage(transferred, final_total),
            bytes_per_sec: calculate_transfer_rate(transferred, started.elapsed()),
            eta_seconds: calculate_eta(
                final_total,
                transferred,
                calculate_transfer_rate(transferred, started.elapsed()),
            ),
            message: result.as_ref().err().cloned(),
        },
    );
    result
}

// Tauri commands receive named keyword arguments over IPC, so a params
// struct would change the wire contract; the argument list mirrors the
// event/transfer contract instead.
#[allow(clippy::too_many_arguments)]
pub async fn upload_folder<R: Runtime>(
    app_handle: &AppHandle<R>,
    sftp: &SftpSession,
    transfers: &TransferManager,
    session_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
    conflict_policy: Option<String>,
) -> Result<(), String> {
    log::info!("Uploading folder {} to {}", local_path, remote_path);
    let kind = crate::transfers::TransferKind::FolderUpload;
    let label = sftp_utils::final_segment(&remote_path);
    let target_root = crate::sftp_conflict::resolve_destination(
        sftp,
        &remote_path,
        crate::sftp_conflict::parse_conflict_policy(conflict_policy.as_deref()),
    )
    .await?;
    let Some(target_root) = target_root else {
        return Ok(());
    };

    let local_root = std::path::PathBuf::from(&local_path);
    let local_metadata = tokio::fs::metadata(&local_root)
        .await
        .map_err(|e| format!("Failed to read local folder: {e}"))?;
    if !local_metadata.is_dir() {
        return Err(format!(
            "Local path {} is not a folder",
            local_root.display()
        ));
    }

    // Collect the full file list and byte total up front so the progress
    // percentage is stable for the whole walk. Directories ? including
    // empty ones ? are created remotely before the first file is written.
    let tree = sftp_utils::collect_local_tree(&local_root).await?;
    let total = tree.files.iter().map(|file| file.size).sum::<u64>();
    let snapshot = FolderSnapshot::new(
        FolderDirection::Upload,
        local_root.to_string_lossy().to_string(),
        target_root.clone(),
        tree.files
            .iter()
            .map(|file| FolderFile {
                relative_path: file.relative_path.clone(),
                size: file.size,
                modified: file.modified,
            })
            .collect(),
    )?;

    let cancellation = transfers
        .begin(transfer_id.clone(), session_id.clone())
        .await;
    let mut transferred = 0_u64;
    let started = std::time::Instant::now();
    let mut partial_paths: Vec<String> = Vec::new();
    let mut resumed = false;

    emit_transfer(
        app_handle,
        TransferEvent {
            transfer_id: transfer_id.clone(),
            session_id: session_id.clone(),
            kind,
            label: label.clone(),
            status: TransferStatus::Running,
            transferred,
            total: Some(total),
            percent: calculate_percentage(transferred, Some(total)),
            bytes_per_sec: calculate_transfer_rate(transferred, started.elapsed()),
            eta_seconds: calculate_eta(
                Some(total),
                transferred,
                calculate_transfer_rate(transferred, started.elapsed()),
            ),
            message: None,
        },
    );

    let result = async {
        // An existing target must be a directory; a file at the same path
        // would make every create_dir and rename below fail confusingly.
        if let Ok(metadata) = sftp.metadata(&target_root).await {
            if !metadata.is_dir() {
                return Err(format!(
                    "Cannot upload folder: {target_root} exists and is not a directory"
                ));
            }
        }
        for relative in &tree.dirs {
            if is_cancelled(&cancellation) {
                return Err("Transfer cancelled".to_string());
            }
            let remote_dir = sftp_utils::join_sftp_path(&target_root, relative);
            // create_dir is non-recursive; the sorted dir list guarantees
            // each parent exists by the time its children are created.
            if let Err(error) = sftp.create_dir(&remote_dir).await {
                match sftp.metadata(&remote_dir).await {
                    Ok(metadata) if metadata.is_dir() => {}
                    _ => {
                        return Err(format!(
                            "Failed to create remote directory {remote_dir}: {error:?}"
                        ))
                    }
                }
            }
        }

        let stored = sftp_folder_resume::read_remote_snapshot(sftp, &target_root).await;
        let stored_matches = stored
            .as_ref()
            .is_some_and(|stored| stored.matches(&snapshot));
        let mut completed = if stored_matches {
            let journal = sftp_folder_resume::read_remote_journal(sftp, &target_root).await;
            if snapshot.supports_completed_skip() {
                snapshot.completed_paths(&journal)
            } else {
                std::collections::HashSet::new()
            }
        } else {
            sftp_folder_resume::remove_remote_resume_artifacts(sftp, &target_root).await;
            if let Err(error) =
                sftp_folder_resume::write_remote_snapshot(sftp, &target_root, &snapshot).await
            {
                log::warn!("Folder resume state unavailable for {target_root}: {error}");
            }
            std::collections::HashSet::new()
        };

        // A journal entry is only trusted when the destination still exists
        // with the recorded size; otherwise the file is copied again.
        let mut verified = std::collections::HashSet::new();
        for file in &snapshot.files {
            if !completed.contains(&file.relative_path) {
                continue;
            }
            let remote_file_path = sftp_utils::join_sftp_path(&target_root, &file.relative_path);
            if let Ok(metadata) = sftp.metadata(&remote_file_path).await {
                if metadata.is_regular() && metadata.len() == file.size {
                    verified.insert(file.relative_path.clone());
                }
            }
        }
        completed = verified;
        transferred = snapshot.completed_bytes(&completed);
        resumed = !completed.is_empty();

        for file in &tree.files {
            if is_cancelled(&cancellation) {
                return Err("Transfer cancelled".to_string());
            }
            if completed.contains(&file.relative_path) {
                continue;
            }

            let remote_file_path = sftp_utils::join_sftp_path(&target_root, &file.relative_path);
            let local_file_path = local_root.join(&file.relative_path);
            let local_display = local_file_path.display().to_string();
            let mut local_file = tokio::fs::File::open(&local_file_path).await.map_err(|e| {
                sftp_utils::local_file_error("Failed to open local file", &local_display, &e)
            })?;
            let local_metadata = local_file.metadata().await.map_err(|e| {
                sftp_utils::local_file_error(
                    "Failed to read local file metadata",
                    &local_display,
                    &e,
                )
            })?;
            let source = sftp_resume::local_source(&local_display, &local_metadata);
            let partial_path = format!("{remote_file_path}.mobaxtauri-part");
            let remote_partial_size = sftp
                .metadata(&partial_path)
                .await
                .ok()
                .filter(|metadata| metadata.is_regular())
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            let resuming_file = sftp_resume::can_resume(
                sftp_resume::read_remote_sidecar(sftp, &partial_path).await,
                &source,
                remote_partial_size,
            );
            let mut remote_file = if resuming_file {
                let mut file = sftp
                    .open_with_flags(&partial_path, OpenFlags::WRITE)
                    .await
                    .map_err(|e| format!("Failed to reopen remote file: {e:?}"))?;
                file.seek(SeekFrom::Start(remote_partial_size))
                    .await
                    .map_err(|e| format!("Failed to seek remote file: {e:?}"))?;
                local_file
                    .seek(SeekFrom::Start(remote_partial_size))
                    .await
                    .map_err(|e| format!("Failed to seek local file: {e}"))?;
                transferred += remote_partial_size;
                resumed = true;
                file
            } else {
                let file = sftp.create(&partial_path).await.map_err(|e| {
                    format!("Failed to create remote file {remote_file_path}: {e:?}")
                })?;
                if let Err(error) =
                    sftp_resume::write_remote_sidecar(sftp, &partial_path, &source).await
                {
                    log::warn!("Resume metadata unavailable for {partial_path}: {error}");
                }
                file
            };
            partial_paths.push(partial_path.clone());
            let mut buffer = vec![0_u8; 64 * 1024];

            let mut file_error = None;
            loop {
                if is_cancelled(&cancellation) {
                    file_error = Some("Transfer cancelled".to_string());
                    break;
                }
                let count = match sftp_utils::read_upload_chunk(
                    &local_display,
                    sftp_utils::CLOUD_RETRY_DELAYS_MS,
                    &mut local_file,
                    &mut buffer,
                )
                .await
                {
                    Ok(count) => count,
                    Err(message) => {
                        file_error = Some(message);
                        break;
                    }
                };
                if count == 0 {
                    break;
                }
                if let Err(e) = remote_file.write_all(&buffer[..count]).await {
                    file_error = Some(format!("Write failed for {remote_file_path}: {e:?}"));
                    break;
                }
                transferred += count as u64;
                emit_transfer(
                    app_handle,
                    TransferEvent {
                        transfer_id: transfer_id.clone(),
                        session_id: session_id.clone(),
                        kind,
                        label: label.clone(),
                        status: TransferStatus::Running,
                        transferred,
                        total: Some(total),
                        percent: calculate_percentage(transferred, Some(total)),
                        bytes_per_sec: calculate_transfer_rate(transferred, started.elapsed()),
                        eta_seconds: calculate_eta(
                            Some(total),
                            transferred,
                            calculate_transfer_rate(transferred, started.elapsed()),
                        ),
                        message: Some(file.relative_path.clone()),
                    },
                );
            }
            if let Some(error) = file_error {
                if error == "Transfer cancelled" {
                    let _ = sftp.remove_file(&partial_path).await;
                    sftp_resume::remove_remote_sidecar(sftp, &partial_path).await;
                }
                return Err(error);
            }
            // Drop the handle before the finalizing rename, mirroring the
            // local-file pattern in folder downloads.
            let flushed = remote_file.flush().await;
            drop(remote_file);
            flushed
                .map_err(|e| format!("Failed to flush remote file {remote_file_path}: {e:?}"))?;
            let _ = sftp.remove_file(&remote_file_path).await;
            sftp.rename(&partial_path, &remote_file_path)
                .await
                .map_err(|e| format!("Failed to finalize remote file {remote_file_path}: {e:?}"))?;
            sftp_resume::remove_remote_sidecar(sftp, &partial_path).await;
            if let Err(error) =
                sftp_folder_resume::append_remote_journal(sftp, &target_root, &file.relative_path)
                    .await
            {
                log::warn!("Folder resume journal unavailable: {error}");
            }
        }
        sftp_folder_resume::remove_remote_resume_artifacts(sftp, &target_root).await;
        Ok(())
    }
    .await;

    transfers.finish(&transfer_id).await;
    if result
        .as_ref()
        .err()
        .is_some_and(|error| error == "Transfer cancelled")
    {
        sftp_folder_resume::remove_remote_resume_artifacts(sftp, &target_root).await;
        for partial_path in &partial_paths {
            let _ = sftp.remove_file(partial_path).await;
            sftp_resume::remove_remote_sidecar(sftp, partial_path).await;
        }
    }
    if resumed {
        log::info!("Folder upload resumed from saved progress");
    }
    emit_transfer(
        app_handle,
        TransferEvent {
            transfer_id,
            session_id,
            kind,
            label: label.clone(),
            status: match &result {
                Ok(()) => TransferStatus::Completed,
                Err(error) if error == "Transfer cancelled" => TransferStatus::Cancelled,
                Err(_) => TransferStatus::Failed,
            },
            transferred,
            total: Some(total),
            percent: calculate_percentage(transferred, Some(total)),
            bytes_per_sec: calculate_transfer_rate(transferred, started.elapsed()),
            eta_seconds: calculate_eta(
                Some(total),
                transferred,
                calculate_transfer_rate(transferred, started.elapsed()),
            ),
            message: result.as_ref().err().cloned(),
        },
    );
    result
}
