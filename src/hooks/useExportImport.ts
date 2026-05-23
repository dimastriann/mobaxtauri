import { save, open, ask, message } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useSessionStore } from '../store/useSessionStore';
import { parseSSHConfig, parseMobaXtermINI } from '../utils/importParsers';

export function useExportImport() {
  const handleExport = async () => {
    try {
      const selectedPath = await save({
        filters: [{ name: 'MobaXTauri Backup', extensions: ['json'] }],
        defaultPath: 'mobaxtauri_backup.json',
      });

      if (!selectedPath) return;

      // Strip status, errors, and passwords for security
      const exportSessions = useSessionStore
        .getState()
        .sessions.filter((s) => s.id !== 'local')
        .map(({ status, error, lastActivity, ...s }) => s);

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

      await message('Backup exported successfully!', { title: 'Export', kind: 'info' });
    } catch (err) {
      console.error('Export failed:', err);
      await message(`Export failed: ${err}`, { title: 'Export Error', kind: 'error' });
    }
  };

  const handleImportJSON = async () => {
    try {
      const selectedPath = await open({
        filters: [{ name: 'MobaXTauri Backup', extensions: ['json'] }],
        multiple: false,
      });

      if (!selectedPath || typeof selectedPath !== 'string') return;

      const content = (await invoke('read_text_file', { path: selectedPath })) as string;
      const data = JSON.parse(content);

      if (data.app !== 'mobaxtauri') {
        throw new Error('Invalid backup file format.');
      }

      const shouldMerge = await ask(
        'Do you want to MERGE imported sessions with your existing ones?\n\n- Click "Yes" to Merge (keep existing and append new)\n- Click "No" to REPLACE everything',
        { title: 'Import Sessions', kind: 'warning' },
      );

      const importedSessions = (data.sessions || []).map((s: any) => ({
        ...s,
        status: 'disconnected',
      }));

      const importedFolders = data.folders || [];
      const importedSnippets = data.snippets || [];

      if (shouldMerge) {
        // Merge folders
        const existingFolders = useSessionStore.getState().folders;
        const newFolders = [...existingFolders];
        importedFolders.forEach((f: any) => {
          if (!newFolders.some((ex) => ex.id === f.id || ex.name === f.name)) {
            newFolders.push(f);
          }
        });

        // Merge sessions
        const existingSessions = useSessionStore.getState().sessions;
        const newSessions = [...existingSessions];
        importedSessions.forEach((s: any) => {
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
        importedSnippets.forEach((sn: any) => {
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
          sessions: [local, ...importedSessions.filter((s: any) => s.id !== 'local')],
          snippets: importedSnippets,
        });
      }

      await useSessionStore.getState().saveToDisk();
      await message('Import completed successfully!', { title: 'Import', kind: 'info' });
    } catch (err) {
      console.error('Import failed:', err);
      await message(`Import failed: ${err}`, { title: 'Import Error', kind: 'error' });
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
        await message('No valid SSH hosts found in the selected file.', {
          title: 'Import SSH Config',
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
        await message(`Successfully imported ${importedCount} sessions from SSH config!`, {
          title: 'Import Complete',
          kind: 'info',
        });
      } else {
        await message('All imported hosts already exist in your sessions.', {
          title: 'Import Info',
          kind: 'info',
        });
      }
    } catch (err) {
      console.error('SSH Config Import failed:', err);
      await message(`Import failed: ${err}`, { title: 'Import Error', kind: 'error' });
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
        await message('No valid SSH bookmarks found in the selected MobaXterm file.', {
          title: 'Import MobaXterm',
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
      await message(`Successfully imported ${importedCount} sessions from MobaXterm bookmarks!`, {
        title: 'Import Complete',
        kind: 'info',
      });
    } catch (err) {
      console.error('MobaXterm Import failed:', err);
      await message(`Import failed: ${err}`, { title: 'Import Error', kind: 'error' });
    }
  };

  return {
    handleExport,
    handleImportJSON,
    handleImportSSHConfig,
    handleImportMobaXterm,
  };
}
