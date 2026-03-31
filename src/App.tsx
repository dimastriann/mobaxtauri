import { useEffect, useState } from 'react';
import { Flex, Box, VStack, HStack, Text, IconButton, Spinner, Icon } from "@chakra-ui/react";
import { LuPlus, LuPencil, LuX, LuTerminal } from "react-icons/lu";
import Terminal from './components/Terminal';
import NewSessionModal from './components/NewSessionModal';
import { Session, useSessionStore } from './store/useSessionStore';
import { invoke } from '@tauri-apps/api/core';

function App() {
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | undefined>(undefined);
  const { sessions, activeSessionId, setActiveSession, deleteSession, loadSessions, isLoading } = useSessionStore();

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
    if (window.confirm('Are you sure you want to delete this session?')) {
      if (id.startsWith('ssh-')) {
        try {
          await invoke('ssh_disconnect', { sessionId: id });
        } catch (err) {
          console.warn('Session already disconnected or not found in backend:', err);
        }
      }
      deleteSession(id);
    }
  };

  return (
    <Flex h="100vh" direction="column" bg="bg.canvas" color="fg.default" overflow="hidden">
      {/* Titlebar placeholder for Tauri dragging or custom controls */}
      <Box h="32px" bg="bg.muted" borderBottom="1px solid" borderColor="border.subtle" px={4} display="flex" alignItems="center">
        <HStack gap={2}>
          <Icon as={LuTerminal} size="sm" color="blue.500" />
          <Text fontSize="xs" fontWeight="bold" letterSpacing="widest" color="fg.muted">MOBAXTAURI</Text>
        </HStack>
      </Box>

      <Flex flex={1} overflow="hidden">
        {/* Sidebar */}
        <VStack
          w="260px"
          bg="bg.muted"
          borderRight="1px solid"
          borderColor="border.subtle"
          align="stretch"
          gap={0}
        >
          <HStack p={4} justify="space-between">
            <Text fontSize="xs" fontWeight="bold" letterSpacing="0.05em" color="fg.subtle">SESSIONS</Text>
            <IconButton 
              aria-label="New Session" 
              size="xs" 
              variant="ghost" 
              color="blue.500"
              onClick={handleNewSession}
            >
              <LuPlus />
            </IconButton>
          </HStack>

          <VStack align="stretch" flex={1} overflowY="auto" gap={1} px={2}>
            {isLoading ? (
              <Flex p={4} justify="center"><Spinner size="sm" /></Flex>
            ) : sessions.map((session) => (
              <HStack
                key={session.id}
                onClick={() => setActiveSession(session.id)}
                p={2}
                cursor="pointer"
                borderRadius="md"
                bg={activeSessionId === session.id ? "bg.subtle" : "transparent"}
                color={activeSessionId === session.id ? "fg.default" : "fg.subtle"}
                _hover={{ bg: "bg.emphasized", color: "fg.default" }}
                transition="all 0.2s"
                data-group
              >
                <HStack flex={1} gap={3} overflow="hidden">
                  <Box 
                    w="8px" 
                    h="8px" 
                    borderRadius="full" 
                    bg={
                      session.status === 'connected' ? 'green.500' :
                      session.status === 'connecting' ? 'orange.500' :
                      session.status === 'error' ? 'red.500' : 'gray.500'
                    }
                    animation={session.status === 'connecting' ? 'pulse 2s infinite' : undefined}
                  />
                  <Text fontSize="sm" truncate>{session.name}</Text>
                </HStack>
                {session.id !== 'local' && (
                  <HStack gap={1} opacity={0} _groupHover={{ opacity: 1 }} transition="opacity 0.2s">
                    <IconButton 
                      aria-label="Edit" 
                      size="xs" 
                      variant="ghost" 
                      color="blue.400"
                      onClick={(e) => handleEdit(e, session)}
                    >
                      <LuPencil />
                    </IconButton>
                    <IconButton 
                      aria-label="Delete" 
                      size="xs" 
                      variant="ghost" 
                      color="red.400"
                      onClick={(e) => handleDelete(e, session.id)}
                    >
                      <LuX />
                    </IconButton>
                  </HStack>
                )}
              </HStack>
            ))}
          </VStack>
        </VStack>

        {/* Content Area */}
        <Box flex={1} bg="black" position="relative" h="full" w="full">
          {activeSessionId && <Terminal key={activeSessionId} />}
        </Box>
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
}

export default App;
