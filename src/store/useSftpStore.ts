import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import { joinLocalPath } from '../utils/localPath';
import {
  SFTP_TARGET_EXISTS_MARKER,
  type SftpConflictPolicy,
  type SftpLocalEntryPayload,
  type SftpRemoveManyResult,
  type SftpTransferEvent,
} from '../types/sftp';

export interface SftpFile {
  name: string;
  is_dir: boolean;
  is_file: boolean;
  size: number;
  modified: number | null;
  uid: number | null;
  gid: number | null;
  permissions: string;
  mode: number | null;
}

/** How long finished transfers stay in the queue view. */
const FINISHED_TRANSFER_LINGER_MS = 4000;

export interface SftpBatchDownloadResult {
  downloaded: number;
  failures: { name: string; message: string }[];
}

interface TransferRetryRequest {
  kind: 'upload' | 'download' | 'copy' | 'folder_upload' | 'folder_download';
  sessionId: string;
  sourcePath: string;
  destPath: string;
  conflictPolicy?: SftpConflictPolicy;
}

export interface SftpConflictPrompt {
  kind: 'upload' | 'copy' | 'create-file' | 'folder-download' | 'folder-upload';
  sessionId: string;
  destPath: string;
  destName: string;
  sourcePath?: string;
  localPath?: string;
}

interface SftpState {
  currentPath: string;
  files: SftpFile[];
  isLoading: boolean;
  error: string | null;
  history: string[]; // For going back
  /** Every transfer seen in this session, in arrival order. */
  transfers: SftpTransferEvent[];
  conflictPrompt: SftpConflictPrompt | null;

  fetchDirectory: (sessionId: string, path?: string) => Promise<void>;
  cd: (sessionId: string, subPath: string) => Promise<void>;
  cdUp: (sessionId: string) => Promise<void>;
  refresh: (sessionId: string) => Promise<void>;
  reset: () => void;
  downloadFile: (sessionId: string, fileName: string) => Promise<void>;
  downloadFolder: (sessionId: string, folderName: string) => Promise<void>;
  downloadSelected: (
    sessionId: string,
    files: SftpFile[],
  ) => Promise<SftpBatchDownloadResult | null>;
  uploadFile: (sessionId: string) => Promise<void>;
  uploadFolder: (sessionId: string) => Promise<void>;
  uploadPaths: (sessionId: string, paths: string[]) => Promise<void>;
  copyFile: (sessionId: string, sourceName: string, destName: string) => Promise<void>;
  openFile: (sessionId: string, fileName: string) => Promise<void>;
  renameFile: (sessionId: string, oldName: string, newName: string) => Promise<void>;
  deleteFile: (sessionId: string, name: string, isDir: boolean) => Promise<void>;
  deleteFiles: (sessionId: string, names: string[]) => Promise<SftpRemoveManyResult>;
  createDir: (sessionId: string, dirName: string) => Promise<void>;
  createFile: (sessionId: string, fileName: string) => Promise<void>;
  updateTransfer: (transfer: SftpTransferEvent) => void;
  retryTransfer: (transferId: string) => Promise<void>;
  cancelTransfer: (transferId: string) => Promise<void>;
  resolveConflict: (policy: SftpConflictPolicy) => Promise<void>;
  dismissConflict: () => void;
}

