import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-stronghold', () => ({
  Stronghold: { load: mocks.load },
}));
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('C:/app-data'),
  join: vi.fn().mockResolvedValue('C:/app-data/mobaxtauri-v2.hold'),
}));

import { useCredentialStore } from './useCredentialStore';

const fakeStronghold = () => ({
  loadClient: vi.fn().mockResolvedValue({ getStore: () => ({}) }),
  createClient: vi.fn().mockResolvedValue({ getStore: () => ({}) }),
});

describe('useCredentialStore unlock', () => {
  beforeEach(() => {
    mocks.load.mockReset();
    useCredentialStore.setState({
      stronghold: null,
      store: null,
      isUnlocked: false,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => vi.useRealTimers());

  it('shares one Stronghold load across concurrent callers', async () => {
    mocks.load.mockResolvedValue(fakeStronghold());

    const [first, second] = await Promise.all([
      useCredentialStore.getState().unlock(),
      useCredentialStore.getState().unlock(),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(useCredentialStore.getState().isUnlocked).toBe(true);
  });

  it('returns control when Stronghold does not resolve', async () => {
    vi.useFakeTimers();
    mocks.load.mockReturnValue(new Promise(() => {}));

    const result = useCredentialStore.getState().unlock();
    await vi.advanceTimersByTimeAsync(30000);

    await expect(result).resolves.toBe(false);
    expect(useCredentialStore.getState().isLoading).toBe(false);
    expect(useCredentialStore.getState().error).toMatch(/too long/i);
  });
});
