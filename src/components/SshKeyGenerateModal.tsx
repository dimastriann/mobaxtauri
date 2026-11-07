import React, { useState } from 'react';
import { Button, HStack, Input, Stack, Text } from '@chakra-ui/react';
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
import { Field } from './ui/field';
import { useTranslation } from '../store/useLocaleStore';
import { toaster } from './ui/toaster';
import type { SshKeyMetadata } from '../types/sshKeys';

interface SshKeyGenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerated: (key: SshKeyMetadata) => void;
}

const SshKeyGenerateModal: React.FC<SshKeyGenerateModalProps> = ({
  isOpen,
  onClose,
  onGenerated,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [algorithm, setAlgorithm] = useState<'ed25519' | 'rsa'>('ed25519');
  const [comment, setComment] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen);
    if (isOpen) {
      setName('');
      setAlgorithm('ed25519');
      setComment('');
      setPassphrase('');
      setError(null);
      setIsSaving(false);
    }
  }

  const generate = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const key = await invoke<SshKeyMetadata>('ssh_key_generate', {
        name: name.trim(),
        algorithm,
        comment: comment.trim(),
        passphrase: passphrase ? passphrase : null,
      });
      toaster.create({
        title: t('sshKeys.generated'),
        description: key.fingerprint,
        type: 'success',
      });
      onGenerated(key);
      onClose();
    } catch (err) {
      const message = String(err);
      setError(message);
      toaster.create({
        title: t('sshKeys.generateFailed'),
        description: message,
        type: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DialogRoot
      open={isOpen}
      onOpenChange={(event) => !event.open && onClose()}
      size="md"
      placement="center"
    >
      <DialogContent bg="bg.panel" borderColor="border.subtle">
        <DialogHeader>
          <DialogTitle color="fg.default">{t('sshKeys.generateTitle')}</DialogTitle>
        </DialogHeader>
        <DialogBody pb={2}>
          <Stack gap={3}>
            <Field label={t('sshKeys.name')} required>
              <Input
                size="sm"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('sshKeys.namePlaceholder')}
                autoFocus
              />
            </Field>
            <Field label={t('sshKeys.algorithm')}>
              <select
                value={algorithm}
                onChange={(event) => setAlgorithm(event.target.value as 'ed25519' | 'rsa')}
                style={{
                  width: '100%',
                  height: '32px',
                  backgroundColor: 'transparent',
                  border: '1px solid var(--chakra-colors-border-subtle)',
                  borderRadius: '4px',
                  padding: '0 8px',
                  fontSize: '14px',
                  color: 'inherit',
                  outline: 'none',
                }}
              >
                <option value="ed25519" style={{ background: 'var(--chakra-colors-bg-panel)' }}>
                  Ed25519
                </option>
                <option value="rsa" style={{ background: 'var(--chakra-colors-bg-panel)' }}>
                  RSA
                </option>
              </select>
            </Field>
            <Field label={t('sshKeys.comment')}>
              <Input
                size="sm"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder={t('sshKeys.commentPlaceholder')}
              />
            </Field>
            <Field label={t('sshKeys.passphrase')} helperText={t('sshKeys.passphraseHelper')}>
              <Input
                size="sm"
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                placeholder={t('sshKeys.passphrasePlaceholder')}
              />
            </Field>
            {error && (
              <Text fontSize="11px" color="red.fg" role="alert">
                {error}
              </Text>
            )}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <HStack gap={2}>
            <Button size="sm" variant="ghost" onClick={onClose} disabled={isSaving}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              colorPalette="blue"
              loading={isSaving}
              disabled={!name.trim()}
              onClick={() => void generate()}
            >
              {t('sshKeys.generate')}
            </Button>
          </HStack>
        </DialogFooter>
        <DialogCloseTrigger />
      </DialogContent>
    </DialogRoot>
  );
};

export default SshKeyGenerateModal;
