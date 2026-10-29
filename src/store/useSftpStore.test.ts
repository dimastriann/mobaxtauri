import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSftpStore } from './useSftpStore';

// Mock Tauri's invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock the dialog plugin used by upload/download flows
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
  ask: vi.fn(),
}));

describe('useSftpStore', () => {
  beforeEach(() => {
    useSftpStore.getState().reset();
  });

  it('should initialize with root path', () => {
    const state = useSftpStore.getState();
    expect(state.currentPath).toBe('/');
  });

  it('should update currentPath when cd is called', async () => {
    const { cd } = useSftpStore.getState();

    // We need to mock the search_dir invoke that fetchDirectory calls
    // But for a simple unit test of 'cd' logic:
    await cd('session-1', '/etc/docker');

    const state = useSftpStore.getState();
    expect(state.currentPath).toBe('/etc/docker');
  });

  it("should handle relative navigation with '..'", async () => {
    const { cd } = useSftpStore.getState();

    await cd('session-1', '/etc/docker');
    await cd('session-1', '..');

    const state = useSftpStore.getState();
    expect(state.currentPath).toBe('/etc');
  });

  it("should not go above root with '..'", async () => {
    const { cd } = useSftpStore.getState();

    await cd('session-1', '/');
    await cd('session-1', '..');

    const state = useSftpStore.getState();
    expect(state.currentPath).toBe('/');
  });

  it('should sort directories first and then alphabetically', async () => {
    const { fetchDirectory } = useSftpStore.getState();
    const { invoke } = await import('@tauri-apps/api/core');

    // Mock files in mixed order
    const mockFiles = [
      { name: 'zebra.txt', is_dir: false, is_file: true, size: 100, modified: 0 },
      { name: 'apple.txt', is_dir: false, is_file: true, size: 200, modified: 0 },
      { name: 'docs', is_dir: true, is_file: false, size: 0, modified: 0 },
      { name: 'apps', is_dir: true, is_file: false, size: 0, modified: 0 },
    ];

    vi.mocked(invoke).mockResolvedValueOnce(mockFiles);

    await fetchDirectory('session-1', '/home');

    const state = useSftpStore.getState();
    expect(state.files[0].name).toBe('apps'); // Dir 1
    expect(state.files[1].name).toBe('docs'); // Dir 2
    expect(state.files[2].name).toBe('apple.txt'); // File 1
    expect(state.files[3].name).toBe('zebra.txt'); // File 2
  });

  it('should set error state when fetch fails', async () => {
    const { fetchDirectory } = useSftpStore.getState();
    const { invoke } = await import('@tauri-apps/api/core');

    vi.mocked(invoke).mockRejectedValueOnce(new Error('Connection lost'));

    await fetchDirectory('session-1', '/home');

    const state = useSftpStore.getState();
    expect(state.error).toContain('Connection lost');
    expect(state.isLoading).toBe(false);
  });

  it('tracks progress and delegates cancellation to Rust', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    useSftpStore.getState().updateTransfer({
      transferId: 'transfer-1',
      sessionId: 'session-1',
      status: 'running',
      transferred: 64,
      total: 128,
      message: null,
    });

    expect(useSftpStore.getState().transfer?.transferred).toBe(64);
    await useSftpStore.getState().cancelTransfer();

    expect(invoke).toHaveBeenCalledWith('sftp_cancel_transfer', {
      transferId: 'transfer-1',
    });
  });

  it('clears progress when a transfer completes', () => {
    useSftpStore.getState().updateTransfer({
      transferId: 'transfer-1',
      sessionId: 'session-1',
      status: 'completed',
      transferred: 128,
      total: 128,
      message: null,
    });

    expect(useSftpStore.getState().transfer).toBeNull();
    expect(useSftpStore.getState().isLoading).toBe(false);
  });

  it('uploads a picked folder into the current remote path', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { open } = await import('@tauri-apps/plugin-dialog');
    vi.mocked(invoke).mockReset();
    // call order: list_dir (cd), upload, list_dir (refresh after upload)
    vi.mocked(invoke).mockResolvedValueOnce([]);
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    vi.mocked(invoke).mockResolvedValueOnce([]);
    vi.mocked(open).mockResolvedValue('C:\\work\\release');

    await useSftpStore.getState().cd('session-1', '/srv');
    await useSftpStore.getState().uploadFolder('session-1');

    expect(invoke).toHaveBeenCalledWith('sftp_upload_folder', {
      sessionId: 'session-1',
      localPath: 'C:\\work\\release',
      remotePath: '/srv/release',
      transferId: expect.stringMatching(/^folder-upload-\d+$/),
    });
    expect(useSftpStore.getState().conflictPrompt).toBeNull();
    expect(useSftpStore.getState().isLoading).toBe(false);
  });

  it('opens the folder-upload conflict dialog when the target exists', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { open } = await import('@tauri-apps/plugin-dialog');
    vi.mocked(invoke).mockReset();
    // call order: list_dir (cd), upload rejected as existing target
    vi.mocked(invoke).mockResolvedValueOnce([]);
    vi.mocked(invoke).mockRejectedValueOnce('SFTP TARGET EXISTS: /srv/release');
    vi.mocked(open).mockResolvedValue('C:\\work\\release');

    await useSftpStore.getState().cd('session-1', '/srv');
    await useSftpStore.getState().uploadFolder('session-1');

    const prompt = useSftpStore.getState().conflictPrompt;
    expect(prompt).toMatchObject({
      kind: 'folder-upload',
      sessionId: 'session-1',
      localPath: 'C:\\work\\release',
      destPath: '/srv/release',
      destName: 'release',
    });
    expect(useSftpStore.getState().isLoading).toBe(false);
  });

  it('resolves a folder-upload conflict through sftp_upload_folder with the policy', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);

    useSftpStore.setState({
      conflictPrompt: {
        kind: 'folder-upload',
        sessionId: 'session-1',
        localPath: 'C:\\work\\release',
        destPath: '/srv/release',
        destName: 'release',
      },
    });

    await useSftpStore.getState().resolveConflict('rename');

    expect(invoke).toHaveBeenCalledWith(
      'sftp_upload_folder',
      expect.objectContaining({ conflictPolicy: 'rename', remotePath: '/srv/release' }),
    );
    expect(useSftpStore.getState().conflictPrompt).toBeNull();
  });

  it('dispatches dropped files and folders to the matching upload commands', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockReset();
    // call order: classify, list_dir (after each successful upload), upload x3
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'sftp_local_entries') {
        return [
          { path: 'C:\\work\\notes.txt', name: 'notes.txt', isDir: false },
          { path: 'C:\\work\\release', name: 'release', isDir: true },
          { path: 'C:\\work\\img.png', name: 'img.png', isDir: false },
        ];
      }
      return [];
    });

    await useSftpStore.getState().cd('session-1', '/srv');
    await useSftpStore
      .getState()
      .uploadPaths('session-1', ['C:\\work\\notes.txt', 'C:\\work\\release', 'C:\\work\\img.png']);

    const uploads = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd !== 'sftp_list_dir');
    expect(uploads.map(([cmd]) => cmd)).toEqual([
      'sftp_local_entries',
      'sftp_upload_file',
      'sftp_upload_folder',
      'sftp_upload_file',
    ]);
    expect(uploads[1][1]).toMatchObject({
      localPath: 'C:\\work\\notes.txt',
      remotePath: '/srv/notes.txt',
    });
    expect(uploads[2][1]).toMatchObject({
      localPath: 'C:\\work\\release',
      remotePath: '/srv/release',
    });
    expect(useSftpStore.getState().error).toBeNull();
  });

  it('stops dispatching dropped entries while a conflict dialog is open', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockReset();
    let firstUpload = true;
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'sftp_local_entries') {
        return [
          { path: 'C:\\work\\a.txt', name: 'a.txt', isDir: false },
          { path: 'C:\\work\\b.txt', name: 'b.txt', isDir: false },
        ];
      }
      if (cmd === 'sftp_upload_file' && firstUpload) {
        firstUpload = false;
        throw 'SFTP TARGET EXISTS: /srv/a.txt';
      }
      return [];
    });

    await useSftpStore.getState().cd('session-1', '/srv');
    await useSftpStore.getState().uploadPaths('session-1', ['C:\\work\\a.txt', 'C:\\work\\b.txt']);

    const uploadCalls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'sftp_upload_file');
    expect(uploadCalls).toHaveLength(1);
    expect(useSftpStore.getState().conflictPrompt).toMatchObject({
      kind: 'upload',
      destName: 'a.txt',
    });
  });
});
