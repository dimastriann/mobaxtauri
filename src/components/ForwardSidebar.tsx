import React, { useEffect, useState } from 'react';
import { VStack, HStack, Text, Box, Flex, Icon, Button, Input } from '@chakra-ui/react';
import { LuNetwork, LuPlus, LuTrash2 } from 'react-icons/lu';
import { useSessionStore } from '../store/useSessionStore';
import { useForwardStore } from '../store/useForwardStore';
import { toaster } from './ui/toaster';

const ForwardSidebar: React.FC = () => {
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
      toaster.create({ title: 'Invalid port', type: 'error' });
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
        toaster.create({ title: 'Enter a local target host and port', type: 'error' });
        return;
      }
      await addRemote(activeSessionId, remoteHost.trim(), portValue, targetHost.trim(), localPort);
    } else if (kind === 'local') {
      const remotePort = Number(targetPort);
      if (!targetHost.trim() || !Number.isInteger(remotePort) || remotePort <= 0) {
        toaster.create({ title: 'Enter a target host and port', type: 'error' });
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
          Connect to an SSH session to add tunnels.
        </Text>
      </Flex>
    );
  }

  const sessionForwards = forwards.filter((forward) => forward.sessionId === activeSessionId);

  return (
    <VStack align="stretch" h="full" minH={0} overflow="hidden" gap={0}>
      <HStack p={2} borderBottom="1px solid" borderColor="border.subtle" bg="bg.panel">
        <Text fontSize="10px" color="fg.muted" fontWeight="bold">
          TUNNELS
        </Text>
      </HStack>

      <VStack align="stretch" p={2} gap={2} borderBottom="1px solid" borderColor="border.subtle">
        <HStack gap={2}>
          <select
            aria-label="Tunnel kind"
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
              Local
            </option>
            <option value="dynamic" style={{ background: 'var(--chakra-colors-bg-panel)' }}>
              Dynamic (SOCKS5)
            </option>
            <option value="remote" style={{ background: 'var(--chakra-colors-bg-panel)' }}>
              Remote
            </option>
          </select>
          <Input
            aria-label="Port"
            value={bindPort}
            onChange={(event) => setBindPort(event.target.value)}
            placeholder={kind === 'remote' ? 'Server port (auto)' : 'Local port (auto)'}
            size="xs"
            w="140px"
          />
        </HStack>
        {kind === 'remote' && (
          <Input
            aria-label="Server listen host"
            value={remoteHost}
            onChange={(event) => setRemoteHost(event.target.value)}
            placeholder="Server listen host"
            size="xs"
          />
        )}
        {kind !== 'dynamic' && (
          <HStack gap={2}>
            <Input
              aria-label="Target host"
              value={targetHost}
              onChange={(event) => setTargetHost(event.target.value)}
              placeholder={kind === 'remote' ? 'Local target host' : 'Target host (remote)'}
              size="xs"
              flex={1}
            />
            <Input
              aria-label="Target port"
              value={targetPort}
              onChange={(event) => setTargetPort(event.target.value)}
              placeholder={kind === 'remote' ? 'Local port' : 'Port'}
              size="xs"
              w="80px"
            />
          </HStack>
        )}
        <Button size="xs" colorPalette="blue" onClick={() => void handleAdd()} loading={isLoading}>
          <Icon as={LuPlus} boxSize="12px" />
          {kind === 'local'
            ? 'Add Local Forward'
            : kind === 'dynamic'
              ? 'Add SOCKS5 Proxy'
              : 'Add Remote Forward'}
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
              No tunnels for this session. Local forwards map a local port to a remote target;
              dynamic forwards expose a SOCKS5 proxy.
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
                    ? 'SOCKS5 proxy'
                    : forward.kind === 'remote'
                      ? 'Remote forward'
                      : 'Local forward'}
                </Text>
              </Box>
              <Button
                aria-label="Remove tunnel"
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
