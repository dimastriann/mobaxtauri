export const TRANSFER_CONCURRENCY_KEY = 'sftp-transfer-concurrency';
export const DEFAULT_TRANSFER_CONCURRENCY = 3;
export const MIN_TRANSFER_CONCURRENCY = 1;
export const MAX_TRANSFER_CONCURRENCY = 4;

const normalize = (value: number): number =>
  Math.min(MAX_TRANSFER_CONCURRENCY, Math.max(MIN_TRANSFER_CONCURRENCY, Math.round(value)));

export function loadTransferConcurrency(
  storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined'
    ? undefined
    : localStorage,
): number {
  const raw = storage?.getItem(TRANSFER_CONCURRENCY_KEY);
  if (raw === null || raw === undefined || raw === '') return DEFAULT_TRANSFER_CONCURRENCY;
  const value = Number(raw);
  return Number.isInteger(value) ? normalize(value) : DEFAULT_TRANSFER_CONCURRENCY;
}

export function saveTransferConcurrency(
  value: number,
  storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage === 'undefined'
    ? undefined
    : localStorage,
): number {
  const normalized = normalize(value);
  try {
    storage?.setItem(TRANSFER_CONCURRENCY_KEY, String(normalized));
  } catch {
    // A read-only storage area must not block transfer settings.
  }
  return normalized;
}
