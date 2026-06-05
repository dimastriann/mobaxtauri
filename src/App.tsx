import { useEffect, useState, useRef } from 'react';
import { Flex } from '@chakra-ui/react';
import {
  LuPlus,
  LuPencil,
  LuX,
  LuFolderPlus,
  LuCode,
  LuTag,
  LuCopy,
  LuScissors,
  LuClipboard,
  LuMousePointer2,
  LuTerminal,
  LuMonitor,
} from 'react-icons/lu';
import TerminalContainer from './components/Terminal';
import TabBar from './components/TabBar';
import Sidebar from './components/Sidebar';
import TitleBar from './components/TitleBar';
import HealthBar from './components/HealthBar';
import NewSessionModal from './components/NewSessionModal';
import PromptModal from './components/PromptModal';
import { useExportImport } from './hooks/useExportImport';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from './components/ContextMenu';
import { Session, useSessionStore } from './store/useSessionStore';
import { invoke } from '@tauri-apps/api/core';
import { ask } from '@tauri-apps/plugin-dialog';
import { emit } from '@tauri-apps/api/event';
import { writeText, readText } from '@tauri-apps/plugin-clipboard-manager';

type SidebarMenuType = 'folder' | 'session' | 'empty' | 'snippet' | 'input' | 'import';

interface PromptConfig {
  title: string;
  fields: { key: string; label: string; placeholder?: string }[];
  onConfirm: (values: Record<string, string>) => void;
}

