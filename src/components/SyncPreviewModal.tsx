import React, { useState } from 'react';
import { Box, Button, HStack, Input, Spinner, Stack, Text } from '@chakra-ui/react';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from './ui/dialog';
import type { SyncConflictPolicy, SyncDirection } from '../types/sync';
import { useSyncStore } from '../store/useSyncStore';
import { useTranslation } from '../store/useLocaleStore';
import { toaster } from './ui/toaster';

interface SyncPreviewModalProps {
  isOpen: boolean;
  sessionId: string | null;
  sessionName: string;
  localPath: string | null;
  remotePath: string | null;
  onClose: () => void;
  onApplied: () => Promise<void> | void;
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  height: 30,
  background: 'transparent',
  border: '1px solid var(--chakra-colors-border-subtle)',
  borderRadius: 4,
  padding: '0 8px',
  fontSize: 12,
  color: 'inherit',
};

const SyncPreviewModal: React.FC<SyncPreviewModalProps> = ({
  isOpen,
  sessionId,
  sessionName,
  localPath,
  remotePath,
  onClose,
  onApplied,
}) => {
  const { t } = useTranslation();
  const store = useSyncStore();
  const [direction, setDirection] = useState<SyncDirection>('push');
  const [conflictPolicy, setConflictPolicy] = useState<SyncConflictPolicy>('overwrite');
  const [deleteTargetOnly, setDeleteTargetOnly] = useState(false);
  const [editableLocalPath, setEditableLocalPath] = useState(localPath ?? '');
  const [editableRemotePath, setEditableRemotePath] = useState(remotePath ?? '');

  const openKey = isOpen ? sessionId : null;
  const [lastOpenKey, setLastOpenKey] = useState<string | null>(null);
  if (lastOpenKey !== openKey) {
    setLastOpenKey(openKey);
    setEditableLocalPath(localPath ?? '');
    setEditableRemotePath(remotePath ?? '');
    setDirection('push');
    setConflictPolicy('overwrite');
    setDeleteTargetOnly(false);
    store.clear();
  }

  const canPreview = Boolean(sessionId && editableLocalPath && editableRemotePath);
  const plan = store.plan;

  const handlePreview = async () => {
    if (!sessionId || !canPreview) return;
    const result = await store.preview({
      sessionId,
      localPath: editableLocalPath,
      remotePath: editableRemotePath,
      direction,
      conflictPolicy,
      deleteTargetOnly,
    });
    if (!result) {
      toaster.create({
        title: t('sync.previewFailed'),
        description: store.error ?? t('sync.previewFailedDetail'),
        type: 'error',
      });
    }
  };

  const handleApply = async () => {
    if (!sessionId || !plan) return;
    const result = await store.apply(sessionId, plan);
    if (!result) {
      toaster.create({
        title: t('sync.applyFailed'),
        description: store.error ?? t('sync.applyFailedDetail'),
        type: 'error',
      });
      return;
    }
    if (result.failures.length > 0) {
      toaster.create({
        title: t('sync.applyFailed'),
        description: result.failures
          .slice(0, 3)
          .map((failure) => `${failure.relativePath}: ${failure.message}`)
          .join('\n'),
        type: 'error',
      });
    } else {
      toaster.create({
        title: t('sync.applied', {
          create: result.appliedCreate,
          update: result.appliedUpdate,
          delete: result.appliedDelete,
        }),
        type: 'success',
      });
    }
    await onApplied();
    onClose();
  };

  return (
    <DialogRoot open={isOpen} onOpenChange={(event) => !event.open && onClose()} size="lg">
      <DialogContent bg="bg.panel" borderColor="border.subtle">
        <DialogHeader>
          <DialogTitle color="fg.default">
            {t('sync.title')} ? {sessionName}
          </DialogTitle>
        </DialogHeader>
        <DialogBody pb={2}>
          <Stack gap={3}>
            <HStack gap={3} align="flex-end">
              <Box flex={1}>
                <Text fontSize="12px" color="fg.muted" mb={1}>
                  {t('sync.localPath')}
                </Text>
                <Input
                  size="sm"
                  value={editableLocalPath}
                  onChange={(event) => setEditableLocalPath(event.target.value)}
                  disabled={Boolean(store.plan)}
                />
              </Box>
              <Box flex={1}>
                <Text fontSize="12px" color="fg.muted" mb={1}>
                  {t('sync.remotePath')}
                </Text>
                <Input
                  size="sm"
                  value={editableRemotePath}
                  onChange={(event) => setEditableRemotePath(event.target.value)}
                  disabled={Boolean(store.plan)}
                />
              </Box>
            </HStack>
            <HStack gap={3}>
              <Box w="140px">
                <Text fontSize="12px" color="fg.muted" mb={1}>
                  {t('sync.direction')}
                </Text>
                <select
                  aria-label={t('sync.direction')}
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as SyncDirection)}
                  disabled={Boolean(store.plan)}
                  style={selectStyle}
                >
                  <option value="push">{t('sync.push')}</option>
                  <option value="pull">{t('sync.pull')}</option>
                </select>
              </Box>
              <Box w="160px">
                <Text fontSize="12px" color="fg.muted" mb={1}>
                  {t('sync.conflictPolicy')}
                </Text>
                <select
                  aria-label={t('sync.conflictPolicy')}
                  value={conflictPolicy}
                  onChange={(event) => setConflictPolicy(event.target.value as SyncConflictPolicy)}
                  disabled={Boolean(store.plan)}
                  style={selectStyle}
                >
                  <option value="overwrite">{t('sync.overwrite')}</option>
                  <option value="skip">{t('sync.skip')}</option>
                  <option value="rename">{t('sync.rename')}</option>
                </select>
              </Box>
            </HStack>
            <HStack gap={2} align="center">
              <input
                type="checkbox"
                id="sync-delete-target-only"
                checked={deleteTargetOnly}
                onChange={(event) => setDeleteTargetOnly(event.target.checked)}
                disabled={Boolean(store.plan)}
              />
              <label htmlFor="sync-delete-target-only" style={{ fontSize: 12 }}>
                {t('sync.deleteTargetOnly')}
              </label>
            </HStack>
            {deleteTargetOnly && (
              <Text fontSize="11px" color="red.fg">
                {t('sync.deleteWarning')}
              </Text>
            )}
            {store.isPlanning ? (
              <HStack justify="center" py={6}>
                <Spinner size="sm" />
              </HStack>
            ) : plan ? (
              <Stack gap={2}>
                <HStack gap={3} fontSize="12px">
                  <Text color="green.fg">{t('sync.createCount', { count: plan.createCount })}</Text>
                  <Text color="orange.fg">
                    {t('sync.updateCount', { count: plan.updateCount })}
                  </Text>
                  <Text color="red.fg">{t('sync.deleteCount', { count: plan.deleteCount })}</Text>
                </HStack>
                <Box maxH="180px" overflowY="auto" bg="bg.muted" p={2} borderRadius="md">
                  {plan.entries.length === 0 ? (
                    <Text fontSize="11px" color="fg.muted">
                      {t('sync.noChanges')}
                    </Text>
                  ) : (
                    plan.entries.map((entry) => (
                      <HStack key={entry.relativePath} gap={2} py={0.5} fontSize="11px">
                        <Text color="fg.muted" minW="70px">
                          {entry.action}
                        </Text>
                        <Text
                          color={entry.kind === 'directory' ? 'blue.fg' : 'fg.default'}
                          flex={1}
                        >
                          {entry.relativePath}
                        </Text>
                      </HStack>
                    ))
                  )}
                </Box>
              </Stack>
            ) : (
              <Text fontSize="11px" color="fg.muted">
                {t('sync.previewHint')}
              </Text>
            )}
          </Stack>
        </DialogBody>
        <DialogFooter>
          <HStack gap={2}>
            <Button size="sm" variant="ghost" onClick={onClose} disabled={store.isApplying}>
              {t('common.close')}
            </Button>
            {!plan ? (
              <Button
                size="sm"
                colorPalette="blue"
                onClick={() => void handlePreview()}
                disabled={!canPreview || store.isPlanning}
              >
                {t('sync.preview')}
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => store.clear()}
                  disabled={store.isApplying}
                >
                  {t('sync.back')}
                </Button>
                <Button
                  size="sm"
                  colorPalette="blue"
                  onClick={() => void handleApply()}
                  disabled={store.isApplying || plan.entries.length === 0}
                >
                  {t('sync.apply')}
                </Button>
              </>
            )}
          </HStack>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
};

export default SyncPreviewModal;
