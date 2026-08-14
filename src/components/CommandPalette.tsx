import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, HStack, Icon, Input, Kbd, Text, VStack } from '@chakra-ui/react';
import {
  LuCode,
  LuCommand,
  LuMonitor,
  LuPlus,
  LuSearch,
  LuSettings,
  LuTerminal,
} from 'react-icons/lu';
import type { IconType } from 'react-icons';
import type { Session, Snippet } from '../store/useSessionStore';
import { DialogBody, DialogContent, DialogRoot } from './ui/dialog';

interface CommandPaletteProps {
  isOpen: boolean;
  sessions: Session[];
  snippets: Snippet[];
  canExecuteSnippet: boolean;
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
  onExecuteSnippet: (command: string) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
  onShowDashboard: () => void;
  onShowTerminals: () => void;
}

interface PaletteItem {
  id: string;
  label: string;
  detail?: string;
  category: 'Sessions' | 'Snippets' | 'Settings' | 'Actions';
  icon: IconType;
  keywords: string;
  run: () => void;
}

const CommandPalette = ({
  isOpen,
  sessions,
  snippets,
  canExecuteSnippet,
  onClose,
  onOpenSession,
  onExecuteSnippet,
  onNewSession,
  onOpenSettings,
  onShowDashboard,
  onShowTerminals,
}: CommandPaletteProps) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const items = useMemo<PaletteItem[]>(
    () => [
      ...sessions.map((session) => ({
        id: `session-${session.id}`,
        label: session.name,
        detail: session.host ?? 'Local terminal',
        category: 'Sessions' as const,
        icon: LuTerminal,
        keywords: `${session.name} ${session.host ?? ''} ${session.user ?? ''} ${session.tag ?? ''}`,
        run: () => onOpenSession(session.id),
      })),
      ...(canExecuteSnippet
        ? snippets.map((snippet) => ({
            id: `snippet-${snippet.id}`,
            label: snippet.name,
            detail: snippet.command,
            category: 'Snippets' as const,
            icon: LuCode,
            keywords: `${snippet.name} ${snippet.command}`,
            run: () => onExecuteSnippet(snippet.command),
          }))
        : []),
      {
        id: 'settings',
        label: 'Open Settings',
        detail: 'Appearance, terminal, and SSH preferences',
        category: 'Settings',
        icon: LuSettings,
        keywords: 'open settings preferences appearance theme terminal ssh',
        run: onOpenSettings,
      },
      {
        id: 'new-session',
        label: 'New Session',
        detail: 'Create an SSH connection',
        category: 'Actions',
        icon: LuPlus,
        keywords: 'new create session ssh connection',
        run: onNewSession,
      },
      {
        id: 'dashboard',
        label: 'Show Dashboard',
        category: 'Actions',
        icon: LuMonitor,
        keywords: 'show open dashboard home',
        run: onShowDashboard,
      },
      {
        id: 'terminals',
        label: 'Show Terminals',
        category: 'Actions',
        icon: LuCommand,
        keywords: 'show open terminals console',
        run: onShowTerminals,
      },
    ],
    [
      sessions,
      snippets,
      canExecuteSnippet,
      onOpenSession,
      onExecuteSnippet,
      onOpenSettings,
      onNewSession,
      onShowDashboard,
      onShowTerminals,
    ],
  );

  const filteredItems = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return items;
    return items.filter((item) => {
      const haystack = `${item.category} ${item.keywords}`.toLocaleLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [items, query]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  useEffect(() => setSelectedIndex(0), [query]);

  useEffect(() => {
    resultsRef.current
      ?.querySelector<HTMLElement>(`[data-palette-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const runItem = (item: PaletteItem) => {
    onClose();
    item.run();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!filteredItems.length) return;
      setSelectedIndex((index) => (index + 1) % Math.max(filteredItems.length, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!filteredItems.length) return;
      setSelectedIndex(
        (index) => (index - 1 + filteredItems.length) % Math.max(filteredItems.length, 1),
      );
    } else if (event.key === 'Enter' && filteredItems[selectedIndex]) {
      event.preventDefault();
      runItem(filteredItems[selectedIndex]);
    }
  };

  return (
    <DialogRoot
      open={isOpen}
      onOpenChange={(event) => !event.open && onClose()}
      placement="top"
      size="lg"
    >
      <DialogContent mt="12vh" bg="bg.panel" borderColor="border.subtle" overflow="hidden">
        <DialogBody p={0}>
          <HStack px={4} borderBottom="1px solid" borderColor="border.subtle">
            <Icon as={LuSearch} color="fg.muted" boxSize="18px" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search sessions, snippets, settings, and actions"
              aria-label="Command palette search"
              variant="flushed"
              border="none"
              h="52px"
            />
            <Kbd fontSize="10px">ESC</Kbd>
          </HStack>
          <VStack
            ref={resultsRef}
            align="stretch"
            gap={1}
            p={2}
            maxH="360px"
            overflowY="auto"
            role="listbox"
          >
            {filteredItems.map((item, index) => (
              <HStack
                key={item.id}
                data-palette-index={index}
                role="option"
                aria-selected={index === selectedIndex}
                p={2.5}
                borderRadius="6px"
                cursor="pointer"
                bg={index === selectedIndex ? 'blue.subtle' : 'transparent'}
                _hover={{ bg: 'blue.subtle' }}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => runItem(item)}
              >
                <Icon as={item.icon} boxSize="16px" color="blue.fg" />
                <Box flex={1} minW={0}>
                  <Text fontSize="13px" fontWeight="500" lineClamp={1}>
                    {item.label}
                  </Text>
                  {item.detail && (
                    <Text fontSize="11px" color="fg.muted" lineClamp={1}>
                      {item.detail}
                    </Text>
                  )}
                </Box>
                <Text fontSize="10px" color="fg.subtle">
                  {item.category}
                </Text>
              </HStack>
            ))}
            {!filteredItems.length && (
              <Text p={6} textAlign="center" fontSize="12px" color="fg.muted">
                No commands found
              </Text>
            )}
          </VStack>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  );
};

export default CommandPalette;
