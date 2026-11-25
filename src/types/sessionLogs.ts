/** One saved plain-text session log (mirrors Rust session_log::SessionLogEntry). */
export interface SessionLogEntry {
  fileName: string;
  size: number;
  /** Seconds since the Unix epoch, when the filesystem exposes it. */
  modified: number | null;
}
