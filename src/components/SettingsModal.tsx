import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
  LuCode,
  LuHistory,
  LuPlus,
  LuTrash2,
  LuShieldCheck,
  LuKeyRound,
} from 'react-icons/lu';
import { ask, open, save } from '@tauri-apps/plugin-dialog';
import type { KnownHost } from '../types/ssh';
import SshKeyManager from './SshKeyManager';
import { useSessionStore } from '../store/useSessionStore';
import { useCredentialStore } from '../store/useCredentialStore';
import { useTerminalAppearanceStore } from '../store/useTerminalAppearanceStore';
import { useTranslation } from '../store/useLocaleStore';
import { LOCALES, type Locale } from '../i18n';
import {
  DEFAULT_SHORTCUTS,
  KeyboardShortcuts,
  loadKeyboardShortcuts,
  saveKeyboardShortcuts,
  shortcutFromEvent,
  ShortcutAction,
  SHORTCUT_LABELS,
} from '../utils/keyboardShortcuts';
import {
  loadReconnectSettings,
  saveReconnectSettings,
  type ReconnectSettings,
} from '../utils/reconnectPolicy';
import { AUTO_LOCK_OPTIONS, loadAutoLockMinutes, saveAutoLockMinutes } from '../utils/idleLock';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab =
  | 'appearance'
  | 'terminal'
  | 'ssh'
  | 'keys'
  | 'shortcuts'
  | 'snippets'
  | 'history'
  | 'about';

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const { t } = useTranslation();

  const tabs: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
    { id: 'appearance', label: t('settings.tab.appearance'), icon: LuPalette },
    { id: 'terminal', label: t('settings.tab.terminal'), icon: LuTerminal },
    { id: 'ssh', label: t('settings.tab.ssh'), icon: LuServer },
    { id: 'keys', label: t('settings.tab.keys'), icon: LuKeyRound },
    { id: 'shortcuts', label: t('settings.tab.shortcuts'), icon: LuKeyboard },
    { id: 'snippets', label: t('settings.tab.snippets'), icon: LuCode },
    { id: 'history', label: t('settings.tab.history'), icon: LuHistory },
    { id: 'about', label: t('settings.tab.about'), icon: LuMonitor },
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
          <DialogTitle color="fg.default">{t('settings.title')}</DialogTitle>
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
            {activeTab === 'keys' && <SshKeyManager />}
            {activeTab === 'shortcuts' && <ShortcutSettings />}
            {activeTab === 'snippets' && <SnippetSettings />}
            {activeTab === 'history' && <ConnectionHistorySettings />}
            {activeTab === 'about' && <AboutSettings />}
          </Box>
        </DialogBody>

        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
        <DialogCloseTrigger />
      </DialogContent>
    </DialogRoot>
  );
};

