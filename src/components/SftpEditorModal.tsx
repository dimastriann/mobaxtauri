import React, { useState, useEffect } from 'react';
import { Box, HStack, Button, Text, Spinner, Textarea } from '@chakra-ui/react';
import { invoke } from '@tauri-apps/api/core';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogCloseTrigger,
} from './ui/dialog';

interface SftpEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  filePath: string;
  fileName: string;
}

const SftpEditorModal: React.FC<SftpEditorModalProps> = ({
  isOpen,
  onClose,
  sessionId,
  filePath,
  fileName,
}) => {
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && sessionId && filePath) {
      loadContent();
    } else {
      setContent('');
      setError(null);
    }
  }, [isOpen, sessionId, filePath]);

  const loadContent = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await invoke<string>('sftp_read_file_content', {
        sessionId,
        remotePath: filePath,
      });
      setContent(data);
    } catch (err) {
      console.error('Failed to read file', err);
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await invoke('sftp_write_file_content', {
        sessionId,
        remotePath: filePath,
        content,
      });
      onClose();
    } catch (err) {
      console.error('Failed to write file', err);
      setError(String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DialogRoot
      open={isOpen}
      onOpenChange={(e) => !e.open && onClose()}
      size="xl"
      placement="center"
    >
      <DialogContent
        bg="bg.panel"
        borderColor="border.subtle"
        maxW="80vw"
        h="80vh"
        display="flex"
        flexDirection="column"
      >
        <DialogHeader>
          <DialogTitle color="fg.default" fontSize="14px">
            Edit File: {fileName}
          </DialogTitle>
        </DialogHeader>

        <DialogBody flex={1} display="flex" flexDirection="column" p={4} overflow="hidden">
          {isLoading ? (
            <Box display="flex" alignItems="center" justifyContent="center" flex={1}>
              <Spinner size="md" color="#38bdf8" />
            </Box>
          ) : error ? (
            <Box p={4} color="red.400" bg="red.subtle" borderRadius="md">
              <Text fontSize="12px">Error: {error}</Text>
            </Box>
          ) : (
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              flex={1}
              w="full"
              h="full"
              fontFamily='"Cascadia Code", Menlo, "Courier New", monospace'
              fontSize="13px"
              p={4}
              bg="bg.muted"
              color="fg"
              border="1px solid"
              borderColor="border.subtle"
              borderRadius="md"
              resize="none"
              _focus={{ outline: 'none', borderColor: 'blue.fg' }}
              css={{
                '&::-webkit-scrollbar': { width: '8px', height: '8px' },
                '&::-webkit-scrollbar-track': { background: 'transparent' },
                '&::-webkit-scrollbar-thumb': {
                  background: 'var(--chakra-colors-border-subtle)',
                  borderRadius: '4px',
                },
              }}
            />
          )}
        </DialogBody>

        <DialogFooter>
          <HStack gap={3}>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={isLoading || isSaving}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              size="sm"
              onClick={handleSave}
              loading={isSaving}
              disabled={isLoading || !!error}
            >
              Save
            </Button>
          </HStack>
        </DialogFooter>
        <DialogCloseTrigger />
      </DialogContent>
    </DialogRoot>
  );
};

export default SftpEditorModal;
