import React, { useEffect, useState } from 'react';
import { Button, HStack, Spinner, Stack, Text } from '@chakra-ui/react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from './ui/dialog';
import type { ConnectionDiagnostics } from '../types/diagnostics';
import { formatConnectionDiagnostics } from '../utils/diagnosticsReport';
import { useTranslation } from '../store/useLocaleStore';
import { toaster } from './ui/toaster';

interface ConnectionDiagnosticsModalProps {
  isOpen: boolean;
  sessionId: string | null;
  sessionName: string;
  onClose: () => void;
}

const ConnectionDiagnosticsModal: React.FC<ConnectionDiagnosticsModalProps> = ({
  isOpen,
  sessionId,
  sessionName,
  onClose,
}) => {
  const { t } = useTranslation();
  const [report, setReport] = useState<ConnectionDiagnostics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const openKey = isOpen ? sessionId : null;

  if (loadedKey !== openKey) {
    setLoadedKey(openKey);
    setReport(null);
    setError(null);
    setIsLoading(openKey !== null);
  }

  useEffect(() => {
    if (!isOpen || !sessionId) return;
    let disposed = false;
    invoke<ConnectionDiagnostics>('ssh_diagnostics', { sessionId })
      .then((value) => {
        if (!disposed) setReport(value);
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
  }, [isOpen, sessionId]);

  const copyReport = async () => {
    if (!report) return;
    try {
      await writeText(formatConnectionDiagnostics(report));
      toaster.create({ title: t('diagnostics.copied'), type: 'success' });
    } catch (copyError) {
      toaster.create({
        title: t('diagnostics.copyFailed'),
        description: String(copyError),
        type: 'error',
      });
    }
  };

  const saveReport = async () => {
    if (!report) return;
    const path = await save({
      defaultPath: `${sessionName.replace(/[^a-z0-9_-]+/gi, '-')}-diagnostics.txt`,
      filters: [{ name: t('diagnostics.reportFilter'), extensions: ['txt'] }],
    });
    if (!path) return;
    try {
      await invoke('write_text_file', {
        path,
        content: formatConnectionDiagnostics(report),
      });
      toaster.create({ title: t('diagnostics.saved'), type: 'success' });
    } catch (saveError) {
      toaster.create({
        title: t('diagnostics.saveFailed'),
        description: String(saveError),
        type: 'error',
      });
    }
  };

  const rows: { label: string; value: string | number | null | undefined }[] = report
    ? [
        { label: t('diagnostics.target'), value: `${report.user}@${report.host}:${report.port}` },
        {
          label: t('diagnostics.connectedAt'),
          value: new Date(report.connectedAt * 1000).toLocaleString(),
        },
        { label: t('diagnostics.proxyJump'), value: report.jumpSessionId ?? '?' },
        { label: t('diagnostics.tcp'), value: `${report.timings.tcpMs} ms` },
        { label: t('diagnostics.auth'), value: `${report.timings.authMs} ms` },
        { label: t('diagnostics.shell'), value: `${report.timings.shellMs} ms` },
        { label: t('diagnostics.sftp'), value: `${report.timings.sftpMs} ms` },
        { label: t('diagnostics.total'), value: `${report.timings.totalMs} ms` },
        { label: t('diagnostics.authAttempted'), value: report.authAttempted.join(', ') },
        { label: t('diagnostics.authUsed'), value: report.authUsed ?? '?' },
        { label: t('diagnostics.serverBanner'), value: report.serverBanner || '?' },
        { label: t('diagnostics.hostKeyType'), value: report.hostKeyType ?? '?' },
        { label: t('diagnostics.fingerprint'), value: report.hostKeyFingerprint ?? '?' },
        { label: t('diagnostics.sftpHome'), value: report.sftpHome ?? '?' },
      ]
    : [];

  return (
    <DialogRoot open={isOpen} onOpenChange={(event) => !event.open && onClose()} size="md">
      <DialogContent bg="bg.panel" borderColor="border.subtle">
        <DialogHeader>
          <DialogTitle color="fg.default">
            {t('diagnostics.title')} ? {sessionName}
          </DialogTitle>
        </DialogHeader>
        <DialogBody pb={2}>
          {isLoading ? (
            <HStack justify="center" py={6}>
              <Spinner size="sm" />
            </HStack>
          ) : error ? (
            <Text fontSize="12px" color="red.fg" role="alert">
              {error}
            </Text>
          ) : report ? (
            <Stack gap={1} fontFamily="monospace" fontSize="11px">
              {rows.map((row) => (
                <HStack key={row.label} align="flex-start" gap={3}>
                  <Text color="fg.muted" minW="150px">
                    {row.label}
                  </Text>
                  <Text color="fg.default" wordBreak="break-all">
                    {row.value === null || row.value === undefined || row.value === ''
                      ? '?'
                      : row.value}
                  </Text>
                </HStack>
              ))}
            </Stack>
          ) : (
            <Text fontSize="12px" color="fg.muted">
              {t('diagnostics.unavailable')}
            </Text>
          )}
        </DialogBody>
        <DialogFooter>
          <HStack gap={2}>
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t('common.close')}
            </Button>
            <Button size="sm" variant="subtle" onClick={() => void copyReport()} disabled={!report}>
              {t('diagnostics.copy')}
            </Button>
            <Button
              size="sm"
              colorPalette="blue"
              onClick={() => void saveReport()}
              disabled={!report}
            >
              {t('diagnostics.save')}
            </Button>
          </HStack>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
};

export default ConnectionDiagnosticsModal;
