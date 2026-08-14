import React, { useState } from 'react';
import {
  Stack,
  Input,
  Button,
  HStack,
  Text,
  Box,
  Switch,
  Flex,
  Icon,
  VStack,
} from '@chakra-ui/react';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogCloseTrigger,
} from './ui/dialog';
import { useColorMode } from './ui/color-mode';
import {
  LuTerminal,
  LuPalette,
  LuServer,
  LuMonitor,
  LuKeyboard,
  LuRotateCcw,
} from 'react-icons/lu';
import {
  DEFAULT_SHORTCUTS,
  KeyboardShortcuts,
  loadKeyboardShortcuts,
  saveKeyboardShortcuts,
  shortcutFromEvent,
  ShortcutAction,
  SHORTCUT_LABELS,
} from '../utils/keyboardShortcuts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = 'appearance' | 'terminal' | 'ssh' | 'shortcuts' | 'about';

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');

  const tabs: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
    { id: 'appearance', label: 'Appearance', icon: LuPalette },
    { id: 'terminal', label: 'Terminal', icon: LuTerminal },
    { id: 'ssh', label: 'SSH', icon: LuServer },
    { id: 'shortcuts', label: 'Shortcuts', icon: LuKeyboard },
    { id: 'about', label: 'About', icon: LuMonitor },
  ];

  return (
    <DialogRoot
      open={isOpen}
      onOpenChange={(e) => !e.open && onClose()}
      size="md"
      placement="center"
    >
      <DialogContent bg="bg.panel" borderColor="border.subtle" maxW="600px" h="450px">
        <DialogHeader>
          <DialogTitle color="fg.default">Settings</DialogTitle>
        </DialogHeader>

        <DialogBody display="flex" gap={4} p={4} overflow="hidden">
          {/* Sidebar tabs */}
          <VStack gap={1} minW="140px" align="stretch">
            {tabs.map((tab) => (
              <Box
                key={tab.id}
                p={2}
                borderRadius="md"
                cursor="pointer"
                bg={activeTab === tab.id ? 'blue.subtle' : 'transparent'}
                color={activeTab === tab.id ? 'blue.fg' : 'fg.muted'}
                _hover={{ bg: activeTab === tab.id ? 'blue.muted' : 'bg.emphasized' }}
                onClick={() => setActiveTab(tab.id)}
              >
                <HStack gap={2}>
                  <Icon as={tab.icon} boxSize="14px" />
                  <Text fontSize="13px" fontWeight="500">
                    {tab.label}
                  </Text>
                </HStack>
              </Box>
            ))}
          </VStack>

          {/* Content area */}
          <Box flex={1} overflowY="auto" className="custom-scrollbar" px={2}>
            {activeTab === 'appearance' && <AppearanceSettings />}
            {activeTab === 'terminal' && <TerminalSettings />}
            {activeTab === 'ssh' && <SshSettings />}
            {activeTab === 'shortcuts' && <ShortcutSettings />}
            {activeTab === 'about' && <AboutSettings />}
          </Box>
        </DialogBody>

        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
        <DialogCloseTrigger />
      </DialogContent>
    </DialogRoot>
  );
};

// ── Keyboard Shortcut Settings ──────────────────────────────
const ShortcutSettings: React.FC = () => {
  const [shortcuts, setShortcuts] = useState<KeyboardShortcuts>(loadKeyboardShortcuts);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);

  const updateShortcut = (action: ShortcutAction, shortcut: string) => {
    const updated = { ...shortcuts, [action]: shortcut };
    setShortcuts(updated);
    saveKeyboardShortcuts(updated);
    setRecording(null);
  };

  const resetShortcuts = () => {
    setShortcuts(DEFAULT_SHORTCUTS);
    saveKeyboardShortcuts(DEFAULT_SHORTCUTS);
    setRecording(null);
  };

  return (
    <Stack gap={3}>
      <Flex justify="space-between" align="center">
        <Text fontSize="14px" fontWeight="bold" color="fg">
          Keyboard Shortcuts
        </Text>
        <Button size="xs" variant="ghost" onClick={resetShortcuts}>
          <LuRotateCcw /> Reset
        </Button>
      </Flex>
      <Text fontSize="11px" color="fg.muted">
        Click a shortcut, then press the new key combination.
      </Text>
      {Object.keys(SHORTCUT_LABELS).map((key) => {
        const action = key as ShortcutAction;
        const duplicate = Object.entries(shortcuts).some(
          ([otherAction, value]) => otherAction !== action && value === shortcuts[action],
        );
        return (
          <Flex key={action} justify="space-between" align="center" gap={3}>
            <Text fontSize="12px" color="fg">
              {SHORTCUT_LABELS[action]}
            </Text>
            <Input
              size="xs"
              w="145px"
              readOnly
              value={recording === action ? 'Press keys…' : shortcuts[action]}
              color={duplicate ? 'orange.fg' : undefined}
              cursor="pointer"
              textAlign="center"
              onClick={() => setRecording(action)}
              onBlur={() => setRecording(null)}
              onKeyDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (event.key === 'Escape') {
                  setRecording(null);
                  return;
                }
                const shortcut = shortcutFromEvent(event);
                if (shortcut) updateShortcut(action, shortcut);
              }}
            />
          </Flex>
        );
      })}
      {new Set(Object.values(shortcuts)).size !== Object.keys(shortcuts).length && (
        <Text fontSize="11px" color="orange.fg">
          Duplicate shortcuts are highlighted. Only the first matching action will run.
        </Text>
      )}
    </Stack>
  );
};