const SnippetSettings: React.FC = () => {
  const { t } = useTranslation();
  const snippets = useSessionStore((state) => state.snippets);
  const addSnippet = useSessionStore((state) => state.addSnippet);
  const deleteSnippet = useSessionStore((state) => state.deleteSnippet);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');

  const handleAdd = () => {
    if (!name.trim() || !command.trim()) return;
    addSnippet(name.trim(), command);
    setName('');
    setCommand('');
  };

  return (
    <Stack gap={3}>
      <Text fontSize="14px" fontWeight="bold" color="fg">
        {t('settings.snippets.heading')}
      </Text>
      <Input
        size="sm"
        placeholder={t('settings.snippets.namePlaceholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <HStack align="stretch">
        <Input
          size="sm"
          fontFamily="monospace"
          placeholder={t('settings.snippets.commandPlaceholder')}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <Button
          size="sm"
          colorPalette="blue"
          onClick={handleAdd}
          disabled={!name.trim() || !command.trim()}
        >
          <LuPlus /> {t('settings.snippets.add')}
        </Button>
      </HStack>
      <VStack align="stretch" gap={1}>
        {snippets.map((snippet) => (
          <HStack key={snippet.id} p={2} borderRadius="md" bg="bg.muted">
            <Box flex={1} minW={0}>
              <Text fontSize="12px" fontWeight="500" lineClamp={1}>
                {snippet.name}
              </Text>
              <Text fontSize="10px" color="fg.muted" fontFamily="monospace" lineClamp={1}>
                {snippet.command}
              </Text>
            </Box>
            <Button
              size="xs"
              variant="ghost"
              colorPalette="red"
              onClick={() => deleteSnippet(snippet.id)}
            >
              <LuTrash2 />
            </Button>
          </HStack>
        ))}
        {!snippets.length && (
          <Text fontSize="11px" color="fg.muted">
            {t('settings.snippets.empty')}
          </Text>
        )}
      </VStack>
    </Stack>
  );
};

const ConnectionHistorySettings: React.FC = () => {
  const { t } = useTranslation();
  const history = useSessionStore((state) => state.connectionHistory);
  const clearHistory = useSessionStore((state) => state.clearConnectionHistory);
  return (
    <Stack gap={3}>
      <Flex justify="space-between" align="center">
        <Text fontSize="14px" fontWeight="bold" color="fg">
          {t('settings.history.heading')}
        </Text>
        <Button size="xs" variant="ghost" onClick={clearHistory} disabled={!history.length}>
          {t('settings.history.clear')}
        </Button>
      </Flex>
      <VStack align="stretch" gap={1}>
        {history.map((entry) => (
          <Box key={entry.id} p={2} borderRadius="md" bg="bg.muted">
            <HStack justify="space-between">
              <Text fontSize="12px" fontWeight="500" lineClamp={1}>
                {entry.sessionName}
              </Text>
              <Text
                fontSize="10px"
                color={
                  entry.status === 'connected'
                    ? 'green.fg'
                    : entry.status === 'failed'
                      ? 'red.fg'
                      : 'orange.fg'
                }
              >
                {t(`settings.history.${entry.status}` as const)}
              </Text>
            </HStack>
            <Text fontSize="10px" color="fg.muted">
              {new Date(entry.timestamp).toLocaleString()}
              {entry.host ? ` · ${entry.host}` : ''}
            </Text>
            {entry.message && (
              <Text fontSize="10px" color="red.fg" lineClamp={2}>
                {entry.message}
              </Text>
            )}
          </Box>
        ))}
        {!history.length && (
          <Text fontSize="11px" color="fg.muted">
            {t('settings.history.empty')}
          </Text>
        )}
      </VStack>
    </Stack>
  );
};

// ── Keyboard Shortcut Settings ──────────────────────────────
const ShortcutSettings: React.FC = () => {
  const { t } = useTranslation();
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
          {t('settings.shortcuts.heading')}
        </Text>
        <Button size="xs" variant="ghost" onClick={resetShortcuts}>
          <LuRotateCcw /> {t('settings.shortcuts.reset')}
        </Button>
      </Flex>
      <Text fontSize="11px" color="fg.muted">
        {t('settings.shortcuts.hint')}
      </Text>
      {Object.keys(SHORTCUT_LABELS).map((key) => {
        const action = key as ShortcutAction;
        const duplicate = Object.entries(shortcuts).some(
          ([otherAction, value]) => otherAction !== action && value === shortcuts[action],
        );
        return (
          <Flex key={action} justify="space-between" align="center" gap={3}>
            <Text fontSize="12px" color="fg">
              {t(`shortcut.${action}` as const)}
            </Text>
            <Input
              size="xs"
              w="145px"
              readOnly
              value={recording === action ? t('settings.shortcuts.pressKeys') : shortcuts[action]}
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
          {t('settings.shortcuts.duplicate')}
        </Text>
      )}
    </Stack>
  );
};

// ── Appearance Settings ──────────────────────────────────────
const AppearanceSettings: React.FC = () => {
  const { colorMode, toggleColorMode } = useColorMode();
  const { t, locale, setLocale } = useTranslation();

  return (
    <Stack gap={4}>
      <Text fontSize="14px" fontWeight="bold" color="fg">
        {t('appearance.heading')}
      </Text>
      <Flex justify="space-between" align="center">
        <Box>
          <Text fontSize="13px" color="fg">
            {t('appearance.theme.label')}
          </Text>
          <Text fontSize="11px" color="fg.muted">
            {t('appearance.theme.helper')}
          </Text>
        </Box>
        <HStack gap={2}>
          <Text fontSize="12px" color="fg.muted">
            {colorMode === 'dark' ? t('appearance.theme.dark') : t('appearance.theme.light')}
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
      <Flex justify="space-between" align="center">
        <Box>
          <Text fontSize="13px" color="fg">
            {t('appearance.language.label')}
          </Text>
          <Text fontSize="11px" color="fg.muted">
            {t('appearance.language.helper')}
          </Text>
        </Box>
        <select
          aria-label={t('appearance.language.label')}
          value={locale}
          onChange={(event) => setLocale(event.target.value as Locale)}
          style={{
            width: '180px',
            height: '32px',
            backgroundColor: 'transparent',
            border: '1px solid',
            borderColor: 'var(--chakra-colors-border-subtle)',
            borderRadius: '4px',
            padding: '0 8px',
            fontSize: '13px',
            color: 'inherit',
          }}
        >
          {LOCALES.map((option) => (
            <option
              key={option.id}
              value={option.id}
              style={{ background: 'var(--chakra-colors-bg-panel)' }}
            >
              {option.label}
            </option>
          ))}
        </select>
      </Flex>
    </Stack>
  );
};

// ── Terminal Settings ────────────────────────────────────────
const settingsSelectStyle: React.CSSProperties = {
  width: '100%',
  height: '32px',
  backgroundColor: 'transparent',
  border: '1px solid',
  borderColor: 'var(--chakra-colors-border-subtle)',
  borderRadius: '4px',
  padding: '0 8px',
  fontSize: '13px',
  color: 'inherit',
};

const TerminalSettings: React.FC = () => {
  const { t } = useTranslation();
  const themes = useTerminalAppearanceStore((state) => state.themes);
  const isLoadingThemes = useTerminalAppearanceStore((state) => state.isLoadingThemes);
  const selectedThemeId = useTerminalAppearanceStore((state) => state.selectedThemeId);
  const fetchThemes = useTerminalAppearanceStore((state) => state.fetchThemes);
  const selectTheme = useTerminalAppearanceStore((state) => state.selectTheme);
  const fontPreferences = useTerminalAppearanceStore((state) => state.fontPreferences);
  const updateFontPreferences = useTerminalAppearanceStore((state) => state.updateFontPreferences);
  const [scrollback, setScrollback] = useState(
    () => localStorage.getItem('terminal-scrollback') || '10000',
  );

  useEffect(() => {
    void fetchThemes();
  }, [fetchThemes]);

  const saveScrollback = (val: string) => {
    setScrollback(val);
    localStorage.setItem('terminal-scrollback', val);
  };

  return (
    <Stack gap={4}>
      <Text fontSize="14px" fontWeight="bold" color="fg">
        {t('terminal.heading')}
      </Text>
      <Box>
        <Text fontSize="13px" color="fg" mb={1}>
          {t('terminal.theme.label')}
        </Text>
        <select
          aria-label={t('settings.terminal.colorThemeAria')}
          value={selectedThemeId ?? ''}
          onChange={(event) => selectTheme(event.target.value || null)}
          style={settingsSelectStyle}
          disabled={isLoadingThemes && themes.length === 0}
        >
          <option value="" style={{ background: 'var(--chakra-colors-bg-panel)' }}>
            {t('terminal.theme.matchApp')}
          </option>
          {themes.map((theme) => (
            <option
              key={theme.id}
              value={theme.id}
              style={{ background: 'var(--chakra-colors-bg-panel)' }}
            >
              {theme.name}
            </option>
          ))}
        </select>
      </Box>
      <HStack gap={4} align="flex-end">
        <Box>
          <Text fontSize="13px" color="fg" mb={1}>
            {t('terminal.fontSize')}
          </Text>
          <HStack gap={2}>
            <Input
              size="sm"
              w="80px"
              type="number"
              min={8}
              max={32}
              value={fontPreferences.size}
              onChange={(event) => updateFontPreferences({ size: Number(event.target.value) })}
              variant="subtle"
            />
            <Text fontSize="12px" color="fg.muted">
              px
            </Text>
          </HStack>
        </Box>
        <Box>
          <Text fontSize="13px" color="fg" mb={1}>
            {t('terminal.lineHeight')}
          </Text>
          <Input
            size="sm"
            w="80px"
            type="number"
            min={1}
            max={2}
            step={0.1}
            value={fontPreferences.lineHeight}
            onChange={(event) => updateFontPreferences({ lineHeight: Number(event.target.value) })}
            variant="subtle"
          />
        </Box>
        <Box w="120px">
          <Text fontSize="13px" color="fg" mb={1}>
            {t('terminal.weight')}
          </Text>
          <select
            aria-label={t('settings.terminal.fontWeightAria')}
            value={fontPreferences.weight}
            onChange={(event) =>
              updateFontPreferences({
                weight: event.target.value === 'bold' ? 'bold' : 'normal',
              })
            }
            style={settingsSelectStyle}
          >
            <option value="normal" style={{ background: 'var(--chakra-colors-bg-panel)' }}>
              {t('terminal.weight.normal')}
            </option>
            <option value="bold" style={{ background: 'var(--chakra-colors-bg-panel)' }}>
              {t('terminal.weight.bold')}
            </option>
          </select>
        </Box>
      </HStack>
      <Box>
        <Text fontSize="13px" color="fg" mb={1}>
          {t('terminal.fontFamily')}
        </Text>
        <Input
          size="sm"
          value={fontPreferences.family}
          onChange={(event) => updateFontPreferences({ family: event.target.value })}
          variant="subtle"
          placeholder={t('settings.terminal.fontFamilyPlaceholder')}
        />
      </Box>
      <Box>
        <Text fontSize="13px" color="fg" mb={1}>
          {t('terminal.scrollback')}
        </Text>
        <HStack gap={2}>
          <Input
            size="sm"
            w="80px"
            type="number"
            min={1000}
            max={200000}
            step={1000}
            value={scrollback}
            onChange={(e) => saveScrollback(e.target.value)}
            variant="subtle"
          />
          <Text fontSize="12px" color="fg.muted">
            {t('settings.terminal.lines')}
          </Text>
        </HStack>
      </Box>
      <Text fontSize="11px" color="fg.muted" fontStyle="italic">
        {t('terminal.applyNote')}
      </Text>
    </Stack>
  );
};

// ── SSH Settings ─────────────────────────────────────────────
const SshSettings: React.FC = () => {
  const { t } = useTranslation();
  const [defaultPort, setDefaultPort] = useState(
    () => localStorage.getItem('ssh-default-port') || '22',
  );
  const [timeout, setTimeout_] = useState(() => localStorage.getItem('ssh-timeout') || '15');
  const [healthInterval, setHealthInterval] = useState(
    () => localStorage.getItem('health-interval') || '5',
  );
  const [reconnect, setReconnect] = useState<ReconnectSettings>(loadReconnectSettings);
  const [autoLockMinutes, setAutoLockMinutes] = useState(loadAutoLockMinutes);
  const isVaultUnlocked = useCredentialStore((state) => state.isUnlocked);
  const lockVault = useCredentialStore((state) => state.lock);

  const saveDefaultPort = (val: string) => {
    setDefaultPort(val);
    localStorage.setItem('ssh-default-port', val);
  };

  const saveTimeout = (val: string) => {
    setTimeout_(val);
    localStorage.setItem('ssh-timeout', val);
  };

  const saveHealthInterval = (val: string) => {
    setHealthInterval(val);
    localStorage.setItem('health-interval', val);
    void invoke('set_health_interval', { seconds: Number(val) });
  };

  const updateReconnect = (next: ReconnectSettings) => {
    setReconnect(next);
    saveReconnectSettings(next);
  };

  const updateAutoLock = (value: string) => {
    setAutoLockMinutes(saveAutoLockMinutes(Number(value)));
  };

  return (
    <Stack gap={4}>
      <Text fontSize="14px" fontWeight="bold" color="fg">
        {t('ssh.defaults')}
      </Text>
      <Box>
        <Text fontSize="13px" color="fg" mb={1}>
          {t('ssh.healthInterval')}
        </Text>
        <select value={healthInterval} onChange={(e) => saveHealthInterval(e.target.value)}>
          <option value="0">{t('ssh.health.off')}</option>
          <option value="2">{t('ssh.health.2')}</option>
          <option value="5">{t('ssh.health.5')}</option>
          <option value="15">{t('ssh.health.15')}</option>
          <option value="60">{t('ssh.health.60')}</option>
        </select>
      </Box>
      <Box>
        <Text fontSize="13px" color="fg" mb={1}>
          {t('ssh.defaultPort')}
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
          {t('ssh.connectionTimeout')}
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
            {t('ssh.seconds')}
          </Text>
        </HStack>
      </Box>
      <Box borderTop="1px solid" borderColor="border.subtle" pt={3}>
        <HStack gap={2}>
          <input
            type="checkbox"
            id="auto-reconnect"
            checked={reconnect.enabled}
            onChange={(event) => updateReconnect({ ...reconnect, enabled: event.target.checked })}
          />
          <label htmlFor="auto-reconnect" style={{ fontSize: '13px', cursor: 'pointer' }}>
            {t('ssh.autoReconnect')}
          </label>
        </HStack>
        <Text fontSize="11px" color="fg.muted" mt={1}>
          {t('ssh.autoReconnectHelper')}
        </Text>
        <HStack gap={2} mt={2} align="center">
          <Text fontSize="12px" color="fg.muted">
            {t('ssh.autoReconnectMax')}
          </Text>
          <Input
            size="sm"
            w="80px"
            type="number"
            min={5}
            max={300}
            value={reconnect.maxDelaySecs}
            disabled={!reconnect.enabled}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value >= 1 && value <= 300) {
                updateReconnect({ ...reconnect, maxDelaySecs: value });
              }
            }}
            variant="subtle"
          />
          <Text fontSize="12px" color="fg.muted">
            {t('ssh.seconds')}
          </Text>
        </HStack>
        <Text fontSize="11px" color="fg.muted" mt={1}>
          {t('ssh.autoReconnectMaxHelper')}
        </Text>
      </Box>
      <Box borderTop="1px solid" borderColor="border.subtle" pt={3}>
        <Text fontSize="14px" fontWeight="bold" color="fg" mb={1}>
          {t('ssh.vault.heading')}
        </Text>
        <Text fontSize="11px" color="fg.muted" mb={2}>
          {t('ssh.vault.helper')}
        </Text>
        <Box>
          <Text fontSize="13px" color="fg" mb={1}>
            {t('ssh.vault.autoLock')}
          </Text>
          <select
            aria-label={t('ssh.vault.autoLock')}
            value={autoLockMinutes}
            onChange={(event) => updateAutoLock(event.target.value)}
          >
            {AUTO_LOCK_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0 ? t('ssh.vault.never') : t('ssh.vault.minutes', { minutes })}
              </option>
            ))}
          </select>
        </Box>
        <HStack gap={3} mt={3} align="center">
          <Text fontSize="12px" color={isVaultUnlocked ? 'green.fg' : 'fg.muted'}>
            {isVaultUnlocked ? t('ssh.vault.unlocked') : t('ssh.vault.locked')}
          </Text>
          <Button size="xs" variant="subtle" onClick={() => void lockVault()}>
            {t('ssh.vault.lockNow')}
          </Button>
        </HStack>
      </Box>
      <TrustedHostsSettings />
    </Stack>
  );
};

