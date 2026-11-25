import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useSftpStore } from '../store/useSftpStore';
import { useTranslation } from '../store/useLocaleStore';
import { SFTP_TRANSFER_EVENT, type SftpTransferEvent } from '../types/sftp';
import { formatFileSize } from '../utils/formatFileSize';
import { loadTransferConcurrency } from '../utils/transferConcurrency';
import { loadBandwidthLimitKbps } from '../utils/bandwidthLimit';
import { toaster } from '../components/ui/toaster';

/**
 * One application-level listener for SFTP progress events. Keeping this out of
 * the queue component means both the sidebar and the Files view share the same
 * store state without duplicate listeners or duplicate toast notifications.
 */
export function useSftpTransferEvents(): void {
  const { t } = useTranslation();
  const lastNotified = useRef<{ id: string; status: string } | null>(null);

  useEffect(() => {
    const limit = loadTransferConcurrency();
    void useSftpStore.getState().setTransferConcurrency(limit);
    const bandwidth = loadBandwidthLimitKbps();
    void useSftpStore.getState().setBandwidthLimit(bandwidth);
  }, []);

  useEffect(() => {
    const unlisten = listen<SftpTransferEvent>(SFTP_TRANSFER_EVENT, ({ payload }) => {
      useSftpStore.getState().updateTransfer(payload);
      if (
        (payload.status === 'completed' || payload.status === 'failed') &&
        (lastNotified.current?.id !== payload.transferId ||
          lastNotified.current?.status !== payload.status)
      ) {
        lastNotified.current = { id: payload.transferId, status: payload.status };
        if (payload.status === 'completed') {
          toaster.create({
            title: t('sftp.transferCompleted'),
            description: t('sftp.transferCompletedDetail', {
              size: formatFileSize(payload.transferred),
            }),
            type: 'success',
          });
        } else {
          toaster.create({
            title: t('sftp.transferFailed'),
            description: payload.message || t('sftp.transferFailedDetail'),
            type: 'error',
          });
        }
      }
    });
    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, [t]);
}
