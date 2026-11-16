import { describe, expect, it } from 'vitest';
import { formatConnectionDiagnostics } from './diagnosticsReport';
import type { ConnectionDiagnostics } from '../types/diagnostics';

const report: ConnectionDiagnostics = {
  sessionId: 'ssh-1',
  host: 'example.com',
  port: 22,
  user: 'operator',
  connectedAt: 1_700_000_000,
  timings: { tcpMs: 10, authMs: 20, shellMs: 5, sftpMs: 7, totalMs: 42 },
  authAttempted: ['publickey'],
  authUsed: 'publickey',
  serverBanner: 'SSH-2.0-test',
  hostKeyType: 'ssh-ed25519',
  hostKeyFingerprint: 'SHA256:test',
  jumpSessionId: null,
  sftpHome: '/home/operator',
};

describe('formatConnectionDiagnostics', () => {
  it('renders a copyable technical report', () => {
    const text = formatConnectionDiagnostics(report);
    expect(text).toContain('operator@example.com:22');
    expect(text).toContain('Authentication: 20 ms');
    expect(text).toContain('Auth used: publickey');
    expect(text).toContain('ProxyJump session: ?');
    expect(text).not.toContain('password');
  });
});
