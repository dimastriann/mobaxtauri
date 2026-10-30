import { describe, expect, it } from 'vitest';
import { canConnectDirectly } from './connectEligibility';
import type { Session } from '../store/useSessionStore';

const base: Session = { id: 's1', name: 'host', type: 'ssh', status: 'disconnected' };

describe('canConnectDirectly', () => {
  it('is false with no credentials at all', () => {
    expect(canConnectDirectly(base)).toBe(false);
  });

  it('is true with a private key path', () => {
    expect(canConnectDirectly({ ...base, privateKeyPath: '~/.ssh/id_ed25519' })).toBe(true);
  });

  it('is true with an in-memory password', () => {
    expect(canConnectDirectly({ ...base, password: 'secret' })).toBe(true);
  });

  it('is true with a vault-saved credential', () => {
    expect(canConnectDirectly({ ...base, savePassword: true })).toBe(true);
  });

  it('is true when the ssh agent is used', () => {
    expect(canConnectDirectly({ ...base, useAgent: true })).toBe(true);
  });

  it('is false when an empty password is the only field', () => {
    expect(canConnectDirectly({ ...base, password: '' })).toBe(false);
  });
});
