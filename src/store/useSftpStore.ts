import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';

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
  downloadFile: (sessionId: string, fileName: string) => Promise<void>;
  uploadFile: (sessionId: string) => Promise<void>;
  copyFile: (sessionId: string, sourceName: string, destName: string) => Promise<void>;
  openFile: (sessionId: string, fileName: string) => Promise<void>;
  renameFile: (sessionId: string, oldName: string, newName: string) => Promise<void>;
  deleteFile: (sessionId: string, name: string, isDir: boolean) => Promise<void>;
}

export const useSftpStore = create<SftpState>((set, get) => ({
  currentPath: '/',
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
      }) || [];
      
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
    set({ currentPath: '/', files: [], error: null, isLoading: false, history: [] });
  },

  downloadFile: async (sessionId, fileName) => {
    const state = get();
    const sourcePath = state.currentPath.endsWith('/') ? `${state.currentPath}${fileName}` : `${state.currentPath}/${fileName}`;
    try {
      const localPath = await save({ defaultPath: fileName });
      if (!localPath) return; 
      
      set({ isLoading: true, error: null });
      await invoke('sftp_download_file', {
        sessionId,
        remotePath: sourcePath,
        localPath
      });
      set({ isLoading: false });
    } catch (err) {
      console.error(err);
      set({ error: String(err), isLoading: false });
    }
  },

  uploadFile: async (sessionId) => {
    const state = get();
    try {
      const localPath = await open({ multiple: false, directory: false });
      if (!localPath || Array.isArray(localPath)) return;
      
      const pathStr = localPath as string;
      const fileName = pathStr.split(/[/\\]/).pop();
      if (!fileName) return;

      const destPath = state.currentPath.endsWith('/') ? `${state.currentPath}${fileName}` : `${state.currentPath}/${fileName}`;
      
      set({ isLoading: true, error: null });
      await invoke('sftp_upload_file', {
        sessionId,
        localPath: pathStr,
        remotePath: destPath
      });
      await get().fetchDirectory(sessionId);
    } catch (err) {
      console.error(err);
      set({ error: String(err), isLoading: false });
    }
  },

  copyFile: async (sessionId, sourceName, destName) => {
    const state = get();
    const sourcePath = state.currentPath.endsWith('/') ? `${state.currentPath}${sourceName}` : `${state.currentPath}/${sourceName}`;
    const destPath = state.currentPath.endsWith('/') ? `${state.currentPath}${destName}` : `${state.currentPath}/${destName}`;
    
    try {
      set({ isLoading: true, error: null });
      await invoke('sftp_copy_file', {
        sessionId,
        sourcePath,
        destPath
      });
      await get().fetchDirectory(sessionId);
    } catch (err) {
      console.error(err);
      set({ error: String(err), isLoading: false });
    }
  },

  openFile: async (sessionId, fileName) => {
    const state = get();
    const sourcePath = state.currentPath.endsWith('/') ? `${state.currentPath}${fileName}` : `${state.currentPath}/${fileName}`;
    try {
      set({ isLoading: true, error: null });
      await invoke('sftp_open_file', {
        sessionId,
        remotePath: sourcePath
      });
      set({ isLoading: false });
    } catch (err) {
      console.error(err);
      set({ error: String(err), isLoading: false });
    }
  },

  renameFile: async (sessionId, oldName, newName) => {
    const state = get();
    const oldPath = state.currentPath.endsWith('/') ? `${state.currentPath}${oldName}` : `${state.currentPath}/${oldName}`;
    const newPath = state.currentPath.endsWith('/') ? `${state.currentPath}${newName}` : `${state.currentPath}/${newName}`;

    try {
      set({ isLoading: true, error: null });
      await invoke('sftp_rename', {
        sessionId,
        oldPath,
        newPath
      });
      await get().fetchDirectory(sessionId);
    } catch (err) {
      console.error(err);
      set({ error: String(err), isLoading: false });
    }
  },

  deleteFile: async (sessionId, name, isDir) => {
    const state = get();
    const path = state.currentPath.endsWith('/') ? `${state.currentPath}${name}` : `${state.currentPath}/${name}`;

    try {
      set({ isLoading: true, error: null });
      await invoke('sftp_remove', {
        sessionId,
        path,
        isDir
      });
      await get().fetchDirectory(sessionId);
    } catch (err) {
      console.error(err);
      set({ error: String(err), isLoading: false });
    }
  }
}));
