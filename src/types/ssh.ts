export const SSH_SESSION_STATE_EVENT = 'ssh-session-state';
export const DEFAULT_SSH_CONNECTION_TIMEOUT_SECONDS = 15;
const MIN_SSH_CONNECTION_TIMEOUT_SECONDS = 5;
const MAX_SSH_CONNECTION_TIMEOUT_SECONDS = 120;

export const getSshConnectionTimeoutSeconds = (): number => {
  const configured = Number(localStorage.getItem('ssh-timeout'));
  return Number.isInteger(configured) &&
    configured >= MIN_SSH_CONNECTION_TIMEOUT_SECONDS &&
    configured <= MAX_SSH_CONNECTION_TIMEOUT_SECONDS
    ? configured
    : DEFAULT_SSH_CONNECTION_TIMEOUT_SECONDS;
};

export interface SshConnectRequest {
  sessionId: string;
  host: string;
  port: number;
  user: string;
  password: string | null;
  privateKeyPath: string | null;
  keyPassphrase?: string | null;
  useSavedCredential: boolean;
  useAgent?: boolean;
  /** Allow keyboard-interactive/OTP prompts after password auth fails. */
  allowKeyboardInteractive?: boolean;
  /** Saved profile id for vault lookups; absent means `sessionId`. */
  credentialSessionId?: string | null;
  jumpSessionId?: string | null;
  startupCommand?: string | null;
  connectionTimeoutSecs: number;
}

export type SshSessionStatus = 'connecting' | 'connected' | 'disconnected' | 'failed';

export type SshDisconnectReason = 'requested' | 'remote_eof' | 'remote_closed';

export interface SshSessionStateEvent {
  sessionId: string;
  status: SshSessionStatus;
  message?: string;
  reason?: SshDisconnectReason;
}

export interface SshHealthSnapshot {
  timestamp: number;
  cpu: number;
  ram: number;
  ram_used: number;
  ram_total: number;
  swap: number;
  swap_used: number;
  swap_total: number;
  disk: number;
}

export interface SshHealthEvent {
  sessionId: string;
  health: SshHealthSnapshot | null;
}

export const SSH_HEALTH_EVENT = 'ssh-health';

export const SSH_HOST_KEY_EVENT = 'ssh-host-key';
export const SSH_AUTH_PROMPT_EVENT = 'ssh-auth-prompt';

/** One keyboard-interactive prompt field (mirrors Rust auth_prompts). */
export interface SshAuthPromptField {
  prompt: string;
  echo: boolean;
}

export interface SshAuthPromptEvent {
  sessionId: string;
  name: string;
  instructions: string;
  prompts: SshAuthPromptField[];
}

/** One trusted host key (mirrors Rust known_hosts::KnownHost). */
export interface KnownHost {
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  firstSeen: number;
}

/// Emitted when a server presents a key that is not in the known-hosts
/// store. `mismatch: true` marks the dangerous case: the host is known
/// with a different key (possible man-in-the-middle).
export interface SshHostKeyEvent {
  sessionId: string;
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  mismatch: boolean;
}
