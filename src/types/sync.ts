export type SyncDirection = 'push' | 'pull';

export type SyncAction = 'create' | 'update' | 'delete';

export type SyncConflictPolicy = 'overwrite' | 'skip' | 'rename';

export type SyncEntryKind = 'file' | 'directory';

export interface SyncEntry {
  relativePath: string;
  action: SyncAction;
  kind: SyncEntryKind;
  sourceSize: number | null;
  sourceModified: number | null;
  targetSize: number | null;
  targetModified: number | null;
}

export interface SyncPlan {
  direction: SyncDirection;
  localRoot: string;
  remoteRoot: string;
  conflictPolicy: SyncConflictPolicy;
  deleteTargetOnly: boolean;
  entries: SyncEntry[];
  createCount: number;
  updateCount: number;
  deleteCount: number;
}

export interface SyncApplyFailure {
  relativePath: string;
  message: string;
}

export interface SyncApplyResult {
  appliedCreate: number;
  appliedUpdate: number;
  appliedDelete: number;
  failures: SyncApplyFailure[];
}
