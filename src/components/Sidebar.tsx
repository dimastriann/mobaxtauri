import React, { useRef, useEffect, useState } from 'react';
import {
  VStack,
  HStack,
  Text,
  Box,
  Icon,
  IconButton,
  Spinner,
  Flex,
  Input,
  Button,
} from '@chakra-ui/react';
import {
  LuPlus,
  LuFolderPlus,
  LuChevronRight,
  LuChevronDown,
  LuFolder,
  LuCode,
  LuDownload,
  LuUpload,
  LuPanelLeftClose,
  LuPanelLeftOpen,
  LuSearch,
  LuX,
  LuLayers,
  LuSave,
  LuTrash2,
  LuListTree,
  LuFolderTree,
  LuNetwork,
} from 'react-icons/lu';
import type { IconType } from 'react-icons';
import {
  Session,
  Folder,
  Snippet,
  sessionConfigId,
  useSessionStore,
} from '../store/useSessionStore';
import { useExportImport } from '../hooks/useExportImport';
import SftpSidebar from './SftpSidebar';
import ForwardSidebar from './ForwardSidebar';
import OSIcon from './OSIcon';
import { Tooltip } from './ui/tooltip';
import { useTranslation } from '../store/useLocaleStore';

type SidebarMenuType = 'folder' | 'session' | 'empty' | 'snippet' | 'input' | 'import';

export type SidebarTabId = 'sessions' | 'sftp' | 'snippets' | 'tunnels';

const SIDEBAR_TABS: { id: SidebarTabId; label: string; icon: IconType }[] = [
  { id: 'sessions', label: 'Sessions', icon: LuListTree },
  { id: 'sftp', label: 'SFTP', icon: LuFolderTree },
  { id: 'snippets', label: 'Snippets', icon: LuCode },
  { id: 'tunnels', label: 'Tunnels', icon: LuNetwork },
];

// ── Sub-component: SessionItem ──────────────────────────────────────
interface SessionItemProps {
  session: Session;
  isActive: boolean;
  isOpen: boolean;
  onDragStart: (e: React.DragEvent, sessionId: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string, name: string) => void;
  onOpen: () => void;
  onOpenNew: () => void;
}

const SessionItem: React.FC<SessionItemProps> = ({
  session,
  isActive,
  isOpen,
  onDragStart,
  onContextMenu,
  onOpen,
  onOpenNew,
}) => {
  const { t } = useTranslation();
  let tagColorStr = 'transparent';
  if (session.tag === 'prod') tagColorStr = 'red.400';
  else if (session.tag === 'staging') tagColorStr = 'orange.400';
  else if (session.tag === 'dev') tagColorStr = 'green.400';
  else if (session.tag === 'custom' && session.tagColor) tagColorStr = session.tagColor;

  return (
    <HStack
      p={2}
      mb={1}
      borderRadius="8px"
      cursor="pointer"
      bg={isActive ? 'blue.subtle' : 'transparent'}
      borderLeft="3px solid"
      borderColor={tagColorStr}
      _hover={{ bg: isActive ? 'blue.muted' : 'whiteAlpha.100' }}
      onContextMenu={(e) => onContextMenu(e, session.id, session.name)}
      draggable={session.id !== 'local'}
      onDragStart={(e) => onDragStart(e, session.id)}
      onDoubleClick={(event) => {
        if (event.ctrlKey || event.metaKey) onOpenNew();
        else onOpen();
      }}
      tabIndex={0}
      role="button"
      aria-label={`${isOpen ? t('sidebar.activateSession', { name: session.name }) : t('sidebar.connectSession', { name: session.name })} (${t('sidebar.newConnectionHint')})`}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
    >
      <OSIcon
        os={session.type === 'ssh' ? session.os : 'local'}
        boxSize={3.5}
        color={isActive ? 'blue.fg' : 'fg.muted'}
      />
      <Text fontSize="13px" color={isActive ? 'fg' : 'fg.muted'} flex={1} lineClamp={1}>
        {session.name}
      </Text>
      {isOpen && <Box w="4px" h="4px" borderRadius="full" bg="blue.fg" />}
    </HStack>
  );
};

