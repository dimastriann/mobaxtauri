export const SSH_SESSION_STATE_EVENT = 'ssh-session-state';

export type SshSessionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed';

export interface SshSessionStateEvent {
  sessionId: string;
  status: SshSessionStatus;
  message?: string;
}
