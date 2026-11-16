import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { LocalFileEntry, LocalListing, LocalRemoveManyResult } from '../types/localFiles';

interface LocalFilesState {
  currentPath: string | null;
  parent: string | null;
  entries: LocalFileEntry[];
  isLoading: boolean;
  error: string | null;

  fetchDirectory: (path?: string | null) => Promise<void>;
  cd: (path: string) => Promise<void>;
  cdUp: () => Promise<void>;
  refresh: () => Promise<void>;
  createDir: (path: string) => Promise<void>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  removeMany: (entries: { path: string; recursive: boolean }[]) => Promise<LocalRemoveManyResult>;
}

export const useLocalFilesStore = create<LocalFilesState>((set, get) => ({
  currentPath: null,
  parent: null,
  entries: [],
  isLoading: false,
  error: null,

  fetchDirectory: async (path) => {
    set({ isLoading: true, error: null });
    try {
      const listing = await invoke<LocalListing>('local_list_dir', {
        path: path ?? null,
      });
      set({
        currentPath: listing.path,
        parent: listing.parent,
        entries: listing.entries,
        isLoading: false,
      });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  cd: async (path) => {
    await get().fetchDirectory(path);
  },

  cdUp: async () => {
    const parent = get().parent;
    if (parent) await get().fetchDirectory(parent);
  },

  refresh: async () => {
    await get().fetchDirectory(get().currentPath);
  },

  createDir: async (path) => {
    try {
      await invoke('local_create_dir', { path });
      await get().refresh();
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  rename: async (oldPath, newPath) => {
    try {
      await invoke('local_rename', { oldPath, newPath });
      await get().refresh();
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  removeMany: async (entries) => {
    try {
      const result = await invoke<LocalRemoveManyResult>('local_remove_many', {
        entries,
      });
      await get().refresh();
      return result;
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },
}));
