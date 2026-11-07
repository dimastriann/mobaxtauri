import React, { useEffect, useState } from 'react';
import { Box, Button, Flex, HStack, Icon, IconButton, Text, VStack } from '@chakra-ui/react';
import { LuCopy, LuDownload, LuKeyRound, LuPlus, LuTrash2, LuUpload } from 'react-icons/lu';
import { invoke } from '@tauri-apps/api/core';
import { ask, open, save } from '@tauri-apps/plugin-dialog';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useSessionStore } from '../store/useSessionStore';
import { useTranslation } from '../store/useLocaleStore';
import { toaster } from './ui/toaster';
import SshKeyGenerateModal from './SshKeyGenerateModal';
import type { SshKeyMetadata } from '../types/sshKeys';

const formatDate = (seconds: number): string => {
  if (!seconds) return '—';
  return new Date(seconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};

const SshKeyManager: React.FC = () => {
  const { t } = useTranslation();
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const activeSession = useSessionStore((state) =>
    state.sessions.find((session) => session.id === state.activeSessionId),
  );
  const [keys, setKeys] = useState<SshKeyMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);

  useEffect(() => {
    let disposed = false;
    void invoke<SshKeyMetadata[]>('ssh_key_list')
      .then((entries) => {
        if (!disposed) setKeys(entries);
      })
      .catch((loadError) => {
        if (!disposed) setError(String(loadError));
      })
      .finally(() => {
        if (!disposed) setIsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const canDeploy =
    Boolean(activeSessionId) &&
    activeSession?.type === 'ssh' &&
    activeSession.status === 'connected';

  const copyPublicKey = async (key: SshKeyMetadata) => {
    try {
      await writeText(key.publicKey);
      toaster.create({ title: t('sshKeys.copied'), type: 'success' });
    } catch (err) {
      toaster.create({
        title: t('sshKeys.copyFailed'),
        description: String(err),
        type: 'error',
      });
    }
  };

  const registerExisting = async () => {
    const picked = await open({ multiple: false, directory: false });
    if (!picked || Array.isArray(picked)) return;
    const name =
      picked
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .pop() ?? 'SSH Key';
    try {
      const key = await invoke<SshKeyMetadata>('ssh_key_register', { name, path: picked });
      setKeys((entries) => [...entries, key]);
      toaster.create({
        title: t('sshKeys.registered'),
        description: key.fingerprint,
        type: 'success',
      });
    } catch (err) {
      toaster.create({
        title: t('sshKeys.registerFailed'),
        description: String(err),
        type: 'error',
      });
    }
  };

  const exportKey = async (key: SshKeyMetadata) => {
    const destination = await save({ defaultPath: key.name });
    if (!destination) return;
    try {
      await invoke('ssh_key_export', { id: key.id, destination });
      toaster.create({ title: t('sshKeys.exported'), type: 'success' });
    } catch (err) {
      toaster.create({
        title: t('sshKeys.exportFailed'),
        description: String(err),
        type: 'error',
      });
    }
  };

  const removeKey = async (key: SshKeyMetadata) => {
    const confirmed = await ask(t('sshKeys.removeConfirm', { name: key.name }), {
      title: t('sshKeys.removeTitle'),
      kind: 'warning',
      okLabel: t('sshKeys.remove'),
      cancelLabel: t('common.cancel'),
    });
    if (!confirmed) return;
    try {
      await invoke('ssh_key_remove', { id: key.id });
      setKeys((entries) => entries.filter((entry) => entry.id !== key.id));
      toaster.create({ title: t('sshKeys.removed'), type: 'success' });
    } catch (err) {
      toaster.create({
        title: t('sshKeys.removeFailed'),
        description: String(err),
        type: 'error',
      });
    }
  };

  const deployKey = async (key: SshKeyMetadata) => {
    if (!activeSessionId) return;
    try {
      await invoke('ssh_key_deploy', { sessionId: activeSessionId, keyId: key.id });
      toaster.create({ title: t('sshKeys.deployed'), type: 'success' });
    } catch (err) {
      toaster.create({
        title: t('sshKeys.deployFailed'),
        description: String(err),
        type: 'error',
      });
    }
  };

  return (
    <VStack align="stretch" gap={3} h="full">
      <Flex justify="space-between" align="flex-start" gap={2}>
        <Box>
          <HStack gap={2}>
            <Icon as={LuKeyRound} boxSize="14px" color="blue.fg" />
            <Text fontSize="14px" fontWeight="bold" color="fg">
              {t('sshKeys.heading')}
            </Text>
          </HStack>
          <Text fontSize="11px" color="fg.muted" mt={1}>
            {t('sshKeys.helper')}
          </Text>
        </Box>
        <HStack gap={1}>
          <Button size="xs" variant="outline" onClick={() => void registerExisting()}>
            <LuUpload /> {t('sshKeys.register')}
          </Button>
          <Button size="xs" colorPalette="blue" onClick={() => setGenerateOpen(true)}>
            <LuPlus /> {t('sshKeys.generate')}
          </Button>
        </HStack>
      </Flex>

      {isLoading ? (
        <Text fontSize="11px" color="fg.muted">
          {t('sshKeys.loading')}
        </Text>
      ) : error ? (
        <Text fontSize="11px" color="red.fg" role="alert">
          {t('sshKeys.loadFailed')}: {error}
        </Text>
      ) : keys.length === 0 ? (
        <Text fontSize="11px" color="fg.muted">
          {t('sshKeys.empty')}
        </Text>
      ) : (
        <VStack align="stretch" gap={2} overflowY="auto" className="custom-scrollbar">
          {keys.map((key) => (
            <Box key={key.id} p={2} borderRadius="md" bg="bg.muted">
              <Flex justify="space-between" gap={2} align="flex-start">
                <Box flex={1} minW={0}>
                  <HStack gap={2}>
                    <Text fontSize="12px" fontWeight="600" color="fg" lineClamp={1}>
                      {key.name}
                    </Text>
                    {key.encrypted && (
                      <Text fontSize="9px" color="orange.fg">
                        {t('sshKeys.encrypted')}
                      </Text>
                    )}
                    <Text fontSize="9px" color="fg.subtle">
                      {key.managed ? t('sshKeys.managed') : t('sshKeys.external')}
                    </Text>
                  </HStack>
                  <Text
                    fontSize="10px"
                    color="fg.muted"
                    fontFamily="monospace"
                    wordBreak="break-all"
                  >
                    {key.keyType} · {key.fingerprint}
                  </Text>
                  <Text fontSize="10px" color="fg.subtle" wordBreak="break-all">
                    {key.path}
                  </Text>
                  <Text fontSize="10px" color="fg.subtle">
                    {t('sshKeys.created')}: {formatDate(key.createdAt)}
                  </Text>
                </Box>
                <HStack gap={0}>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    aria-label={t('sshKeys.copyPublic', { name: key.name })}
                    title={t('sshKeys.copyPublic', { name: key.name })}
                    onClick={() => void copyPublicKey(key)}
                  >
                    <LuCopy />
                  </IconButton>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    aria-label={t('sshKeys.deploy', { name: key.name })}
                    title={canDeploy ? t('sshKeys.deployHint') : t('sshKeys.deployUnavailable')}
                    disabled={!canDeploy}
                    onClick={() => void deployKey(key)}
                  >
                    <LuUpload />
                  </IconButton>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    aria-label={t('sshKeys.export', { name: key.name })}
                    title={t('sshKeys.export')}
                    onClick={() => void exportKey(key)}
                  >
                    <LuDownload />
                  </IconButton>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    colorPalette="red"
                    aria-label={t('sshKeys.remove', { name: key.name })}
                    title={t('sshKeys.remove')}
                    onClick={() => void removeKey(key)}
                  >
                    <LuTrash2 />
                  </IconButton>
                </HStack>
              </Flex>
            </Box>
          ))}
        </VStack>
      )}

      <SshKeyGenerateModal
        isOpen={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onGenerated={(key) => setKeys((entries) => [...entries, key])}
      />
    </VStack>
  );
};

export default SshKeyManager;
