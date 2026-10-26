import type { Session } from '../store/useSessionStore';

/**
 * Whether a session has actionable credentials so the terminal can connect
 * without prompting: a private key path (passphrase, if any, is requested
 * only when the backend reports the key is encrypted), an in-memory
 * password, or a vault-saved credential the backend unlocks.
 */
export const canConnectDirectly = (session: Session): boolean =>
  Boolean(session.privateKeyPath || session.password || session.savePassword);
