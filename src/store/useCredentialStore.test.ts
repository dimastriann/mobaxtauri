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
      requiresMasterPassword: false,
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
    expect(mocks.invoke).toHaveBeenCalledWith('credential_unlock', { masterPassword: null });
    expect(useCredentialStore.getState().isUnlocked).toBe(true);
  });

  it('delegates credential writes to Rust after unlocking', async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await useCredentialStore.getState().saveCredential('ssh-test', 'secret');

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'credential_unlock', { masterPassword: null });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'credential_save', {
      sessionId: 'ssh-test',
      secret: 'secret',
    });
  });

  it('flags a master-password requirement and retries with the password', async () => {
    mocks.invoke.mockRejectedValueOnce('VAULT MASTER PASSWORD REQUIRED');

    await expect(useCredentialStore.getState().unlock()).resolves.toBe(false);
    expect(useCredentialStore.getState().requiresMasterPassword).toBe(true);

    mocks.invoke.mockResolvedValueOnce(undefined);
    await expect(useCredentialStore.getState().unlock('hunter2')).resolves.toBe(true);
    expect(mocks.invoke).toHaveBeenLastCalledWith('credential_unlock', {
      masterPassword: 'hunter2',
    });
    expect(useCredentialStore.getState().requiresMasterPassword).toBe(false);
    expect(useCredentialStore.getState().isUnlocked).toBe(true);
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
