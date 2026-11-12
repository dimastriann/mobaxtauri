import type { SftpConflictPolicy, SftpTransferEvent, SftpTransferKind } from '../types/sftp';

export const FAILED_TRANSFERS_STORAGE_KEY = 'mobaxtauri-sftp-failed-transfers';

export interface FailedTransferRequest {
  kind: SftpTransferKind;
  sessionId: string;
  sourcePath: string;
  destPath: string;
  conflictPolicy?: SftpConflictPolicy;
}

export interface PersistedFailedTransfer {
  request: FailedTransferRequest;
  event: SftpTransferEvent;
}

interface StoredFailedTransfers {
  version: 1;
  entries: PersistedFailedTransfer[];
}

const TRANSFER_KINDS: ReadonlySet<string> = new Set([
  'upload',
  'download',
  'copy',
  'folder_upload',
  'folder_download',
]);

const CONFLICT_POLICIES: ReadonlySet<string> = new Set(['overwrite', 'rename', 'skip']);

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

const defaultStorage = (): Storage | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isOptionalNumber = (value: unknown): value is number | null | undefined =>
  value === undefined || value === null || isFiniteNumber(value);

const isTransferKind = (value: unknown): value is SftpTransferKind =>
  typeof value === 'string' && TRANSFER_KINDS.has(value);

const isConflictPolicy = (value: unknown): value is SftpConflictPolicy =>
  typeof value === 'string' && CONFLICT_POLICIES.has(value);

function parseEvent(value: unknown): SftpTransferEvent | null {
  if (!isRecord(value)) return null;
  if (value.status !== 'failed') return null;
  if (
    typeof value.transferId !== 'string' ||
    typeof value.sessionId !== 'string' ||
    !isTransferKind(value.kind) ||
    typeof value.label !== 'string' ||
    !isFiniteNumber(value.transferred) ||
    !isOptionalNumber(value.total) ||
    !isOptionalNumber(value.percent) ||
    !isOptionalNumber(value.bytesPerSec) ||
    !isOptionalNumber(value.etaSeconds) ||
    (value.message !== null && typeof value.message !== 'string')
  ) {
    return null;
  }
  return {
    transferId: value.transferId,
    sessionId: value.sessionId,
    kind: value.kind,
    label: value.label,
    status: 'failed',
    transferred: value.transferred,
    total: value.total ?? null,
    percent: value.percent ?? null,
    bytesPerSec: value.bytesPerSec ?? null,
    etaSeconds: value.etaSeconds ?? null,
    message: value.message,
  };
}

function parseRequest(value: unknown): FailedTransferRequest | null {
  if (!isRecord(value)) return null;
  if (
    !isTransferKind(value.kind) ||
    typeof value.sessionId !== 'string' ||
    typeof value.sourcePath !== 'string' ||
    typeof value.destPath !== 'string' ||
    (value.conflictPolicy !== undefined && !isConflictPolicy(value.conflictPolicy))
  ) {
    return null;
  }
  return {
    kind: value.kind,
    sessionId: value.sessionId,
    sourcePath: value.sourcePath,
    destPath: value.destPath,
    ...(value.conflictPolicy === undefined ? {} : { conflictPolicy: value.conflictPolicy }),
  };
}

export function loadFailedTransfers(
  storage: ReadableStorage | undefined = defaultStorage(),
): PersistedFailedTransfer[] {
  if (!storage) return [];
  let stored: unknown;
  try {
    const raw = storage.getItem(FAILED_TRANSFERS_STORAGE_KEY);
    if (!raw) return [];
    stored = JSON.parse(raw);
  } catch {
    return [];
  }

  const entries = isRecord(stored) ? stored.entries : stored;
  if (!Array.isArray(entries)) return [];

  const seen = new Set<string>();
  const result: PersistedFailedTransfer[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const request = parseRequest(entry.request);
    const event = parseEvent(entry.event);
    if (!request || !event) continue;
    if (event.sessionId !== request.sessionId) continue;
    if (seen.has(event.transferId)) continue;
    seen.add(event.transferId);
    result.push({ request, event });
  }
  return result;
}

export function saveFailedTransfers(
  entries: PersistedFailedTransfer[],
  storage: WritableStorage | undefined = defaultStorage(),
): void {
  if (!storage) return;
  const document: StoredFailedTransfers = { version: 1, entries };
  try {
    storage.setItem(FAILED_TRANSFERS_STORAGE_KEY, JSON.stringify(document));
  } catch {
    // A full or unavailable storage area must not break active transfers.
  }
}
