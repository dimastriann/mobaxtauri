import { describe, expect, it } from 'vitest';
import { connectedBroadcastTargets } from './broadcastInput';

const sessions = [
  { id: 'a', type: 'ssh' as const, status: 'connected' },
  { id: 'b', type: 'ssh' as const, status: 'connected' },
  { id: 'c', type: 'ssh' as const, status: 'disconnected' },
  { id: 'local', type: 'local' as const, status: 'connected' },
];

describe('connectedBroadcastTargets', () => {
  it('returns visible connected SSH panes except the source', () => {
    expect(connectedBroadcastTargets(['a', 'b', 'c', 'local'], 'a', sessions)).toEqual(['b']);
  });

  it('ignores hidden panes, duplicates, and unknown sessions', () => {
    expect(connectedBroadcastTargets(['b', 'b', 'missing'], 'a', sessions)).toEqual(['b']);
    expect(connectedBroadcastTargets([], 'a', sessions)).toEqual([]);
  });
});
