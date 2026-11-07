import React, { useEffect, useState } from 'react';
import { VStack, HStack, Text, Box, Flex, Icon, Button, Input } from '@chakra-ui/react';
import { LuNetwork, LuPlus, LuTrash2 } from 'react-icons/lu';
import { useSessionStore } from '../store/useSessionStore';
import { useForwardStore } from '../store/useForwardStore';
import { toaster } from './ui/toaster';
import { useTranslation } from '../store/useLocaleStore';

const ForwardSidebar: React.FC = () => {
  const { t } = useTranslation();
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const activeSession = useSessionStore((state) =>
    state.sessions.find((s) => s.id === activeSessionId),
  );
  const forwards = useForwardStore((state) => state.forwards);
  const isLoading = useForwardStore((state) => state.isLoading);
  const error = useForwardStore((state) => state.error);
  const fetchForwards = useForwardStore((state) => state.fetchForwards);
  const addLocal = useForwardStore((state) => state.addLocal);
  const addDynamic = useForwardStore((state) => state.addDynamic);
  const addRemote = useForwardStore((state) => state.addRemote);
  const removeForward = useForwardStore((state) => state.removeForward);

  const [kind, setKind] = useState<'local' | 'dynamic' | 'remote'>('local');
  const [remoteHost, setRemoteHost] = useState('127.0.0.1');
  const [targetHost, setTargetHost] = useState('127.0.0.1');
  const [targetPort, setTargetPort] = useState('');
  const [bindPort, setBindPort] = useState('');

  const connected = Boolean(
    activeSessionId &&
    activeSessionId !== 'local' &&
    activeSession?.type === 'ssh' &&
    activeSession?.status === 'connected',
  );

  useEffect(() => {
    if (connected) {
      void fetchForwards();
    }
  }, [connected, fetchForwards]);

  const handleAdd = async () => {
    if (!activeSessionId) return;
    const portValue = bindPort.trim() ? Number(bindPort) : 0;
    if (!Number.isInteger(portValue) || portValue < 0 || portValue > 65535) {
      toaster.create({ title: t('forwards.invalidPort'), type: 'error' });
      return;
    }
    if (kind === 'remote') {
      const localPort = Number(targetPort);
      if (
        !remoteHost.trim() ||
        !targetHost.trim() ||
        !Number.isInteger(localPort) ||
        localPort <= 0
      ) {
        toaster.create({ title: t('forwards.enterLocalTarget'), type: 'error' });
        return;
      }
      await addRemote(activeSessionId, remoteHost.trim(), portValue, targetHost.trim(), localPort);
    } else if (kind === 'local') {
      const remotePort = Number(targetPort);
      if (!targetHost.trim() || !Number.isInteger(remotePort) || remotePort <= 0) {
        toaster.create({ title: t('forwards.enterTarget'), type: 'error' });
        return;
      }
      await addLocal(activeSessionId, targetHost.trim(), remotePort, portValue);
    } else {
      await addDynamic(activeSessionId, portValue);
    }
    setTargetPort('');
    setBindPort('');
  };

  if (!connected) {
    return (
      <Flex p={8} h="full" align="center" justify="center" direction="column" gap={4}>
        <Icon as={LuNetwork} boxSize="40px" color="fg.subtle" opacity={0.15} />
        <Text fontSize="12px" color="fg.muted" textAlign="center">
          {t('forwards.connectHint')}
        </Text>
      </Flex>
    );
  }

  const sessionForwards = forwards.filter((forward) => forward.sessionId === activeSessionId);

  return (
    <VStack align="stretch" h="full" minH={0} overflow="hidden" gap={0}>
      <HStack p={2} borderBottom="1px solid" borderColor="border.subtle" bg="bg.panel">
        <Text fontSize="10px" color="fg.muted" fontWeight="bold">
          {t('forwards.title')}
        </Text>
      </HStack>

      <VStack align="stretch" p={2} gap={2} borderBottom="1px solid" borderColor="border.subtle">
        <HStack gap={2}>
          <select
            aria-label={t('forwards.kind')}
            value={kind}
            onChange={(event) => setKind(event.target.value as 'local' | 'dynamic' | 'remote')}
            style={{
              height: '26px',
              flex: 1,
              backgroundColor: 'transparent',
              border: '1px solid var(--chakra-colors-border-subtle)',
              borderRadius: '4px',
              padding: '0 6px',
              fontSize: '12px',
              color: 'inherit',
            }}
          >
            <option value="local" style={{ background: 'var(--chakra-colors-bg-panel)' }}>
              {t('forwards.local')}
            </option>
            <option value="dynamic" style={{ background: 'var(--chakra-colors-bg-panel)' }}>
              {t('forwards.dynamic')}
            </option>
            <option value="remote" style={{ background: 'var(--chakra-colors-bg-panel)' }}>
              {t('forwards.remote')}
            </option>
          </select>
          <Input
            aria-label={t('forwards.port')}
            value={bindPort}
            onChange={(event) => setBindPort(event.target.value)}
            placeholder={
              kind === 'remote'
                ? t('forwards.serverPortPlaceholder')
                : t('forwards.bindPortPlaceholder')
            }
            size="xs"
            w="140px"
          />
        </HStack>
        {kind === 'remote' && (
          <Input
            aria-label={t('forwards.serverListenHost')}
            value={remoteHost}
            onChange={(event) => setRemoteHost(event.target.value)}
            placeholder={t('forwards.serverListenHost')}
            size="xs"
          />
        )}
        {kind !== 'dynamic' && (
          <HStack gap={2}>
            <Input
              aria-label={t('forwards.targetHost')}
              value={targetHost}
              onChange={(event) => setTargetHost(event.target.value)}
              placeholder={
                kind === 'remote' ? t('forwards.localTargetHost') : t('forwards.remoteTargetHost')
              }
              size="xs"
              flex={1}
            />
            <Input
              aria-label={t('forwards.targetPort')}
              value={targetPort}
              onChange={(event) => setTargetPort(event.target.value)}
              placeholder={kind === 'remote' ? t('forwards.localPort') : t('forwards.targetPort')}
              size="xs"
              w="80px"
            />
          </HStack>
        )}
        <Button size="xs" colorPalette="blue" onClick={() => void handleAdd()} loading={isLoading}>
          <Icon as={LuPlus} boxSize="12px" />
          {kind === 'local'
            ? t('forwards.addLocal')
            : kind === 'dynamic'
              ? t('forwards.addDynamic')
              : t('forwards.addRemote')}
        </Button>
        {error && (
          <Text fontSize="11px" color="red.fg" wordBreak="break-word">
            {error}
          </Text>
        )}
      </VStack>

      <VStack align="stretch" flex={1} minH={0} overflowY="auto" gap={0} px={1} py={1}>
        {sessionForwards.length === 0 ? (
          <Box p={4}>
            <Text fontSize="11px" color="fg.muted">
              {t('forwards.empty')}
            </Text>
          </Box>
        ) : (
          sessionForwards.map((forward) => (
            <HStack
              key={forward.id}
              justify="space-between"
              px={2}
              py={1.5}
              borderRadius="md"
              _hover={{ bg: 'bg.muted' }}
            >
              <Box minW={0}>
                <Text fontSize="11px" fontWeight="600" truncate>
                  {forward.kind === 'dynamic'
                    ? `socks5://${forward.bindHost}:${forward.bindPort}`
                    : forward.kind === 'remote'
                      ? `${forward.bindHost}:${forward.bindPort} → local ${forward.targetHost}:${forward.targetPort}`
                      : `${forward.bindHost}:${forward.bindPort} → ${forward.targetHost}:${forward.targetPort}`}
                </Text>
                <Text fontSize="10px" color="fg.subtle">
                  {forward.kind === 'dynamic'
                    ? t('forwards.socks5')
                    : forward.kind === 'remote'
                      ? t('forwards.remoteLabel')
                      : t('forwards.localLabel')}
                </Text>
              </Box>
              <Button
                aria-label={t('forwards.remove')}
                size="xs"
                variant="ghost"
                color="red.fg"
                onClick={() => void removeForward(forward.id)}
              >
                <Icon as={LuTrash2} boxSize="12px" />
              </Button>
            </HStack>
          ))
        )}
      </VStack>
    </VStack>
  );
};

export default ForwardSidebar;
