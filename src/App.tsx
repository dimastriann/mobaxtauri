import { useEffect, useState, useCallback } from 'react';
import { Flex, Box, VStack, HStack, Text, IconButton, Spinner, Icon, Input } from "@chakra-ui/react";
import { 
  LuPlus, LuPencil, LuX, LuTerminal, LuMonitor,
  LuFolder, LuFolderPlus, LuChevronRight, LuChevronDown,
  LuCode, LuTag
} from "react-icons/lu";
import TerminalContainer from './components/Terminal';
import TabBar from './components/TabBar';
import NewSessionModal from './components/NewSessionModal';
import { Session, useSessionStore } from './store/useSessionStore';
import SftpSidebar from './components/SftpSidebar';
import { invoke } from '@tauri-apps/api/core';
import { ask } from '@tauri-apps/plugin-dialog';
import { ColorModeButton } from './components/ui/color-mode';
import { Tooltip } from './components/ui/tooltip';
import { emit } from '@tauri-apps/api/event';

function App() {
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | undefined>(undefined);
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const openTabs = useSessionStore((state) => state.openTabs);
  const openTab = useSessionStore((state) => state.openTab);
  const deleteSession = useSessionStore((state) => state.deleteSession);
  const updateSession = useSessionStore((state) => state.updateSession);
  const loadSessions = useSessionStore((state) => state.loadSessions);
  const isLoading = useSessionStore((state) => state.isLoading);

  const folders = useSessionStore((state) => state.folders);
  const addFolder = useSessionStore((state) => state.addFolder);
  const renameFolder = useSessionStore((state) => state.renameFolder);
  const deleteFolder = useSessionStore((state) => state.deleteFolder);
  const toggleFolderCollapse = useSessionStore((state) => state.toggleFolderCollapse);

  const snippets = useSessionStore((state) => state.snippets);
  const addSnippet = useSessionStore((state) => state.addSnippet);
  const updateSnippet = useSessionStore((state) => state.updateSnippet);
  const deleteSnippet = useSessionStore((state) => state.deleteSnippet);

  const [sidebarTab, setSidebarTab] = useState<'sessions' | 'sftp' | 'snippets'>('sessions');
  const [sidebarMenu, setSidebarMenu] = useState<{ x: number, y: number, type: 'folder' | 'session' | 'empty' | 'snippet', id?: string, name?: string, command?: string } | null>(null);
  const [quickConnectStr, setQuickConnectStr] = useState('');

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
        await invoke('ssh_connect', {
          sessionId,
          host,
          port,
          user,
          password: null
        });
        useSessionStore.getState().updateSessionStatus(sessionId, 'connected');
        setQuickConnectStr('');
      } catch (err) {
        useSessionStore.getState().updateSessionStatus(sessionId, 'error', String(err));
      }
    }
  };

  useEffect(() => {
    const handleGlobalClick = () => setSidebarMenu(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    // Poll health data for connected SSH sessions every 60 seconds
    const pollHealth = () => {
      const currentSessions = useSessionStore.getState().sessions;
      currentSessions.forEach(s => {
        if (s.type === 'ssh' && s.status === 'connected') {
          invoke<NonNullable<Session['health']>>('ssh_health_check', { sessionId: s.id })
            .then(health => {
              useSessionStore.getState().updateSessionHealth(s.id, health);
            })
            .catch(() => {
              // Silently ignore — session may have disconnected
            });
        }
      });
    };

    // Run immediately on mount, then every 60 seconds
    pollHealth();
    const interval = setInterval(pollHealth, 60000);
    return () => clearInterval(interval);
  }, []);

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, sessionId: string) => {
    e.dataTransfer.setData('sessionId', sessionId);
  };

  const handleDropOnFolder = (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    const sessionId = e.dataTransfer.getData('sessionId');
    if (sessionId) {
      useSessionStore.getState().moveSessionToFolder(sessionId, folderId);
    }
  };

  const onSidebarContextMenu = (e: React.MouseEvent, type: 'folder' | 'session' | 'empty' | 'snippet', id?: string, name?: string, command?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSidebarMenu({ x: e.clientX, y: e.clientY, type, id, name, command });
  };

  const handleNewSession = () => {
    setEditingSession(undefined);
    setModalOpen(true);
  };

  const handleEdit = useCallback((e: React.MouseEvent | undefined, session: Session) => {
    e?.stopPropagation();
    setEditingSession(session);
    setModalOpen(true);
  }, []);

  const handleDelete = useCallback(async (e: React.MouseEvent | undefined, id: string) => {
    e?.stopPropagation();
    const confirmed = await ask('Are you sure you want to delete this session?', {
      title: 'MobaXTauri',
      kind: 'warning'
    });
    if (confirmed) {
      if (id.startsWith('ssh-')) {
        try {
          await invoke('ssh_disconnect', { sessionId: id });
        } catch (err) {
          console.warn('Disconnect failed:', err);
        }
      }
      deleteSession(id);
    }
  }, [deleteSession]);

  const handleSidebarClick = (session: Session) => {
    openTab(session.id);
  };

  const handleAddFolder = () => {
    const name = window.prompt('Enter folder name:');
    if (name) addFolder(name);
  };

  const handleRenameFolder = useCallback((e: React.MouseEvent | undefined, id: string, oldName: string) => {
    e?.stopPropagation();
    const newName = window.prompt('Rename folder to:', oldName);
    if (newName) renameFolder(id, newName);
  }, [renameFolder]);

  const handleDeleteFolder = useCallback(async (e: React.MouseEvent | undefined, id: string) => {
    e?.stopPropagation();
    const confirmed = await ask('Delete this folder? Sessions will be moved to Uncategorized.', {
      title: 'MobaXTauri',
      kind: 'warning'
    });
    if (confirmed) {
      deleteFolder(id);
    }
  }, [deleteFolder]);

  const handleAddSnippet = () => {
    const name = window.prompt('Enter snippet name:');
    if (!name) return;
    const command = window.prompt('Enter command:');
    if (command) addSnippet(name, command);
  };

  const handleEditSnippet = useCallback((id: string, oldName: string, oldCommand: string) => {
    const name = window.prompt('Edit snippet name:', oldName);
    if (!name) return;
    const command = window.prompt('Edit command:', oldCommand);
    if (command) updateSnippet(id, { name, command });
  }, [updateSnippet]);

  const handleExecuteSnippet = (command: string) => {
    if (!activeSessionId) return;
    emit(`snippet-execute-${activeSessionId}`, command.endsWith('\n') ? command : command + '\n');
  };

  const renderSessionItem = (session: Session) => {
    if (!session) return null;
    const isActive = activeSessionId === session.id;
    const isOpen = openTabs.includes(session.id);
    let tagColorStr = 'transparent';
    if (session.tag === 'prod') tagColorStr = 'red.400';
    else if (session.tag === 'staging') tagColorStr = 'orange.400';
    else if (session.tag === 'dev') tagColorStr = 'green.400';
    else if (session.tag === 'custom' && session.tagColor) tagColorStr = session.tagColor;

    return (
      <HStack
        key={session.id} p={2} mb={1} borderRadius="8px" cursor="pointer"
        bg={isActive ? "blue.subtle" : "transparent"}
        borderLeft="3px solid"
        borderColor={tagColorStr}
        _hover={{ bg: isActive ? "blue.muted" : "whiteAlpha.100" }}
        onContextMenu={(e) => onSidebarContextMenu(e, 'session', session.id, session.name)}
        draggable={session.id !== 'local'}
        onDragStart={(e) => handleDragStart(e, session.id)}
        onClick={() => handleSidebarClick(session)}
      >
        <Icon as={session.type === 'ssh' ? LuTerminal : LuMonitor} boxSize="14px" color={isActive ? "blue.fg" : "fg.muted"} />
        <Text fontSize="13px" color={isActive ? "fg" : "fg.muted"} flex={1} lineClamp={1}>{session.name}</Text>
        {isOpen && <Box w="4px" h="4px" borderRadius="full" bg="blue.fg" />}
      </HStack>
    );
  };

  const renderSidebarContent = () => {
    if (sidebarTab === 'sessions') {
      return (
        <>
          <HStack p={3} justify="space-between">
            <Text fontSize="11px" fontWeight="bold" color="fg.subtle" letterSpacing="0.05em">LIST</Text>
            <HStack gap={1}>
              <IconButton aria-label="New Session" size="xs" variant="ghost" onClick={handleNewSession} color="blue.fg"><LuPlus size={14} /></IconButton>
              <IconButton aria-label="New Folder" size="xs" variant="ghost" onClick={handleAddFolder} color="fg.muted"><LuFolderPlus size={14} /></IconButton>
            </HStack>
          </HStack>

          <VStack 
            align="stretch" flex={1} overflowY="auto" gap={0} px={2} pb={4} className="custom-scrollbar"
            onContextMenu={(e) => onSidebarContextMenu(e, 'empty')}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDropOnFolder(e, null)}
          >
            {isLoading ? (
              <Flex p={4} justify="center"><Spinner size="sm" color="blue.fg" /></Flex>
            ) : (
              <>
                {folders.map((folder) => {
                  const folderSessions = sessions.filter(s => s.folderId === folder.id);
                  return (
                    <Box 
                      key={folder.id} mb={1}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleDropOnFolder(e, folder.id)}
                      onContextMenu={(e) => onSidebarContextMenu(e, 'folder', folder.id, folder.name)}
                    >
                      <HStack p={2} borderRadius="6px" cursor="pointer" _hover={{ bg: 'bg.emphasized' }} onClick={() => toggleFolderCollapse(folder.id)}>
                        <Icon as={folder.isCollapsed ? LuChevronRight : LuChevronDown} boxSize="12px" color="fg.muted" />
                        <Icon as={LuFolder} boxSize="14px" color="orange.fg" />
                        <Text fontSize="13px" color="fg" fontWeight="500" flex={1} lineClamp={1}>{folder.name}</Text>
                      </HStack>
                      {!folder.isCollapsed && (
                        <VStack align="stretch" gap={0} pl={4} mt={1}>
                          {folderSessions.map(session => renderSessionItem(session))}
                        </VStack>
                      )}
                    </Box>
                  );
                })}
                {sessions.filter(s => s.id !== 'local' && (!s.folderId || !folders.find(f => f.id === s.folderId))).map(session => renderSessionItem(session))}
                {renderSessionItem(sessions.find(s => s.id === 'local')!)}
              </>
            )}
          </VStack>
        </>
      );
    } else if (sidebarTab === 'sftp') {
      return <SftpSidebar />;
    } else {
      return (
        <>
          <HStack p={3} justify="space-between">
            <Text fontSize="11px" fontWeight="bold" color="fg.subtle" letterSpacing="0.05em">QUICK COMMANDS</Text>
            <IconButton aria-label="New Snippet" size="xs" variant="ghost" onClick={handleAddSnippet} color="blue.fg"><LuPlus size={14} /></IconButton>
          </HStack>
          <VStack align="stretch" flex={1} overflowY="auto" gap={0} px={2} pb={4} className="custom-scrollbar" onContextMenu={(e) => onSidebarContextMenu(e, 'empty')}>
            {snippets.length === 0 ? (
              <Flex p={4} direction="column" align="center" justify="center" gap={2} opacity={0.5} mt={10}>
                <Icon as={LuCode} boxSize="24px" />
                <Text fontSize="11px" textAlign="center">No snippets yet. Save common commands here.</Text>
              </Flex>
            ) : (
              snippets.map(snippet => (
                <HStack 
                  key={snippet.id} p={2} mb={1} borderRadius="8px" cursor="pointer"
                  _hover={{ bg: "bg.emphasized" }}
                  onClick={() => handleExecuteSnippet(snippet.command)}
                  onContextMenu={(e) => onSidebarContextMenu(e, 'snippet', snippet.id, snippet.name, snippet.command)}
                >
                  <Icon as={LuCode} boxSize="14px" color="blue.fg" />
                  <VStack align="flex-start" gap={0} flex={1} overflow="hidden">
                    <Text fontSize="13px" color="fg" fontWeight="500" lineClamp={1}>{snippet.name}</Text>
                    <Text fontSize="10px" color="fg.muted" lineClamp={1} fontFamily="monospace">{snippet.command}</Text>
                  </VStack>
                </HStack>
              ))
            )}
          </VStack>
        </>
      );
    }
  };

  return (
    <Flex h="100vh" direction="column" bg="bg.panel" color="fg" overflow="hidden">
      {/* ── Titlebar ───────────────────────────────────────── */}
      <Box
        h="38px"
        minH="38px"
        bg="bg.muted"
        borderBottom="1px solid"
        borderColor="border.subtle"
        px={4}
        display="flex"
        alignItems="center"
        justifyContent="space-between"
      >
        <HStack gap={2}>
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            w="22px"
            h="22px"
            borderRadius="4px"
            bg="blue.subtle"
          >
            <Icon as={LuTerminal} boxSize="12px" color="blue.fg" />
          </Box>
          <Text fontSize="12px" fontWeight="700" letterSpacing="0.08em" color="fg.muted">
            MOBAXTAURI
          </Text>
          <Text fontSize="10px" color="fg.subtle" ml={1}>
            v0.1.0
          </Text>
        </HStack>

        <HStack gap={3}>
          <Input 
            size="xs" 
            placeholder="Quick Connect (user@host:port)" 
            w="200px" 
            value={quickConnectStr}
            onChange={(e) => setQuickConnectStr(e.target.value)}
            onKeyDown={handleQuickConnect}
          />

          <HStack gap={1} pr={2} borderRight="1px solid" borderColor="border.subtle">
            <Tooltip content="Shutdown all active sessions" showArrow>
              <IconButton
                aria-label="Shutdown all sessions"
                size="xs"
                variant="ghost"
                color="red.fg"
                _hover={{ bg: 'red.subtle' }}
                onClick={async () => {
                  const confirmed = await ask('Shutdown all active sessions? ALL terminal data will be lost.', {
                    title: 'MobaXTauri',
                    kind: 'warning'
                  });
                  if (confirmed) {
                    useSessionStore.getState().shutdownAll();
                  }
                }}
              >
                <Icon as={LuMonitor} />
              </IconButton>
            </Tooltip>

            <Tooltip content="Toggle Dark/Light Mode" showArrow>
              <ColorModeButton 
                size="xs" 
                zIndex={20}
                position="relative"
                _hover={{ bg: "bg.emphasized" }} 
              />
            </Tooltip>
          </HStack>
        </HStack>
      </Box>

      <Flex flex={1} overflow="hidden">
        {/* ── Sidebar ── */}
        <VStack
          w="240px"
          minW="240px"
          bg="bg.panel"
          borderRight="1px solid"
          borderColor="border.subtle"
          align="stretch"
          gap={0}
        >
          <HStack w="full" px={2} pt={2} gap={1} borderBottom="1px solid" borderColor="border.subtle">
             <Box 
               flex={1} pb={2} cursor="pointer" textAlign="center" 
               borderBottom="2px solid" 
               borderColor={sidebarTab === 'sessions' ? 'blue.fg' : 'transparent'}
               onClick={() => setSidebarTab('sessions')}
             >
               <Text fontSize="11px" fontWeight="bold" color={sidebarTab === 'sessions' ? 'fg' : 'fg.muted'}>SESSIONS</Text>
             </Box>
             <Box 
               flex={1} pb={2} cursor="pointer" textAlign="center" 
               borderBottom="2px solid" 
               borderColor={sidebarTab === 'sftp' ? 'blue.fg' : 'transparent'}
               onClick={() => setSidebarTab('sftp')}
             >
               <Text fontSize="11px" fontWeight="bold" color={sidebarTab === 'sftp' ? 'fg' : 'fg.muted'}>SFTP</Text>
             </Box>
             <Box 
               flex={1} pb={2} cursor="pointer" textAlign="center" 
               borderBottom="2px solid" 
               borderColor={sidebarTab === 'snippets' ? 'blue.fg' : 'transparent'}
               onClick={() => setSidebarTab('snippets')}
             >
               <Text fontSize="11px" fontWeight="bold" color={sidebarTab === 'snippets' ? 'fg' : 'fg.muted'}>SNIPPETS</Text>
             </Box>
          </HStack>

          {renderSidebarContent()}
        </VStack>

        <Flex flex={1} direction="column" overflow="hidden">
          <TabBar onNewSession={handleNewSession} />
          <TerminalContainer />

          {/* ── Health Status Bar ── */}
          {(() => {
            const activeSession = sessions.find(s => s.id === activeSessionId);
            if (!activeSession?.health) return null;
            const h = activeSession.health;
            const barColor = (pct: number) => pct > 90 ? 'red.400' : pct > 70 ? 'orange.400' : 'green.400';
            return (
              <HStack
                minH="24px" px={4} py={1} gap={4}
                bg="bg.muted" borderTop="1px solid" borderColor="border.subtle"
                fontSize="11px" color="fg.muted" fontFamily="monospace"
                flexWrap="wrap"
              >
                <HStack gap={1} flexShrink={0}>
                  <Text color="fg.subtle" fontWeight="600">CPU</Text>
                  <Box w="60px" h="6px" bg="whiteAlpha.100" borderRadius="full" overflow="hidden">
                    <Box h="full" bg={barColor(h.cpu)} w={`${h.cpu}%`} transition="width 0.5s" borderRadius="full" />
                  </Box>
                  <Text w="42px" textAlign="right">{h.cpu.toFixed(1)}%</Text>
                </HStack>
                <HStack gap={1} flexShrink={0}>
                  <Text color="fg.subtle" fontWeight="600">RAM</Text>
                  <Box w="60px" h="6px" bg="whiteAlpha.100" borderRadius="full" overflow="hidden">
                    <Box h="full" bg={barColor(h.ram)} w={`${h.ram}%`} transition="width 0.5s" borderRadius="full" />
                  </Box>
                  <Text textAlign="right">{h.ram_used.toFixed(0)}/{h.ram_total.toFixed(0)}M ({h.ram.toFixed(0)}%)</Text>
                </HStack>
                <HStack gap={1} flexShrink={0}>
                  <Text color="fg.subtle" fontWeight="600">SWAP</Text>
                  <Box w="60px" h="6px" bg="whiteAlpha.100" borderRadius="full" overflow="hidden">
                    <Box h="full" bg={barColor(h.swap)} w={`${h.swap}%`} transition="width 0.5s" borderRadius="full" />
                  </Box>
                  <Text textAlign="right">{h.swap_used.toFixed(0)}/{h.swap_total.toFixed(0)}M ({h.swap.toFixed(0)}%)</Text>
                </HStack>
                <HStack gap={1} flexShrink={0}>
                  <Text color="fg.subtle" fontWeight="600">DISK</Text>
                  <Box w="60px" h="6px" bg="whiteAlpha.100" borderRadius="full" overflow="hidden">
                    <Box h="full" bg={barColor(h.disk)} w={`${h.disk}%`} transition="width 0.5s" borderRadius="full" />
                  </Box>
                  <Text w="42px" textAlign="right">{h.disk.toFixed(0)}%</Text>
                </HStack>
              </HStack>
            );
          })()}
        </Flex>
      </Flex>

      <NewSessionModal isOpen={isModalOpen} onClose={() => setModalOpen(false)} editingSession={editingSession} />

      {sidebarMenu && (
        <Box
          position="fixed" top={sidebarMenu.y} left={sidebarMenu.x}
          bg="bg.panel" border="1px solid" borderColor="border.subtle"
          borderRadius="8px" boxShadow="xl" zIndex={1000} py={1} minW="160px"
        >
          {sidebarMenu.type === 'empty' && (
            <>
              <SidebarMenuItem icon={LuPlus} label="New Session" onClick={() => handleNewSession()} />
              <SidebarMenuItem icon={LuFolderPlus} label="New Folder" onClick={() => handleAddFolder()} />
              <SidebarMenuItem icon={LuCode} label="New Snippet" onClick={() => handleAddSnippet()} />
            </>
          )}
          {sidebarMenu.type === 'folder' && (
            <>
              <SidebarMenuItem icon={LuPencil} label="Rename Folder" onClick={() => handleRenameFolder(undefined, sidebarMenu.id!, sidebarMenu.name!)} />
              <SidebarMenuItem icon={LuX} label="Delete Folder" color="red.fg" onClick={() => handleDeleteFolder(undefined, sidebarMenu.id!)} />
            </>
          )}
          {sidebarMenu.type === 'session' && (
            <>
              <SidebarMenuItem icon={LuPencil} label="Edit Session" onClick={() => handleEdit(undefined, sessions.find(s => s.id === sidebarMenu.id!)!)} />
              <SidebarMenuItem icon={LuTag} label="Tag: Prod" color="red.400" onClick={() => updateSession(sidebarMenu.id!, { tag: 'prod' })} />
              <SidebarMenuItem icon={LuTag} label="Tag: Staging" color="orange.400" onClick={() => updateSession(sidebarMenu.id!, { tag: 'staging' })} />
              <SidebarMenuItem icon={LuTag} label="Tag: Dev" color="green.400" onClick={() => updateSession(sidebarMenu.id!, { tag: 'dev' })} />
              <SidebarMenuItem icon={LuTag} label="Tag: None" color="fg.muted" onClick={() => updateSession(sidebarMenu.id!, { tag: undefined })} />
              <Box h="1px" bg="border.subtle" my={1} />
              <SidebarMenuItem icon={LuX} label="Delete Session" color="red.fg" onClick={() => handleDelete(undefined, sidebarMenu.id!)} />
            </>
          )}
          {sidebarMenu.type === 'snippet' && (
            <>
              <SidebarMenuItem icon={LuPencil} label="Edit Snippet" onClick={() => handleEditSnippet(sidebarMenu.id!, sidebarMenu.name!, sidebarMenu.command!)} />
              <SidebarMenuItem icon={LuX} label="Delete Snippet" color="red.fg" onClick={() => deleteSnippet(sidebarMenu.id!)} />
            </>
          )}
        </Box>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: var(--chakra-colors-border-subtle); border-radius: 10px; }
      `}</style>
    </Flex>
  );

  function SidebarMenuItem({ icon, label, onClick, color }: any) {
    return (
      <HStack
        px={3} py={2} cursor="pointer" _hover={{ bg: 'whiteAlpha.50' }}
        onClick={(e) => { e.stopPropagation(); onClick(); setSidebarMenu(null); }} gap={3}
      >
        <Icon as={icon} boxSize="14px" color={color || "fg.muted"} />
        <Text fontSize="12px" color={color || "fg"}>{label}</Text>
      </HStack>
    );
  }
}

export default App;
