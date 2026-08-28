import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

import { useCredentialStore } from './useCredentialStore';

describe('useCredentialStore', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    useCredentialStore.setState({
      isUnlocked: false,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => vi.useRealTimers());

  it('shares one backend unlock across concurrent callers', async () => {
    mocks.invoke.mockResolvedValue(undefined);

    const [first, second] = await Promise.all([
      useCredentialStore.getState().unlock(),
      useCredentialStore.getState().unlock(),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith('credential_unlock');
    expect(useCredentialStore.getState().isUnlocked).toBe(true);
  });

  it('delegates credential writes to Rust after unlocking', async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await useCredentialStore.getState().saveCredential('ssh-test', 'secret');

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'credential_unlock');
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'credential_save', {
      sessionId: 'ssh-test',
      secret: 'secret',
    });
  });

  it('returns control when the backend does not resolve', async () => {
    vi.useFakeTimers();
    mocks.invoke.mockReturnValue(new Promise(() => {}));

    const result = useCredentialStore.getState().unlock();
    await vi.advanceTimersByTimeAsync(120000);

    await expect(result).resolves.toBe(false);
    expect(useCredentialStore.getState().isLoading).toBe(false);
    expect(useCredentialStore.getState().error).toMatch(/too long/i);
  });
});
