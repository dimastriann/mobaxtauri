import { save, open, ask, message } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useSessionStore, type Folder, type Session, type Snippet } from '../store/useSessionStore';
import { parseSSHConfig, parseMobaXtermINI } from '../utils/importParsers';

import { useTranslation } from '../store/useLocaleStore';

export function useExportImport() {
  const { t } = useTranslation();
  const exportSelection = async (payload: {
    sessionId?: string;
    folderId?: string;
    defaultPath: string;
  }) => {
    const selectedPath = await save({
      filters: [{ name: t('exportImport.backupFilter'), extensions: ['json'] }],
      defaultPath: payload.defaultPath,
    });
    if (!selectedPath) return;

    await useSessionStore.getState().flushPendingSave();
    const count = await invoke<number>('export_app_data_backup', {
      path: selectedPath,
      sessionId: payload.sessionId,
      folderId: payload.folderId,
      exportedAt: new Date().toISOString(),
    });
    await message(t('exportImport.exported', { count }), {
      title: t('exportImport.exportTitle'),
      kind: 'info',
    });
  };

  const handleExportSession = async (sessionId: string, sessionName: string) => {
    try {
      await exportSelection({
        sessionId,
        defaultPath: `${sessionName.replace(/[^a-z0-9_-]+/gi, '-')}-session.json`,
      });
    } catch (err) {
      console.error('Session export failed:', err);
      await message(t('exportImport.exportFailed', { message: String(err) }), {
        title: t('exportImport.exportError'),
        kind: 'error',
      });
    }
  };

  const handleExportFolder = async (folderId: string, folderName: string) => {
    try {
      await exportSelection({
        folderId,
        defaultPath: `${folderName.replace(/[^a-z0-9_-]+/gi, '-')}-folder.json`,
      });
    } catch (err) {
      console.error('Folder export failed:', err);
      await message(t('exportImport.exportFailed', { message: String(err) }), {
        title: t('exportImport.exportError'),
        kind: 'error',
      });
    }
  };

  const handleExport = async () => {
    try {
      const selectedPath = await save({
        filters: [{ name: t('exportImport.backupFilter'), extensions: ['json'] }],
        defaultPath: 'mobaxtauri_backup.json',
      });

      if (!selectedPath) return;

      // Strip status, errors, and passwords for security
      const exportSessions = useSessionStore
        .getState()
        .sessions.filter((s) => s.id !== 'local')
        .map(({ status: _status, error: _error, lastActivity: _lastActivity, ...s }) => s);

      const exportData = {
        version: 1,
        app: 'mobaxtauri',
        exportedAt: new Date().toISOString(),
        sessions: exportSessions,
        folders: useSessionStore.getState().folders,
        snippets: useSessionStore.getState().snippets,
      };

      await invoke('write_text_file', {
        path: selectedPath,
        content: JSON.stringify(exportData, null, 2),
      });

      await message(t('exportImport.backupExported'), {
        title: t('exportImport.exportTitle'),
        kind: 'info',
      });
    } catch (err) {
      console.error('Export failed:', err);
      await message(t('exportImport.exportFailed', { message: String(err) }), {
        title: t('exportImport.exportError'),
        kind: 'error',
      });
    }
  };

  const handleImportJSON = async () => {
    try {
      const selectedPath = await open({
        filters: [{ name: t('exportImport.backupFilter'), extensions: ['json'] }],
        multiple: false,
      });

      if (!selectedPath || typeof selectedPath !== 'string') return;

      const content = (await invoke('read_text_file', { path: selectedPath })) as string;
      const data = JSON.parse(content) as {
        app?: string;
        sessions?: Array<Omit<Session, 'status'>>;
        folders?: Folder[];
        snippets?: Snippet[];
      };

      if (data.app !== 'mobaxtauri') {
        throw new Error(t('exportImport.invalidBackup'));
      }

      const shouldMerge = await ask(t('exportImport.mergePrompt'), {
        title: t('exportImport.importSessions'),
        kind: 'warning',
      });

      const importedSessions = (data.sessions ?? []).map((s) => ({
        ...s,
        status: 'disconnected' as const,
      }));

      const importedFolders = data.folders || [];
      const importedSnippets = data.snippets || [];

      if (shouldMerge) {
        // Merge folders
        const existingFolders = useSessionStore.getState().folders;
        const newFolders = [...existingFolders];
        importedFolders.forEach((f) => {
          if (!newFolders.some((ex) => ex.id === f.id || ex.name === f.name)) {
            newFolders.push(f);
          }
        });

        // Merge sessions
        const existingSessions = useSessionStore.getState().sessions;
        const newSessions = [...existingSessions];
        importedSessions.forEach((s) => {
          if (
            !newSessions.some(
              (ex) =>
                ex.id === s.id || (ex.host === s.host && ex.user === s.user && ex.port === s.port),
            )
          ) {
            newSessions.push(s);
          }
        });

        // Merge snippets
        const existingSnippets = useSessionStore.getState().snippets;
        const newSnippets = [...existingSnippets];
        importedSnippets.forEach((sn) => {
          if (!newSnippets.some((ex) => ex.id === sn.id || ex.name === sn.name)) {
            newSnippets.push(sn);
          }
        });

        useSessionStore.setState({
          folders: newFolders,
          sessions: newSessions,
          snippets: newSnippets,
        });
      } else {
        const local = useSessionStore.getState().sessions.find((s) => s.id === 'local') || {
          id: 'local',
          name: 'Local Terminal',
          type: 'local',
          status: 'connected',
        };

        useSessionStore.setState({
          folders: importedFolders,
          sessions: [local, ...importedSessions.filter((s) => s.id !== 'local')],
          snippets: importedSnippets,
        });
      }

      await useSessionStore.getState().saveToDisk();
      await message(t('exportImport.importCompleted'), {
        title: t('exportImport.importTitle'),
        kind: 'info',
      });
    } catch (err) {
      console.error('Import failed:', err);
      await message(t('exportImport.importFailed', { message: String(err) }), {
        title: t('exportImport.importError'),
        kind: 'error',
      });
    }
  };

  const handleImportSSHConfig = async () => {
    try {
      const selectedPath = await open({
        multiple: false,
      });

      if (!selectedPath || typeof selectedPath !== 'string') return;

      const content = (await invoke('read_text_file', { path: selectedPath })) as string;
      const parsedSessions = parseSSHConfig(content);

      if (parsedSessions.length === 0) {
        await message(t('exportImport.noSshHosts'), {
          title: t('exportImport.importSshConfig'),
          kind: 'info',
        });
        return;
      }

      const existingSessions = useSessionStore.getState().sessions;
      const newSessions = [...existingSessions];
      let importedCount = 0;

      parsedSessions.forEach((s) => {
        if (
          !newSessions.some((ex) => ex.host === s.host && ex.user === s.user && ex.port === s.port)
        ) {
          newSessions.push(s);
          importedCount++;
        }
      });

      if (importedCount > 0) {
        useSessionStore.setState({ sessions: newSessions });
        await useSessionStore.getState().saveToDisk();
        await message(t('exportImport.importedSsh', { count: importedCount }), {
          title: t('exportImport.importComplete'),
          kind: 'info',
        });
      } else {
        await message(t('exportImport.allExist'), {
          title: t('exportImport.importInfo'),
          kind: 'info',
        });
      }
    } catch (err) {
      console.error('SSH Config Import failed:', err);
      await message(t('exportImport.importFailed', { message: String(err) }), {
        title: t('exportImport.importError'),
        kind: 'error',
      });
    }
  };

  const handleImportMobaXterm = async () => {
    try {
      const selectedPath = await open({
        filters: [{ name: 'MobaXterm INI', extensions: ['ini'] }],
        multiple: false,
      });

      if (!selectedPath || typeof selectedPath !== 'string') return;

      const content = (await invoke('read_text_file', { path: selectedPath })) as string;
      const { sessions: parsedSessions, folders: parsedFolders } = parseMobaXtermINI(content);

      if (parsedSessions.length === 0) {
        await message(t('exportImport.noMobaBookmarks'), {
          title: t('exportImport.importMobaXterm'),
          kind: 'info',
        });
        return;
      }

      // Merge folders
      const existingFolders = useSessionStore.getState().folders;
      const newFolders = [...existingFolders];
      parsedFolders.forEach((f) => {
        if (!newFolders.some((ex) => ex.name === f.name)) {
          newFolders.push(f);
        }
      });

      // Merge sessions
      const existingSessions = useSessionStore.getState().sessions;
      const newSessions = [...existingSessions];
      let importedCount = 0;

      parsedSessions.forEach((s) => {
        if (
          !newSessions.some((ex) => ex.host === s.host && ex.user === s.user && ex.port === s.port)
        ) {
          // Resolve correct folder ID if folder was already loaded or just imported
          if (s.folderId) {
            const folderObj = parsedFolders.find((f) => f.id === s.folderId);
            if (folderObj) {
              const matchedFolder = newFolders.find((f) => f.name === folderObj.name);
              if (matchedFolder) {
                s.folderId = matchedFolder.id;
              }
            }
          }
          newSessions.push(s);
          importedCount++;
        }
      });

      useSessionStore.setState({
        folders: newFolders,
        sessions: newSessions,
      });

      await useSessionStore.getState().saveToDisk();
      await message(t('exportImport.importedMoba', { count: importedCount }), {
        title: t('exportImport.importComplete'),
        kind: 'info',
      });
    } catch (err) {
      console.error('MobaXterm Import failed:', err);
      await message(t('exportImport.importFailed', { message: String(err) }), {
        title: t('exportImport.importError'),
        kind: 'error',
      });
    }
  };

  return {
    handleExport,
    handleExportSession,
    handleExportFolder,
    handleImportJSON,
    handleImportSSHConfig,
    handleImportMobaXterm,
  };
}
