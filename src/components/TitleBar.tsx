import React from 'react';
import { Box, HStack, Icon, Text, Input, IconButton } from '@chakra-ui/react';
import { Tooltip } from './ui/tooltip';
import { LuTerminal, LuMonitor } from 'react-icons/lu';
import { ColorModeButton } from './ui/color-mode';
import { ask } from '@tauri-apps/plugin-dialog';
import { useSessionStore } from '../store/useSessionStore';

interface TitleBarProps {
  quickConnectRef: React.RefObject<HTMLInputElement | null>;
  quickConnectStr: string;
  setQuickConnectStr: (val: string) => void;
  onQuickConnect: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const TitleBar: React.FC<TitleBarProps> = ({
  quickConnectRef,
  quickConnectStr,
  setQuickConnectStr,
  onQuickConnect,
  onContextMenu,
}) => {
  return (
    <Box
      h="38px"
      minH="38px"
      bg="bg.muted"
      borderBottom="1px solid"
      borderColor="border.subtle"
      px={4}
      display="flex"
      alignItems="center"
      justifyContent="space-between"
    >
      <HStack gap={2}>
        <Box
          display="flex"
          alignItems="center"
          justifyContent="center"
          w="22px"
          h="22px"
          borderRadius="4px"
          bg="blue.subtle"
        >
          <Icon as={LuTerminal} boxSize="12px" color="blue.fg" />
        </Box>
        <Text fontSize="12px" fontWeight="700" letterSpacing="0.08em" color="fg.muted">
          MOBAXTAURI
        </Text>
        <Text fontSize="10px" color="fg.subtle" ml={1}>
          v0.1.0
        </Text>
      </HStack>

      <HStack gap={3}>
        <Input
          ref={quickConnectRef}
          size="xs"
          placeholder="Quick Connect (user@host:port)"
          w="200px"
          value={quickConnectStr}
          onChange={(e) => setQuickConnectStr(e.target.value)}
          onKeyDown={onQuickConnect}
          onContextMenu={onContextMenu}
        />

        <HStack gap={1} pr={2} borderRight="1px solid" borderColor="border.subtle">
          <Tooltip content="Shutdown all active sessions" showArrow>
            <IconButton
              aria-label="Shutdown all sessions"
              size="xs"
              variant="ghost"
              color="red.fg"
              _hover={{ bg: 'red.subtle' }}
              onClick={async () => {
                const confirmed = await ask(
                  'Shutdown all active sessions? ALL terminal data will be lost.',
                  {
                    title: 'MobaXTauri',
                    kind: 'warning',
                  },
                );
                if (confirmed) {
                  useSessionStore.getState().shutdownAll();
                }
              }}
            >
              <Icon as={LuMonitor} />
            </IconButton>
          </Tooltip>

          <Tooltip content="Toggle Dark/Light Mode" showArrow>
            <ColorModeButton
              size="xs"
              zIndex={20}
              position="relative"
              _hover={{ bg: 'bg.emphasized' }}
            />
          </Tooltip>
        </HStack>
      </HStack>
    </Box>
  );
};

export default TitleBar;
