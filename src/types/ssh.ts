export const SSH_SESSION_STATE_EVENT = 'ssh-session-state';

export type SshSessionStatus = 'connecting' | 'connected' | 'disconnected' | 'failed';

export type SshDisconnectReason = 'requested' | 'remote_eof' | 'remote_closed' | 'keepalive_failed';

export interface SshSessionStateEvent {
  sessionId: string;
  status: SshSessionStatus;
  message?: string;
  reason?: SshDisconnectReason;
}
