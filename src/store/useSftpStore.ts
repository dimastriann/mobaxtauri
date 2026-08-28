import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import type { SftpTransferEvent } from '../types/sftp';

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
  transfer: SftpTransferEvent | null;

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
  createDir: (sessionId: string, dirName: string) => Promise<void>;
  updateTransfer: (transfer: SftpTransferEvent) => void;
  cancelTransfer: () => Promise<void>;
}

export const useSftpStore = create<SftpState>((set, get) => ({
  currentPath: '/',
  files: [],
  isLoading: false,
  error: null,
  history: [],
  transfer: null,

  updateTransfer: (transfer) => {
    if (transfer.status === 'running') {
      set({ transfer, isLoading: true });
      return;
    }
    set({
      transfer: null,
      isLoading: false,
      error: transfer.status === 'failed' ? transfer.message || 'Transfer failed' : null,
    });
  },

  cancelTransfer: async () => {
    const transfer = get().transfer;
    if (!transfer) return;
    await invoke('sftp_cancel_transfer', { transferId: transfer.transferId });
  },

  fetchDirectory: async (sessionId, path) => {
    const targetPath = path !== undefined ? path : get().currentPath;
    set({ isLoading: true, error: null });
    try {
      const files =
        (await invoke<SftpFile[]>('sftp_list_dir', {
          sessionId,
          path: targetPath,
        })) || [];

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
        isLoading: false,
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
      const parts = state.currentPath.split('/').filter((p) => p !== '');
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
    set({
      currentPath: '/',
      files: [],
      error: null,
      isLoading: false,
      history: [],
      transfer: null,
    });
  },

  downloadFile: async (sessionId, fileName) => {
    const state = get();
    const sourcePath = state.currentPath.endsWith('/')
      ? `${state.currentPath}${fileName}`
      : `${state.currentPath}/${fileName}`;
    try {
      const localPath = await save({ defaultPath: fileName });
      if (!localPath) return;

      set({ isLoading: true, error: null });
      const transferId = `download-${Date.now()}`;
      await invoke('sftp_download_file', {
        sessionId,
        remotePath: sourcePath,
        localPath,
        transferId,
      });
      set({ isLoading: false });
    } catch (err) {
      console.error(err);
      const message = String(err);
      set({
        error: message.includes('Transfer cancelled') ? null : message,
        isLoading: false,
        transfer: null,
      });
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

      const destPath = state.currentPath.endsWith('/')
        ? `${state.currentPath}${fileName}`
        : `${state.currentPath}/${fileName}`;

      set({ isLoading: true, error: null });
      const transferId = `upload-${Date.now()}`;
      await invoke('sftp_upload_file', {
        sessionId,
        localPath: pathStr,
        remotePath: destPath,
        transferId,
      });
      await get().fetchDirectory(sessionId);
    } catch (err) {
      console.error(err);
      const message = String(err);
      set({
        error: message.includes('Transfer cancelled') ? null : message,
        isLoading: false,
        transfer: null,
      });
    }
  },

  copyFile: async (sessionId, sourceName, destName) => {
    const state = get();
    const sourcePath = state.currentPath.endsWith('/')
      ? `${state.currentPath}${sourceName}`
      : `${state.currentPath}/${sourceName}`;
    const destPath = state.currentPath.endsWith('/')
      ? `${state.currentPath}${destName}`
      : `${state.currentPath}/${destName}`;

    try {
      set({ isLoading: true, error: null });
      await invoke('sftp_copy_file', {
        sessionId,
        sourcePath,
        destPath,
      });
      await get().fetchDirectory(sessionId);
    } catch (err) {
      console.error(err);
      set({ error: String(err), isLoading: false });
    }
  },

  openFile: async (sessionId, fileName) => {
    const state = get();
    const sourcePath = state.currentPath.endsWith('/')
      ? `${state.currentPath}${fileName}`
      : `${state.currentPath}/${fileName}`;
    try {
      set({ isLoading: true, error: null });
      await invoke('sftp_open_file', {
        sessionId,
        remotePath: sourcePath,
      });
      set({ isLoading: false });
    } catch (err) {
      console.error(err);
      set({ error: String(err), isLoading: false });
    }
  },

  renameFile: async (sessionId, oldName, newName) => {
    const state = get();
    const oldPath = state.currentPath.endsWith('/')
      ? `${state.currentPath}${oldName}`
      : `${state.currentPath}/${oldName}`;
    const newPath = state.currentPath.endsWith('/')
      ? `${state.currentPath}${newName}`
      : `${state.currentPath}/${newName}`;

    try {
      set({ isLoading: true, error: null });
      await invoke('sftp_rename', {
        sessionId,
        oldPath,
        newPath,
      });
      await get().fetchDirectory(sessionId);
    } catch (err) {
      console.error(err);
      set({ error: String(err), isLoading: false });
    }
  },

  deleteFile: async (sessionId, name, isDir) => {
    const state = get();
    const path = state.currentPath.endsWith('/')
      ? `${state.currentPath}${name}`
      : `${state.currentPath}/${name}`;

    try {
      set({ isLoading: true, error: null });
      await invoke('sftp_remove', {
        sessionId,
        path,
        isDir,
      });
      await get().fetchDirectory(sessionId);
    } catch (err) {
      console.error(err);
      set({ error: String(err), isLoading: false });
    }
  },

  createDir: async (sessionId, dirName) => {
    const state = get();
    const path = state.currentPath.endsWith('/')
      ? `${state.currentPath}${dirName}`
      : `${state.currentPath}/${dirName}`;

    try {
      set({ isLoading: true, error: null });
      await invoke('sftp_create_dir', {
        sessionId,
        path,
      });
      await get().fetchDirectory(sessionId);
    } catch (err) {
      console.error(err);
      set({ error: String(err), isLoading: false });
    }
  },
}));
