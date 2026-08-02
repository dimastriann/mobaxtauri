import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useSessionStore, Session, SessionStatus } from '../store/useSessionStore';
import { useCredentialStore } from '../store/useCredentialStore';
import { Box, HStack, Input, IconButton, Icon } from '@chakra-ui/react';
import { useColorMode } from './ui/color-mode';
import { LuSearch, LuChevronUp, LuChevronDown, LuX } from 'react-icons/lu';
import '@xterm/xterm/css/xterm.css';

// ── XTerm colour themes ────────────────────────────────────────
const XTERM_THEME_LIGHT: XTerm['options']['theme'] = {
  background: '#ffffff',
  foreground: '#1e293b',
  cursor: '#38bdf8',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(56, 189, 248, 0.3)',
  black: '#1e293b',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#f8fafc',
  brightBlack: '#64748b',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#facc15',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#ffffff',
};

const XTERM_THEME_DARK: XTerm['options']['theme'] = {
  background: '#0f172a',
  foreground: '#f1f5f9',
  cursor: '#38bdf8',
  cursorAccent: '#0f172a',
  selectionBackground: 'rgba(56, 189, 248, 0.3)',
  black: '#1e293b',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#f8fafc',
  brightBlack: '#64748b',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#facc15',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#ffffff',
};

interface TerminalInstanceProps {
  sessionId: string;
  isVisible: boolean;
}

