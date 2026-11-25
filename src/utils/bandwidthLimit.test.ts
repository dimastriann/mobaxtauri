import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BANDWIDTH_LIMIT_KBPS,
  loadBandwidthLimitKbps,
  saveBandwidthLimitKbps,
} from './bandwidthLimit';

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

describe('bandwidthLimit', () => {
  it('defaults to unlimited and clamps saved values', () => {
    expect(loadBandwidthLimitKbps(storage(null))).toBe(DEFAULT_BANDWIDTH_LIMIT_KBPS);
    expect(loadBandwidthLimitKbps(storage('999999999'))).toBe(102_400);
    expect(loadBandwidthLimitKbps(storage('bad'))).toBe(DEFAULT_BANDWIDTH_LIMIT_KBPS);
  });

  it('persists normalized values', () => {
    const target = storage();
    expect(saveBandwidthLimitKbps(0, target)).toBe(0);
    expect(saveBandwidthLimitKbps(512, target)).toBe(512);
    expect(target.peek()).toBe('512');
  });
});
