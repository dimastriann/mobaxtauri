import type { ConnectionDiagnostics } from '../types/diagnostics';

const line = (label: string, value: string | number | null | undefined): string =>
  `${label}: ${value === null || value === undefined || value === '' ? '?' : value}`;

/** Plain-text report suitable for copying into a support ticket. */
export function formatConnectionDiagnostics(report: ConnectionDiagnostics): string {
  const timings = report.timings;
  return [
    'MobaXTauri connection diagnostics',
    line('Target', `${report.user}@${report.host}:${report.port}`),
    line('Connected at', new Date(report.connectedAt * 1000).toISOString()),
    line('Session', report.sessionId),
    line('ProxyJump session', report.jumpSessionId),
    '',
    line('TCP', `${timings.tcpMs} ms`),
    line('Authentication', `${timings.authMs} ms`),
    line('Shell', `${timings.shellMs} ms`),
    line('SFTP', `${timings.sftpMs} ms`),
    line('Total', `${timings.totalMs} ms`),
    '',
    line('Auth attempted', report.authAttempted.join(', ')),
    line('Auth used', report.authUsed),
    line('Server banner', report.serverBanner),
    line('Host key type', report.hostKeyType),
    line('Host key fingerprint', report.hostKeyFingerprint),
    line('SFTP home', report.sftpHome),
  ].join('\n');
}
