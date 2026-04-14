import React from 'react';
import { HStack, Box, Text, IconButton, Icon } from '@chakra-ui/react';
import { LuPlus, LuX } from 'react-icons/lu';
import { Session, useSessionStore } from '../store/useSessionStore';

interface TabBarProps {
  onNewSession: () => void;
}

const statusColor = (status: Session['status']) => {
  switch (status) {
    case 'connected': return '#22c55e';
    case 'connecting': return '#f97316';
    case 'error': return '#ef4444';
    default: return '#6b7280';
  }
};

const TabBar: React.FC<TabBarProps> = ({ onNewSession }) => {
  const { sessions, openTabs, activeSessionId, setActiveSession, closeTab } = useSessionStore();

  const openSessions = openTabs
    .map((id) => sessions.find((s) => s.id === id))
    .filter(Boolean) as Session[];

  const handleClose = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    closeTab(id);
  };

  const handleMiddleClick = (e: React.MouseEvent, id: string) => {
    if (e.button === 1) {
      e.preventDefault();
      closeTab(id);
    }
  };

  const handleDoubleClickBar = (e: React.MouseEvent) => {
    // Double-click on empty space in bar opens a new session
    if ((e.target as HTMLElement).closest('[data-tab]')) return;
    onNewSession();
  };

  return (
    <Box
      className="tabbar"
      h="36px"
      minH="36px"
      bg="bg.muted"
      borderBottom="1px solid"
      borderColor="border.subtle"
      display="flex"
      alignItems="stretch"
      onDoubleClick={handleDoubleClickBar}
      overflow="hidden"
    >
      {/* Scrollable tab area */}
      <HStack
        className="tabbar-scroll"
        flex={1}
        gap={0}
        overflowX="auto"
        overflowY="hidden"
        css={{
          '&::-webkit-scrollbar': { height: '2px' },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,0.1)', borderRadius: '1px' },
        }}
      >
        {openSessions.map((session, index) => {
          const isActive = session.id === activeSessionId;
          return (
            <Box
              key={session.id}
              data-tab
              onClick={() => setActiveSession(session.id)}
              onMouseDown={(e) => handleMiddleClick(e, session.id)}
              display="flex"
              alignItems="center"
              gap="8px"
              px="14px"
              h="100%"
              cursor="pointer"
              position="relative"
              minW="120px"
              maxW="200px"
              bg={isActive ? 'blue.subtle' : 'transparent'}
              borderRight="1px solid"
              borderColor="border.subtle"
              transition="all 0.15s ease"
              _hover={{
                bg: isActive ? 'blue.muted' : 'bg.emphasized',
              }}
              title={session.host ? `${session.user || ''}@${session.host}:${session.port || 22}` : session.name}
            >
              {/* Active indicator bar */}
              {isActive && (
                <Box
                  position="absolute"
                  bottom="0"
                  left="0"
                  right="0"
                  h="2px"
                  bg="blue.fg"
                  borderRadius="1px 1px 0 0"
                />
              )}

              {/* Tab number */}
              <Text
                fontSize="10px"
                fontWeight="bold"
                color={isActive ? 'blue.fg' : 'fg.muted'}
                minW="14px"
                textAlign="center"
                userSelect="none"
              >
                {index + 1}.
              </Text>

              {/* Status dot */}
              <Box
                w="7px"
                h="7px"
                borderRadius="full"
                bg={statusColor(session.status)}
                flexShrink={0}
                boxShadow={session.status === 'connected' ? `0 0 6px ${statusColor(session.status)}` : undefined}
                animation={session.status === 'connecting' ? 'pulse 2s infinite' : undefined}
              />

              {/* Session name */}
              <Text
                fontSize="12px"
                fontWeight={isActive ? '600' : '400'}
                color={isActive ? 'fg' : 'fg.muted'}
                overflow="hidden"
                textOverflow="ellipsis"
                whiteSpace="nowrap"
                flex={1}
                userSelect="none"
              >
                {session.name}
              </Text>

              {/* Close button */}
              <Box
                as="button"
                onClick={(e: React.MouseEvent) => handleClose(e, session.id)}
                display="flex"
                alignItems="center"
                justifyContent="center"
                w="18px"
                h="18px"
                borderRadius="3px"
                flexShrink={0}
                opacity={isActive ? 0.6 : 0}
                transition="all 0.15s ease"
                _hover={{ opacity: 1, bg: 'red.subtle' }}
                _groupHover={{ opacity: 0.4 }}
                color="fg.muted"
                css={{
                  'div:hover > &': { opacity: 0.4 },
                  '&:hover': { opacity: '1 !important', color: 'red.fg' },
                }}
              >
                <Icon as={LuX} boxSize="12px" />
              </Box>
            </Box>
          );
        })}
      </HStack>

      {/* New tab button */}
      <Box
        display="flex"
        alignItems="center"
        px="10px"
        borderLeft="1px solid"
        borderColor="border.subtle"
      >
        <IconButton
          aria-label="New Session"
          size="xs"
          variant="ghost"
          color="blue.fg"
          onClick={onNewSession}
          minW="26px"
          h="26px"
          borderRadius="4px"
          _hover={{ bg: 'blue.subtle' }}
        >
          <LuPlus />
        </IconButton>
      </Box>
    </Box>
  );
};

export default TabBar;
