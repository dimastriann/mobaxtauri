import React from 'react';
import { Box, Button, HStack, Text, VStack } from '@chakra-ui/react';
import { useSftpStore } from '../store/useSftpStore';
import { useTranslation } from '../store/useLocaleStore';
import { formatFileSize } from '../utils/formatFileSize';
import { formatEta, formatTransferSpeed } from '../utils/transferMetrics';

interface TransferQueueProps {
  maxHeight?: string;
}

const TransferQueue: React.FC<TransferQueueProps> = ({ maxHeight = '160px' }) => {
  const { t } = useTranslation();
  const transfers = useSftpStore((state) => state.transfers);
  const cancelTransfer = useSftpStore((state) => state.cancelTransfer);
  const pauseTransfer = useSftpStore((state) => state.pauseTransfer);
  const resumeTransfer = useSftpStore((state) => state.resumeTransfer);
  const retryTransfer = useSftpStore((state) => state.retryTransfer);
  const dismissTransfer = useSftpStore((state) => state.dismissTransfer);

  if (transfers.length === 0) return null;

  return (
    <VStack
      align="stretch"
      gap={0}
      px={2}
      py={1}
      borderBottom="1px solid"
      borderColor="border.subtle"
      bg="bg.muted"
      maxH={maxHeight}
      overflowY="auto"
      className="custom-scrollbar"
    >
      <Text fontSize="10px" color="fg.subtle" fontWeight="bold" pt={1}>
        {t('sftp.transfersHeading', {
          active: transfers.filter(
            (entry) =>
              entry.status === 'running' || entry.status === 'queued' || entry.status === 'paused',
          ).length,
        })}
      </Text>
      {transfers.map((entry) => {
        const percent =
          entry.percent !== undefined && entry.percent !== null
            ? Math.min(100, entry.percent)
            : entry.total
              ? Math.min(100, (entry.transferred / entry.total) * 100)
              : 25;
        const failed = entry.status === 'failed';
        const done = entry.status === 'completed';
        const paused = entry.status === 'paused';
        const active = entry.status === 'running' || entry.status === 'queued' || paused;
        const speed = entry.status === 'running' ? formatTransferSpeed(entry.bytesPerSec) : null;
        const eta = entry.status === 'running' ? formatEta(entry.etaSeconds) : null;
        return (
          <Box key={entry.transferId} py={1}>
            <HStack justify="space-between" gap={2}>
              <Text fontSize="10px" color={failed ? 'red.fg' : 'fg.muted'} truncate flex={1}>
                {entry.kind.replace(/_/g, ' ')} ? {entry.label} {formatFileSize(entry.transferred)}
                {entry.total ? ` / ${formatFileSize(entry.total)}` : ''}
                {entry.percent !== undefined && entry.percent !== null
                  ? ` (${entry.percent}%)`
                  : ''}
                {entry.resumed ? ` | ${t('sftp.transfer.resumed')}` : ''}
                {speed ? ` | ${speed}` : ''}
                {eta ? ` | ${t('sftp.eta', { eta })}` : ''}
                {paused ? ` | ${t('sftp.transfer.paused')}` : ''}
              </Text>
              {active ? (
                <HStack gap={1}>
                  {entry.status === 'running' && (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => void pauseTransfer(entry.transferId)}
                    >
                      {t('sftp.transfer.pause')}
                    </Button>
                  )}
                  {paused && (
                    <Button
                      size="xs"
                      variant="ghost"
                      colorPalette="blue"
                      onClick={() => void resumeTransfer(entry.transferId)}
                    >
                      {t('sftp.transfer.resume')}
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => void cancelTransfer(entry.transferId)}
                  >
                    {t('sftp.transfer.cancel')}
                  </Button>
                </HStack>
              ) : failed ? (
                <HStack gap={1}>
                  <Button
                    size="xs"
                    variant="ghost"
                    colorPalette="blue"
                    onClick={() => void retryTransfer(entry.transferId)}
                  >
                    {t('sftp.transfer.retry')}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    colorPalette="gray"
                    onClick={() => dismissTransfer(entry.transferId)}
                  >
                    {t('sftp.transfer.dismiss')}
                  </Button>
                  <Text fontSize="10px" color="red.fg">
                    {entry.status}
                  </Text>
                </HStack>
              ) : (
                <Text fontSize="10px" color={done ? 'green.fg' : 'fg.muted'}>
                  {entry.status}
                </Text>
              )}
            </HStack>
            <Box h="2px" bg="bg.emphasized" borderRadius="full" overflow="hidden" mt={1}>
              <Box
                h="full"
                bg={
                  failed
                    ? 'red.fg'
                    : done
                      ? 'green.fg'
                      : paused
                        ? 'orange.fg'
                        : entry.status === 'queued'
                          ? 'gray.fg'
                          : 'blue.fg'
                }
                width={`${percent}%`}
                transition="width 120ms linear"
              />
            </Box>
          </Box>
        );
      })}
    </VStack>
  );
};

export default TransferQueue;
