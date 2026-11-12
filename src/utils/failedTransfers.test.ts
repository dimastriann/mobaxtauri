import { describe, expect, it } from 'vitest';
import {
  loadFailedTransfers,
  saveFailedTransfers,
  type PersistedFailedTransfer,
} from './failedTransfers';
import type { SftpTransferEvent } from '../types/sftp';

const failedEvent: SftpTransferEvent = {
  transferId: 'download-1',
  sessionId: 'session-1',
  kind: 'download',
  label: 'report.bin',
  status: 'failed',
  transferred: 512,
  total: 1024,
  percent: 50,
  resumed: true,
  bytesPerSec: null,
  etaSeconds: null,
  message: 'network down',
};

const entry: PersistedFailedTransfer = {
  request: {
    kind: 'download',
    sessionId: 'session-1',
    sourcePath: '/srv/report.bin',
    destPath: 'C:\\downloads\\report.bin',
  },
  event: failedEvent,
};

const readable = (value: string | null) => ({
  getItem: () => value,
});

describe('failedTransfers', () => {
  it('round-trips failed transfer requests and events', () => {
    let stored: string | null = null;
    const storage = {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    };

    saveFailedTransfers([entry], storage);
    expect(stored).toContain('version');
    expect(loadFailedTransfers(storage)).toEqual([entry]);
  });

  it('drops malformed entries, non-failed events, and duplicates', () => {
    const duplicate = {
      ...entry,
      event: { ...failedEvent, status: 'completed' },
    };
    const stored = JSON.stringify({
      version: 1,
      entries: [
        entry,
        entry,
        duplicate,
        { request: entry.request, event: { ...failedEvent, status: 'cancelled' } },
        { request: null, event: failedEvent },
      ],
    });

    expect(loadFailedTransfers(readable(stored))).toEqual([entry]);
  });

  it('ignores corrupt or unavailable storage', () => {
    expect(loadFailedTransfers(readable('{not json'))).toEqual([]);
    expect(loadFailedTransfers(readable(null))).toEqual([]);
    expect(
      loadFailedTransfers({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toEqual([]);
    expect(() =>
      saveFailedTransfers([entry], {
        setItem: () => {
          throw new Error('quota');
        },
      }),
    ).not.toThrow();
  });
});
