import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

import { useLocalFilesStore } from './useLocalFilesStore';

const listing = {
  path: '/home/user',
  parent: '/home',
  entries: [
    {
      name: 'docs',
      path: '/home/user/docs',
      isDir: true,
      isFile: false,
      isSymlink: false,
      size: 0,
      modified: 1,
    },
  ],
};

describe('useLocalFilesStore', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    useLocalFilesStore.setState({
      currentPath: null,
      parent: null,
      entries: [],
      isLoading: false,
      error: null,
    });
  });

  it('loads the default home listing and navigates up', async () => {
    mocks.invoke.mockResolvedValueOnce(listing);
    await useLocalFilesStore.getState().fetchDirectory();
    expect(mocks.invoke).toHaveBeenCalledWith('local_list_dir', { path: null });
    expect(useLocalFilesStore.getState().entries).toHaveLength(1);

    mocks.invoke.mockResolvedValueOnce({ ...listing, path: '/home', parent: '/' });
    await useLocalFilesStore.getState().cdUp();
    expect(mocks.invoke).toHaveBeenLastCalledWith('local_list_dir', { path: '/home' });
    expect(useLocalFilesStore.getState().currentPath).toBe('/home');
  });

  it('surfaces local listing failures', async () => {
    mocks.invoke.mockRejectedValueOnce('permission denied');
    await useLocalFilesStore.getState().fetchDirectory('/root');
    expect(useLocalFilesStore.getState().error).toContain('permission denied');
    expect(useLocalFilesStore.getState().isLoading).toBe(false);
  });
});
