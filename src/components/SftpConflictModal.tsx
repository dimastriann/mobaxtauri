import React from 'react';
import { Text, Button, VStack, HStack } from '@chakra-ui/react';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogCloseTrigger,
} from './ui/dialog';
import type { SftpConflictPolicy } from '../types/sftp';

interface SftpConflictModalProps {
  isOpen: boolean;
  destName: string;
  onResolve: (policy: SftpConflictPolicy) => void;
  onClose: () => void;
}

const SftpConflictModal: React.FC<SftpConflictModalProps> = ({
  isOpen,
  destName,
  onResolve,
  onClose,
}) => {
  return (
    <DialogRoot open={isOpen} onOpenChange={(e) => !e.open && onClose()} size="sm" placement="center">
      <DialogContent bg="bg.panel" borderColor="border.subtle">
        <DialogHeader>
          <DialogTitle color="fg.default">Destination already exists</DialogTitle>
        </DialogHeader>
        <DialogBody pb={2}>
          <VStack align="flex-start" gap={2}>
            <Text fontSize="13px" color="fg.default">
              <Text as="span" fontWeight="600">
                {destName}
              </Text>{' '}
              already exists in the remote folder.
            </Text>
            <Text fontSize="12px" color="fg.muted">
              Rename saves the new item under a suffixed name, overwrite replaces the existing
              file, and skip leaves everything unchanged.
            </Text>
          </VStack>
        </DialogBody>
        <DialogFooter>
          <HStack gap={2}>
            <Button size="sm" variant="ghost" onClick={() => onResolve('skip')}>
              Skip
            </Button>
            <Button size="sm" colorPalette="blue" onClick={() => onResolve('rename')}>
              Rename copy
            </Button>
            <Button size="sm" colorPalette="red" onClick={() => onResolve('overwrite')}>
              Overwrite
            </Button>
          </HStack>
        </DialogFooter>
        <DialogCloseTrigger />
      </DialogContent>
    </DialogRoot>
  );
};

export default SftpConflictModal;
