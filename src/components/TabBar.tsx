import React, { useState } from 'react';
import { HStack, Box, Text, IconButton, Icon } from '@chakra-ui/react';
import {
  LuBell,
  LuChevronLeft,
  LuChevronRight,
  LuColumns2,
  LuLayoutGrid,
  LuPlus,
  LuRows2,
  LuX,
} from 'react-icons/lu';
import { Session, useSessionStore } from '../store/useSessionStore';
import { buildTabDisplayNames } from '../utils/sessionTabs';
import { useTranslation } from '../store/useLocaleStore';
import type { WorkspacePaneLayout } from '../utils/workspacePanes';
import { ask } from '@tauri-apps/plugin-dialog';

interface TabBarProps {
  onNewSession: () => void;
  paneCount: number;
  paneLayout: WorkspacePaneLayout;
  onSetPaneLayout: (layout: WorkspacePaneLayout | 'single') => void;
  onActivateSession: (sessionId: string) => void;
}

const statusColor = (status: Session['status']) => {
  switch (status) {
    case 'connected':
      return '#22c55e';
    case 'connecting':
      return '#f97316';
    case 'error':
      return '#ef4444';
    default:
      return '#6b7280';
  }
};

const TabBar: React.FC<TabBarProps> = ({
  onNewSession,
  paneCount,
  paneLayout,
  onSetPaneLayout,
  onActivateSession,
}) => {
  const { t } = useTranslation();
  const { sessions, openTabs, activeSessionId, closeTab, reorderTabs } = useSessionStore();
  const [checkedTabs, setCheckedTabs] = useState<string[]>([]);

  const selectedTabs = checkedTabs.filter((id) => openTabs.includes(id));

  const openSessions = openTabs
    .map((id) => sessions.find((s) => s.id === id))
    .filter(Boolean) as Session[];

  const displayNames = buildTabDisplayNames(openSessions, sessions);

  const handleClose = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const session = sessions.find((s) => s.id === id);
    // Show confirmation dialog only for SSH sessions to avoid accidental disconnect
    if (session?.type === 'ssh' && session.status === 'connected') {
      const confirmed = await ask(t('tabs.closeConfirm', { name: session.name }), {
        title: t('tabs.closeTitle'),
        kind: 'warning',
      });
      if (!confirmed) return;
    }
    closeTab(id);
  };

  const handleMiddleClick = async (e: React.MouseEvent, id: string) => {
    if (e.button === 1) {
      e.preventDefault();
      const session = sessions.find((s) => s.id === id);
      if (session?.type === 'ssh' && session.status === 'connected') {
        const confirmed = await ask(t('tabs.closeConfirm', { name: session.name }), {
          title: t('tabs.closeTitle'),
          kind: 'warning',
        });
        if (!confirmed) return;
      }
      closeTab(id);
    }
  };

  const handleDoubleClickBar = (e: React.MouseEvent) => {
    // Double-click on empty space in bar opens a new session
    if ((e.target as HTMLElement).closest('[data-tab]')) return;
    onNewSession();
  };

  const handleTabClick = (event: React.MouseEvent, sessionId: string) => {
    if (event.ctrlKey || event.metaKey) {
      setCheckedTabs((selected) =>
        selected.includes(sessionId)
          ? selected.filter((id) => id !== sessionId)
          : [...selected, sessionId],
      );
      return;
    }
    setCheckedTabs([]);
    onActivateSession(sessionId);
  };

  const closeSelectedTabs = async () => {
    const connectedCount = selectedTabs.filter((id) => {
      const session = sessions.find((item) => item.id === id);
      return session?.type === 'ssh' && session.status === 'connected';
    }).length;
    if (
      connectedCount > 0 &&
      !(await ask(t('tabs.closeSelectedConfirm', { count: selectedTabs.length }), {
        title: t('tabs.closeSelectedTitle'),
        kind: 'warning',
      }))
    )
      return;
    selectedTabs.forEach(closeTab);
    setCheckedTabs([]);
  };

  const moveSelectedTabs = (direction: -1 | 1) => {
    const reordered = [...openTabs];
    const selected = new Set(selectedTabs);
    const indices = reordered
      .map((id, index) => (selected.has(id) ? index : -1))
      .filter((index) => index >= 0);
    const orderedIndices = direction < 0 ? indices : indices.reverse();
    orderedIndices.forEach((index) => {
      const target = index + direction;
      if (target < 0 || target >= reordered.length || selected.has(reordered[target])) return;
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    });
    reorderTabs(reordered);
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
        role="tablist"
        aria-label={t('tabs.list')}
        className="tabbar-scroll"
        flex={1}
        gap={0}
        overflowX="auto"
        overflowY="hidden"
        css={{
          '&::-webkit-scrollbar': { height: '2px' },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '1px',
          },
        }}
      >
        {openSessions.map((session, index) => {
          const isActive = session.id === activeSessionId;
          return (
            <Box
              key={session.id}
              data-tab
              data-tab-id={session.id}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onKeyDown={(event) => {
                const ids = openSessions.map((entry) => entry.id);
                const index = ids.indexOf(session.id);
                if (event.key === 'Delete') {
                  event.preventDefault();
                  closeTab(session.id);
                  return;
                }
                let nextIndex: number | null = null;
                if (event.key === 'ArrowRight') nextIndex = (index + 1) % ids.length;
                else if (event.key === 'ArrowLeft')
                  nextIndex = (index - 1 + ids.length) % ids.length;
                else if (event.key === 'Home') nextIndex = 0;
                else if (event.key === 'End') nextIndex = ids.length - 1;
                if (nextIndex === null) return;
                event.preventDefault();
                const nextId = ids[nextIndex];
                onActivateSession(nextId);
                requestAnimationFrame(() => {
                  document.querySelector<HTMLElement>(`[data-tab-id="${nextId}"]`)?.focus();
                });
              }}
              onClick={(event) => handleTabClick(event, session.id)}
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
              bg={
                selectedTabs.includes(session.id)
                  ? 'purple.subtle'
                  : isActive
                    ? 'blue.subtle'
                    : 'transparent'
              }
              borderRight="1px solid"
              borderColor="border.subtle"
              transition="all 0.15s ease"
              _hover={{
                bg: isActive ? 'blue.muted' : 'bg.emphasized',
              }}
              title={
                session.host
                  ? `${session.user || ''}@${session.host}:${session.port || 22}`
                  : session.name
              }
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
                boxShadow={
                  session.status === 'connected'
                    ? `0 0 6px ${statusColor(session.status)}`
                    : undefined
                }
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
                {displayNames.get(session.id) ?? session.name}
              </Text>

              {session.hasBell && (
                <Icon
                  as={LuBell}
                  boxSize="12px"
                  color="orange.fg"
                  flexShrink={0}
                  aria-label={t('tabs.bell')}
                />
              )}

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
        {selectedTabs.length > 0 && (
          <HStack gap={0} mr={1}>
            <Text fontSize="10px" color="fg.muted" px={1}>
              {selectedTabs.length}
            </Text>
            <IconButton
              aria-label={t('tabs.moveLeft')}
              title={t('tabs.moveLeft')}
              size="xs"
              variant="ghost"
              onClick={() => moveSelectedTabs(-1)}
            >
              <LuChevronLeft />
            </IconButton>
            <IconButton
              aria-label={t('tabs.moveRight')}
              title={t('tabs.moveRight')}
              size="xs"
              variant="ghost"
              onClick={() => moveSelectedTabs(1)}
            >
              <LuChevronRight />
            </IconButton>
            <IconButton
              aria-label={t('tabs.closeSelected')}
              title={t('tabs.closeSelected')}
              size="xs"
              variant="ghost"
              color="red.fg"
              onClick={closeSelectedTabs}
            >
              <LuX />
            </IconButton>
          </HStack>
        )}
        <IconButton
          aria-label={t('tabs.splitColumns')}
          title={t('tabs.splitColumns')}
          size="xs"
          variant="ghost"
          color={paneCount === 2 && paneLayout === 'columns' ? 'blue.fg' : 'fg.muted'}
          onClick={() =>
            onSetPaneLayout(paneCount === 2 && paneLayout === 'columns' ? 'single' : 'columns')
          }
          disabled={openTabs.length < 2}
          minW="26px"
          h="26px"
          borderRadius="4px"
          _hover={{ bg: 'blue.subtle' }}
        >
          <LuColumns2 />
        </IconButton>
        <IconButton
          aria-label={t('tabs.splitRows')}
          title={t('tabs.splitRows')}
          size="xs"
          variant="ghost"
          color={paneCount === 2 && paneLayout === 'rows' ? 'blue.fg' : 'fg.muted'}
          onClick={() =>
            onSetPaneLayout(paneCount === 2 && paneLayout === 'rows' ? 'single' : 'rows')
          }
          disabled={openTabs.length < 2}
          minW="26px"
          h="26px"
          borderRadius="4px"
          _hover={{ bg: 'blue.subtle' }}
        >
          <LuRows2 />
        </IconButton>
        <IconButton
          aria-label={t('tabs.splitGrid')}
          title={t('tabs.splitGrid')}
          size="xs"
          variant="ghost"
          color={paneCount === 4 && paneLayout === 'grid' ? 'blue.fg' : 'fg.muted'}
          onClick={() =>
            onSetPaneLayout(paneCount === 4 && paneLayout === 'grid' ? 'single' : 'grid')
          }
          disabled={openTabs.length < 4}
          minW="26px"
          h="26px"
          borderRadius="4px"
          _hover={{ bg: 'blue.subtle' }}
        >
          <LuLayoutGrid />
        </IconButton>
        <IconButton
          aria-label={t('tabs.newSession')}
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
