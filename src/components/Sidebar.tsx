import React from 'react';
import { VStack, HStack, Text, Box, Icon, IconButton, Spinner, Flex } from "@chakra-ui/react";
import { 
  LuPlus, LuFolderPlus, LuChevronRight, LuChevronDown, LuFolder, LuTerminal, LuMonitor, LuCode
} from "react-icons/lu";
import { Session, useSessionStore } from '../store/useSessionStore';
import SftpSidebar from './SftpSidebar';

interface SidebarProps {
  sidebarTab: 'sessions' | 'sftp' | 'snippets';
  setSidebarTab: (tab: 'sessions' | 'sftp' | 'snippets') => void;
  onNewSession: () => void;
  onEditSession: (session: Session) => void;
  onDeleteSession: (id: string) => void;
  onAddFolder: () => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onAddSnippet: () => void;
  onEditSnippet: (id: string, name: string, command: string) => void;
  onExecuteSnippet: (command: string) => void;
  onContextMenu: (e: React.MouseEvent, type: any, id?: string, name?: string, command?: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  sidebarTab, setSidebarTab, onNewSession, onEditSession, onDeleteSession,
  onAddFolder, onRenameFolder, onDeleteFolder, onAddSnippet, onEditSnippet, onExecuteSnippet,
  onContextMenu
}) => {
  const sessions = useSessionStore((state) => state.sessions);
  const folders = useSessionStore((state) => state.folders);
  const snippets = useSessionStore((state) => state.snippets);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const openTabs = useSessionStore((state) => state.openTabs);
  const isLoading = useSessionStore((state) => state.isLoading);
  const toggleFolderCollapse = useSessionStore((state) => state.toggleFolderCollapse);
  const openTab = useSessionStore((state) => state.openTab);

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
        onContextMenu={(e) => onContextMenu(e, 'session', session.id, session.name)}
        draggable={session.id !== 'local'}
        onDragStart={(e) => handleDragStart(e, session.id)}
        onClick={() => openTab(session.id)}
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
              <IconButton aria-label="New Session" size="xs" variant="ghost" onClick={onNewSession} color="blue.fg"><LuPlus size={14} /></IconButton>
              <IconButton aria-label="New Folder" size="xs" variant="ghost" onClick={onAddFolder} color="fg.muted"><LuFolderPlus size={14} /></IconButton>
            </HStack>
          </HStack>

          <VStack 
            align="stretch" flex={1} overflowY="auto" gap={0} px={2} pb={4} className="custom-scrollbar"
            onContextMenu={(e) => onContextMenu(e, 'empty')}
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
                      onContextMenu={(e) => onContextMenu(e, 'folder', folder.id, folder.name)}
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
            <IconButton aria-label="New Snippet" size="xs" variant="ghost" onClick={onAddSnippet} color="blue.fg"><LuPlus size={14} /></IconButton>
          </HStack>
          <VStack align="stretch" flex={1} overflowY="auto" gap={0} px={2} pb={4} className="custom-scrollbar" onContextMenu={(e) => onContextMenu(e, 'empty')}>
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
                  onClick={() => onExecuteSnippet(snippet.command)}
                  onContextMenu={(e) => onContextMenu(e, 'snippet', snippet.id, snippet.name, snippet.command)}
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
  );
};

export default Sidebar;
