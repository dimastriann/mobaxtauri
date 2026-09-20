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
                This host is known with a DIFFERENT key. The connection may be intercepted
                (man-in-the-middle). Only continue if the server operator told you the key changed.
              </Text>
            )}
            <Text fontSize="12px" color="fg.muted">
              Verify this fingerprint against your server before trusting it.
            </Text>
            <Stack gap={1} fontFamily="monospace" fontSize="11px">
              <Text color="fg.default">
                Host: {prompt?.host}:{prompt?.port}
              </Text>
              <Text color="fg.default">Key type: {prompt?.keyType}</Text>
              <Text color="fg.default" wordBreak="break-all">
                Fingerprint: {prompt?.fingerprint}
              </Text>
            </Stack>
          </Stack>
        </DialogBody>
        <DialogFooter>
          <HStack gap={2}>
            <Button size="sm" variant="ghost" onClick={onReject}>
              Reject
            </Button>
            <Button
              size="sm"
              colorPalette={mismatch ? 'red' : 'blue'}
              onClick={() => prompt && onAccept(prompt)}
            >
              {mismatch ? 'Replace key and connect' : 'Trust and connect'}
            </Button>
          </HStack>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
};

export default HostKeyModal;
