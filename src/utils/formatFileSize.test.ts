import { describe, it, expect } from 'vitest';
import { formatFileSize } from './formatFileSize';

describe('formatFileSize', () => {
  it('handles zero and invalid values', () => {
    expect(formatFileSize(0, 'en-US')).toBe('0 B');
    expect(formatFileSize(null, 'en-US')).toBe('0 B');
    expect(formatFileSize(undefined, 'en-US')).toBe('0 B');
    expect(formatFileSize(-100, 'en-US')).toBe('0 B');
  });

  it('formats bytes under 1 KB', () => {
    expect(formatFileSize(512, 'en-US')).toBe('512 B');
    expect(formatFileSize(1023, 'en-US')).toBe('1023 B');
  });

  it('formats KB with decimal and thousand separators', () => {
    expect(formatFileSize(1024, 'en-US')).toBe('1 KB');
    expect(formatFileSize(1536, 'en-US')).toBe('1.5 KB');
    expect(formatFileSize(100 * 1024, 'en-US')).toBe('100 KB');
    expect(formatFileSize(1000 * 1024, 'en-US')).toBe('1,000 KB');
  });

  it('formats MB', () => {
    expect(formatFileSize(1024 * 1024, 'en-US')).toBe('1 MB');
    expect(formatFileSize(2.5 * 1024 * 1024, 'en-US')).toBe('2.5 MB');
  });

  it('formats GB and TB', () => {
    expect(formatFileSize(1024 * 1024 * 1024, 'en-US')).toBe('1 GB');
    expect(formatFileSize(1024 * 1024 * 1024 * 1024, 'en-US')).toBe('1 TB');
  });
});
