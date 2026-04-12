import React, { useEffect, useRef, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useSessionStore, Session, SessionStatus } from '../store/useSessionStore';
import { Box } from '@chakra-ui/react';
import '@xterm/xterm/css/xterm.css';

// ─────────────────────────────────────────────────────────────
// Single terminal instance — mounts once per open tab, persists
// until the tab is closed (never re-created on tab switch).
// ─────────────────────────────────────────────────────────────

interface TerminalInstanceProps {
  sessionId: string;
  isVisible: boolean;
}

const TerminalInstance: React.FC<TerminalInstanceProps> = ({ sessionId, isVisible }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const unlistenDataRef = useRef<UnlistenFn | null>(null);
  const isDisconnectedRef = useRef(false);
  const isPasswordModeRef = useRef(false);
  const passwordBufRef = useRef('');

  const getSession = useCallback((): Session | undefined => {
    return useSessionStore.getState().sessions.find((s) => s.id === sessionId);
  }, [sessionId]);

  const updateStatus = useCallback(
    (status: SessionStatus, error?: string) => {
      useSessionStore.getState().updateSessionStatus(sessionId, status, error);
    },
    [sessionId]
  );

  // ── Reconnect logic ────────────────────────────────────────
  const doConnect = useCallback(
    async (password?: string) => {
      const session = getSession();
      if (!session || session.type !== 'ssh') return;

      const term = xtermRef.current;
      if (!term) return;

      updateStatus('connecting');
      term.writeln(`\r\n\x1b[38;5;81m● Connecting to ${session.user}@${session.host}:${session.port || 22}...\x1b[0m`);

      try {
        await invoke('ssh_connect', {
          sessionId,
          host: session.host,
          port: session.port || 22,
          user: session.user,
          password: password ?? session.password ?? null,
        });
        updateStatus('connected');
        isDisconnectedRef.current = false;
        term.writeln(`\x1b[32m✔ Connected.\x1b[0m\r\n`);
      } catch (err) {
        const errMsg = String(err);
        updateStatus('error', errMsg);
        term.writeln(`\x1b[31m✘ Connection failed: ${errMsg}\x1b[0m`);
        showReconnectBanner(term);
      }
    },
    [sessionId, getSession, updateStatus]
  );

  // ── Password prompt inside terminal ─────────────────────────
  const promptPassword = useCallback(() => {
    const term = xtermRef.current;
    if (!term) return;
    const session = getSession();
    isPasswordModeRef.current = true;
    passwordBufRef.current = '';
    term.write(`\x1b[33mPassword for ${session?.user || 'user'}@${session?.host || 'host'}: \x1b[0m`);
  }, [getSession]);

  // ── Reconnect / disconnect banner ────────────────────────────
  const showReconnectBanner = useCallback((term: XTerm) => {
    isDisconnectedRef.current = true;
    term.writeln('');
    term.writeln('\x1b[33m──────────────────────────────────────────────────────\x1b[0m');
    term.writeln('\x1b[33m  ⚠  Session disconnected.\x1b[0m');
    term.writeln('\x1b[33m  Press \x1b[1mr\x1b[22m to reconnect  •  \x1b[1mq\x1b[22m to close tab\x1b[0m');
    term.writeln('\x1b[33m──────────────────────────────────────────────────────\x1b[0m');
  }, []);

  // ── Mount: create XTerm, wire up SSH events ──────────────────
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Cascadia Code", Menlo, "Courier New", monospace',
      theme: {
        background: '#0a0a14',
        foreground: '#e2e8f0',
        cursor: '#38bdf8',
        cursorAccent: '#0a0a14',
        selectionBackground: 'rgba(56, 189, 248, 0.3)',
        black: '#1e1e2e',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#94e2d5',
        white: '#cdd6f4',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#cba6f7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8',
      },
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitRef.current = fitAddon;

    const session = getSession();

    // ── Welcome banner ─────────────────────────────────────
    term.writeln(`\x1b[38;5;81m● MobaxTauri\x1b[0m v0.1.0`);
    if (session?.type === 'ssh') {
      term.writeln(
        `  Session: \x1b[32m${session.name}\x1b[0m  → \x1b[36m${session.user}@${session.host}:${session.port || 22}\x1b[0m`
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
          console.log('[TERMINAL] Disconnected event received');
          updateStatus('disconnected');
          showReconnectBanner(term);
          // Clean up backend resources immediately
          invoke('ssh_disconnect', { sessionId }).catch(() => {});
        })
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
          isDisconnectedRef.current = false;
          const sess = getSession();
          if (sess?.password) {
            doConnect();
          } else {
            promptPassword();
          }
          return;
        }
        if (data === 'q' || data === 'Q') {
          useSessionStore.getState().closeTab(sessionId);
          return;
        }
        return; // Ignore other keys in disconnected mode
      }

      // Normal mode: send data to SSH backend
      if (session?.type === 'ssh') {
        invoke('ssh_send_data', { sessionId, data }).catch((err: unknown) => {
          console.error('Failed to send terminal data:', err);
          // Detect disconnect from send errors
          const errStr = String(err);
          if (errStr.includes('Send failed') || errStr.includes('Session not found')) {
            updateStatus('disconnected', errStr);
            showReconnectBanner(term);
          }
        });
      }
    });

    // ── Auto-connect SSH sessions ──────────────────────────
    if (session?.type === 'ssh' && session.status !== 'connected') {
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

    // ── Cleanup on tab close ───────────────────────────────
    return () => {
      window.removeEventListener('resize', handleResize);
      unlistenDataRef.current?.();

      // Disconnect SSH when tab is closed
      const sess = getSession();
      if (sess?.type === 'ssh') {
        invoke('ssh_disconnect', { sessionId }).catch(() => {});
      }

      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ── Fit when becoming visible (tab switch) ────────────────
  useEffect(() => {
    if (isVisible && fitRef.current && xtermRef.current) {
      // Small delay to let the DOM layout settle
      const timer = setTimeout(() => {
        fitRef.current?.fit();
        xtermRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

  return (
    <Box
      h="full"
      w="full"
      bg="#0a0a14"
      overflow="hidden"
      display={isVisible ? 'block' : 'none'}
    >
      <div ref={terminalRef} style={{ height: '100%', width: '100%' }} />
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────
// Multi-terminal container — renders ALL open tabs, hiding
// the inactive ones so they stay alive in the background.
// ─────────────────────────────────────────────────────────────

const TerminalContainer: React.FC = () => {
  const openTabs = useSessionStore((state) => state.openTabs);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);

  return (
    <Box flex={1} position="relative" h="full" w="full" bg="#0a0a14" overflow="hidden">
      {openTabs.map((tabId) => (
        <TerminalInstance
          key={tabId}
          sessionId={tabId}
          isVisible={tabId === activeSessionId}
        />
      ))}
      {openTabs.length === 0 && (
        <Box
          display="flex"
          alignItems="center"
          justifyContent="center"
          h="full"
          w="full"
          color="#4a5568"
        >
          <Box textAlign="center">
            <Box fontSize="48px" mb={4} opacity={0.3}>⌨</Box>
            <Box fontSize="14px" fontWeight="500">No open sessions</Box>
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
