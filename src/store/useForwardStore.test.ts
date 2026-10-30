import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useForwardStore } from './useForwardStore';
import type { PortForward } from '../types/portForward';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const sampleForward: PortForward = {
  id: 'fwd-1',
  sessionId: 'session-1',
  kind: 'local',
  bindHost: '127.0.0.1',
  bindPort: 8080,
  targetHost: '10.0.0.5',
  targetPort: 80,
};

describe('useForwardStore', () => {
  beforeEach(() => {
    useForwardStore.getState().reset();
    vi.clearAllMocks();
  });

  it('adds a local forward and refreshes the list', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'ssh_forward_add_local') return sampleForward;
      if (command === 'ssh_forward_list') return [sampleForward];
      return undefined;
    });

    await useForwardStore.getState().addLocal('session-1', '10.0.0.5', 80, 8080);

    expect(invoke).toHaveBeenCalledWith('ssh_forward_add_local', {
      sessionId: 'session-1',
      bindHost: '127.0.0.1',
      bindPort: 8080,
      targetHost: '10.0.0.5',
      targetPort: 80,
    });
    expect(useForwardStore.getState().forwards).toHaveLength(1);
    expect(useForwardStore.getState().forwards[0].id).toBe('fwd-1');
    expect(useForwardStore.getState().isLoading).toBe(false);
    expect(useForwardStore.getState().error).toBeNull();
  });

  it('adds a dynamic forward through the socks5 command', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'ssh_forward_add_dynamic') return { ...sampleForward, kind: 'dynamic' };
      if (command === 'ssh_forward_list') return [{ ...sampleForward, kind: 'dynamic' }];
      return undefined;
    });

    await useForwardStore.getState().addDynamic('session-1', 0);

    expect(invoke).toHaveBeenCalledWith('ssh_forward_add_dynamic', {
      sessionId: 'session-1',
      bindHost: '127.0.0.1',
      bindPort: 0,
    });
    expect(useForwardStore.getState().forwards[0].kind).toBe('dynamic');
  });

  it('adds a remote forward through the remote command', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'ssh_forward_add_remote') return { ...sampleForward, kind: 'remote' };
      if (command === 'ssh_forward_list') return [{ ...sampleForward, kind: 'remote' }];
      return undefined;
    });

    await useForwardStore.getState().addRemote('session-1', '127.0.0.1', 22022, '127.0.0.1', 5432);

    expect(invoke).toHaveBeenCalledWith('ssh_forward_add_remote', {
      sessionId: 'session-1',
      remoteHost: '127.0.0.1',
      remotePort: 22022,
      targetHost: '127.0.0.1',
      targetPort: 5432,
    });
    expect(useForwardStore.getState().forwards[0].kind).toBe('remote');
  });

  it('surfaces backend errors and stops loading', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockRejectedValueOnce('Failed to bind 127.0.0.1:80: access denied');

    await useForwardStore.getState().addLocal('session-1', '10.0.0.5', 80, 80);

    expect(useForwardStore.getState().error).toContain('Failed to bind');
    expect(useForwardStore.getState().isLoading).toBe(false);
    expect(useForwardStore.getState().forwards).toHaveLength(0);
  });

  it('removes a forward and refreshes the list', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'ssh_forward_remove') return undefined;
      if (command === 'ssh_forward_list') return [];
      return undefined;
    });
    useForwardStore.setState({ forwards: [sampleForward] });

    await useForwardStore.getState().removeForward('fwd-1');

    expect(invoke).toHaveBeenCalledWith('ssh_forward_remove', { forwardId: 'fwd-1' });
    expect(useForwardStore.getState().forwards).toHaveLength(0);
  });
});
