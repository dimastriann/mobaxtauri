import React, { useEffect, useRef, useState } from 'react';
import {
  VStack,
  HStack,
  Text,
  Box,
  Icon,
  Spinner,
  IconButton,
  Flex,
  Button,
} from '@chakra-ui/react';
import {
  LuFolder,
  LuFolderOpen,
  LuFile,
  LuRefreshCw,
  LuArrowUp,
  LuFileText,
  LuFileCode2,
  LuFileJson,
  LuFileTerminal,
  LuFileImage,
  LuFileVideo,
  LuFileMusic,
  LuFileSpreadsheet,
  LuFileKey,
  LuFileCog,
  LuFileArchive,
  LuCode,
  LuUpload,
  LuDownload,
  LuCopy,
  LuLink,
  LuLink2,
  LuExternalLink,
  LuPencil,
  LuTrash2,
  LuFolderPlus,
  LuFilePlus,
} from 'react-icons/lu';
import type { IconType } from 'react-icons';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { ask } from '@tauri-apps/plugin-dialog';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useSftpStore } from '../store/useSftpStore';
import { useSessionStore } from '../store/useSessionStore';
import { SSH_SESSION_STATE_EVENT, type SshSessionStateEvent } from '../types/ssh';
import { SFTP_TRANSFER_EVENT, type SftpTransferEvent } from '../types/sftp';
import type { SftpPathVariantsPayload } from '../types/sftp';
import { type SftpFile } from '../store/useSftpStore';
import { formatFileSize } from '../utils/formatFileSize';
import { toaster } from './ui/toaster';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from './ContextMenu';
import SftpEditorModal from './SftpEditorModal';
import SftpConflictModal from './SftpConflictModal';
import PromptModal from './PromptModal';

