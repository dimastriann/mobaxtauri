export const SFTP_TRANSFER_EVENT = 'sftp-transfer';

/** Error marker emitted when a destination already exists on the remote. */
export const SFTP_TARGET_EXISTS_MARKER = 'SFTP TARGET EXISTS';

/** Error marker emitted when a file changed remotely between read and save. */
export const SFTP_FILE_CHANGED_MARKER = 'SFTP FILE CHANGED';

export type SftpConflictPolicy = 'overwrite' | 'rename' | 'skip';

export type SftpTransferStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export type SftpTransferKind = 'upload' | 'download' | 'copy' | 'folder_upload' | 'folder_download';

export interface SftpTransferEvent {
  transferId: string;
  sessionId: string;
  kind: SftpTransferKind;
  label: string;
  status: SftpTransferStatus;
  transferred: number;
  total: number | null;
  percent?: number | null;
  bytesPerSec?: number | null;
  etaSeconds?: number | null;
  message: string | null;
}

/** Payload of sftp_read_file_content (mirrors Rust SftpReadFileContent). */
export interface SftpReadFileContentPayload {
  content: string;
  mtime: number | null;
}

/** Payload of sftp_path_variants (mirrors Rust SftpPathVariants). */
export interface SftpPathVariantsPayload {
  fullPath: string;
  relativeToHome: string;
  name: string;
}

/** One entry of sftp_local_entries (mirrors Rust sftp_utils::LocalEntry). */
export interface SftpLocalEntryPayload {
  path: string;
  name: string;
  isDir: boolean;
}

/** Payload of sftp_remove_many (mirrors Rust sftp_remove::RemoveManyResult). */
export interface SftpRemoveFailure {
  path: string;
  message: string;
}

export interface SftpRemoveManyResult {
  removed: string[];
  failures: SftpRemoveFailure[];
}
