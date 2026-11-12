export const AUTO_LOCK_STORAGE_KEY = 'vault-auto-lock-minutes';
export const AUTO_LOCK_CHANGED_EVENT = 'vault-auto-lock-changed';
export const DEFAULT_AUTO_LOCK_MINUTES = 15;
export const AUTO_LOCK_OPTIONS = [0, 5, 15, 30, 60] as const;

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

const defaultStorage = (): Storage | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

const normalize = (value: number): number =>
  (AUTO_LOCK_OPTIONS as readonly number[]).includes(value) ? value : DEFAULT_AUTO_LOCK_MINUTES;

export function loadAutoLockMinutes(
  storage: ReadableStorage | undefined = defaultStorage(),
): number {
  const raw = storage?.getItem(AUTO_LOCK_STORAGE_KEY);
  const value = Number(raw);
  return Number.isInteger(value) ? normalize(value) : DEFAULT_AUTO_LOCK_MINUTES;
}

export function saveAutoLockMinutes(
  minutes: number,
  storage: WritableStorage | undefined = defaultStorage(),
): number {
  const normalized = normalize(minutes);
  try {
    storage?.setItem(AUTO_LOCK_STORAGE_KEY, String(normalized));
  } catch {
    // A read-only storage area must not break the settings view.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTO_LOCK_CHANGED_EVENT));
  }
  return normalized;
}

export function autoLockDelayMs(minutes: number): number | null {
  if (!Number.isInteger(minutes) || minutes <= 0) return null;
  return minutes * 60_000;
}

export function shouldLockAfterIdle(lastActivity: number, now: number, timeoutMs: number): boolean {
  return now - lastActivity >= timeoutMs;
}
