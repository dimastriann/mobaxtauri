export const BANDWIDTH_LIMIT_KEY = 'sftp-bandwidth-limit-kbps';
export const DEFAULT_BANDWIDTH_LIMIT_KBPS = 0;
export const MAX_BANDWIDTH_LIMIT_KBPS = 102_400;

const normalize = (value: number): number => {
  const rounded = Math.round(value);
  if (rounded <= 0) return 0;
  return Math.min(MAX_BANDWIDTH_LIMIT_KBPS, rounded);
};

export function loadBandwidthLimitKbps(
  storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined'
    ? undefined
    : localStorage,
): number {
  const raw = storage?.getItem(BANDWIDTH_LIMIT_KEY);
  if (raw === null || raw === undefined || raw === '') return DEFAULT_BANDWIDTH_LIMIT_KBPS;
  const value = Number(raw);
  return Number.isInteger(value) ? normalize(value) : DEFAULT_BANDWIDTH_LIMIT_KBPS;
}

export function saveBandwidthLimitKbps(
  value: number,
  storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage === 'undefined'
    ? undefined
    : localStorage,
): number {
  const normalized = normalize(value);
  try {
    storage?.setItem(BANDWIDTH_LIMIT_KEY, String(normalized));
  } catch {
    // A read-only storage area must not block transfer settings.
  }
  return normalized;
}