// ── Sub-component: SessionsTab ──────────────────────────────────────
interface SessionsTabProps {
  sessions: Session[];
  folders: Folder[];
  isLoading: boolean;
  activeSessionId: string | null;
  openTabs: string[];
  onNewSession: () => void;
  onAddFolder: () => void;
  onSaveWorkspace: () => void;
  onRestoreWorkspace: (workspaceId: string) => void;
  onContextMenu: (e: React.MouseEvent, type: SidebarMenuType, id?: string, name?: string) => void;
  handleExport: () => void;
  handleDropOnFolder: (e: React.DragEvent, folderId: string | null) => void;
  handleDragStart: (e: React.DragEvent, sessionId: string) => void;
  toggleFolderCollapse: (id: string) => void;
  openConfig: (id: string) => void;
  openNewInstance: (id: string) => void;
}

const SessionsTab: React.FC<SessionsTabProps> = ({
  sessions,
  folders,
  isLoading,
  activeSessionId,
  openTabs,
  onNewSession,
  onAddFolder,
  onSaveWorkspace,
  onRestoreWorkspace,
  onContextMenu,
  handleExport,
  handleDropOnFolder,
  handleDragStart,
  toggleFolderCollapse,
  openConfig,
  openNewInstance,
}) => {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const visibleSessions = sessions.filter((session) => !session.ephemeral);
  const filteredSessions = normalizedQuery
    ? visibleSessions.filter((session) =>
        [session.name, session.host, session.tag].some((value) =>
          value?.toLocaleLowerCase().includes(normalizedQuery),
        ),
      )
    : visibleSessions;
  const localSession = filteredSessions.find((s) => s.id === 'local');
  const hasResults = filteredSessions.length > 0;
  const workspaces = useSessionStore((state) => state.workspaces);
  const deleteWorkspace = useSessionStore((state) => state.deleteWorkspace);
  const openConfigIds = new Set(
    openTabs
      .map((tabId) => sessions.find((session) => session.id === tabId))
      .filter((session): session is Session => Boolean(session))
      .map(sessionConfigId),
  );
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const activeConfigId = activeSession ? sessionConfigId(activeSession) : null;

  useEffect(() => {
    const focusSearch = () => searchInputRef.current?.focus();
    window.addEventListener('focus-session-search', focusSearch);
    return () => window.removeEventListener('focus-session-search', focusSearch);
  }, []);

  return (
    <>
      <HStack p={3} justify="space-between">
        <Text fontSize="11px" fontWeight="bold" color="fg.subtle" letterSpacing="0.05em">
          {t('sidebar.list')}
        </Text>
        <HStack gap={1}>
          <IconButton
            aria-label={t('sidebar.importBookmarks')}
            size="xs"
            variant="ghost"
            onClick={(e) => onContextMenu(e, 'import')}
            color="fg.muted"
          >
            <LuUpload size={14} />
          </IconButton>
          <IconButton
            aria-label={t('sidebar.exportBookmarks')}
            size="xs"
            variant="ghost"
            onClick={handleExport}
            color="fg.muted"
          >
            <LuDownload size={14} />
          </IconButton>
          <IconButton
            aria-label={t('sidebar.newSession')}
            size="xs"
            variant="ghost"
            onClick={onNewSession}
            color="blue.fg"
          >
            <LuPlus size={14} />
          </IconButton>
          <IconButton
            aria-label={t('sidebar.newFolder')}
            size="xs"
            variant="ghost"
            onClick={onAddFolder}
            color="fg.muted"
          >
            <LuFolderPlus size={14} />
          </IconButton>
        </HStack>
      </HStack>

      {!normalizedQuery && (
        <Box px={2} pb={2}>
          <HStack px={1} pb={1} justify="space-between">
            <HStack gap={1.5} color="fg.subtle">
              <LuLayers size={12} />
              <Text fontSize="10px" fontWeight="bold" letterSpacing="0.05em">
                {t('sidebar.workspaces')}
              </Text>
            </HStack>
            <IconButton
              aria-label={t('sidebar.saveWorkspace')}
              title={t('sidebar.saveWorkspace')}
              size="2xs"
              variant="ghost"
              onClick={onSaveWorkspace}
            >
              <LuSave size={12} />
            </IconButton>
          </HStack>
          {workspaces.length === 0 ? (
            <Text px={1} fontSize="10px" color="fg.subtle">
              {t('sidebar.saveWorkspaceHint')}
            </Text>
          ) : (
            workspaces.map((workspace) => (
              <HStack
                key={workspace.id}
                px={2}
                py={1.5}
                borderRadius="6px"
                cursor="pointer"
                _hover={{ bg: 'bg.emphasized' }}
                onClick={() => onRestoreWorkspace(workspace.id)}
              >
                <LuLayers size={13} />
                <Text flex={1} minW={0} fontSize="12px" lineClamp={1}>
                  {workspace.name}
                </Text>
                <Text fontSize="10px" color="fg.subtle">
                  {workspace.configIds.length}
                </Text>
                <IconButton
                  aria-label={t('sidebar.deleteWorkspace', { name: workspace.name })}
                  size="2xs"
                  variant="ghost"
                  color="fg.muted"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteWorkspace(workspace.id);
                  }}
                >
                  <LuTrash2 size={11} />
                </IconButton>
              </HStack>
            ))
          )}
        </Box>
      )}

      <HStack px={3} pb={2} position="relative">
        <Icon
          as={LuSearch}
          boxSize="14px"
          color="fg.subtle"
          position="absolute"
          left="22px"
          zIndex={1}
          pointerEvents="none"
        />
        <Input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t('sidebar.searchPlaceholder')}
          aria-label={t('sidebar.searchAria')}
          size="xs"
          pl="28px"
          pr={searchQuery ? '28px' : undefined}
          borderRadius="6px"
        />
        {searchQuery && (
          <IconButton
            aria-label={t('sidebar.clearSearch')}
            title={t('sidebar.clearSearch')}
            size="2xs"
            variant="ghost"
            position="absolute"
            right="18px"
            onClick={() => setSearchQuery('')}
          >
            <LuX size={12} />
          </IconButton>
        )}
      </HStack>

      <VStack
        align="stretch"
        flex={1}
        overflowY="auto"
        gap={0}
        px={2}
        pb={4}
        className="custom-scrollbar"
        role="list"
        onKeyDown={(event) => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          const rows = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>('[role="button"]'),
          );
          if (!rows.length) return;
          const current = rows.indexOf(document.activeElement as HTMLElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? rows.length - 1
                : event.key === 'ArrowDown'
                  ? Math.min(current + 1, rows.length - 1)
                  : Math.max(current - 1, 0);
          event.preventDefault();
          rows[next]?.focus();
        }}
        onContextMenu={(e) => onContextMenu(e, 'empty')}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => handleDropOnFolder(e, null)}
      >
        {isLoading ? (
          <Flex p={4} justify="center">
            <Spinner size="sm" color="blue.fg" />
          </Flex>
        ) : (
          <>
            {folders.map((folder) => {
              const folderSessions = filteredSessions.filter((s) => s.folderId === folder.id);
              if (normalizedQuery && folderSessions.length === 0) return null;
              return (
                <Box
                  key={folder.id}
                  mb={1}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDropOnFolder(e, folder.id)}
                  onContextMenu={(e) => onContextMenu(e, 'folder', folder.id, folder.name)}
                >
                  <HStack
                    p={2}
                    borderRadius="6px"
                    cursor="pointer"
                    _hover={{ bg: 'bg.emphasized' }}
                    onClick={() => toggleFolderCollapse(folder.id)}
                  >
                    <Icon
                      as={folder.isCollapsed ? LuChevronRight : LuChevronDown}
                      boxSize="12px"
                      color="fg.muted"
                    />
                    <Icon as={LuFolder} boxSize="14px" color="orange.fg" />
                    <Text fontSize="13px" color="fg" fontWeight="500" flex={1} lineClamp={1}>
                      {folder.name}
                    </Text>
                  </HStack>
                  {(!folder.isCollapsed || normalizedQuery) && (
                    <VStack align="stretch" gap={0} pl={4} mt={1}>
                      {folderSessions.map((session) => (
                        <SessionItem
                          key={session.id}
                          session={session}
                          isActive={activeConfigId === session.id}
                          isOpen={openConfigIds.has(session.id)}
                          onDragStart={handleDragStart}
                          onContextMenu={(e, id, name) => onContextMenu(e, 'session', id, name)}
                          onOpen={() => openConfig(session.id)}
                          onOpenNew={() => openNewInstance(session.id)}
                        />
                      ))}
                    </VStack>
                  )}
                </Box>
              );
            })}
            {filteredSessions
              .filter(
                (s) =>
                  s.id !== 'local' && (!s.folderId || !folders.some((f) => f.id === s.folderId)),
              )
              .map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={activeConfigId === session.id}
                  isOpen={openConfigIds.has(session.id)}
                  onDragStart={handleDragStart}
                  onContextMenu={(e, id, name) => onContextMenu(e, 'session', id, name)}
                  onOpen={() => openConfig(session.id)}
                  onOpenNew={() => openNewInstance(session.id)}
                />
              ))}
            {localSession && (
              <SessionItem
                session={localSession}
                isActive={activeConfigId === localSession.id}
                isOpen={openConfigIds.has(localSession.id)}
                onDragStart={handleDragStart}
                onContextMenu={(e, id, name) => onContextMenu(e, 'session', id, name)}
                onOpen={() => openConfig(localSession.id)}
                onOpenNew={() => openNewInstance(localSession.id)}
              />
            )}
            {!hasResults && (
              <Flex p={6} direction="column" align="center" gap={2} color="fg.muted">
                <Icon as={LuSearch} boxSize="20px" />
                <Text fontSize="12px" textAlign="center">
                  No sessions match “{searchQuery.trim()}”
                </Text>
              </Flex>
            )}
          </>
        )}
      </VStack>
    </>
  );
};

