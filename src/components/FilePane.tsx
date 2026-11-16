import React, { useRef, useState } from 'react';
import { Box, Button, Flex, HStack, Icon, Input, Spinner, Text } from '@chakra-ui/react';
import { LuArrowUp, LuFile, LuFolder, LuLink, LuRefreshCw } from 'react-icons/lu';
import { formatFileSize } from '../utils/formatFileSize';

export interface PaneEntry {
  key: string;
  name: string;
  path: string;
  isDir: boolean;
  isFile: boolean;
  isSymlink?: boolean;
  size: number;
  modified: number | null;
  permissions?: string;
}

interface FilePaneProps {
  title: string;
  path: string | null;
  parent: string | null;
  entries: PaneEntry[];
  isLoading: boolean;
  error: string | null;
  emptyLabel: string;
  pathPlaceholder: string;
  upLabel: string;
  refreshLabel: string;
  onOpen: (entry: PaneEntry) => void;
  onUp: () => void;
  onRefresh: () => void;
  onPathSubmit: (path: string) => void;
  dragMime?: string;
  acceptMime?: string;
  onDropEntries?: (entries: PaneEntry[]) => void;
  toolbar?: React.ReactNode;
  actions?: (selected: PaneEntry[]) => React.ReactNode;
}

const formatModified = (seconds: number | null): string =>
  seconds
    ? new Date(seconds * 1000).toLocaleString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '?';