const formatFirstSeen = (seconds: number): string => {
  if (!seconds) return '—';
  return new Date(seconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};

const TrustedHostsSettings: React.FC = () => {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<KnownHost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void invoke<KnownHost[]>('known_hosts_list')
      .then((entries) => {
        if (!disposed) setHosts(entries);
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
  }, []);

  const exportHosts = async () => {
    const path = await save({
      defaultPath: 'mobaxtauri-known-hosts.json',
      filters: [{ name: t('ssh.trustedHosts.importFilter'), extensions: ['json'] }],
    });
    if (!path) return;
    try {
      const count = await invoke<number>('known_hosts_export', { path });
      setNotice(t('ssh.trustedHosts.exported', { count }));
      setError(null);
    } catch (exportError) {
      setError(String(exportError));
    }
  };

  const importHosts = async () => {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: t('ssh.trustedHosts.importFilter'), extensions: ['json'] }],
    });
    if (!path || Array.isArray(path)) return;
    const confirmed = await ask(t('ssh.trustedHosts.importConfirm'), {
      title: t('ssh.trustedHosts.importTitle'),
      kind: 'warning',
      okLabel: t('ssh.trustedHosts.import'),
      cancelLabel: t('common.cancel'),
    });
    if (!confirmed) return;
    try {
      const count = await invoke<number>('known_hosts_import', { path });
      const entries = await invoke<KnownHost[]>('known_hosts_list');
      setHosts(entries);
      setNotice(t('ssh.trustedHosts.imported', { count }));
      setError(null);
    } catch (importError) {
      setError(String(importError));
    }
  };

  const remove = async (host: KnownHost) => {
    const confirmed = await ask(
      t('ssh.trustedHosts.removeConfirm', { host: host.host, port: host.port }),
      {
        title: t('ssh.trustedHosts.removeTitle'),
        kind: 'warning',
        okLabel: t('ssh.trustedHosts.remove'),
        cancelLabel: t('common.cancel'),
      },
    );
    if (!confirmed) return;
    try {
      await invoke('known_hosts_remove', { host: host.host, port: host.port });
      setHosts((entries) =>
        entries.filter((entry) => !(entry.host === host.host && entry.port === host.port)),
      );
    } catch (removeError) {
      setError(String(removeError));
    }
  };

  return (
    <Box borderTop="1px solid" borderColor="border.subtle" pt={3}>
      <HStack gap={2} mb={1} justify="space-between">
        <HStack gap={2}>
          <Icon as={LuShieldCheck} boxSize="14px" color="green.fg" />
          <Text fontSize="14px" fontWeight="bold" color="fg">
            {t('ssh.trustedHosts.heading')}
          </Text>
        </HStack>
        <HStack gap={1}>
          <Button size="xs" variant="subtle" onClick={() => void exportHosts()}>
            {t('ssh.trustedHosts.export')}
          </Button>
          <Button size="xs" variant="subtle" onClick={() => void importHosts()}>
            {t('ssh.trustedHosts.import')}
          </Button>
        </HStack>
      </HStack>
      <Text fontSize="11px" color="fg.muted" mb={2}>
        {t('ssh.trustedHosts.helper')}
      </Text>
      {notice && (
        <Text fontSize="11px" color="green.fg" mb={2} role="status">
          {notice}
        </Text>
      )}

      {isLoading ? (
        <Text fontSize="11px" color="fg.muted">
          {t('ssh.trustedHosts.loading')}
        </Text>
      ) : error ? (
        <Text fontSize="11px" color="red.fg" role="alert">
          {t('ssh.trustedHosts.loadFailed')}: {error}
        </Text>
      ) : hosts.length === 0 ? (
        <Text fontSize="11px" color="fg.muted">
          {t('ssh.trustedHosts.empty')}
        </Text>
      ) : (
        <VStack align="stretch" gap={1}>
          {hosts.map((host) => (
            <HStack
              key={`${host.host}-${host.port}-${host.keyType}`}
              p={2}
              borderRadius="md"
              bg="bg.muted"
              gap={2}
              align="flex-start"
            >
              <Box flex={1} minW={0}>
                <Text fontSize="12px" fontWeight="500" color="fg">
                  {host.host}:{host.port}
                </Text>
                <Text fontSize="10px" color="fg.muted" fontFamily="monospace" wordBreak="break-all">
                  {host.keyType} · {host.fingerprint}
                </Text>
                <Text fontSize="10px" color="fg.subtle">
                  {t('ssh.trustedHosts.firstSeen')}: {formatFirstSeen(host.firstSeen)}
                </Text>
              </Box>
              <Button
                size="xs"
                variant="ghost"
                colorPalette="red"
                aria-label={t('ssh.trustedHosts.removeHost', { host: host.host })}
                onClick={() => void remove(host)}
              >
                <LuTrash2 />
              </Button>
            </HStack>
          ))}
        </VStack>
      )}
    </Box>
  );
};

// ── About Section ────────────────────────────────────────────
const AboutSettings: React.FC = () => {
  const { t } = useTranslation();
  return (
    <Stack gap={4} align="center" justify="center" flex={1} h="full">
      <Text fontSize="24px" fontWeight="bold" bgGradient="to-r" bgClip="text" color="blue.400">
        MobaXTauri
      </Text>
      <Text fontSize="13px" color="fg.muted">
        v0.11.0
      </Text>
      <Text fontSize="12px" color="fg.muted" textAlign="center" maxW="250px">
        {t('settings.about.description')}
      </Text>
      <Text fontSize="11px" color="fg.muted" mt={4}>
        {t('settings.about.madeWith')}
      </Text>
    </Stack>
  );
};

export default SettingsModal;
