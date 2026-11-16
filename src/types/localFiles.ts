/** Mirrors Rust local_fs::LocalEntry. */
export interface LocalFileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size: number;
  modified: number | null;
}

/** Mirrors Rust local_fs::LocalListing. */
export interface LocalListing {
  path: string;
  parent: string | null;
  entries: LocalFileEntry[];
}