const FilePane: React.FC<FilePaneProps> = ({
  title,
  path,
  parent,
  entries,
  isLoading,
  error,
  emptyLabel,
  pathPlaceholder,
  upLabel,
  refreshLabel,
  onOpen,
  onUp,
  onRefresh,
  onPathSubmit,
  dragMime,
  acceptMime,
  onDropEntries,
  toolbar,
  actions,
}) => {
  const [pathDraft, setPathDraft] = useState(path ?? '');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [dragOver, setDragOver] = useState(false);
  const lastIndexRef = useRef<number | null>(null);

  const selectedEntries = entries.filter((entry) => selectedPaths.has(entry.path));

  const selectEntry = (entry: PaneEntry, index: number, event: React.MouseEvent) => {
    setSelectedPaths((current) => {
      let next: Set<string>;
      if (event.shiftKey && lastIndexRef.current !== null) {
        const start = Math.min(lastIndexRef.current, index);
        const end = Math.max(lastIndexRef.current, index);
        next = new Set(current);
        for (let cursor = start; cursor <= end; cursor += 1) {
          next.add(entries[cursor].path);
        }
      } else if (event.ctrlKey || event.metaKey) {
        next = new Set(current);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
      } else {
        next = new Set([entry.path]);
      }
      lastIndexRef.current = index;
      return next;
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (entries.length === 0) return;
    const currentIndex = entries.findIndex((entry) => selectedPaths.has(entry.path));
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = Math.min(currentIndex + 1, entries.length - 1);
    else if (event.key === 'ArrowUp') nextIndex = Math.max(currentIndex - 1, 0);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = entries.length - 1;
    else if (event.key === 'Enter' && currentIndex >= 0) {
      event.preventDefault();
      onOpen(entries[currentIndex]);
      return;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const next = entries[nextIndex];
    setSelectedPaths(new Set([next.path]));
    lastIndexRef.current = nextIndex;
  };

  return (
    <Flex direction="column" minW={0} minH={0} flex={1} bg="bg.panel" overflow="hidden">
      <Flex
        direction="column"
        gap={2}
        px={3}
        py={2}
        borderBottom="1px solid"
        borderColor="border.subtle"
        bg="bg.muted"
      >
        <HStack justify="space-between" gap={2}>
          <Text fontSize="12px" fontWeight="bold" color="fg">
            {title}
          </Text>
          <HStack gap={1}>
            <Button
              size="xs"
              variant="ghost"
              onClick={onUp}
              disabled={!parent}
              aria-label={upLabel}
              title={upLabel}
            >
              <Icon as={LuArrowUp} />
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={onRefresh}
              aria-label={refreshLabel}
              title={refreshLabel}
            >
              <Icon as={LuRefreshCw} />
            </Button>
          </HStack>
        </HStack>
        <Input
          size="xs"
          value={pathDraft}
          onChange={(event) => setPathDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onPathSubmit(pathDraft.trim());
          }}
          placeholder={pathPlaceholder}
          aria-label={pathPlaceholder}
          fontFamily="monospace"
        />
        {toolbar && (
          <HStack gap={1} wrap="wrap">
            {toolbar}
          </HStack>
        )}
        {actions && selectedEntries.length > 0 && (
          <HStack gap={1} wrap="wrap">
            {actions(selectedEntries)}
          </HStack>
        )}
      </Flex>

      <Box
        flex={1}
        minH={0}
        overflowY="auto"
        className="custom-scrollbar"
        bg={dragOver ? 'blue.subtle' : undefined}
        onDragOver={(event) => {
          if (!acceptMime || !event.dataTransfer.types.includes(acceptMime)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          if (!acceptMime || !onDropEntries) return;
          const raw = event.dataTransfer.getData(acceptMime);
          if (!raw) return;
          event.preventDefault();
          setDragOver(false);
          try {
            const entries = JSON.parse(raw) as PaneEntry[];
            if (Array.isArray(entries)) onDropEntries(entries);
          } catch {
            // Ignore malformed drag payloads from other applications.
          }
        }}
      >
        {isLoading ? (
          <Flex align="center" justify="center" h="full" minH="120px">
            <Spinner size="sm" />
          </Flex>
        ) : error ? (
          <Text p={3} fontSize="11px" color="red.fg" role="alert">
            {error}
          </Text>
        ) : entries.length === 0 ? (
          <Text p={3} fontSize="11px" color="fg.muted">
            {emptyLabel}
          </Text>
        ) : (
          <Box
            role="listbox"
            aria-label={title}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onClick={(event) => {
              if (!(event.target as HTMLElement).closest('[data-pane-row]')) {
                setSelectedPaths(new Set());
              }
            }}
          >
            {entries.map((entry, index) => {
              const selected = selectedPaths.has(entry.path);
              return (
                <Flex
                  key={entry.key}
                  data-pane-row
                  role="option"
                  aria-selected={selected}
                  align="center"
                  gap={2}
                  px={3}
                  py={1.5}
                  cursor="pointer"
                  bg={selected ? 'blue.subtle' : 'transparent'}
                  _hover={{ bg: selected ? 'blue.subtle' : 'bg.muted' }}
                  onClick={(event) => selectEntry(entry, index, event)}
                  onDoubleClick={() => onOpen(entry)}
                  draggable={Boolean(dragMime)}
                  onDragStart={(event) => {
                    if (!dragMime) return;
                    const dragged = selectedPaths.has(entry.path) ? selectedEntries : [entry];
                    event.dataTransfer.setData(dragMime, JSON.stringify(dragged));
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                >
                  <Icon
                    as={entry.isSymlink ? LuLink : entry.isDir ? LuFolder : LuFile}
                    boxSize="14px"
                    color={entry.isDir ? 'blue.fg' : 'fg.muted'}
                    flexShrink={0}
                  />
                  <Text fontSize="12px" color="fg" truncate flex={1}>
                    {entry.name}
                  </Text>
                  {entry.permissions && (
                    <Text fontSize="10px" color="fg.subtle" fontFamily="monospace">
                      {entry.permissions}
                    </Text>
                  )}
                  <Text fontSize="10px" color="fg.subtle" textAlign="right" minW="64px">
                    {entry.isDir ? '?' : formatFileSize(entry.size)}
                  </Text>
                  <Text fontSize="10px" color="fg.subtle" minW="120px" textAlign="right">
                    {formatModified(entry.modified)}
                  </Text>
                </Flex>
              );
            })}
          </Box>
        )}
      </Box>
    </Flex>
  );
};

export default FilePane;