const formatMtime = (secs: number | null): string => {
  if (!secs) return '';
  const d = new Date(secs * 1000);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatMetaDetails = (file: SftpFile): string => {
  const parts: string[] = [];
  if (file.permissions) parts.push(file.permissions);
  if (file.uid !== null && file.uid !== undefined) {
    parts.push(
      file.gid !== null && file.gid !== undefined ? `${file.uid}:${file.gid}` : `${file.uid}`,
    );
  }
  if (file.modified) {
    parts.push(formatMtime(file.modified));
  }
  return parts.join('  ');
};

interface FileVisual {
  icon: IconType;
  color: string;
  extensions: string[];
}

const FILE_VISUALS: FileVisual[] = [
  {
    icon: LuFileCode2,
    color: 'blue.fg',
    extensions: [
      'js',
      'jsx',
      'mjs',
      'cjs',
      'ts',
      'tsx',
      'rs',
      'go',
      'java',
      'kt',
      'swift',
      'c',
      'cpp',
      'h',
      'hpp',
      'cs',
      'php',
      'rb',
      'scala',
    ],
  },
  { icon: LuCode, color: 'pink.fg', extensions: ['html', 'htm', 'xml', 'vue', 'svelte'] },
  { icon: LuFileTerminal, color: 'green.fg', extensions: ['sh', 'bash', 'zsh', 'fish', 'ps1'] },
  { icon: LuFileJson, color: 'yellow.fg', extensions: ['json'] },
  {
    icon: LuFileCog,
    color: 'fg.muted',
    extensions: ['yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env'],
  },
  { icon: LuFileText, color: 'fg.muted', extensions: ['txt', 'md', 'rtf', 'log', 'properties'] },
  {
    icon: LuFileImage,
    color: 'cyan.fg',
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'],
  },
  { icon: LuFileVideo, color: 'purple.fg', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm'] },
  { icon: LuFileMusic, color: 'blue.fg', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a'] },
  { icon: LuFileSpreadsheet, color: 'green.fg', extensions: ['csv', 'xls', 'xlsx', 'ods', 'sql'] },
  {
    icon: LuFileArchive,
    color: 'orange.400',
    extensions: ['zip', 'rar', 'tar', 'gz', 'bz2', 'xz', '7z', 'iso'],
  },
  { icon: LuFileKey, color: 'red.fg', extensions: ['pem', 'key', 'crt', 'ppk', 'pub'] },
];

const getFileVisual = (file: SftpFile): { icon: IconType; color: string } => {
  if (file.is_dir) return { icon: LuFolder, color: 'orange.fg' };
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const visual = FILE_VISUALS.find((entry) => entry.extensions.includes(ext));
  return visual ?? { icon: LuFile, color: 'fg.subtle' };
};

const SftpSidebar: React.FC = () => {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const activeSession = useSessionStore((state) =>
    state.sessions.find((s) => s.id === activeSessionId),
  );
  const {
    currentPath,
    files,
    fetchDirectory,
    cd,
    isLoading,
    error,
    refresh,
    uploadFile,
    downloadFile,
    copyFile,
    openFile,
    renameFile,
    deleteFile,
    createDir,
    createFile,
    downloadFolder,
    reset,
    transfer,
    updateTransfer,
    cancelTransfer,
    conflictPrompt,
    resolveConflict,
    dismissConflict,
  } = useSftpStore();

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    file: SftpFile | null;
  } | null>(null);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [editorFile, setEditorFile] = useState<{ path: string; name: string } | null>(null);
  const [createPrompt, setCreatePrompt] = useState<'folder' | 'file' | null>(null);
  const lastNotifiedTransferRef = useRef<{ id: string; status: string } | null>(null);

  const handleCreatePromptConfirm = (values: Record<string, string>) => {
    const name = (values.name ?? '').trim();
    if (!name || !activeSessionId) return;
    if (createPrompt === 'file') {
      void createFile(activeSessionId, name);
    } else {
      void createDir(activeSessionId, name);
    }
  };

  const copyPathVariant = async (file: SftpFile, variant: 'full' | 'relative' | 'name') => {
    if (!activeSessionId) return;
    const path = currentPath.endsWith('/')
      ? `${currentPath}${file.name}`
      : `${currentPath}/${file.name}`;
    try {
      const variants = await invoke<SftpPathVariantsPayload>('sftp_path_variants', {
        sessionId: activeSessionId,
        remotePath: path,
      });
      const value =
        variant === 'full'
          ? variants.fullPath
          : variant === 'relative'
            ? variants.relativeToHome
            : variants.name;
      await writeText(value);
      toaster.create({ title: 'Copied to clipboard', description: value, type: 'success' });
    } catch (err) {
      console.error('Failed to copy path', err);
      toaster.create({ title: 'Copy failed', description: String(err), type: 'error' });
    }
  };

  const renderCopyPathItems = (file: SftpFile) => (
    <>
      <ContextMenuItem
        icon={LuLink}
        label="Copy Full Path"
        onClick={() => {
          setContextMenu(null);
          void copyPathVariant(file, 'full');
        }}
      />
      <ContextMenuItem
        icon={LuLink2}
        label="Copy Relative Path"
        onClick={() => {
          setContextMenu(null);
          void copyPathVariant(file, 'relative');
        }}
      />
      <ContextMenuItem
        icon={LuFile}
        label="Copy Name"
        onClick={() => {
          setContextMenu(null);
          void copyPathVariant(file, 'name');
        }}
      />
    </>
  );

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // Sync SFTP disconnect with SSH session disconnect
  useEffect(() => {
    if (!activeSessionId) return;

    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen<SshSessionStateEvent>(SSH_SESSION_STATE_EVENT, ({ payload }) => {
        if (payload.sessionId !== activeSessionId || payload.status !== 'disconnected') return;
        console.log('[SFTP] Disconnected event received - resetting store');
        reset();
      });
    };

    setupListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, [activeSessionId, reset]);

  useEffect(() => {
    const unlisten = listen<SftpTransferEvent>(SFTP_TRANSFER_EVENT, ({ payload }) => {
      if (payload.sessionId === activeSessionId) {
        updateTransfer(payload);

        if (
          (payload.status === 'completed' || payload.status === 'failed') &&
          (lastNotifiedTransferRef.current?.id !== payload.transferId ||
            lastNotifiedTransferRef.current?.status !== payload.status)
        ) {
          lastNotifiedTransferRef.current = {
            id: payload.transferId,
            status: payload.status,
          };

          if (payload.status === 'completed') {
            toaster.create({
              title: 'Transfer Completed',
              description: `Transferred ${formatFileSize(payload.transferred)}`,
              type: 'success',
            });
          } else if (payload.status === 'failed') {
            toaster.create({
              title: 'Transfer Failed',
              description: payload.message || 'An error occurred during file transfer.',
              type: 'error',
            });
          }
        }
      }
    });
    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, [activeSessionId, updateTransfer]);

  useEffect(() => {
    if (activeSessionId && activeSessionId !== 'local' && activeSession?.status === 'connected') {
      fetchDirectory(activeSessionId, '/');
    }
  }, [activeSessionId, activeSession?.status, fetchDirectory]);

  if (!activeSessionId || activeSessionId === 'local') {
    return (
      <Flex p={8} h="full" align="center" justify="center" direction="column" gap={4}>
        <Icon as={LuFolder} boxSize="40px" color="fg.subtle" opacity={0.1} />
        <Text fontSize="12px" color="fg.muted" textAlign="center">
          Terminal only. Connect to an SSH session to use SFTP.
        </Text>
      </Flex>
    );
  }

  if (activeSession?.status === 'disconnected' || activeSession?.status === 'error') {
    return (
      <Flex p={8} h="full" align="center" justify="center" direction="column" gap={4}>
        <Icon as={LuFolder} boxSize="40px" color="fg.subtle" opacity={0.2} />
        <Text fontSize="12px" fontWeight="600" color="red.fg" textAlign="center">
          SESSION DISCONNECTED
        </Text>
        <Text fontSize="11px" color="fg.muted" textAlign="center">
          The SSH connection was lost. Reconnect the session to use SFTP features.
        </Text>
      </Flex>
    );
  }

  const handleFileClick = (file: SftpFile) => {
    if (file.is_dir) {
      cd(activeSessionId, file.name);
    }
  };

  const handleRename = async () => {
    if (renamingFile && renameValue && renameValue !== renamingFile) {
      await renameFile(activeSessionId, renamingFile, renameValue);
    }
    setRenamingFile(null);
  };

  const handleDelete = async (file: SftpFile) => {
    try {
      const confirmed = await ask(`Are you sure you want to delete ${file.name}?`, {
        title: 'Delete Confirmation',
        kind: 'warning',
        okLabel: 'Delete',
        cancelLabel: 'Cancel',
      });

      if (confirmed) {
        await deleteFile(activeSessionId, file.name, file.is_dir);
      }
    } catch (err) {
      console.error('Delete dialog error:', err);
    }
    setContextMenu(null);
  };

  const renderBreadcrumbs = () => {
    const parts = currentPath.split('/').filter((p) => p !== '');
    const breadcrumbs = [{ name: 'Root', path: '/' }];

    let current = '';
    parts.forEach((p) => {
      current += '/' + p;
      breadcrumbs.push({ name: p, path: current });
    });

    return (
      <HStack gap={1} overflowX="auto" className="custom-scrollbar" py={1}>
        {breadcrumbs.map((crumb, idx) => (
          <React.Fragment key={crumb.path}>
            <Text
              fontSize="10px"
              color={idx === breadcrumbs.length - 1 ? 'blue.fg' : 'fg.muted'}
              cursor="pointer"
              _hover={{ color: 'blue.fg' }}
              onClick={() => cd(activeSessionId, crumb.path)}
              whiteSpace="nowrap"
            >
              {crumb.name}
            </Text>
            {idx < breadcrumbs.length - 1 && (
              <Text fontSize="10px" color="fg.subtle">
                /
              </Text>
            )}
          </React.Fragment>
        ))}
      </HStack>
    );
  };

  const getFileIcon = (file: SftpFile) => {
    if (file.is_dir) return LuFolder;
    return getFileVisual(file).icon;
  };

  const renderBlankMenu = (menu: { x: number; y: number }) => (
    <ContextMenu x={menu.x} y={menu.y} onClose={() => setContextMenu(null)}>
      <VStack align="stretch" gap={0}>
        <ContextMenuItem
          icon={LuFolderPlus}
          color="blue.fg"
          label="New Folder"
          onClick={() => {
            setContextMenu(null);
            setCreatePrompt('folder');
          }}
        />
        <ContextMenuItem
          icon={LuFilePlus}
          color="blue.fg"
          label="New File"
          onClick={() => {
            setContextMenu(null);
            setCreatePrompt('file');
          }}
        />
        <ContextMenuItem
          icon={LuUpload}
          label="Upload File"
          onClick={() => {
            setContextMenu(null);
            uploadFile(activeSessionId);
          }}
        />
        <ContextMenuItem
          icon={LuRefreshCw}
          label="Refresh"
          onClick={() => {
            setContextMenu(null);
            refresh(activeSessionId);
          }}
        />
      </VStack>
    </ContextMenu>
  );

  const renderFolderMenu = (menu: { x: number; y: number }, file: SftpFile) => (
    <ContextMenu x={menu.x} y={menu.y} onClose={() => setContextMenu(null)}>
      <VStack align="stretch" gap={0}>
        <ContextMenuItem
          icon={LuFolderOpen}
          color="blue.fg"
          label="Open Folder"
          onClick={() => {
            setContextMenu(null);
            cd(activeSessionId, file.name);
          }}
        />
        <ContextMenuItem
          icon={LuDownload}
          label="Download Folder"
          onClick={() => {
            setContextMenu(null);
            void downloadFolder(activeSessionId, file.name);
          }}
        />
        <ContextMenuSeparator />
        {renderCopyPathItems(file)}
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={LuPencil}
          label="Rename"
          onClick={() => {
            setRenamingFile(file.name);
            setRenameValue(file.name);
            setContextMenu(null);
          }}
        />
        <ContextMenuItem
          icon={LuTrash2}
          color="red.fg"
          label="Delete"
          onClick={() => {
            setContextMenu(null);
            handleDelete(file);
          }}
        />
      </VStack>
    </ContextMenu>
  );

  const renderFileMenu = (menu: { x: number; y: number }, file: SftpFile) => (
    <ContextMenu x={menu.x} y={menu.y} onClose={() => setContextMenu(null)}>
      <VStack align="stretch" gap={0}>
        <ContextMenuItem
          icon={LuExternalLink}
          color="blue.fg"
          label="Open File"
          onClick={() => {
            setContextMenu(null);
            openFile(activeSessionId, file.name);
          }}
        />
        <ContextMenuItem
          icon={LuCode}
          label="Edit File"
          onClick={() => {
            const path = currentPath.endsWith('/')
              ? `${currentPath}${file.name}`
              : `${currentPath}/${file.name}`;
            setEditorFile({ path, name: file.name });
            setContextMenu(null);
          }}
        />
        <ContextMenuItem
          icon={LuDownload}
          label="Download"
          onClick={() => {
            setContextMenu(null);
            downloadFile(activeSessionId, file.name);
          }}
        />
        <ContextMenuItem
          icon={LuCopy}
          label="Duplicate"
          onClick={() => {
            setContextMenu(null);
            copyFile(activeSessionId, file.name, `copy_${file.name}`);
          }}
        />
        <ContextMenuSeparator />
        {renderCopyPathItems(file)}
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={LuPencil}
          label="Rename"
          onClick={() => {
            setRenamingFile(file.name);
            setRenameValue(file.name);
            setContextMenu(null);
          }}
        />
        <ContextMenuItem
          icon={LuTrash2}
          color="red.fg"
          label="Delete"
          onClick={() => {
            setContextMenu(null);
            handleDelete(file);
          }}
        />
      </VStack>
    </ContextMenu>
  );

  return (
    <VStack align="stretch" h="full" minH={0} overflow="hidden" gap={0}>
      {/* SFTP Toolbar */}
      <HStack
        p={2}
        borderBottom="1px solid"
        borderColor="border.subtle"
        justify="space-between"
        bg="bg.panel"
      >
        <HStack gap={1}>
          <IconButton
            aria-label="Upload"
            size="xs"
            variant="ghost"
            onClick={() => uploadFile(activeSessionId)}
            color="blue.fg"
            title="Upload File"
          >
            <LuUpload size={14} />
          </IconButton>
          <IconButton
            aria-label="New Folder"
            size="xs"
            variant="ghost"
            onClick={() => setCreatePrompt('folder')}
            color="blue.fg"
            title="New Folder"
          >
            <LuFolderPlus size={14} />
          </IconButton>
          <IconButton
            aria-label="New File"
            size="xs"
            variant="ghost"
            onClick={() => setCreatePrompt('file')}
            color="blue.fg"
            title="New File"
          >
            <LuFilePlus size={14} />
          </IconButton>
          <IconButton
            aria-label="Up"
            size="xs"
            variant="ghost"
            onClick={() => cd(activeSessionId, '..')}
            color="fg.muted"
          >
            <LuArrowUp size={14} />
          </IconButton>
          <IconButton
            aria-label="Refresh"
            size="xs"
            variant="ghost"
            onClick={() => refresh(activeSessionId)}
            loading={isLoading}
            color="blue.fg"
          >
            <LuRefreshCw size={14} />
          </IconButton>
        </HStack>
        <Text fontSize="10px" color="fg.muted" fontWeight="bold">
          SFTP EXPLORER
        </Text>
      </HStack>

      {/* Path Display */}
      <Box p={2} bg="bg.muted" borderBottom="1px solid" borderColor="border.subtle">
        {renderBreadcrumbs()}
      </Box>

      {transfer && (
        <Box px={2} py={2} borderBottom="1px solid" borderColor="border.subtle" bg="bg.muted">
          <HStack justify="space-between" mb={1}>
            <Text fontSize="10px" color="fg.muted">
              Transferring {formatFileSize(transfer.transferred)}
              {transfer.total ? ` / ${formatFileSize(transfer.total)}` : ''}
              {transfer.percent !== undefined && transfer.percent !== null
                ? ` (${transfer.percent}%)`
                : ''}
            </Text>
            <Button size="xs" variant="ghost" onClick={() => void cancelTransfer()}>
              Cancel
            </Button>
          </HStack>
          <Box h="3px" bg="bg.emphasized" borderRadius="full" overflow="hidden">
            <Box
              h="full"
              bg="blue.fg"
              width={
                transfer.percent !== undefined && transfer.percent !== null
                  ? `${Math.min(100, transfer.percent)}%`
                  : transfer.total
                    ? `${Math.min(100, (transfer.transferred / transfer.total) * 100)}%`
                    : '25%'
              }
              transition="width 120ms linear"
            />
          </Box>
        </Box>
      )}

      {/* File List */}
      <VStack
        align="stretch"
        flex={1}
        minH={0}
        overflowY="auto"
        gap={0}
        px={1}
        pb={2}
        className="custom-scrollbar"
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY, file: null });
        }}
      >
        {isLoading && files.length === 0 ? (
          <Flex p={8} justify="center">
            <Spinner size="sm" color="#38bdf8" />
          </Flex>
        ) : error ? (
          <Box p={4}>
            <Text color="red.400" fontSize="11px">
              Error: {error}
            </Text>
          </Box>
        ) : (
          files.map((file) => (
            <HStack
              key={`${file.name}-${file.is_dir}`}
              p={2}
              borderRadius="4px"
              cursor="pointer"
              _hover={{ bg: 'bg.emphasized' }}
              onDoubleClick={() => handleFileClick(file)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({ x: e.clientX, y: e.clientY, file });
              }}
              gap={3}
              transition="background 0.15s"
            >
              <Icon as={getFileIcon(file)} boxSize="14px" color={getFileVisual(file).color} />
              <VStack align="flex-start" gap={0} flex={1} overflow="hidden">
                {renamingFile === file.name ? (
                  <Box w="full" py={1}>
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={handleRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename();
                        if (e.key === 'Escape') setRenamingFile(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        background: 'var(--chakra-colors-bg-muted)',
                        border: '1px solid var(--chakra-colors-blue-fg)',
                        borderRadius: '2px',
                        color: 'var(--chakra-colors-fg)',
                        fontSize: '12px',
                        padding: '2px 4px',
                        width: '100%',
                        outline: 'none',
                      }}
                    />
                  </Box>
                ) : (
                  <>
                    <Text
                      fontSize="12px"
                      color="fg"
                      lineClamp={1}
                      fontWeight={file.is_dir ? '500' : '400'}
                    >
                      {file.name}
                    </Text>
                    <Text fontSize="9px" color="fg.muted" lineClamp={1}>
                      {!file.is_dir ? `${formatFileSize(file.size)}  ` : ''}
                      {formatMetaDetails(file)}
                    </Text>
                  </>
                )}
              </VStack>
            </HStack>
          ))
        )}
      </VStack>

      {contextMenu && contextMenu.file === null && renderBlankMenu(contextMenu)}

      {contextMenu && contextMenu.file?.is_dir && renderFolderMenu(contextMenu, contextMenu.file)}

      {contextMenu && contextMenu.file && !contextMenu.file.is_dir
        ? renderFileMenu(contextMenu, contextMenu.file)
        : null}

      <SftpEditorModal
        isOpen={!!editorFile}
        onClose={() => setEditorFile(null)}
        sessionId={activeSessionId}
        filePath={editorFile?.path || ''}
        fileName={editorFile?.name || ''}
      />

      <SftpConflictModal
        isOpen={!!conflictPrompt}
        destName={conflictPrompt?.destName ?? ''}
        onResolve={resolveConflict}
        onClose={dismissConflict}
      />

      <PromptModal
        isOpen={!!createPrompt}
        title={createPrompt === 'file' ? 'New File' : 'New Folder'}
        fields={[
          {
            key: 'name',
            label: createPrompt === 'file' ? 'File name' : 'Folder name',
            placeholder: createPrompt === 'file' ? 'notes.txt' : 'documents',
          },
        ]}
        onConfirm={handleCreatePromptConfirm}
        onClose={() => setCreatePrompt(null)}
      />
    </VStack>
  );
};

export default SftpSidebar;
