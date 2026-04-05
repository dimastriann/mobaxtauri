import { useEffect, useState } from 'react';
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

function App() {
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | undefined>(undefined);
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const openTabs = useSessionStore((state) => state.openTabs);
  const setActiveSession = useSessionStore((state) => state.setActiveSession);
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

  useEffect(() => {
    loadSessions();
  }, []);

  const handleNewSession = () => {
    setEditingSession(undefined);
    setModalOpen(true);
  };

  const handleEdit = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    setEditingSession(session);
    setModalOpen(true);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    console.log('[DEBUG] handleDelete triggered for ID:', id);
    if (window.confirm('Are you sure you want to delete this session?')) {
      console.log('[DEBUG] Confirmation accepted, deleting:', id);
      if (id.startsWith('ssh-')) {
        try {
          await invoke('ssh_disconnect', { sessionId: id });
          console.log('[DEBUG] SSH disconnect invoked successfully');
        } catch (err) {
          console.warn('[DEBUG] SSH disconnect failed or already inactive:', err);
        }
      }
      deleteSession(id);
      console.log('[DEBUG] deleteSession store action called');
    }
  };

  const handleSidebarClick = (session: Session) => {
    // If already open as a tab, focus it; otherwise open a new tab
    openTab(session.id);
  };

  const handleAddFolder = () => {
    const name = window.prompt('Enter folder name:');
    if (name) addFolder(name);
  };

  const handleRenameFolder = (e: React.MouseEvent, id: string, oldName: string) => {
    e.stopPropagation();
    const newName = window.prompt('Rename folder to:', oldName);
    if (newName) renameFolder(id, newName);
  };

  const handleDeleteFolder = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm('Delete this folder? Sessions will be moved to Uncategorized.')) {
      deleteFolder(id);
    }
  };

  return (
    <Flex h="100vh" direction="column" bg="#0d0d1a" color="#e2e8f0" overflow="hidden">
      {/* ── Titlebar ───────────────────────────────────────── */}
      <Box
        h="38px"
        minH="38px"
        bg="#12122a"
        borderBottom="1px solid rgba(255,255,255,0.06)"
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
            bg="rgba(56,189,248,0.15)"
          >
            <Icon as={LuTerminal} boxSize="12px" color="#38bdf8" />
          </Box>
          <Text fontSize="12px" fontWeight="700" letterSpacing="0.08em" color="#94a3b8">
            MOBAXTAURI
          </Text>
          <Text fontSize="10px" color="rgba(148,163,184,0.4)" ml={1}>
            v0.1.0
          </Text>
        </HStack>

        <HStack gap={1}>
          <Box w="12px" h="12px" borderRadius="full" bg="#22c55e" opacity={0.7} cursor="pointer" _hover={{ opacity: 1 }} />
          <Box w="12px" h="12px" borderRadius="full" bg="#f59e0b" opacity={0.7} cursor="pointer" _hover={{ opacity: 1 }} />
          <Box w="12px" h="12px" borderRadius="full" bg="#ef4444" opacity={0.7} cursor="pointer" _hover={{ opacity: 1 }} />
        </HStack>
      </Box>

      <Flex flex={1} overflow="hidden">
        {/* ── Sidebar (Saved Sessions / Bookmarks) ──────────── */}
        <VStack
          w="240px"
          minW="240px"
          bg="#10102a"
          borderRight="1px solid rgba(255,255,255,0.06)"
          align="stretch"
          gap={0}
        >
          {/* Sidebar Tabs */}
          <HStack w="full" px={2} pt={2} gap={1} borderBottom="1px solid rgba(255,255,255,0.06)">
             <Box 
               flex={1} 
               pb={2} 
               cursor="pointer" 
               textAlign="center" 
               borderBottom="2px solid" 
               borderColor={sidebarTab === 'sessions' ? '#38bdf8' : 'transparent'}
               onClick={() => setSidebarTab('sessions')}
               _hover={{ bg: 'rgba(255,255,255,0.03)' }}
             >
               <Text fontSize="11px" fontWeight="bold" color={sidebarTab === 'sessions' ? 'white' : '#64748b'}>SESSIONS</Text>
             </Box>
             <Box 
               flex={1} 
               pb={2} 
               cursor="pointer" 
               textAlign="center" 
               borderBottom="2px solid" 
               borderColor={sidebarTab === 'sftp' ? '#38bdf8' : 'transparent'}
               onClick={() => setSidebarTab('sftp')}
               _hover={{ bg: 'rgba(255,255,255,0.03)' }}
             >
               <Text fontSize="11px" fontWeight="bold" color={sidebarTab === 'sftp' ? 'white' : '#64748b'}>SFTP</Text>
             </Box>
          </HStack>

          {sidebarTab === 'sessions' ? (
            <>
              <HStack p={3} justify="space-between">
                <Text fontSize="11px" fontWeight="bold" color="#64748b" letterSpacing="0.05em">
                  LIST
                </Text>
                <HStack gap={1}>
                  <IconButton
                    aria-label="New Session"
                    size="xs"
                    variant="ghost"
                    onClick={handleNewSession}
                    color="#38bdf8"
                    _hover={{ bg: 'rgba(56,189,248,0.1)' }}
                  >
                    <LuPlus size={14} />
                  </IconButton>
                  <IconButton
                    aria-label="New Folder"
                    size="xs"
                    variant="ghost"
                    onClick={handleAddFolder}
                    color="#94a3b8"
                    _hover={{ bg: 'rgba(148,163,184,0.1)' }}
                  >
                    <LuFolderPlus size={14} />
                  </IconButton>
                </HStack>
              </HStack>

              <VStack align="stretch" flex={1} overflowY="auto" gap={0} px={2} pb={4} className="custom-scrollbar">
                {isLoading ? (
                  <Flex p={4} justify="center"><Spinner size="sm" color="#38bdf8" /></Flex>
                ) : (
                  <>
                    {/* Folders */}
                    {folders.map((folder) => {
                      const folderSessions = sessions.filter(s => s.folderId === folder.id);
                      return (
                        <Box key={folder.id} mb={1}>
                          <HStack
                            p={2}
                            borderRadius="6px"
                            cursor="pointer"
                            _hover={{ bg: 'rgba(255,255,255,0.03)' }}
                            onClick={() => toggleFolderCollapse(folder.id)}
                            data-group
                          >
                            <Icon as={folder.isCollapsed ? LuChevronRight : LuChevronDown} boxSize="12px" color="#475569" />
                            <Icon as={LuFolder} boxSize="14px" color="#f59e0b" />
                            <Text fontSize="13px" color="#cbd5e1" fontWeight="500" flex={1} lineClamp={1}>
                              {folder.name}
                            </Text>
                            <HStack
                              gap={0}
                              opacity={0}
                              flexShrink={0}
                              transition="opacity 0.2s ease"
                              css={{
                                '[data-group]:hover &': { opacity: 1 }
                              }}
                            >
                              <Box as="button" p="4px" onClick={(e: React.MouseEvent) => handleRenameFolder(e, folder.id, folder.name)} color="#94a3b8" _hover={{ color: 'white' }} transition="color 0.2s">
                                <LuPencil size={14} />
                              </Box>
                              <Box as="button" p="4px" onClick={(e: React.MouseEvent) => handleDeleteFolder(e, folder.id)} color="#ef4444" _hover={{ color: '#ff6b6b' }} transition="color 0.2s">
                                <LuX size={14} />
                              </Box>
                            </HStack>
                          </HStack>
                          
                          {!folder.isCollapsed && (
                            <VStack align="stretch" gap={0} pl={4} mt={1}>
                              {folderSessions.map(session => renderSessionItem(session))}
                            </VStack>
                          )}
                        </Box>
                      );
                    })}

                    {/* Root Sessions (Uncategorized) */}
                    {sessions.filter(s => s.id !== 'local' && (!s.folderId || !folders.find(f => f.id === s.folderId))).map(session => renderSessionItem(session))}

                    {/* Local Terminal (Always at bottom or top?) Let's put at bottom under Uncategorized */}
                    {renderSessionItem(sessions.find(s => s.id === 'local')!)}
                  </>
                )}
              </VStack>
            </>
          ) : (
            <SftpSidebar />
          )}
        </VStack>

        {/* ── Main content area ─────────────────────────────── */}
        <Flex flex={1} direction="column" overflow="hidden">
          {/* Tab bar */}
          <TabBar onNewSession={handleNewSession} />

          {/* Terminal area — all instances rendered, hidden/shown */}
          <TerminalContainer />
        </Flex>
      </Flex>

      <NewSessionModal
        isOpen={isModalOpen}
        onClose={() => setModalOpen(false)}
        editingSession={editingSession}
      />

      <style>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.4; }
          100% { opacity: 1; }
        }
      `}</style>
    </Flex>
  );

  function renderSessionItem(session: Session) {
    if (!session) return null;
    const isActive = activeSessionId === session.id;
    const isOpen = openTabs.includes(session.id);

    return (
      <HStack
        key={session.id}
        onClick={() => handleSidebarClick(session)}
        p={2}
        mb={1}
        borderRadius="8px"
        cursor="pointer"
        transition="all 0.2s cubic-bezier(0.4, 0, 0.2, 1)"
        bg={isActive ? "rgba(56,189,248,0.1)" : "transparent"}
        border="1px solid"
        borderColor={isActive ? "rgba(56,189,248,0.2)" : "transparent"}
        _hover={{
          bg: isActive ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.03)",
          transform: "translateX(4px)"
        }}
        position="relative"
        data-group
      >
        <HStack flex={1} gap={3} overflow="hidden">
          <Box
            p="6px"
            borderRadius="6px"
            bg={isActive ? "#38bdf8" : "rgba(148,163,184,0.1)"}
            transition="all 0.2s"
          >
            <Icon
              as={session.type === 'ssh' ? LuTerminal : LuMonitor}
              boxSize="14px"
              color={isActive ? "white" : "#94a3b8"}
            />
          </Box>
          <VStack align="flex-start" gap={0} overflow="hidden" flex={1}>
            <Text
              fontSize="13px"
              fontWeight={isActive ? "600" : "500"}
              color={isActive ? "white" : "#cbd5e1"}
              lineClamp={1}
            >
              {session.name}
            </Text>
            {session.type === 'ssh' && (
              <Text fontSize="10px" color="#64748b" lineClamp={1}>
                {session.user}@{session.host}
              </Text>
            )}
          </VStack>
        </HStack>

        {/* Open indicator */}
        {isOpen && (
          <Box w="4px" h="4px" borderRadius="full" bg="#818cf8" flexShrink={0} />
        )}

        {/* Edit/Delete buttons — visible on hover */}
        {session.id !== 'local' && (
          <HStack
            gap={1}
            className="sidebar-item-actions"
            opacity={0}
            flexShrink={0}
            transition="opacity 0.2s ease"
            css={{
              '[data-group]:hover &': { opacity: 1 }
            }}
            ml="auto"
            align="center"
          >
            {/* Edit Button */}
            <Box
              as="button"
              p="4px"
              borderRadius="4px"
              color="#818cf8"
              display="flex"
              alignItems="center"
              justifyContent="center"
              onClick={(e: React.MouseEvent) => handleEdit(e, session)}
              _hover={{ bg: 'rgba(129,140,248,0.2)' }}
              transition="all 0.2s"
              title="Edit Session"
            >
              <LuPencil size={14} />
            </Box>

            {/* Delete Button */}
            <Box
              as="button"
              p="4px"
              borderRadius="4px"
              color="#ef4444"
              display="flex"
              alignItems="center"
              justifyContent="center"
              onClick={(e: React.MouseEvent) => handleDelete(e, session.id)}
              _hover={{ bg: 'rgba(239,68,68,0.2)' }}
              transition="all 0.2s"
              title="Delete Session"
            >
              <LuX size={14} />
            </Box>
          </HStack>
        )}
      </HStack>
    );
  }
}

export default App;
