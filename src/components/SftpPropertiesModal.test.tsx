import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SftpPropertiesModal from './SftpPropertiesModal';
import { Provider } from './ui/provider';
import type { SftpFile } from '../store/useSftpStore';

const file: SftpFile = {
  name: 'deploy.sh',
  is_dir: false,
  is_file: true,
  size: 2048,
  modified: 1_700_000_000,
  uid: 1000,
  gid: 1000,
  permissions: '-rw-r--r--',
  mode: 0o100644,
};

const renderModal = (onClose = vi.fn(), onSaved = vi.fn()) =>
  render(
    <Provider>
      <SftpPropertiesModal
        isOpen
        onClose={onClose}
        sessionId="ssh-test"
        filePath="/srv/deploy.sh"
        file={file}
        onSaved={onSaved}
      />
    </Provider>,
  );

describe('SftpPropertiesModal', () => {
  it('shows the current metadata and permission checkboxes', () => {
    renderModal();

    expect(screen.getByText('deploy.sh')).toBeInTheDocument();
    expect(screen.getByText('/srv/deploy.sh')).toBeInTheDocument();
    expect(screen.getByText('-rw-r--r--')).toBeInTheDocument();
    expect(screen.getByLabelText('Octal')).toHaveValue('644');
    expect(screen.getAllByRole('checkbox')).toHaveLength(9);
  });

  it('saves the edited octal mode', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const invoke = vi.mocked(
      (window as unknown as { __TAURI_INTERNALS__: { invoke: ReturnType<typeof vi.fn> } })
        .__TAURI_INTERNALS__.invoke,
    );
    renderModal(onClose, onSaved);

    const octal = screen.getByLabelText('Octal');
    fireEvent.change(octal, { target: { value: '640' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Permissions' }));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke.mock.calls[0][0]).toBe('sftp_set_permissions');
    expect(invoke.mock.calls[0][1]).toEqual({
      sessionId: 'ssh-test',
      path: '/srv/deploy.sh',
      mode: 0o640,
    });
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('rejects an invalid octal value', () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Octal'), { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Permissions' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Use an octal value between 0000 and 7777.',
    );
  });
});
