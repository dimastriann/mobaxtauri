import React from 'react';
import { HStack, Box, Text } from "@chakra-ui/react";
import { useSessionStore } from '../store/useSessionStore';

const HealthBar: React.FC = () => {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const sessions = useSessionStore((state) => state.sessions);
  const activeSession = sessions.find(s => s.id === activeSessionId);

  if (!activeSession?.health) return null;
  const h = activeSession.health;
  const barColor = (pct: number) => pct > 90 ? 'red.400' : pct > 70 ? 'orange.400' : 'green.400';

  return (
    <HStack
      minH="24px" px={4} py={1} gap={4}
      bg="bg.muted" borderTop="1px solid" borderColor="border.subtle"
      fontSize="11px" color="fg.muted" fontFamily="monospace"
      flexWrap="wrap"
    >
      <HStack gap={1} flexShrink={0}>
        <Text color="fg.subtle" fontWeight="600">CPU</Text>
        <Box w="60px" h="6px" bg="whiteAlpha.100" borderRadius="full" overflow="hidden">
          <Box h="full" bg={barColor(h.cpu)} w={`${h.cpu}%`} transition="width 0.5s" borderRadius="full" />
        </Box>
        <Text w="42px" textAlign="right">{h.cpu.toFixed(1)}%</Text>
      </HStack>
      <HStack gap={1} flexShrink={0}>
        <Text color="fg.subtle" fontWeight="600">RAM</Text>
        <Box w="60px" h="6px" bg="whiteAlpha.100" borderRadius="full" overflow="hidden">
          <Box h="full" bg={barColor(h.ram)} w={`${h.ram}%`} transition="width 0.5s" borderRadius="full" />
        </Box>
        <Text textAlign="right">{h.ram_used.toFixed(0)}/{h.ram_total.toFixed(0)}M ({h.ram.toFixed(0)}%)</Text>
      </HStack>
      <HStack gap={1} flexShrink={0}>
        <Text color="fg.subtle" fontWeight="600">SWAP</Text>
        <Box w="60px" h="6px" bg="whiteAlpha.100" borderRadius="full" overflow="hidden">
          <Box h="full" bg={barColor(h.swap)} w={`${h.swap}%`} transition="width 0.5s" borderRadius="full" />
        </Box>
        <Text textAlign="right">{h.swap_used.toFixed(0)}/{h.swap_total.toFixed(0)}M ({h.swap.toFixed(0)}%)</Text>
      </HStack>
      <HStack gap={1} flexShrink={0}>
        <Text color="fg.subtle" fontWeight="600">DISK</Text>
        <Box w="60px" h="6px" bg="whiteAlpha.100" borderRadius="full" overflow="hidden">
          <Box h="full" bg={barColor(h.disk)} w={`${h.disk}%`} transition="width 0.5s" borderRadius="full" />
        </Box>
        <Text w="42px" textAlign="right">{h.disk.toFixed(0)}%</Text>
      </HStack>
    </HStack>
  );
};

export default HealthBar;
