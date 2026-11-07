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
import { useTranslation } from '../store/useLocaleStore';

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
  const { t } = useTranslation();
  return (
    <DialogRoot
      open={isOpen}
      onOpenChange={(e) => !e.open && onClose()}
      size="sm"
      placement="center"
    >
      <DialogContent bg="bg.panel" borderColor="border.subtle">
        <DialogHeader>
          <DialogTitle color="fg.default">{t('sftp.conflict.title')}</DialogTitle>
        </DialogHeader>
        <DialogBody pb={2}>
          <VStack align="flex-start" gap={2}>
            <Text fontSize="13px" color="fg.default">
              {t('sftp.conflict.body', { name: destName })}
            </Text>
            <Text fontSize="12px" color="fg.muted">
              {t('sftp.conflict.helper')}
            </Text>
          </VStack>
        </DialogBody>
        <DialogFooter>
          <HStack gap={2}>
            <Button size="sm" variant="ghost" onClick={() => onResolve('skip')}>
              {t('sftp.conflict.skip')}
            </Button>
            <Button size="sm" colorPalette="blue" onClick={() => onResolve('rename')}>
              {t('sftp.conflict.rename')}
            </Button>
            <Button size="sm" colorPalette="red" onClick={() => onResolve('overwrite')}>
              {t('sftp.conflict.overwrite')}
            </Button>
          </HStack>
        </DialogFooter>
        <DialogCloseTrigger />
      </DialogContent>
    </DialogRoot>
  );
};

export default SftpConflictModal;
