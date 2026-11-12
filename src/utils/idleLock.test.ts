import { describe, expect, it } from 'vitest';
import {
  autoLockDelayMs,
  DEFAULT_AUTO_LOCK_MINUTES,
  loadAutoLockMinutes,
  saveAutoLockMinutes,
  shouldLockAfterIdle,
} from './idleLock';

const storage = (initial: string | null = null) => {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    peek: () => value,
  };
};

describe('idleLock', () => {
  it('loads and saves supported timeout values', () => {
    const target = storage(null);
    expect(loadAutoLockMinutes(target)).toBe(DEFAULT_AUTO_LOCK_MINUTES);
    saveAutoLockMinutes(30, target);
    expect(target.peek()).toBe('30');
    expect(loadAutoLockMinutes(target)).toBe(30);
  });

  it('falls back for invalid or unsupported values', () => {
    expect(loadAutoLockMinutes(storage('999'))).toBe(DEFAULT_AUTO_LOCK_MINUTES);
    expect(loadAutoLockMinutes(storage('abc'))).toBe(DEFAULT_AUTO_LOCK_MINUTES);
    expect(saveAutoLockMinutes(7, storage())).toBe(DEFAULT_AUTO_LOCK_MINUTES);
    expect(saveAutoLockMinutes(0, storage())).toBe(0);
  });

  it('converts minutes to a delay and disables zero', () => {
    expect(autoLockDelayMs(15)).toBe(15 * 60_000);
    expect(autoLockDelayMs(0)).toBeNull();
    expect(autoLockDelayMs(-5)).toBeNull();
  });

  it('detects elapsed idle time', () => {
    expect(shouldLockAfterIdle(1_000, 2_000, 1_000)).toBe(true);
    expect(shouldLockAfterIdle(1_000, 1_999, 1_000)).toBe(false);
  });
});