// ── Sub-component: SnippetsTab ──────────────────────────────────────
interface SnippetsTabProps {
  snippets: Snippet[];
  onAddSnippet: () => void;
  onExecuteSnippet: (command: string) => void;
  onContextMenu: (
    e: React.MouseEvent,
    type: SidebarMenuType,
    id?: string,
    name?: string,
    command?: string,
  ) => void;
}

const SnippetsTab: React.FC<SnippetsTabProps> = ({
  snippets,
  onAddSnippet,
  onExecuteSnippet,
  onContextMenu,
}) => {
  const { t } = useTranslation();
  return (
    <>
      <HStack p={3} justify="space-between">
        <Text fontSize="11px" fontWeight="bold" color="fg.subtle" letterSpacing="0.05em">
          {t('sidebar.quickCommands')}
        </Text>
        <IconButton
          aria-label={t('sidebar.newSnippet')}
          size="xs"
          variant="ghost"
          onClick={onAddSnippet}
          color="blue.fg"
        >
          <LuPlus size={14} />
        </IconButton>
      </HStack>
      <VStack
        align="stretch"
        flex={1}
        overflowY="auto"
        gap={0}
        px={2}
        pb={4}
        className="custom-scrollbar"
        onContextMenu={(e) => onContextMenu(e, 'empty')}
      >
        {snippets.length === 0 ? (
          <Flex
            p={4}
            direction="column"
            align="center"
            justify="center"
            gap={2}
            opacity={0.5}
            mt={10}
          >
            <Icon as={LuCode} boxSize="24px" />
            <Text fontSize="11px" textAlign="center">
              {t('sidebar.noSnippets')}
            </Text>
          </Flex>
        ) : (
          snippets.map((snippet) => (
            <HStack
              key={snippet.id}
              p={2}
              mb={1}
              borderRadius="8px"
              cursor="pointer"
              _hover={{ bg: 'bg.emphasized' }}
              onClick={() => onExecuteSnippet(snippet.command)}
              onContextMenu={(e) =>
                onContextMenu(e, 'snippet', snippet.id, snippet.name, snippet.command)
              }
            >
              <Icon as={LuCode} boxSize="14px" color="blue.fg" />
              <VStack align="flex-start" gap={0} flex={1} overflow="hidden">
                <Text fontSize="13px" color="fg" fontWeight="500" lineClamp={1}>
                  {snippet.name}
                </Text>
                <Text fontSize="10px" color="fg.muted" lineClamp={1} fontFamily="monospace">
                  {snippet.command}
                </Text>
              </VStack>
            </HStack>
          ))
        )}
      </VStack>
    </>
  );
};