function App() {
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | undefined>(undefined);
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const openTab = useSessionStore((state) => state.openTab);
  const deleteSession = useSessionStore((state) => state.deleteSession);
  const updateSession = useSessionStore((state) => state.updateSession);
  const loadSessions = useSessionStore((state) => state.loadSessions);
  const addFolder = useSessionStore((state) => state.addFolder);
  const renameFolder = useSessionStore((state) => state.renameFolder);
  const deleteFolder = useSessionStore((state) => state.deleteFolder);
  const addSnippet = useSessionStore((state) => state.addSnippet);
  const updateSnippet = useSessionStore((state) => state.updateSnippet);
  const deleteSnippet = useSessionStore((state) => state.deleteSnippet);

  const [sidebarTab, setSidebarTab] = useState<'sessions' | 'sftp' | 'snippets'>('sessions');

  const [sidebarMenu, setSidebarMenu] = useState<{
    x: number;
    y: number;
    type: SidebarMenuType;
    id?: string;
    name?: string;
    command?: string;
  } | null>(null);

  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null);
  const [quickConnectStr, setQuickConnectStr] = useState('');
  const quickConnectRef = useRef<HTMLInputElement>(null);
  const { handleImportJSON, handleImportSSHConfig, handleImportMobaXterm } = useExportImport();

  // ── Connection Logic ───────────────────────────────────────
  const handleQuickConnect = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const str = quickConnectStr.trim();
      if (!str) return;

      const match = str.match(/^([^@]+)@([^:]+)(?::(\d+))?$/);
      if (!match) {
        alert('Invalid format. Use user@host or user@host:port');
        return;
      }

      const user = match[1];
      const host = match[2];
      const port = match[3] ? parseInt(match[3], 10) : 22;
      const sessionId = `quick-${Date.now()}`;

      useSessionStore.getState().addSession({
        id: sessionId,
        name: `${user}@${host}`,
        type: 'ssh',
        host,
        user,
        port,
        status: 'connecting',
      });
      openTab(sessionId);

      try {
        await invoke('ssh_connect', { sessionId, host, port, user, password: null });
        useSessionStore.getState().updateSessionStatus(sessionId, 'connected');
        setQuickConnectStr('');
      } catch (err) {
        useSessionStore.getState().updateSessionStatus(sessionId, 'error', String(err));
      }
    }
  };

  // ── Context Menu Handlers ──────────────────────────────────
  const handleInputContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setSidebarMenu({ x: e.clientX, y: e.clientY, type: 'input' });
  };

  const onSidebarContextMenu = (
    e: React.MouseEvent,
    type: 'folder' | 'session' | 'empty' | 'snippet' | 'input' | 'import',
    id?: string,
    name?: string,
    command?: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setSidebarMenu({ x: e.clientX, y: e.clientY, type, id, name, command });
  };

  const handleCopy = async () => {
    const el = quickConnectRef.current;
    if (!el) return;
    const selectedText = el.value.substring(el.selectionStart ?? 0, el.selectionEnd ?? 0);
    if (selectedText) await writeText(selectedText);
    setSidebarMenu(null);
  };

  const handleCut = async () => {
    const el = quickConnectRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const selectedText = el.value.substring(start, end);
    if (selectedText) {
      await writeText(selectedText);
      setQuickConnectStr(el.value.substring(0, start) + el.value.substring(end));
    }
    setSidebarMenu(null);
  };

  const handlePaste = async () => {
    const el = quickConnectRef.current;
    if (!el) return;
    try {
      const text = await readText();
      if (text) {
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        setQuickConnectStr(el.value.substring(0, start) + text + el.value.substring(end));
        setTimeout(() => {
          el.focus();
          el.setSelectionRange(start + text.length, start + text.length);
        }, 0);
      }
    } catch (err) {
      console.error('Paste failed:', err);
    }
    setSidebarMenu(null);
  };

  const handleSelectAll = () => {
    const el = quickConnectRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, el.value.length);
    setSidebarMenu(null);
  };

  // ── Effects ────────────────────────────────────────────────
  useEffect(() => {
    const handleGlobalClick = () => setSidebarMenu(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    const pollHealth = () => {
      useSessionStore.getState().sessions.forEach((s) => {
        if (s.type === 'ssh' && s.status === 'connected') {
          invoke<NonNullable<Session['health']>>('ssh_health_check', { sessionId: s.id })
            .then((health) => useSessionStore.getState().updateSessionHealth(s.id, health))
            .catch(() => {});
        }
      });
    };
    pollHealth();
    const interval = setInterval(pollHealth, 60000);
    return () => clearInterval(interval);
  }, []);

  // ── UI Handlers ─────────────────────────────────────────────────
  const handleNewSession = () => {
    setEditingSession(undefined);
    setModalOpen(true);
  };
  const handleAddFolder = () => {
    setPromptConfig({
      title: 'New Folder',
      fields: [{ key: 'name', label: 'Folder Name', placeholder: 'e.g. Production' }],
      onConfirm: ({ name }) => addFolder(name),
    });
  };
  const handleAddSnippet = () => {
    setPromptConfig({
      title: 'New Snippet',
      fields: [
        { key: 'name', label: 'Snippet Name', placeholder: 'e.g. Check disk usage' },
        { key: 'command', label: 'Command', placeholder: 'e.g. df -h' },
      ],
      onConfirm: ({ name, command }) => addSnippet(name, command),
    });
  };

  return (
    <Flex h="100vh" direction="column" bg="bg.panel" color="fg" overflow="hidden">
      <TitleBar
        quickConnectRef={quickConnectRef}
        quickConnectStr={quickConnectStr}
        setQuickConnectStr={setQuickConnectStr}
        onQuickConnect={handleQuickConnect}
        onContextMenu={handleInputContextMenu}
      />

      <Flex flex={1} overflow="hidden">
        <Sidebar
          sidebarTab={sidebarTab}
          setSidebarTab={setSidebarTab}
          onNewSession={handleNewSession}
          onAddFolder={handleAddFolder}
          onAddSnippet={handleAddSnippet}
          onExecuteSnippet={(c) => {
            if (activeSessionId)
              emit(`snippet-execute-${activeSessionId}`, c.endsWith('\n') ? c : c + '\n');
          }}
          onContextMenu={onSidebarContextMenu}
        />

        <Flex flex={1} direction="column" overflow="hidden">
          <TabBar onNewSession={handleNewSession} />
          <TerminalContainer />
          <HealthBar />
        </Flex>
      </Flex>

      <NewSessionModal
        isOpen={isModalOpen}
        onClose={() => setModalOpen(false)}
        editingSession={editingSession}
      />

      <PromptModal
        isOpen={!!promptConfig}
        title={promptConfig?.title ?? ''}
        fields={promptConfig?.fields ?? []}
        onConfirm={(values) => promptConfig?.onConfirm(values)}
        onClose={() => setPromptConfig(null)}
      />

      {sidebarMenu && (
        <ContextMenu x={sidebarMenu.x} y={sidebarMenu.y} onClose={() => setSidebarMenu(null)}>
          {sidebarMenu.type === 'empty' && (
            <>
              <ContextMenuItem
                icon={LuPlus}
                label="New Session"
                onClick={() => {
                  setSidebarMenu(null);
                  handleNewSession();
                }}
              />
              <ContextMenuItem
                icon={LuFolderPlus}
                label="New Folder"
                onClick={() => {
                  setSidebarMenu(null);
                  handleAddFolder();
                }}
              />
              <ContextMenuItem
                icon={LuCode}
                label="New Snippet"
                onClick={() => {
                  setSidebarMenu(null);
                  handleAddSnippet();
                }}
              />
            </>
          )}
          {sidebarMenu.type === 'folder' && (
            <>
              <ContextMenuItem
                icon={LuPencil}
                label="Rename Folder"
                onClick={() => {
                  const id = sidebarMenu.id!;
                  const old = sidebarMenu.name;
                  setSidebarMenu(null);
                  setPromptConfig({
                    title: 'Rename Folder',
                    fields: [{ key: 'name', label: 'Folder Name', placeholder: old }],
                    onConfirm: ({ name }) => renameFolder(id, name),
                  });
                }}
              />
              <ContextMenuItem
                icon={LuX}
                label="Delete Folder"
                color="red.fg"
                onClick={async () => {
                  const id = sidebarMenu.id!;
                  setSidebarMenu(null);
                  if (await ask('Delete?')) deleteFolder(id);
                }}
              />
            </>
          )}
          {sidebarMenu.type === 'session' && (
            <>
              <ContextMenuItem
                icon={LuPencil}
                label="Edit Session"
                onClick={() => {
                  const id = sidebarMenu.id!;
                  setSidebarMenu(null);
                  setEditingSession(sessions.find((s) => s.id === id));
                  setModalOpen(true);
                }}
              />
              <ContextMenuItem
                icon={LuTag}
                label="Tag: Prod"
                color="red.400"
                onClick={() => {
                  const id = sidebarMenu.id!;
                  setSidebarMenu(null);
                  updateSession(id, { tag: 'prod' });
                }}
              />
              <ContextMenuItem
                icon={LuTag}
                label="Tag: Staging"
                color="orange.400"
                onClick={() => {
                  const id = sidebarMenu.id!;
                  setSidebarMenu(null);
                  updateSession(id, { tag: 'staging' });
                }}
              />
              <ContextMenuItem
                icon={LuTag}
                label="Tag: Dev"
                color="green.400"
                onClick={() => {
                  const id = sidebarMenu.id!;
                  setSidebarMenu(null);
                  updateSession(id, { tag: 'dev' });
                }}
              />
              <ContextMenuItem
                icon={LuTag}
                label="Tag: None"
                color="fg.muted"
                onClick={() => {
                  const id = sidebarMenu.id!;
                  setSidebarMenu(null);
                  updateSession(id, { tag: undefined });
                }}
              />
              <ContextMenuSeparator />
              <ContextMenuItem
                icon={LuX}
                label="Delete Session"
                color="red.fg"
                onClick={async () => {
                  const id = sidebarMenu.id!;
                  setSidebarMenu(null);
                  if (await ask('Delete?')) deleteSession(id);
                }}
              />
            </>
          )}
          {sidebarMenu.type === 'snippet' && (
            <>
              <ContextMenuItem
                icon={LuPencil}
                label="Edit Snippet"
                onClick={() => {
                  const id = sidebarMenu.id!;
                  const oldN = sidebarMenu.name;
                  const oldC = sidebarMenu.command;
                  setSidebarMenu(null);
                  setPromptConfig({
                    title: 'Edit Snippet',
                    fields: [
                      { key: 'name', label: 'Snippet Name', placeholder: oldN },
                      { key: 'command', label: 'Command', placeholder: oldC },
                    ],
                    onConfirm: ({ name, command }) => updateSnippet(id, { name, command }),
                  });
                }}
              />
              <ContextMenuItem
                icon={LuX}
                label="Delete Snippet"
                color="red.fg"
                onClick={() => {
                  const id = sidebarMenu.id!;
                  setSidebarMenu(null);
                  deleteSnippet(id);
                }}
              />
            </>
          )}
          {sidebarMenu.type === 'input' && (
            <>
              <ContextMenuItem
                icon={LuScissors}
                label="Cut"
                onClick={() => {
                  setSidebarMenu(null);
                  handleCut();
                }}
              />
              <ContextMenuItem
                icon={LuCopy}
                label="Copy"
                onClick={() => {
                  setSidebarMenu(null);
                  handleCopy();
                }}
              />
              <ContextMenuItem
                icon={LuClipboard}
                label="Paste"
                onClick={() => {
                  setSidebarMenu(null);
                  handlePaste();
                }}
              />
              <ContextMenuSeparator />
              <ContextMenuItem
                icon={LuMousePointer2}
                label="Select All"
                onClick={() => {
                  setSidebarMenu(null);
                  handleSelectAll();
                }}
              />
            </>
          )}
          {sidebarMenu.type === 'import' && (
            <>
              <ContextMenuItem
                icon={LuCode}
                label="Import MobaXTauri Backup (JSON)"
                onClick={() => {
                  setSidebarMenu(null);
                  handleImportJSON();
                }}
              />
              <ContextMenuItem
                icon={LuTerminal}
                label="Import SSH Config File"
                onClick={() => {
                  setSidebarMenu(null);
                  handleImportSSHConfig();
                }}
              />
              <ContextMenuItem
                icon={LuMonitor}
                label="Import MobaXterm Bookmarks"
                onClick={() => {
                  setSidebarMenu(null);
                  handleImportMobaXterm();
                }}
              />
            </>
          )}
        </ContextMenu>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: var(--chakra-colors-border-subtle); border-radius: 10px; }
      `}</style>
    </Flex>
  );
}

export default App;
