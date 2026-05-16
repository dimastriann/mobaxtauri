import { useEffect, useState, useRef } from 'react';
import { Flex } from "@chakra-ui/react";
import { 
  LuPlus, LuPencil, LuX, LuFolderPlus, LuCode, LuTag, LuCopy, LuScissors, LuClipboard, LuMousePointer2
} from "react-icons/lu";
import TerminalContainer from './components/Terminal';
import TabBar from './components/TabBar';
import Sidebar from './components/Sidebar';
import TitleBar from './components/TitleBar';
import HealthBar from './components/HealthBar';
import NewSessionModal from './components/NewSessionModal';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from './components/ContextMenu';
import { Session, useSessionStore } from './store/useSessionStore';
import { invoke } from '@tauri-apps/api/core';
import { ask } from '@tauri-apps/plugin-dialog';
import { emit } from '@tauri-apps/api/event';
import { writeText, readText } from '@tauri-apps/plugin-clipboard-manager';

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
  const [sidebarMenu, setSidebarMenu] = useState<{ x: number, y: number, type: 'folder' | 'session' | 'empty' | 'snippet' | 'input', id?: string, name?: string, command?: string } | null>(null);
  const [quickConnectStr, setQuickConnectStr] = useState('');
  const quickConnectRef = useRef<HTMLInputElement>(null);

  // ── Connection Logic ───────────────────────────────────────
  const handleQuickConnect = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const str = quickConnectStr.trim();
      if (!str) return;
      
      const match = str.match(/^([^@]+)@([^:]+)(?::(\d+))?$/);
      if (!match) {
        alert("Invalid format. Use user@host or user@host:port");
        return;
      }
      
      const user = match[1];
      const host = match[2];
      const port = match[3] ? parseInt(match[3], 10) : 22;
      const sessionId = `quick-${Date.now()}`;
      
      useSessionStore.getState().addSession({
        id: sessionId, name: `${user}@${host}`, type: 'ssh', host, user, port, status: 'connecting',
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

  const onSidebarContextMenu = (e: React.MouseEvent, type: any, id?: string, name?: string, command?: string) => {
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
        setTimeout(() => { el.focus(); el.setSelectionRange(start + text.length, start + text.length); }, 0);
      }
    } catch (err) { console.error("Paste failed:", err); }
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

  useEffect(() => { loadSessions(); }, [loadSessions]);

  useEffect(() => {
    const pollHealth = () => {
      useSessionStore.getState().sessions.forEach(s => {
        if (s.type === 'ssh' && s.status === 'connected') {
          invoke<NonNullable<Session['health']>>('ssh_health_check', { sessionId: s.id })
            .then(health => useSessionStore.getState().updateSessionHealth(s.id, health))
            .catch(() => {});
        }
      });
    };
    pollHealth();
    const interval = setInterval(pollHealth, 60000);
    return () => clearInterval(interval);
  }, []);

  // ── UI Handlers ────────────────────────────────────────────
  const handleNewSession = () => { setEditingSession(undefined); setModalOpen(true); };
  const handleAddFolder = () => { const name = window.prompt('Enter folder name:'); if (name) addFolder(name); };
  const handleAddSnippet = () => { 
    const name = window.prompt('Enter snippet name:'); if (!name) return;
    const command = window.prompt('Enter command:'); if (command) addSnippet(name, command);
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
          onEditSession={(s) => { setEditingSession(s); setModalOpen(true); }}
          onDeleteSession={async (id) => {
            const confirmed = await ask('Delete session?', { title: 'MobaXTauri', kind: 'warning' });
            if (confirmed) {
              if (id.startsWith('ssh-')) try { await invoke('ssh_disconnect', { sessionId: id }); } catch {}
              deleteSession(id);
            }
          }}
          onAddFolder={handleAddFolder}
          onRenameFolder={(id, old) => { const n = window.prompt('Rename:', old); if (n) renameFolder(id, n); }}
          onDeleteFolder={async (id) => {
            const confirmed = await ask('Delete folder?', { title: 'MobaXTauri', kind: 'warning' });
            if (confirmed) deleteFolder(id);
          }}
          onAddSnippet={handleAddSnippet}
          onEditSnippet={(id, n, c) => {
            const newN = window.prompt('Name:', n); if (!newN) return;
            const newC = window.prompt('Command:', c); if (newC) updateSnippet(id, { name: newN, command: newC });
          }}
          onExecuteSnippet={(c) => { if (activeSessionId) emit(`snippet-execute-${activeSessionId}`, c.endsWith('\n') ? c : c + '\n'); }}
          onContextMenu={onSidebarContextMenu}
        />

        <Flex flex={1} direction="column" overflow="hidden">
          <TabBar onNewSession={handleNewSession} />
          <TerminalContainer />
          <HealthBar />
        </Flex>
      </Flex>

      <NewSessionModal isOpen={isModalOpen} onClose={() => setModalOpen(false)} editingSession={editingSession} />

      {sidebarMenu && (
        <ContextMenu x={sidebarMenu.x} y={sidebarMenu.y} onClose={() => setSidebarMenu(null)}>
          {sidebarMenu.type === 'empty' && (
            <>
              <ContextMenuItem icon={LuPlus} label="New Session" onClick={handleNewSession} />
              <ContextMenuItem icon={LuFolderPlus} label="New Folder" onClick={handleAddFolder} />
              <ContextMenuItem icon={LuCode} label="New Snippet" onClick={handleAddSnippet} />
            </>
          )}
          {sidebarMenu.type === 'folder' && (
            <>
              <ContextMenuItem icon={LuPencil} label="Rename Folder" onClick={() => { const n = window.prompt('Rename:', sidebarMenu.name); if (n) renameFolder(sidebarMenu.id!, n); }} />
              <ContextMenuItem icon={LuX} label="Delete Folder" color="red.fg" onClick={async () => { if (await ask('Delete?')) deleteFolder(sidebarMenu.id!); }} />
            </>
          )}
          {sidebarMenu.type === 'session' && (
            <>
              <ContextMenuItem icon={LuPencil} label="Edit Session" onClick={() => { setEditingSession(sessions.find(s => s.id === sidebarMenu.id!)); setModalOpen(true); }} />
              <ContextMenuItem icon={LuTag} label="Tag: Prod" color="red.400" onClick={() => updateSession(sidebarMenu.id!, { tag: 'prod' })} />
              <ContextMenuItem icon={LuTag} label="Tag: Staging" color="orange.400" onClick={() => updateSession(sidebarMenu.id!, { tag: 'staging' })} />
              <ContextMenuItem icon={LuTag} label="Tag: Dev" color="green.400" onClick={() => updateSession(sidebarMenu.id!, { tag: 'dev' })} />
              <ContextMenuItem icon={LuTag} label="Tag: None" color="fg.muted" onClick={() => updateSession(sidebarMenu.id!, { tag: undefined })} />
              <ContextMenuSeparator />
              <ContextMenuItem icon={LuX} label="Delete Session" color="red.fg" onClick={async () => { if (await ask('Delete?')) deleteSession(sidebarMenu.id!); }} />
            </>
          )}
          {sidebarMenu.type === 'snippet' && (
            <>
              <ContextMenuItem icon={LuPencil} label="Edit Snippet" onClick={() => { const n = window.prompt('Name:', sidebarMenu.name); const c = window.prompt('Cmd:', sidebarMenu.command); if (n && c) updateSnippet(sidebarMenu.id!, { name: n, command: c }); }} />
              <ContextMenuItem icon={LuX} label="Delete Snippet" color="red.fg" onClick={() => deleteSnippet(sidebarMenu.id!)} />
            </>
          )}
          {sidebarMenu.type === 'input' && (
            <>
              <ContextMenuItem icon={LuScissors} label="Cut" onClick={handleCut} />
              <ContextMenuItem icon={LuCopy} label="Copy" onClick={handleCopy} />
              <ContextMenuItem icon={LuClipboard} label="Paste" onClick={handlePaste} />
              <ContextMenuSeparator />
              <ContextMenuItem icon={LuMousePointer2} label="Select All" onClick={handleSelectAll} />
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
