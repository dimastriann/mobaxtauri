import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTO_RECONNECT_KEY,
  AUTO_RECONNECT_MAX_DELAY_KEY,
  DEFAULT_RECONNECT_SETTINGS,
  loadReconnectSettings,
  reconnectDelayMs,
  saveReconnectSettings,
} from './reconnectPolicy';

describe('reconnect policy', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses enabled/30s by default', () => {
    expect(loadReconnectSettings()).toEqual(DEFAULT_RECONNECT_SETTINGS);
  });

  it('loads and clamps stored settings', () => {
    localStorage.setItem(AUTO_RECONNECT_KEY, 'false');
    localStorage.setItem(AUTO_RECONNECT_MAX_DELAY_KEY, '60');
    expect(loadReconnectSettings()).toEqual({ enabled: false, maxDelaySecs: 60 });

    localStorage.setItem(AUTO_RECONNECT_MAX_DELAY_KEY, '999');
    expect(loadReconnectSettings().maxDelaySecs).toBe(30);
  });

  it('persists settings', () => {
    saveReconnectSettings({ enabled: false, maxDelaySecs: 15 });
    expect(localStorage.getItem(AUTO_RECONNECT_KEY)).toBe('false');
    expect(localStorage.getItem(AUTO_RECONNECT_MAX_DELAY_KEY)).toBe('15');
  });

  it('backs off exponentially up to the cap', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((attempt) => reconnectDelayMs(attempt, 30))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });
});
