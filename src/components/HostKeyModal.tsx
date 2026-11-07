import React from 'react';
import { Button, HStack, Stack, Text } from '@chakra-ui/react';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from './ui/dialog';
import type { SshHostKeyEvent } from '../types/ssh';
import { useTranslation } from '../store/useLocaleStore';

interface HostKeyModalProps {
  prompt: SshHostKeyEvent | null;
  onAccept: (prompt: SshHostKeyEvent) => void;
  onReject: () => void;
}

/**
 * Shown when a server presents a host key that is not in the known-hosts
 * store. For a known host presenting a different key (mismatch) the copy
 * and styling escalate to a man-in-the-middle warning.
 */
const HostKeyModal: React.FC<HostKeyModalProps> = ({ prompt, onAccept, onReject }) => {
  const { t } = useTranslation();
  const mismatch = prompt?.mismatch ?? false;

  return (
    <DialogRoot
      open={prompt !== null}
      onOpenChange={(e) => !e.open && onReject()}
      size="sm"
      placement="center"
    >
      <DialogContent bg="bg.panel" borderColor={mismatch ? 'red.400' : 'border.subtle'}>
        <DialogHeader>
          <DialogTitle color={mismatch ? 'red.400' : 'fg.default'}>
            {mismatch ? '⚠ Host key mismatch' : 'Unknown host key'}
          </DialogTitle>
        </DialogHeader>
        <DialogBody pb={2}>
          <Stack gap={3}>
            {mismatch && (
              <Text fontSize="12px" color="red.fg">
                {t('hostKey.mismatchWarning')}
              </Text>
            )}
            <Text fontSize="12px" color="fg.muted">
              {t('hostKey.verify')}
            </Text>
            <Stack gap={1} fontFamily="monospace" fontSize="11px">
              <Text color="fg.default">
                {t('hostKey.host')}: {prompt?.host}:{prompt?.port}
              </Text>
              <Text color="fg.default">
                {t('hostKey.keyType')}: {prompt?.keyType}
              </Text>
              <Text color="fg.default" wordBreak="break-all">
                {t('hostKey.fingerprint')}: {prompt?.fingerprint}
              </Text>
            </Stack>
          </Stack>
        </DialogBody>
        <DialogFooter>
          <HStack gap={2}>
            <Button size="sm" variant="ghost" onClick={onReject}>
              {t('hostKey.reject')}
            </Button>
            <Button
              size="sm"
              colorPalette={mismatch ? 'red' : 'blue'}
              onClick={() => prompt && onAccept(prompt)}
            >
              {mismatch ? t('hostKey.replace') : t('hostKey.trust')}
            </Button>
          </HStack>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
};

export default HostKeyModal;
