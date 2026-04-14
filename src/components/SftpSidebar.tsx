import React, { useEffect, useState } from 'react';
import { 
  VStack, HStack, Text, Box, Icon, Spinner, IconButton, 
  Flex
} from "@chakra-ui/react";
import { 
  LuFolder, LuFile, LuRefreshCw, LuArrowUp,
  LuFileText, LuImage, LuCode, LuArchive,
  LuUpload, LuDownload, LuCopy, LuExternalLink,
  LuPencil, LuTrash2
} from "react-icons/lu";
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { ask } from '@tauri-apps/plugin-dialog';
import { useSftpStore } from '../store/useSftpStore';
import { useSessionStore } from '../store/useSessionStore';

const SftpSidebar: React.FC = () => {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const activeSession = useSessionStore((state) => 
    state.sessions.find(s => s.id === activeSessionId)
  );
  const { 
    currentPath, files, fetchDirectory, cd, isLoading, error, refresh,
    uploadFile, downloadFile, copyFile, openFile, renameFile, deleteFile,
    reset
  } = useSftpStore();

  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, file: any } | null>(null);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  // Sync SFTP disconnect with SSH session disconnect
  useEffect(() => {
    if (!activeSessionId) return;

    let unlisten: UnlistenFn | null = null;
    
    const setupListener = async () => {
      unlisten = await listen(`ssh-disconnected-${activeSessionId}`, () => {
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

  const handleFileClick = (file: any) => {
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

  const handleDelete = async (file: any) => {
    try {
      const confirmed = await ask(`Are you sure you want to delete ${file.name}?`, {
        title: 'Delete Confirmation',
        kind: 'warning',
        okLabel: 'Delete',
        cancelLabel: 'Cancel'
      });
      
      if (confirmed) {
        await deleteFile(activeSessionId, file.name, file.is_dir);
      }
    } catch (err) {
      console.error("Delete dialog error:", err);
    }
    setContextMenu(null);
  };

  const renderBreadcrumbs = () => {
    const parts = currentPath.split('/').filter(p => p !== '');
    const breadcrumbs = [{ name: 'Root', path: '/' }];
    
    let current = '';
    parts.forEach(p => {
        current += '/' + p;
        breadcrumbs.push({ name: p, path: current });
    });

    return (
        <HStack gap={1} overflowX="auto" className="custom-scrollbar" py={1}>
            {breadcrumbs.map((crumb, idx) => (
                <React.Fragment key={crumb.path}>
                    <Text 
                        fontSize="10px" 
                        color={idx === breadcrumbs.length - 1 ? "blue.fg" : "fg.muted"}
                        cursor="pointer"
                        _hover={{ color: "blue.fg" }}
                        onClick={() => cd(activeSessionId, crumb.path)}
                        whiteSpace="nowrap"
                    >
                        {crumb.name}
                    </Text>
                    {idx < breadcrumbs.length - 1 && (
                        <Text fontSize="10px" color="fg.subtle">/</Text>
                    )}
                </React.Fragment>
            ))}
        </HStack>
    );
  };

  const getFileIcon = (file: any) => {
    if (file.is_dir) return LuFolder;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext)) return LuImage;
    if (['js', 'ts', 'tsx', 'py', 'rs', 'cpp', 'h', 'css', 'html', 'json', 'yaml', 'md'].includes(ext)) return LuCode;
    if (['zip', 'rar', 'tar', 'gz', '7z'].includes(ext)) return LuArchive;
    if (['txt', 'log', 'config', 'env', 'sh'].includes(ext)) return LuFileText;
    return LuFile;
  };



  return (
    <VStack align="stretch" h="full" gap={0}>
      {/* SFTP Toolbar */}
      <HStack p={2} borderBottom="1px solid" borderColor="border.subtle" justify="space-between" bg="bg.panel">
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
        <Text fontSize="10px" color="fg.muted" fontWeight="bold">SFTP EXPLORER</Text>
      </HStack>

      {/* Path Display */}
      <Box p={2} bg="bg.muted" borderBottom="1px solid" borderColor="border.subtle">
        {renderBreadcrumbs()}
      </Box>

      {/* File List */}
      <VStack 
        align="stretch" 
        flex={1} 
        overflowY="auto" 
        gap={0} 
        px={1} 
        pb={4}
        className="custom-scrollbar"
      >
        {isLoading && files.length === 0 ? (
          <Flex p={8} justify="center"><Spinner size="sm" color="#38bdf8" /></Flex>
        ) : error ? (
          <Box p={4}>
            <Text color="red.400" fontSize="11px">Error: {error}</Text>
          </Box>
        ) : (
          files.map((file) => (
            <HStack 
              key={`${file.name}-${file.is_dir}`}
              p={2}
              borderRadius="4px"
              cursor="pointer"
              _hover={{ bg: 'bg.emphasized' }}
              onClick={() => handleFileClick(file)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, file });
              }}
              gap={3}
              transition="background 0.15s"
            >
              <Icon 
                as={getFileIcon(file)} 
                boxSize="14px" 
                color={file.is_dir ? "orange.fg" : "fg.subtle"} 
              />
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
                                outline: 'none'
                             }}
                        />
                    </Box>
                ) : (
                    <>
                        <Text 
                            fontSize="12px" 
                            color="fg" 
                            lineClamp={1} 
                            fontWeight={file.is_dir ? "500" : "400"}
                        >
                            {file.name}
                        </Text>
                        {!file.is_dir && (
                            <Text fontSize="9px" color="fg.muted">
                                {(file.size / 1024).toFixed(1)} KB
                            </Text>
                        )}
                    </>
                )}
              </VStack>
            </HStack>
          ))
        )}
      </VStack>

      {contextMenu && (
        <Box
          position="fixed"
          left={contextMenu.x}
          top={contextMenu.y}
          bg="bg.panel"
          border="1px solid"
          borderColor="border.subtle"
          borderRadius="md"
          boxShadow="2xl"
          zIndex={1000}
          py={1}
          minW="140px"
        >
          <VStack align="stretch" gap={0}>
            <HStack px={3} py={2} cursor="pointer" transition="background 0.1s" _hover={{ bg: 'bg.emphasized' }} onClick={() => openFile(activeSessionId, contextMenu.file.name)}>
              <Icon as={LuExternalLink} boxSize="14px" color="fg.subtle" />
              <Text fontSize="12px" color="fg">Open File</Text>
            </HStack>
            <HStack px={3} py={2} cursor="pointer" transition="background 0.1s" _hover={{ bg: 'bg.emphasized' }} onClick={() => downloadFile(activeSessionId, contextMenu.file.name)}>
              <Icon as={LuDownload} boxSize="14px" color="fg.subtle" />
              <Text fontSize="12px" color="fg">Download</Text>
            </HStack>
            <HStack px={3} py={2} cursor="pointer" transition="background 0.1s" _hover={{ bg: 'bg.emphasized' }} onClick={() => copyFile(activeSessionId, contextMenu.file.name, `copy_${contextMenu.file.name}`)}>
              <Icon as={LuCopy} boxSize="14px" color="fg.subtle" />
              <Text fontSize="12px" color="fg">Duplicate</Text>
            </HStack>
            <Box h="1px" bg="border.subtle" my={1} />
            <HStack px={3} py={2} cursor="pointer" transition="background 0.1s" _hover={{ bg: 'bg.emphasized' }} onClick={() => {
                setRenamingFile(contextMenu.file.name);
                setRenameValue(contextMenu.file.name);
                setContextMenu(null);
            }}>
              <Icon as={LuPencil} boxSize="14px" color="fg.subtle" />
              <Text fontSize="12px" color="fg">Rename</Text>
            </HStack>
            <HStack px={3} py={2} cursor="pointer" transition="background 0.1s" _hover={{ bg: 'bg.emphasized' }} onClick={(e) => { e.stopPropagation(); handleDelete(contextMenu.file); }}>
              <Icon as={LuTrash2} boxSize="14px" color="red.fg" />
              <Text fontSize="12px" color="red.fg">Delete</Text>
            </HStack>
          </VStack>
        </Box>
      )}
    </VStack>
  );
};

export default SftpSidebar;
