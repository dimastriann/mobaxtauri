export interface ConnectTimings {
  tcpMs: number;
  authMs: number;
  shellMs: number;
  sftpMs: number;
  totalMs: number;
}

export interface ConnectionDiagnostics {
  sessionId: string;
  host: string;
  port: number;
  user: string;
  connectedAt: number;
  timings: ConnectTimings;
  authAttempted: string[];
  authUsed: string | null;
  serverBanner: string;
  hostKeyType: string | null;
  hostKeyFingerprint: string | null;
  jumpSessionId: string | null;
  sftpHome: string | null;
}
