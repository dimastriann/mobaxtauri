import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface SftpFile {
  name: string;
  is_dir: boolean;
  is_file: boolean;
  size: number;
  modified: number;
}

interface SftpState {
  currentPath: string;
  files: SftpFile[];
  isLoading: boolean;
  error: string | null;
  history: string[]; // For going back

  fetchDirectory: (sessionId: string, path?: string) => Promise<void>;
  cd: (sessionId: string, subPath: string) => Promise<void>;
  cdUp: (sessionId: string) => Promise<void>;
  refresh: (sessionId: string) => Promise<void>;
  reset: () => void;
}

export const useSftpStore = create<SftpState>((set, get) => ({
  currentPath: '.',
  files: [],
  isLoading: false,
  error: null,
  history: [],

  fetchDirectory: async (sessionId, path) => {
    const targetPath = path !== undefined ? path : get().currentPath;
    set({ isLoading: true, error: null });
    try {
      const files = await invoke<SftpFile[]>('sftp_list_dir', {
        sessionId,
        path: targetPath,
      });
      
      // Sort: Directories first, then alphabetically
      const sortedFiles = files.sort((a, b) => {
        if (a.is_dir === b.is_dir) {
          return a.name.localeCompare(b.name);
        }
        return a.is_dir ? -1 : 1;
      });

      set({ 
        files: sortedFiles, 
        currentPath: targetPath, 
        isLoading: false 
      });
    } catch (err) {
      console.error('SFTP fetch error:', err);
      set({ error: String(err), isLoading: false });
    }
  },

  cd: async (sessionId, subPath) => {
    const state = get();
    let newPath = '';
    
    if (subPath === '..') {
        const parts = state.currentPath.split('/').filter(p => p !== '');
        if (parts.length > 0) {
            parts.pop();
            newPath = parts.length === 0 ? '/' : '/' + parts.join('/');
        } else {
            newPath = '/';
        }
    } else if (subPath.startsWith('/')) {
        newPath = subPath; // absolute
    } else {
        // relative
        const base = state.currentPath.endsWith('/') ? state.currentPath : state.currentPath + '/';
        newPath = base + subPath;
    }

    await get().fetchDirectory(sessionId, newPath);
  },

  cdUp: async (sessionId) => {
    await get().cd(sessionId, '..');
  },

  refresh: async (sessionId) => {
    await get().fetchDirectory(sessionId);
  },

  reset: () => {
    set({ currentPath: '.', files: [], error: null, isLoading: false, history: [] });
  }
}));
