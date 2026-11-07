import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SshKeyManager from './SshKeyManager';
import { Provider } from './ui/provider';
import { useSessionStore } from '../store/useSessionStore';
import type { SshKeyMetadata } from '../types/sshKeys';

const key: SshKeyMetadata = {
  id: 'key-1',
  name: 'Deploy key',
  path: '/home/me/.local/share/mobaxtauri/keys/key-1',
  keyType: 'ssh-ed25519',
  fingerprint: 'SHA256:test',
  publicKey: 'ssh-ed25519 AAAA test',
  comment: 'deploy',
  encrypted: false,
  managed: true,
  createdAt: 1_700_000_000,
};

describe('SshKeyManager', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: [],
      openTabs: [],
      activeSessionId: null,
    });
  });

  it('lists keys returned by the backend', async () => {
    const invoke = vi.mocked(
      (window as unknown as { __TAURI_INTERNALS__: { invoke: ReturnType<typeof vi.fn> } })
        .__TAURI_INTERNALS__.invoke,
    );
    invoke.mockResolvedValueOnce([key]);

    render(
      <Provider>
        <SshKeyManager />
      </Provider>,
    );

    await waitFor(() => expect(screen.getByText('Deploy key')).toBeInTheDocument());
    expect(screen.getByText(/SHA256:test/)).toBeInTheDocument();
    expect(invoke.mock.calls[0][0]).toBe('ssh_key_list');
  });
});
