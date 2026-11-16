import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSFER_CONCURRENCY,
  loadTransferConcurrency,
  saveTransferConcurrency,
} from './transferConcurrency';

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

describe('transferConcurrency', () => {
  it('defaults to three and clamps saved values', () => {
    expect(loadTransferConcurrency(storage(null))).toBe(DEFAULT_TRANSFER_CONCURRENCY);
    expect(loadTransferConcurrency(storage('99'))).toBe(4);
    expect(loadTransferConcurrency(storage('0'))).toBe(1);
    expect(loadTransferConcurrency(storage('bad'))).toBe(DEFAULT_TRANSFER_CONCURRENCY);
  });

  it('persists the clamped value', () => {
    const target = storage();
    expect(saveTransferConcurrency(2, target)).toBe(2);
    expect(target.peek()).toBe('2');
  });
});
