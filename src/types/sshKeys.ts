/** Mirrors Rust `ssh_keys::SshKeyMetadata` (serde camelCase). */
export interface SshKeyMetadata {
  id: string;
  name: string;
  path: string;
  keyType: string;
  fingerprint: string;
  publicKey: string;
  comment: string;
  encrypted: boolean;
  managed: boolean;
  createdAt: number;
}
