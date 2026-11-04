import { formatFileSize } from './formatFileSize';

/** `1024` -> `1 KB/s`; null when the rate is unknown or not useful yet. */
export const formatTransferSpeed = (bytesPerSec: number | null | undefined): string | null => {
  if (bytesPerSec === null || bytesPerSec === undefined) return null;
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return null;
  return `${formatFileSize(bytesPerSec)}/s`;
};

/** `75` -> `1m 15s`, `12` -> `12s`; null when the ETA is unknown. */
export const formatEta = (seconds: number | null | undefined): string | null => {
  if (seconds === null || seconds === undefined || seconds < 0) return null;
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.ceil(seconds % 60);
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
};