// ── Appearance Settings ──────────────────────────────────────
const AppearanceSettings: React.FC = () => {
  const { colorMode, toggleColorMode } = useColorMode();

  return (
    <Stack gap={4}>
      <Text fontSize="14px" fontWeight="bold" color="fg">
        Appearance
      </Text>
      <Flex justify="space-between" align="center">
        <Box>
          <Text fontSize="13px" color="fg">
            Theme
          </Text>
          <Text fontSize="11px" color="fg.muted">
            Switch between light and dark mode
          </Text>
        </Box>
        <HStack gap={2}>
          <Text fontSize="12px" color="fg.muted">
            {colorMode === 'dark' ? 'Dark' : 'Light'}
          </Text>
          <Switch.Root
            checked={colorMode === 'light'}
            onCheckedChange={toggleColorMode}
            colorPalette="blue"
          >
            <Switch.HiddenInput />
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Root>
        </HStack>
      </Flex>
    </Stack>
  );
};

// ── Terminal Settings ────────────────────────────────────────
const TerminalSettings: React.FC = () => {
  const [fontSize, setFontSize] = useState(
    () => localStorage.getItem('terminal-font-size') || '14',
  );
  const [fontFamily, setFontFamily] = useState(
    () =>
      localStorage.getItem('terminal-font-family') ||
      '"Cascadia Code", Menlo, "Courier New", monospace',
  );

  const saveFontSize = (val: string) => {
    setFontSize(val);
    localStorage.setItem('terminal-font-size', val);
  };

  const saveFontFamily = (val: string) => {
    setFontFamily(val);
    localStorage.setItem('terminal-font-family', val);
  };

  return (
    <Stack gap={4}>
      <Text fontSize="14px" fontWeight="bold" color="fg">
        Terminal
      </Text>
      <Box>
        <Text fontSize="13px" color="fg" mb={1}>
          Font Size
        </Text>
        <HStack gap={2}>
          <Input
            size="sm"
            w="80px"
            type="number"
            min={10}
            max={32}
            value={fontSize}
            onChange={(e) => saveFontSize(e.target.value)}
            variant="subtle"
          />
          <Text fontSize="12px" color="fg.muted">
            px
          </Text>
        </HStack>
      </Box>
      <Box>
        <Text fontSize="13px" color="fg" mb={1}>
          Font Family
        </Text>
        <Input
          size="sm"
          value={fontFamily}
          onChange={(e) => saveFontFamily(e.target.value)}
          variant="subtle"
          placeholder="e.g. Cascadia Code, monospace"
        />
      </Box>
      <Text fontSize="11px" color="fg.muted" fontStyle="italic">
        Changes apply to new terminal sessions. Restart the app to see changes.
      </Text>
    </Stack>
  );
};

// ── SSH Settings ─────────────────────────────────────────────
const SshSettings: React.FC = () => {
  const [defaultPort, setDefaultPort] = useState(
    () => localStorage.getItem('ssh-default-port') || '22',
  );
  const [timeout, setTimeout_] = useState(() => localStorage.getItem('ssh-timeout') || '15');

  const saveDefaultPort = (val: string) => {
    setDefaultPort(val);
    localStorage.setItem('ssh-default-port', val);
  };

  const saveTimeout = (val: string) => {
    setTimeout_(val);
    localStorage.setItem('ssh-timeout', val);
  };

  return (
    <Stack gap={4}>
      <Text fontSize="14px" fontWeight="bold" color="fg">
        SSH Defaults
      </Text>
      <Box>
        <Text fontSize="13px" color="fg" mb={1}>
          Default Port
        </Text>
        <Input
          size="sm"
          w="100px"
          type="number"
          min={1}
          max={65535}
          value={defaultPort}
          onChange={(e) => saveDefaultPort(e.target.value)}
          variant="subtle"
        />
      </Box>
      <Box>
        <Text fontSize="13px" color="fg" mb={1}>
          Connection Timeout
        </Text>
        <HStack gap={2}>
          <Input
            size="sm"
            w="80px"
            type="number"
            min={5}
            max={120}
            value={timeout}
            onChange={(e) => saveTimeout(e.target.value)}
            variant="subtle"
          />
          <Text fontSize="12px" color="fg.muted">
            seconds
          </Text>
        </HStack>
      </Box>
    </Stack>
  );
};

// ── About Section ────────────────────────────────────────────
const AboutSettings: React.FC = () => {
  return (
    <Stack gap={4} align="center" justify="center" flex={1} h="full">
      <Text fontSize="24px" fontWeight="bold" bgGradient="to-r" bgClip="text" color="blue.400">
        MobaXTauri
      </Text>
      <Text fontSize="13px" color="fg.muted">
        v0.1.0
      </Text>
      <Text fontSize="12px" color="fg.muted" textAlign="center" maxW="250px">
        A modern SSH client and terminal emulator built with Tauri and React.
      </Text>
      <Text fontSize="11px" color="fg.muted" mt={4}>
        Made with ❤️ using Rust + React
      </Text>
    </Stack>
  );
};

export default SettingsModal;