// ── Main Component: Sidebar ──────────────────────────────────────────
interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  sidebarTab: SidebarTabId;
  setSidebarTab: (tab: SidebarTabId) => void;
  onNewSession: () => void;
  onAddFolder: () => void;
  onSaveWorkspace: () => void;
  onRestoreWorkspace: (workspaceId: string) => void;
  onAddSnippet: () => void;
  onExecuteSnippet: (command: string) => void;
  onContextMenu: (
    e: React.MouseEvent,
    type: SidebarMenuType,
    id?: string,
    name?: string,
    command?: string,
  ) => void;
}

const SIDEBAR_MIN_WIDTH = 100;
const SIDEBAR_MAX_WIDTH = 500;
const SIDEBAR_WIDTH_KEY = 'sidebar-width';
/** Show the tab labels once the sidebar is wide enough for them. */
const TAB_LABEL_MIN_WIDTH = 360;

const clampSidebarWidth = (value: number): number =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));

interface SidebarPanelTabsProps {
  active: SidebarTabId;
  onSelect: (tab: SidebarTabId) => void;
  showLabels: boolean;
}

export const SidebarPanelTabs: React.FC<SidebarPanelTabsProps> = ({
  active,
  onSelect,
  showLabels,
}) => {
  const { t } = useTranslation();
  return (
    <HStack role="tablist" aria-label={t('sidebar.panels')} gap={0} flex={1} minW={0}>
      {SIDEBAR_TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <Tooltip
            key={tab.id}
            content={t(`sidebar.tab.${tab.id}` as const)}
            positioning={{ placement: 'bottom' }}
            openDelay={300}
          >
            <Button
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={t(`sidebar.tab.${tab.id}` as const)}
              title={t(`sidebar.tab.${tab.id}` as const)}
              variant="ghost"
              flex={1}
              minW={0}
              h="auto"
              py="7px"
              borderRadius={0}
              borderBottom="2px solid"
              borderColor={isActive ? 'blue.fg' : 'transparent'}
              _hover={{ bg: isActive ? 'transparent' : 'bg.muted' }}
              onClick={() => onSelect(tab.id)}
            >
              <HStack justify="center" gap={showLabels ? 1.5 : 0} minW={0}>
                <Icon
                  as={tab.icon}
                  boxSize="14px"
                  color={isActive ? 'blue.fg' : 'fg.muted'}
                  flexShrink={0}
                />
                {showLabels && (
                  <Text
                    fontSize="11px"
                    fontWeight="bold"
                    color={isActive ? 'fg' : 'fg.muted'}
                    whiteSpace="nowrap"
                  >
                    {t(`sidebar.tab.${tab.id}` as const)}
                  </Text>
                )}
              </HStack>
            </Button>
          </Tooltip>
        );
      })}
    </HStack>
  );
};