export const useSftpStore = create<SftpState>((set, get) => {
  const transferRequests = new Map<string, TransferRetryRequest>();
  const rememberTransfer = (id: string, request: TransferRetryRequest) => {
    transferRequests.set(id, request);
  };

  // Shared bodies for the dialog flows and the drag & drop dispatcher:
  // destination paths derive from the remote directory being viewed.
  const uploadOneFile = async (sessionId: string, localPath: string): Promise<void> => {
    const destName = localPath.split(/[/\\]/).filter(Boolean).pop() ?? null;
    if (!destName) return;
    const currentPath = get().currentPath;
    const destPath = currentPath.endsWith('/')
      ? `${currentPath}${destName}`
      : `${currentPath}/${destName}`;
    try {
      set({ isLoading: true, error: null });
      const transferId = `upload-${Date.now()}`;
      rememberTransfer(transferId, {
        kind: 'upload',
        sessionId,
        sourcePath: localPath,
        destPath,
      });
      await invoke('sftp_upload_file', {
        sessionId,
        localPath,
        remotePath: destPath,
        transferId,
      });
      await get().fetchDirectory(sessionId);
    } catch (err) {
      console.error(err);
      const message = String(err);
      if (message.includes(SFTP_TARGET_EXISTS_MARKER)) {
        set({
          isLoading: false,
          conflictPrompt: {
            kind: 'upload',
            sessionId,
            localPath,
            destPath,
            destName,
          },
        });
        return;
      }
      set({
        error: message.includes('Transfer cancelled') ? null : message,
        isLoading: false,
      });
    }
  };

  const uploadOneFolder = async (sessionId: string, localPath: string): Promise<void> => {
    const destName = localPath.split(/[/\\]/).filter(Boolean).pop() ?? null;
    if (!destName) return;
    const currentPath = get().currentPath;
    const destPath = currentPath.endsWith('/')
      ? `${currentPath}${destName}`
      : `${currentPath}/${destName}`;
    try {
      set({ isLoading: true, error: null });
      const transferId = `folder-upload-${Date.now()}`;
      rememberTransfer(transferId, {
        kind: 'folder_upload',
        sessionId,
        sourcePath: localPath,
        destPath,
      });
      await invoke('sftp_upload_folder', {
        sessionId,
        localPath,
        remotePath: destPath,
        transferId,
      });
      await get().fetchDirectory(sessionId);
    } catch (err) {
      console.error(err);
      const message = String(err);
      if (message.includes(SFTP_TARGET_EXISTS_MARKER)) {
        set({
          isLoading: false,
          conflictPrompt: {
            kind: 'folder-upload',
            sessionId,
            localPath,
            destPath,
            destName,
          },
        });
        return;
      }
      set({
        error: message.includes('Transfer cancelled') ? null : message,
        isLoading: false,
      });
    }
  };

  return {
    currentPath: '/',
    files: [],
    isLoading: false,
    error: null,
    history: [],
    transfers: [],
    conflictPrompt: null,

    updateTransfer: (transfer) => {
      const withoutEntry = get().transfers.filter(
        (entry) => entry.transferId !== transfer.transferId,
      );
      set({ transfers: [...withoutEntry, transfer] });
      if (transfer.status === 'running') {
        set({ isLoading: true });
        return;
      }
      if (transfer.status !== 'failed') {
        transferRequests.delete(transfer.transferId);
      }
      set({
        isLoading: false,
        error: transfer.status === 'failed' ? transfer.message || 'Transfer failed' : null,
      });
      // Keep the finished row visible briefly, then drop it from the queue.
      setTimeout(() => {
        set({
          transfers: get().transfers.filter((entry) => entry.transferId !== transfer.transferId),
        });
      }, FINISHED_TRANSFER_LINGER_MS);
    },

    resolveConflict: async (policy) => {
      const prompt = get().conflictPrompt;
      if (!prompt) return;
      set({ conflictPrompt: null });
      try {
        set({ isLoading: true, error: null });
        if (policy === 'skip') {
          await get().fetchDirectory(prompt.sessionId);
          return;
        }
        if (prompt.kind === 'upload') {
          const transferId = `upload-${Date.now()}`;
          rememberTransfer(transferId, {
            kind: 'upload',
            sessionId: prompt.sessionId,
            sourcePath: prompt.localPath ?? '',
            destPath: prompt.destPath,
            conflictPolicy: policy,
          });
          await invoke('sftp_upload_file', {
            sessionId: prompt.sessionId,
            localPath: prompt.localPath,
            remotePath: prompt.destPath,
            transferId,
            conflictPolicy: policy,
          });
        } else if (prompt.kind === 'copy') {
          const transferId = `copy-${Date.now()}`;
          rememberTransfer(transferId, {
            kind: 'copy',
            sessionId: prompt.sessionId,
            sourcePath: prompt.sourcePath ?? '',
            destPath: prompt.destPath,
            conflictPolicy: policy,
          });
          await invoke('sftp_copy_file', {
            sessionId: prompt.sessionId,
            sourcePath: prompt.sourcePath,
            destPath: prompt.destPath,
            transferId,
            conflictPolicy: policy,
          });
        } else if (prompt.kind === 'create-file') {
          await invoke('sftp_create_file', {
            sessionId: prompt.sessionId,
            path: prompt.destPath,
            conflictPolicy: policy,
          });
        } else if (prompt.kind === 'folder-upload') {
          const transferId = `folder-upload-${Date.now()}`;
          rememberTransfer(transferId, {
            kind: 'folder_upload',
            sessionId: prompt.sessionId,
            sourcePath: prompt.localPath ?? '',
            destPath: prompt.destPath,
            conflictPolicy: policy,
          });
          await invoke('sftp_upload_folder', {
            sessionId: prompt.sessionId,
            localPath: prompt.localPath,
            remotePath: prompt.destPath,
            transferId,
            conflictPolicy: policy,
          });
        } else {
          const transferId = `folder-${Date.now()}`;
          rememberTransfer(transferId, {
            kind: 'folder_download',
            sessionId: prompt.sessionId,
            sourcePath: prompt.destPath,
            destPath: prompt.localPath ?? '',
            conflictPolicy: policy,
          });
          await invoke('sftp_download_folder', {
            sessionId: prompt.sessionId,
            remotePath: prompt.destPath,
            localPath: prompt.localPath,
            transferId,
            conflictPolicy: policy,
          });
        }
        await get().fetchDirectory(prompt.sessionId);
      } catch (err) {
        console.error(err);
        const message = String(err);
        set({
          error: message.includes('Transfer cancelled') ? null : message,
          isLoading: false,
        });
      }
    },

    dismissConflict: () => {
      set({ conflictPrompt: null });
    },

    retryTransfer: async (transferId) => {
      const request = transferRequests.get(transferId);
      if (!request) return;
      const nextId = `${request.kind}-retry-${Date.now()}`;
      transferRequests.set(nextId, request);
      set({ isLoading: true, error: null });
      try {
        if (request.kind === 'upload') {
          await invoke('sftp_upload_file', {
            sessionId: request.sessionId,
            localPath: request.sourcePath,
            remotePath: request.destPath,
            transferId: nextId,
            conflictPolicy: request.conflictPolicy,
          });
        } else if (request.kind === 'download') {
          await invoke('sftp_download_file', {
            sessionId: request.sessionId,
            remotePath: request.sourcePath,
            localPath: request.destPath,
            transferId: nextId,
          });
        } else if (request.kind === 'copy') {
          await invoke('sftp_copy_file', {
            sessionId: request.sessionId,
            sourcePath: request.sourcePath,
            destPath: request.destPath,
            transferId: nextId,
            conflictPolicy: request.conflictPolicy,
          });
        } else if (request.kind === 'folder_upload') {
          await invoke('sftp_upload_folder', {
            sessionId: request.sessionId,
            localPath: request.sourcePath,
            remotePath: request.destPath,
            transferId: nextId,
            conflictPolicy: request.conflictPolicy,
          });
        } else {
          await invoke('sftp_download_folder', {
            sessionId: request.sessionId,
            remotePath: request.sourcePath,
            localPath: request.destPath,
            transferId: nextId,
            conflictPolicy: request.conflictPolicy,
          });
        }
        await get().fetchDirectory(request.sessionId);
      } catch (err) {
        set({ error: String(err), isLoading: false });
      }
    },

    cancelTransfer: async (transferId) => {
      await invoke('sftp_cancel_transfer', { transferId });
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
        transfers: [],
        conflictPrompt: null,
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
        rememberTransfer(transferId, {
          kind: 'download',
          sessionId,
          sourcePath,
          destPath: localPath,
        });
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
        });
      }
    },

    downloadFolder: async (sessionId, folderName) => {
      const state = get();
      const remotePath = state.currentPath.endsWith('/')
        ? `${state.currentPath}${folderName}`
        : `${state.currentPath}/${folderName}`;
      let localPath: string | null = null;
      try {
        localPath = await save({ defaultPath: folderName });
        if (!localPath) return;

        set({ isLoading: true, error: null });
        const transferId = `folder-${Date.now()}`;
        rememberTransfer(transferId, {
          kind: 'folder_download',
          sessionId,
          sourcePath: remotePath,
          destPath: localPath,
        });
        await invoke('sftp_download_folder', {
          sessionId,
          remotePath,
          localPath,
          transferId,
        });
        set({ isLoading: false });
      } catch (err) {
        console.error(err);
        const message = String(err);
        if (message.includes(SFTP_TARGET_EXISTS_MARKER) && localPath) {
          set({
            isLoading: false,
            conflictPrompt: {
              kind: 'folder-download',
              sessionId,
              destPath: remotePath,
              destName: folderName,
              localPath,
            },
          });
          return;
        }
        set({
          error: message.includes('Transfer cancelled') ? null : message,
          isLoading: false,
        });
      }
    },

    downloadSelected: async (sessionId, files) => {
      if (!files.length) return null;
      const picked = await open({ multiple: false, directory: true });
      if (!picked || Array.isArray(picked)) return null;

      const state = get();
      const result: SftpBatchDownloadResult = { downloaded: 0, failures: [] };
      for (const [index, file] of files.entries()) {
        const remotePath = state.currentPath.endsWith('/')
          ? `${state.currentPath}${file.name}`
          : `${state.currentPath}/${file.name}`;
        const localPath = joinLocalPath(picked, file.name);
        try {
          if (file.is_dir) {
            const transferId = `folder-${Date.now()}-${index}`;
            rememberTransfer(transferId, {
              kind: 'folder_download',
              sessionId,
              sourcePath: remotePath,
              destPath: localPath,
              conflictPolicy: 'rename',
            });
            await invoke('sftp_download_folder', {
              sessionId,
              remotePath,
              localPath,
              transferId,
              conflictPolicy: 'rename',
            });
          } else {
            const transferId = `download-${Date.now()}-${index}`;
            rememberTransfer(transferId, {
              kind: 'download',
              sessionId,
              sourcePath: remotePath,
              destPath: localPath,
            });
            await invoke('sftp_download_file', {
              sessionId,
              remotePath,
              localPath,
              transferId,
            });
          }
          result.downloaded += 1;
        } catch (err) {
          result.failures.push({ name: file.name, message: String(err) });
        }
      }
      await get().fetchDirectory(sessionId);
      return result;
    },

    uploadFile: async (sessionId) => {
      const picked = await open({ multiple: false, directory: false });
      if (!picked || Array.isArray(picked)) return;
      await uploadOneFile(sessionId, picked as string);
    },

    uploadFolder: async (sessionId) => {
      const picked = await open({ multiple: false, directory: true });
      if (!picked || Array.isArray(picked)) return;
      await uploadOneFolder(sessionId, picked as string);
    },

    uploadPaths: async (sessionId, paths) => {
      if (!paths.length) return;
      try {
        const entries = await invoke<SftpLocalEntryPayload[]>('sftp_local_entries', { paths });
        for (const entry of entries) {
          // A previous entry ended in the conflict dialog; remaining
          // entries wait for a fresh drop once it is resolved.
          if (get().conflictPrompt) break;
          if (entry.isDir) {
            await uploadOneFolder(sessionId, entry.path);
          } else {
            await uploadOneFile(sessionId, entry.path);
          }
        }
      } catch (err) {
        console.error(err);
        set({ error: String(err), isLoading: false });
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
        const transferId = `copy-${Date.now()}`;
        rememberTransfer(transferId, {
          kind: 'copy',
          sessionId,
          sourcePath,
          destPath,
        });
        await invoke('sftp_copy_file', {
          sessionId,
          sourcePath,
          destPath,
          transferId,
        });
        await get().fetchDirectory(sessionId);
      } catch (err) {
        console.error(err);
        const message = String(err);
        if (message.includes(SFTP_TARGET_EXISTS_MARKER)) {
          set({
            isLoading: false,
            conflictPrompt: { kind: 'copy', sessionId, sourcePath, destPath, destName },
          });
          return;
        }
        set({
          error: message.includes('Transfer cancelled') ? null : message,
          isLoading: false,
        });
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

    deleteFiles: async (sessionId, names) => {
      const state = get();
      const paths = names.map((name) =>
        state.currentPath.endsWith('/')
          ? `${state.currentPath}${name}`
          : `${state.currentPath}/${name}`,
      );

      try {
        set({ error: null });
        const result = await invoke<SftpRemoveManyResult>('sftp_remove_many', {
          sessionId,
          paths,
        });
        await get().fetchDirectory(sessionId);
        return result;
      } catch (err) {
        console.error(err);
        set({ error: String(err) });
        throw err;
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

    createFile: async (sessionId, fileName) => {
      const state = get();
      const path = state.currentPath.endsWith('/')
        ? `${state.currentPath}${fileName}`
        : `${state.currentPath}/${fileName}`;

      try {
        set({ isLoading: true, error: null });
        await invoke('sftp_create_file', {
          sessionId,
          path,
        });
        await get().fetchDirectory(sessionId);
      } catch (err) {
        console.error(err);
        const message = String(err);
        if (message.includes(SFTP_TARGET_EXISTS_MARKER)) {
          set({
            isLoading: false,
            conflictPrompt: { kind: 'create-file', sessionId, destPath: path, destName: fileName },
          });
          return;
        }
        set({ error: message, isLoading: false });
      }
    },
  };
});
