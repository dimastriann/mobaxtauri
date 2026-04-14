import { useEffect, useState, useCallback } from 'react';
import { Flex, Box, VStack, HStack, Text, IconButton, Spinner, Icon } from "@chakra-ui/react";
import {
  LuPlus, LuPencil, LuX, LuTerminal, LuMonitor,
  LuFolder, LuFolderPlus, LuChevronRight, LuChevronDown
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

function App() {
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | undefined>(undefined);
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const openTabs = useSessionStore((state) => state.openTabs);
  const openTab = useSessionStore((state) => state.openTab);
  const deleteSession = useSessionStore((state) => state.deleteSession);
  const loadSessions = useSessionStore((state) => state.loadSessions);
  const isLoading = useSessionStore((state) => state.isLoading);

  const folders = useSessionStore((state) => state.folders);
  const addFolder = useSessionStore((state) => state.addFolder);
  const renameFolder = useSessionStore((state) => state.renameFolder);
  const deleteFolder = useSessionStore((state) => state.deleteFolder);
  const toggleFolderCollapse = useSessionStore((state) => state.toggleFolderCollapse);

  const [sidebarTab, setSidebarTab] = useState<'sessions' | 'sftp'>('sessions');
  const [sidebarMenu, setSidebarMenu] = useState<{ x: number, y: number, type: 'folder' | 'session' | 'empty', id?: string, name?: string } | null>(null);

  useEffect(() => {
    const handleGlobalClick = () => setSidebarMenu(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
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

  const onSidebarContextMenu = (e: React.MouseEvent, type: 'folder' | 'session' | 'empty', id?: string, name?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSidebarMenu({ x: e.clientX, y: e.clientY, type, id, name });
  };

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

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

  const renderSessionItem = (session: Session) => {
    if (!session) return null;
    const isActive = activeSessionId === session.id;
    const isOpen = openTabs.includes(session.id);

    return (
      <HStack
        key={session.id} p={2} mb={1} borderRadius="8px" cursor="pointer"
        bg={isActive ? "blue.subtle" : "transparent"}
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

          {/* <HStack gap={1}>
            <Box w="12px" h="12px" borderRadius="full" bg="#22c55e" opacity={0.7} cursor="pointer" _hover={{ opacity: 1 }} />
            <Box w="12px" h="12px" borderRadius="full" bg="#f59e0b" opacity={0.7} cursor="pointer" _hover={{ opacity: 1 }} />
            <Box w="12px" h="12px" borderRadius="full" bg="#ef4444" opacity={0.7} cursor="pointer" _hover={{ opacity: 1 }} />
          </HStack> */}
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
          </HStack>

          {sidebarTab === 'sessions' ? (
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
                          <HStack p={2} borderRadius="6px" cursor="pointer" _hover={{ bg: 'bg.emphasized' }} onClick={() => toggleFolderCollapse(folder.id)} data-group>
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
          ) : (
            <SftpSidebar />
          )}
        </VStack>

        <Flex flex={1} direction="column" overflow="hidden">
          <TabBar onNewSession={handleNewSession} />
          <TerminalContainer />
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
              <SidebarMenuItem icon={LuX} label="Delete Session" color="red.fg" onClick={() => handleDelete(undefined, sidebarMenu.id!)} />
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
