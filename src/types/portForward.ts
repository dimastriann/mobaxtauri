/** Mirrors Rust `port_forward::PortForward` (serde camelCase). */
export type PortForwardKind = 'local' | 'dynamic' | 'remote';

export interface PortForward {
  id: string;
  sessionId: string;
  kind: PortForwardKind;
  bindHost: string;
  bindPort: number;
  targetHost: string;
  targetPort: number;
}
