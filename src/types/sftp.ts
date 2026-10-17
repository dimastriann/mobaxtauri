export const SFTP_TRANSFER_EVENT = 'sftp-transfer';

/** Error marker emitted when a destination already exists on the remote. */
export const SFTP_TARGET_EXISTS_MARKER = 'SFTP TARGET EXISTS';

/** Error marker emitted when a file changed remotely between read and save. */
export const SFTP_FILE_CHANGED_MARKER = 'SFTP FILE CHANGED';

export type SftpConflictPolicy = 'overwrite' | 'rename' | 'skip';

export type SftpTransferStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export interface SftpTransferEvent {
  transferId: string;
  sessionId: string;
  status: SftpTransferStatus;
  transferred: number;
  total: number | null;
  percent?: number | null;
  message: string | null;
}

/** Payload of sftp_read_file_content (mirrors Rust SftpReadFileContent). */
export interface SftpReadFileContentPayload {
  content: string;
  mtime: number | null;
}
