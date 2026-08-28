export const SFTP_TRANSFER_EVENT = 'sftp-transfer';

export type SftpTransferStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export interface SftpTransferEvent {
  transferId: string;
  sessionId: string;
  status: SftpTransferStatus;
  transferred: number;
  total: number | null;
  message: string | null;
}
