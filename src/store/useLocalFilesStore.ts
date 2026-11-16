import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { LocalFileEntry, LocalListing } from '../types/localFiles';

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
}));
