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

  it('mutates local entries and refreshes the listing', async () => {
    mocks.invoke.mockResolvedValueOnce(listing);
    await useLocalFilesStore.getState().fetchDirectory();

    mocks.invoke.mockResolvedValueOnce(undefined);
    mocks.invoke.mockResolvedValueOnce(listing);
    await useLocalFilesStore.getState().createDir('/home/user/new');

    expect(mocks.invoke).toHaveBeenCalledWith('local_create_dir', { path: '/home/user/new' });
    expect(mocks.invoke).toHaveBeenLastCalledWith('local_list_dir', {
      path: '/home/user',
    });

    mocks.invoke.mockResolvedValueOnce({ removed: ['/home/user/docs'], failures: [] });
    mocks.invoke.mockResolvedValueOnce(listing);
    const result = await useLocalFilesStore
      .getState()
      .removeMany([{ path: '/home/user/docs', recursive: true }]);
    expect(result.removed).toEqual(['/home/user/docs']);
    expect(mocks.invoke).toHaveBeenCalledWith('local_remove_many', {
      entries: [{ path: '/home/user/docs', recursive: true }],
    });
  });

  it('surfaces local listing failures', async () => {
    mocks.invoke.mockRejectedValueOnce('permission denied');
    await useLocalFilesStore.getState().fetchDirectory('/root');
    expect(useLocalFilesStore.getState().error).toContain('permission denied');
    expect(useLocalFilesStore.getState().isLoading).toBe(false);
  });
});