const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  onToggleCollapse,
  sidebarTab,
  setSidebarTab,
  onNewSession,
  onAddFolder,
  onSaveWorkspace,
  onRestoreWorkspace,
  onAddSnippet,
  onExecuteSnippet,
  onContextMenu,
}) => {
  const sessions = useSessionStore((state) => state.sessions);
  const folders = useSessionStore((state) => state.folders);
  const snippets = useSessionStore((state) => state.snippets);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const openTabs = useSessionStore((state) => state.openTabs);
  const isLoading = useSessionStore((state) => state.isLoading);
  const toggleFolderCollapse = useSessionStore((state) => state.toggleFolderCollapse);
  const openConfig = useSessionStore((state) => state.openConfig);
  const openNewInstance = useSessionStore((state) => state.openNewInstance);
  const { t } = useTranslation();
  const { handleExport } = useExportImport();

  // ── Resize logic ────────────────────────────────────────────
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampSidebarWidth(stored) : 240;
  });
  const widthRef = useRef(width);
  const resizing = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const newWidth = clampSidebarWidth(e.clientX - 60);
      widthRef.current = newWidth;
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (resizing.current) {
        resizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(widthRef.current));
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

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

  // Collapsed: just show a thin bar with a toggle button
  if (collapsed) {
    return (
      <Flex
        w="36px"
        minW="36px"
        direction="column"
        bg="bg.panel"
        borderRight="1px solid"
        borderColor="border.subtle"
        align="center"
        py={2}
        gap={1}
      >
        <IconButton
          aria-label={t('sidebar.expand')}
          size="xs"
          variant="ghost"
          onClick={onToggleCollapse}
          color="fg.muted"
          _hover={{ color: 'fg' }}
        >
          <LuPanelLeftOpen size={16} />
        </IconButton>
        {SIDEBAR_TABS.map((tab) => (
          <Tooltip
            key={tab.id}
            content={t(`sidebar.tab.${tab.id}` as const)}
            positioning={{ placement: 'right' }}
            openDelay={300}
          >
            <IconButton
              aria-label={t(`sidebar.tab.${tab.id}` as const)}
              size="xs"
              variant="ghost"
              onClick={() => {
                setSidebarTab(tab.id);
                onToggleCollapse();
              }}
              color={sidebarTab === tab.id ? 'blue.fg' : 'fg.muted'}
              _hover={{ color: 'fg' }}
            >
              <Icon as={tab.icon} boxSize="16px" />
            </IconButton>
          </Tooltip>
        ))}
        <Box flex={1} />
      </Flex>
    );
  }

  return (
    <HStack gap={0} position="relative" flexShrink={0}>
      <VStack
        w={`${width}px`}
        minW={`${width}px`}
        h="full"
        bg="bg.panel"
        borderRight="1px solid"
        borderColor="border.subtle"
        align="stretch"
        gap={0}
      >
        {/* Tab switcher with collapse button */}
        <HStack
          w="full"
          gap={0}
          borderBottom="1px solid"
          borderColor="border.subtle"
          align="stretch"
        >
          <SidebarPanelTabs
            active={sidebarTab}
            onSelect={setSidebarTab}
            showLabels={width >= TAB_LABEL_MIN_WIDTH}
          />
          <Box py="6px" px={1} display="flex" alignItems="center">
            <IconButton
              aria-label={t('sidebar.collapse')}
              size="xs"
              variant="ghost"
              onClick={onToggleCollapse}
              color="fg.muted"
              _hover={{ color: 'fg' }}
              minW="20px"
              h="20px"
            >
              <LuPanelLeftClose size={12} />
            </IconButton>
          </Box>
        </HStack>

        {sidebarTab === 'sessions' && (
          <SessionsTab
            sessions={sessions}
            folders={folders}
            isLoading={isLoading}
            activeSessionId={activeSessionId}
            openTabs={openTabs}
            onNewSession={onNewSession}
            onAddFolder={onAddFolder}
            onSaveWorkspace={onSaveWorkspace}
            onRestoreWorkspace={onRestoreWorkspace}
            onContextMenu={onContextMenu}
            handleExport={handleExport}
            handleDropOnFolder={handleDropOnFolder}
            handleDragStart={handleDragStart}
            toggleFolderCollapse={toggleFolderCollapse}
            openConfig={openConfig}
            openNewInstance={openNewInstance}
          />
        )}
        {sidebarTab === 'sftp' && <SftpSidebar />}
        {sidebarTab === 'tunnels' && <ForwardSidebar />}
        {sidebarTab === 'snippets' && (
          <SnippetsTab
            snippets={snippets}
            onAddSnippet={onAddSnippet}
            onExecuteSnippet={onExecuteSnippet}
            onContextMenu={onContextMenu}
          />
        )}
      </VStack>

      {/* Resize handle */}
      <Box
        w="4px"
        h="full"
        cursor="col-resize"
        bg="transparent"
        _hover={{ bg: 'blue.500', opacity: 0.4 }}
        _active={{ bg: 'blue.500', opacity: 0.6 }}
        transition="background 0.15s"
        flexShrink={0}
        onMouseDown={handleMouseDown}
      />
    </HStack>
  );
};

export default Sidebar;
