// Bounds for the pending terminal-output queue shared by the SSH data
// listener. When the renderer falls behind sustained output (a multi-MB
// `cat`, `less`, or `tail -f` burst), an unbounded array grows until GC
// freedom freezes the tab. Terminal scrollback already discards old rows,
// so dropping the oldest queued bytes matches terminal semantics.

export const PENDING_OUTPUT_MAX_CHARS = 4 * 1024 * 1024;

export const OUTPUT_DROPPED_MARKER =
  '\r\n\x1b[90m… earlier output dropped while the terminal was busy rendering …\x1b[0m\r\n';

interface BoundedQueue {
  items: string[];
  totalChars: number;
  dropped: boolean;
}

/**
 * Appends `incoming` to the pending queue while keeping it within
 * `maxChars`. Returns the new queue contents, the running size, and
 * whether anything had to be dropped. Pure: the caller owns the state.
 *
 * Rules:
 * - A single chunk larger than half the budget keeps only its tail
 *   (prefix trims would cut an arbitrary ANSI escape mid-sequence).
 * - Queued data is dropped from the front, and a one-line marker is
 *   inserted where the drop happened so the screen explains itself.
 */
export function appendPendingOutput(
  items: string[],
  totalChars: number,
  incoming: string,
  maxChars: number = PENDING_OUTPUT_MAX_CHARS,
): BoundedQueue {
  const result: string[] = items;
  let size = totalChars;
  let dropped = false;

  // A chunk bigger than half the budget is trimmed to its tail: trimming
  // the head could cut an arbitrary ANSI escape mid-sequence, and hanging
  // screen content at the front is exactly what scroll classification
  // would lose anyway. The marker rides along inline.
  if (incoming.length > maxChars / 2) {
    incoming = OUTPUT_DROPPED_MARKER + incoming.slice(-maxChars / 2);
    dropped = true;
  }

  // Older queued data leaves one at a time; the notice is inserted where
  // the first drop happened.
  while (size + incoming.length > maxChars) {
    const removed = result.shift();
    if (removed === undefined) break;
    size -= removed.length;
    if (!dropped) {
      dropped = true;
      result.unshift(OUTPUT_DROPPED_MARKER);
      size += OUTPUT_DROPPED_MARKER.length;
    }
  }

  result.push(incoming);
  size += incoming.length;
  return { items: result, totalChars: size, dropped };
}
