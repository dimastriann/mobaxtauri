/**
 * Formats a byte count into a human-readable string with units (B, KB, MB, GB, TB)
 * and locale-aware number formatting (comma/dot separators).
 */
export function formatFileSize(bytes: number | null | undefined, locale?: string): string {
  if (bytes === null || bytes === undefined || isNaN(bytes) || bytes < 0) {
    return '0 B';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  const hasDecimal = size % 1 !== 0;
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: hasDecimal ? 1 : 0,
  });

  return `${formatter.format(size)} ${units[unitIndex]}`;
}
