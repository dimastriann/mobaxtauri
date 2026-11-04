import { describe, expect, it } from 'vitest';
import { formatEta, formatTransferSpeed } from './transferMetrics';

describe('transfer metrics', () => {
  it('formats transfer speed', () => {
    expect(formatTransferSpeed(1024)).toBe('1 KB/s');
    expect(formatTransferSpeed(null)).toBeNull();
    expect(formatTransferSpeed(0)).toBeNull();
    expect(formatTransferSpeed(Number.NaN)).toBeNull();
  });

  it('formats eta values', () => {
    expect(formatEta(12)).toBe('12s');
    expect(formatEta(75)).toBe('1m 15s');
    expect(formatEta(120)).toBe('2m');
    expect(formatEta(3720)).toBe('1h 2m');
    expect(formatEta(null)).toBeNull();
    expect(formatEta(-1)).toBeNull();
  });
});
