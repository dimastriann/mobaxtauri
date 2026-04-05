import React, { useEffect } from 'react';
import { 
  VStack, HStack, Text, Box, Icon, Spinner, IconButton, 
  Flex
} from "@chakra-ui/react";
import { 
  LuFolder, LuFile, LuRefreshCw, LuArrowUp,
  LuFileText, LuImage, LuCode, LuArchive
} from "react-icons/lu";
import { useSftpStore } from '../store/useSftpStore';
import { useSessionStore } from '../store/useSessionStore';

const SftpSidebar: React.FC = () => {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const { currentPath, files, fetchDirectory, cd, isLoading, error, refresh } = useSftpStore();

  useEffect(() => {
    if (activeSessionId && activeSessionId !== 'local') {
      fetchDirectory(activeSessionId, '.');
    }
  }, [activeSessionId, fetchDirectory]);

  if (!activeSessionId || activeSessionId === 'local') {
    return (
      <Flex p={8} h="full" align="center" justify="center" direction="column" gap={4}>
        <Icon as={LuFolder} boxSize="40px" color="rgba(255,255,255,0.05)" />
        <Text fontSize="12px" color="#475569" textAlign="center">
          Terminal only. Connect to an SSH session to use SFTP.
        </Text>
      </Flex>
    );
  }

  const handleFileClick = (file: any) => {
    if (file.is_dir) {
      cd(activeSessionId, file.name);
    }
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
      <HStack p={2} borderBottom="1px solid rgba(255,255,255,0.06)" justify="space-between">
        <HStack gap={1}>
           <IconButton 
              aria-label="Up" 
              size="xs" 
              variant="ghost" 
              onClick={() => cd(activeSessionId, '..')}
              color="#94a3b8"
           >
             <LuArrowUp size={14} />
           </IconButton>
           <IconButton 
              aria-label="Refresh" 
              size="xs" 
              variant="ghost" 
              onClick={() => refresh(activeSessionId)}
              loading={isLoading}
              color="#38bdf8"
           >
              <LuRefreshCw size={14} />
           </IconButton>
        </HStack>
        <Text fontSize="10px" color="#475569" fontWeight="bold">SFTP EXPLORER</Text>
      </HStack>

      {/* Path Display */}
      <Box p={2} bg="rgba(0,0,0,0.2)" borderBottom="1px solid rgba(255,255,255,0.06)">
        <Text fontSize="10px" color="#38bdf8" lineClamp={1} title={currentPath}>
          {currentPath}
        </Text>
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
              _hover={{ bg: 'rgba(255,255,255,0.04)' }}
              onClick={() => handleFileClick(file)}
              gap={3}
              transition="background 0.15s"
            >
              <Icon 
                as={getFileIcon(file)} 
                boxSize="14px" 
                color={file.is_dir ? "#f59e0b" : "#94a3b8"} 
              />
              <VStack align="flex-start" gap={0} flex={1} overflow="hidden">
                <Text 
                  fontSize="12px" 
                  color="#e2e8f0" 
                  lineClamp={1} 
                  fontWeight={file.is_dir ? "500" : "400"}
                >
                  {file.name}
                </Text>
                {!file.is_dir && (
                   <Text fontSize="9px" color="#475569">
                     {(file.size / 1024).toFixed(1)} KB
                   </Text>
                )}
              </VStack>
            </HStack>
          ))
        )}
      </VStack>
    </VStack>
  );
};

export default SftpSidebar;
