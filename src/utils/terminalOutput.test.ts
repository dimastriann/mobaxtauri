import { describe, expect, it } from 'vitest';
import {
  appendPendingOutput,
  OUTPUT_DROPPED_MARKER,
  PENDING_OUTPUT_MAX_CHARS,
} from './terminalOutput';

describe('appendPendingOutput', () => {
  it('keeps small bursts intact', () => {
    const { items, totalChars, dropped } = appendPendingOutput([], 0, 'hello\r\n');
    expect(items).toEqual(['hello\r\n']);
    expect(totalChars).toBe(7);
    expect(dropped).toBe(false);
  });

  it('accumulates under the cap without dropping', () => {
    let queue = { items: [] as string[], totalChars: 0, dropped: false };
    for (let i = 0; i < 100; i += 1) {
      queue = appendPendingOutput(queue.items, queue.totalChars, 'x'.repeat(1000));
    }
    expect(queue.items).toHaveLength(100);
    expect(queue.totalChars).toBe(100_000);
    expect(queue.dropped).toBe(false);
  });

  it('drops the oldest entries first once the cap is exceeded', () => {
    const chunk = 'a'.repeat(600_000);
    const { items, totalChars, dropped } = appendPendingOutput(
      [chunk, chunk, chunk],
      1_800_000,
      chunk,
    );
    // 2.4MB over a 4MB cap: nothing dropped yet
    expect(dropped).toBe(false);
    expect(items).toHaveLength(4);
    expect(totalChars).toBe(2_400_000);
  });

  it('marks the queue with a drop notice at overflow', () => {
    const chunk = 'b'.repeat(1_400_000);
    const first = appendPendingOutput([], 0, chunk);
    const second = appendPendingOutput(first.items, first.totalChars, chunk);
    const third = appendPendingOutput(second.items, second.totalChars, chunk);
    expect(third.dropped).toBe(true);
    expect(third.totalChars).toBeLessThanOrEqual(PENDING_OUTPUT_MAX_CHARS);
    expect(third.items[0]).toBe(OUTPUT_DROPPED_MARKER);
    // Every chunk still present in full
    expect(third.items.filter((item) => item === chunk)).toHaveLength(2);
  });

  it('trims a single oversized chunk to its tail', () => {
    const giant = 'c'.repeat(PENDING_OUTPUT_MAX_CHARS);
    const { items, totalChars, dropped } = appendPendingOutput([], 0, giant, 1000);
    expect(dropped).toBe(true);
    expect(items).toHaveLength(1);
    // Only the tail survived, plus the leading marker.
    expect(items[0]).toContain(OUTPUT_DROPPED_MARKER);
    expect(items[0].length).toBeLessThanOrEqual(1000);
    expect(totalChars).toBe(items[0].length);
  });
});
