import React, { useState } from 'react';
import { Button, Checkbox, HStack, Input, Stack, Text, VStack } from '@chakra-ui/react';
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
import { useTranslation } from '../store/useLocaleStore';
import type { SftpFile } from '../store/useSftpStore';
import { formatFileSize } from '../utils/formatFileSize';
import { toaster } from './ui/toaster';
import {
  formatOctalMode,
  modeToPermissions,
  parseOctalMode,
  permissionsToMode,
  type PermissionKey,
} from '../utils/sftpPermissions';

interface SftpPropertiesModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  filePath: string;
  file: SftpFile;
  onSaved: () => void;
}

const formatMtime = (secs: number | null): string => {
  if (!secs) return '—';
  return new Date(secs * 1000).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const PERMISSION_ROWS: { group: 'owner' | 'group' | 'other'; keys: PermissionKey[] }[] = [
  {
    group: 'owner',
    keys: ['ownerRead', 'ownerWrite', 'ownerExecute'],
  },
  {
    group: 'group',
    keys: ['groupRead', 'groupWrite', 'groupExecute'],
  },
  {
    group: 'other',
    keys: ['otherRead', 'otherWrite', 'otherExecute'],
  },
];

const SftpPropertiesModal: React.FC<SftpPropertiesModalProps> = ({
  isOpen,
  onClose,
  sessionId,
  filePath,
  file,
  onSaved,
}) => {
  const { t } = useTranslation();
  const initialMode = file.mode ?? (file.is_dir ? 0o755 : 0o644);
  const [mode, setMode] = useState(initialMode);
  const [octal, setOctal] = useState(() => formatOctalMode(initialMode));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [prevOpen, setPrevOpen] = useState(isOpen);
  const [prevPath, setPrevPath] = useState(filePath);
  if (prevOpen !== isOpen || prevPath !== filePath) {
    setPrevOpen(isOpen);
    setPrevPath(filePath);
    if (isOpen) {
      const nextMode = file.mode ?? (file.is_dir ? 0o755 : 0o644);
      setMode(nextMode);
      setOctal(formatOctalMode(nextMode));
      setError(null);
      setIsSaving(false);
    }
  }

  const checks = modeToPermissions(mode);

  const togglePermission = (key: PermissionKey, checked: boolean) => {
    const nextMode = permissionsToMode({ ...checks, [key]: checked });
    setMode(nextMode);
    setOctal(formatOctalMode(nextMode));
    setError(null);
  };

  const changeOctal = (value: string) => {
    setOctal(value);
    const parsed = parseOctalMode(value);
    if (parsed !== null) setMode(parsed);
    setError(null);
  };

  const save = async () => {
    const parsed = parseOctalMode(octal);
    if (parsed === null) {
      setError(t('sftp.properties.invalidMode'));
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await invoke('sftp_set_permissions', {
        sessionId,
        path: filePath,
        mode: parsed,
      });
      toaster.create({
        title: t('sftp.properties.saved'),
        description: `${file.name}: ${t('sftp.properties.octal')} ${formatOctalMode(parsed)}`,
        type: 'success',
      });
      onSaved();
      onClose();
    } catch (err) {
      const message = String(err);
      setError(message);
      toaster.create({
        title: t('sftp.properties.saveFailed'),
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
          <DialogTitle color="fg.default">{t('sftp.properties.title')}</DialogTitle>
        </DialogHeader>
        <DialogBody pb={2}>
          <Stack gap={3}>
            <VStack align="stretch" gap={1}>
              <Text fontSize="12px" fontWeight="600" color="fg.default" lineClamp={2}>
                {file.name}
              </Text>
              <Text fontSize="10px" color="fg.muted" fontFamily="monospace" wordBreak="break-all">
                {filePath}
              </Text>
            </VStack>

            <Stack gap={1}>
              <PropertyRow label={t('sftp.properties.type')}>
                {file.is_dir ? t('sftp.properties.type.folder') : t('sftp.properties.type.file')}
              </PropertyRow>
              {!file.is_dir && (
                <PropertyRow label={t('sftp.properties.size')}>
                  {formatFileSize(file.size)}
                </PropertyRow>
              )}
              <PropertyRow label={t('sftp.properties.owner')}>
                {file.uid === null ? '—' : `${file.uid}${file.gid === null ? '' : `:${file.gid}`}`}
              </PropertyRow>
              <PropertyRow label={t('sftp.properties.modified')}>
                {formatMtime(file.modified)}
              </PropertyRow>
              <PropertyRow label={t('sftp.properties.currentPermissions')}>
                <Text as="span" fontFamily="monospace">
                  {file.permissions}
                </Text>
              </PropertyRow>
            </Stack>

            <Stack gap={2}>
              <Text fontSize="12px" fontWeight="600" color="fg.default">
                {t('sftp.properties.permissions')}
              </Text>
              <HStack gap={3} align="flex-start">
                <Input
                  size="sm"
                  w="90px"
                  value={octal}
                  onChange={(event) => changeOctal(event.target.value)}
                  aria-label={t('sftp.properties.octal')}
                  fontFamily="monospace"
                />
                <VStack align="stretch" gap={1} flex={1}>
                  {PERMISSION_ROWS.map((row) => (
                    <HStack key={row.group} gap={3} justify="space-between">
                      <Text fontSize="11px" color="fg.muted" minW="48px">
                        {t(`sftp.permissions.${row.group}` as const)}
                      </Text>
                      <HStack gap={3}>
                        {row.keys.map((key) => {
                          const label = key.endsWith('Read')
                            ? 'sftp.permissions.read'
                            : key.endsWith('Write')
                              ? 'sftp.permissions.write'
                              : 'sftp.permissions.execute';
                          return (
                            <Checkbox.Root
                              key={key}
                              size="sm"
                              checked={checks[key]}
                              onCheckedChange={(details) =>
                                togglePermission(key, details.checked === true)
                              }
                            >
                              <Checkbox.HiddenInput />
                              <Checkbox.Control />
                              <Checkbox.Label fontSize="11px" color="fg.default">
                                {t(label)}
                              </Checkbox.Label>
                            </Checkbox.Root>
                          );
                        })}
                      </HStack>
                    </HStack>
                  ))}
                </VStack>
              </HStack>
              {error && (
                <Text fontSize="11px" color="red.fg" role="alert">
                  {error}
                </Text>
              )}
            </Stack>
          </Stack>
        </DialogBody>
        <DialogFooter>
          <HStack gap={2}>
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" colorPalette="blue" loading={isSaving} onClick={() => void save()}>
              {t('sftp.properties.save')}
            </Button>
          </HStack>
        </DialogFooter>
        <DialogCloseTrigger />
      </DialogContent>
    </DialogRoot>
  );
};

const PropertyRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <HStack justify="space-between" align="flex-start" gap={3}>
    <Text fontSize="11px" color="fg.muted">
      {label}
    </Text>
    <Text fontSize="11px" color="fg.default" textAlign="right">
      {children}
    </Text>
  </HStack>
);

export default SftpPropertiesModal;