const TerminalInstance: React.FC<TerminalInstanceProps> = ({ sessionId, isVisible }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const unlistenDataRef = useRef<UnlistenFn | null>(null);
  const isDisconnectedRef = useRef(false);
  const isPasswordModeRef = useRef(false);
  const passwordBufRef = useRef('');
  const keepaliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { colorMode } = useColorMode();

  const [showSearch, setShowSearch] = useState(false);
  const [searchText, setSearchText] = useState('');

  const getSession = useCallback((): Session | undefined => {
    return useSessionStore.getState().sessions.find((s) => s.id === sessionId);
  }, [sessionId]);

  const updateStatus = useCallback(
    (status: SessionStatus, error?: string) => {
      useSessionStore.getState().updateSessionStatus(sessionId, status, error);
    },
    [sessionId],
  );

  // ── Reconnect logic ────────────────────────────────────────
  const doConnect = useCallback(
    async (password?: string) => {
      const session = getSession();
      if (!session || session.type !== 'ssh') return;

      const term = xtermRef.current;
      if (!term) return;

      updateStatus('connecting');
      term.writeln(
        `\r\n\x1b[38;5;81m● Connecting to ${session.user}@${session.host}:${session.port || 22}...\x1b[0m`,
      );

      try {
        let activePassword = password;
        if (!activePassword) {
          activePassword =
            (await useCredentialStore.getState().getCredential(sessionId)) || undefined;
        }

        await invoke('ssh_connect', {
          sessionId,
          host: session.host,
          port: session.port || 22,
          user: session.user,
          password: activePassword ?? session.password ?? null,
          privateKeyPath: session.privateKeyPath ?? null,
        });
        updateStatus('connected');
        isDisconnectedRef.current = false;
        term.writeln(`\x1b[32m✔ Connected.\x1b[0m\r\n`);

        // Detect OS if not already set
        if (!session.os) {
          try {
            const detectedOs = await invoke<string>('ssh_detect_os', { sessionId });
            useSessionStore.getState().updateSession(sessionId, { os: detectedOs });
          } catch (osErr) {
            console.warn('OS detection failed:', osErr);
          }
        }
      } catch (err) {
        const errMsg = String(err);
        updateStatus('error', errMsg);
        term.writeln(`\x1b[31m✘ Connection failed: ${errMsg}\x1b[0m`);
        showReconnectBanner(term);
      }
    },
    [sessionId, getSession, updateStatus],
  );

  // ── Password prompt inside terminal ─────────────────────────
  const promptPassword = useCallback(() => {
    const term = xtermRef.current;
    if (!term) return;
    const session = getSession();
    isPasswordModeRef.current = true;
    passwordBufRef.current = '';
    term.write(
      `\x1b[33mPassword for ${session?.user || 'user'}@${session?.host || 'host'}: \x1b[0m`,
    );
  }, [getSession]);

  // ── Reconnect / disconnect banner ────────────────────────────
  const showReconnectBanner = useCallback((term: XTerm) => {
    isDisconnectedRef.current = true;
    term.writeln('');
    term.writeln('\x1b[33m──────────────────────────────────────────────────────\x1b[0m');
    term.writeln('\x1b[33m  ⚠  Session disconnected.\x1b[0m');
    term.writeln(
      '\x1b[33m  Press \x1b[1mr\x1b[22m to reconnect  •  \x1b[1mq\x1b[22m to close tab\x1b[0m',
    );
    term.writeln('\x1b[33m──────────────────────────────────────────────────────\x1b[0m');
  }, []);

  // ── Mount: create XTerm, wire up SSH events ──────────────────
  useEffect(() => {
    if (!terminalRef.current) return;

    const isLight = colorMode === 'light';
    const savedFontSize = parseInt(localStorage.getItem('terminal-font-size') || '14', 10);
    const savedFontFamily = localStorage.getItem('terminal-font-family') || '"Cascadia Code", Menlo, "Courier New", monospace';
    const term = new XTerm({
      cursorBlink: true,
      fontSize: savedFontSize,
      fontFamily: savedFontFamily,
      theme: isLight ? XTERM_THEME_LIGHT : XTERM_THEME_DARK,
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;

    term.open(terminalRef.current);

    // Ctrl+F handler
    term.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && e.key === 'f') {
        if (e.type === 'keydown') {
          setShowSearch(true);
        }
        return false;
      }
      if (e.key === 'Escape' && e.type === 'keydown') {
        setShowSearch(false);
        searchAddon.clearDecorations();
        return true;
      }
      return true;
    });
    fitAddon.fit();

    xtermRef.current = term;
    fitRef.current = fitAddon;

    const session = getSession();

    // ── Welcome banner ─────────────────────────────────────
    term.writeln(`\x1b[38;5;81m● MobaxTauri\x1b[0m v0.1.0`);
    if (session?.type === 'ssh') {
      term.writeln(
        `  Session: \x1b[32m${session.name}\x1b[0m  → \x1b[36m${session.user}@${session.host}:${session.port || 22}\x1b[0m`,
      );
    } else {
      term.writeln(`  Session: \x1b[32m${session?.name || 'Local Terminal'}\x1b[0m`);
    }
    term.writeln('');

    // ── SSH data listener (from backend) ───────────────────
    const setupListeners = async () => {
      const [unData, unDisconnect] = await Promise.all([
        listen<string>(`ssh-data-${sessionId}`, (event) => {
          term.write(event.payload);
          useSessionStore.getState().updateLastActivity(sessionId);
        }),
        listen<void>(`ssh-disconnected-${sessionId}`, () => {
          updateStatus('disconnected');
          showReconnectBanner(term);
          // Clean up backend resources immediately
          invoke('ssh_disconnect', { sessionId }).catch(() => {});
        }),
      ]);
      unlistenDataRef.current = () => {
        unData();
        unDisconnect();
      };
    };

    if (session?.type === 'ssh') {
      setupListeners();
    }

    // ── Terminal input handler ──────────────────────────────
    term.onData((data) => {
      // Password mode: capture locally, don't send to backend
      if (isPasswordModeRef.current) {
        if (data === '\r' || data === '\n') {
          // Submit password
          term.writeln('');
          isPasswordModeRef.current = false;
          const pwd = passwordBufRef.current;
          passwordBufRef.current = '';
          doConnect(pwd);
        } else if (data === '\x7f' || data === '\b') {
          // Backspace
          if (passwordBufRef.current.length > 0) {
            passwordBufRef.current = passwordBufRef.current.slice(0, -1);
            term.write('\b \b');
          }
        } else if (data === '\x03') {
          // Ctrl+C: cancel
          term.writeln('\r\n\x1b[90mCancelled.\x1b[0m');
          isPasswordModeRef.current = false;
          passwordBufRef.current = '';
          showReconnectBanner(term);
        } else {
          passwordBufRef.current += data;
          term.write('*');
        }
        return;
      }

      // Disconnected mode: hotkey handling
      if (isDisconnectedRef.current) {
        if (data === 'r' || data === 'R') {
          // Always prompt for password on reconnect — the saved one might be stale/wrong
          isDisconnectedRef.current = false;
          promptPassword();
          return;
        }
        if (data === 'q' || data === 'Q') {
          useSessionStore.getState().closeTab(sessionId);
          return;
        }
        return; // Ignore other keys in disconnected mode
      }

      // Normal mode: send data to SSH backend
      const currentSession = getSession();
      if (currentSession?.type === 'ssh') {
        invoke('ssh_send_data', { sessionId, data }).catch((err: unknown) => {
          console.error('Failed to send terminal data:', err);
          const errStr = String(err);
          if (errStr.includes('Send failed') || errStr.includes('Session not found')) {
            updateStatus('disconnected', errStr);
            showReconnectBanner(term);
          }
        });
      }
    });

    // ── Auto-connect SSH sessions ──────────────────────────
    if (session?.type === 'ssh') {
      // Always reconnect: closeTab marks sessions as disconnected,
      // and even if the backend session was dropped, this ensures
      // we establish a fresh connection.
      if (session.password) {
        doConnect();
      } else {
        promptPassword();
      }
    }

    // ── Resize handler ─────────────────────────────────────
    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleResize);

    // ── Notify backend of terminal resize ──────────────────
    term.onResize(({ cols, rows }) => {
      if (session?.type === 'ssh') {
        invoke('ssh_resize', { sessionId, cols, rows }).catch(() => {});
      }
    });

    // ── Snippet execution listener (Tauri native event) ────
    const unlistenSnippet = listen<string>(`snippet-execute-${sessionId}`, (event) => {
      const data = event.payload;
      const currentSession = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
      if (currentSession?.type === 'ssh') {
        invoke('ssh_send_data', { sessionId, data }).catch((err) => {
          console.error('[TERMINAL] Snippet send failed:', err);
        });
      } else {
        term.write(data);
      }
    });

    // ── Keepalive: detect stale connections ────────────────
    const startKeepalive = () => {
      keepaliveRef.current = setInterval(() => {
        invoke('ssh_send_data', { sessionId, data: '' }).catch((err) => {
          // Connection is dead — only mark as disconnected if we're still 'connected'
          const sess = getSession();
          if (sess?.status === 'connected') {
            updateStatus('disconnected', String(err));
            showReconnectBanner(term);
          }
          if (keepaliveRef.current) {
            clearInterval(keepaliveRef.current);
            keepaliveRef.current = null;
          }
        });
      }, 15000); // Check every 15 seconds
    };

    if (session?.type === 'ssh') {
      startKeepalive();
    }

    // ── Cleanup on tab close ───────────────────────────────
    return () => {
      window.removeEventListener('resize', handleResize);
      unlistenSnippet.then((fn) => fn());
      unlistenDataRef.current?.();

      if (keepaliveRef.current) {
        clearInterval(keepaliveRef.current);
        keepaliveRef.current = null;
      }

      // Disconnect SSH when tab is closed
      const sess = getSession();
      if (sess?.type === 'ssh') {
        invoke('ssh_disconnect', { sessionId }).catch(() => {});
      }

      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── Fit when becoming visible (tab switch or view switch) ──
  useEffect(() => {
    if (isVisible && fitRef.current && xtermRef.current) {
      // Use longer delay and retry to handle layout transitions
      // (e.g. parent container switching from display:none to display:flex)
      let cancelled = false;
      const doFit = (attempt: number) => {
        if (cancelled) return;
        fitRef.current?.fit();
        xtermRef.current?.focus();
        // Retry up to 3 times in case layout isn't settled
        if (attempt < 3) {
          setTimeout(() => doFit(attempt + 1), 100 * (attempt + 1));
        }
      };
      const timer = setTimeout(() => doFit(1), 100);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }
  }, [isVisible]);

  // Update xterm theme when colorMode changes
  useEffect(() => {
    if (!xtermRef.current) return;
    const isLight = colorMode === 'light';
    xtermRef.current.options.theme = isLight ? XTERM_THEME_LIGHT : XTERM_THEME_DARK;
  }, [colorMode]);

  return (
    <Box
      h="full"
      w="full"
      bg="bg.panel"
      overflow="hidden"
      visibility={isVisible ? 'visible' : 'hidden'}
      position={isVisible ? 'relative' : 'absolute'}
      top={0}
      left={0}
      right={0}
      bottom={0}
    >
      {showSearch && (
        <Box
          position="absolute"
          top={2}
          right={4}
          zIndex={10}
          bg="bg.panel"
          border="1px solid"
          borderColor="border.subtle"
          borderRadius="md"
          boxShadow="lg"
          p={2}
        >
          <HStack gap={2}>
            <Icon as={LuSearch} color="fg.subtle" boxSize="14px" />
            <Input
              autoFocus
              size="xs"
              w="150px"
              placeholder="Find..."
              value={searchText}
              onChange={(e) => {
                const text = e.target.value;
                setSearchText(text);
                if (searchAddonRef.current && text) {
                  searchAddonRef.current.findNext(text, { incremental: true });
                } else if (!text && searchAddonRef.current) {
                  searchAddonRef.current.clearDecorations();
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  searchAddonRef.current?.findNext(searchText);
                } else if (e.key === 'Escape') {
                  setShowSearch(false);
                  searchAddonRef.current?.clearDecorations();
                }
              }}
            />
            <IconButton
              aria-label="Previous"
              size="xs"
              variant="ghost"
              onClick={() => searchAddonRef.current?.findPrevious(searchText)}
            >
              <LuChevronUp />
            </IconButton>
            <IconButton
              aria-label="Next"
              size="xs"
              variant="ghost"
              onClick={() => searchAddonRef.current?.findNext(searchText)}
            >
              <LuChevronDown />
            </IconButton>
            <IconButton
              aria-label="Close"
              size="xs"
              variant="ghost"
              onClick={() => {
                setShowSearch(false);
                searchAddonRef.current?.clearDecorations();
              }}
            >
              <LuX />
            </IconButton>
          </HStack>
        </Box>
      )}
      <div ref={terminalRef} style={{ height: '100%', width: '100%' }} />
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────
// Multi-terminal container — renders ALL open tabs, hiding
// the inactive ones so they stay alive in the background.
// ─────────────────────────────────────────────────────────────

const TerminalContainer: React.FC<{ isViewVisible?: boolean }> = ({
  isViewVisible = true,
}) => {
  const openTabs = useSessionStore((state) => state.openTabs);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);

  return (
    <Box flex={1} position="relative" h="full" w="full" bg="bg.panel" overflow="hidden">
      {openTabs.map((tabId) => (
        <TerminalInstance
          key={tabId}
          sessionId={tabId}
          isVisible={tabId === activeSessionId && isViewVisible}
        />
      ))}
      {openTabs.length === 0 && (
        <Box
          display="flex"
          alignItems="center"
          justifyContent="center"
          h="full"
          w="full"
          color="fg.subtle"
          bg="bg.panel"
        >
          <Box textAlign="center">
            <Box fontSize="48px" mb={4} opacity={0.3}>
              ⌨
            </Box>
            <Box fontSize="14px" fontWeight="500">
              No open sessions
            </Box>
            <Box fontSize="12px" mt={1} opacity={0.6}>
              Click + or double-click the tab bar to create a new session
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default TerminalContainer;