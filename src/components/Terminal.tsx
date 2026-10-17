import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useSessionStore, Session, SessionStatus } from '../store/useSessionStore';
import {
  getSshConnectionTimeoutSeconds,
  SSH_HOST_KEY_EVENT,
  SSH_SESSION_STATE_EVENT,
  type SshConnectRequest,
  type SshHostKeyEvent,
  type SshSessionStateEvent,
} from '../types/ssh';
import HostKeyModal from './HostKeyModal';
import { Box, HStack, Input, IconButton, Icon, Text } from '@chakra-ui/react';
import { useColorMode } from './ui/color-mode';
import { toaster } from './ui/toaster';
import { LuSearch, LuChevronUp, LuChevronDown, LuX, LuCircle, LuSquare } from 'react-icons/lu';
import '@xterm/xterm/css/xterm.css';
import {
  appendPendingOutput,
  takeWriteSlice,
  TERM_WRITE_BUDGET_CHARS,
} from '../utils/terminalOutput';

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
  isFocused: boolean;
  onActivate: () => void;
}

const TerminalInstance: React.FC<TerminalInstanceProps> = ({
  sessionId,
  isVisible,
  isFocused,
  onActivate,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const unlistenDataRef = useRef<UnlistenFn | null>(null);
  const isDisconnectedRef = useRef(false);
  const lastActivityUpdateRef = useRef(0);
  const isPasswordModeRef = useRef(false);
  const passwordBufRef = useRef('');
  // Passphrase mode reuses the masked-intake machinery but submits into
  // the private-key passphrase prompt for the next connect attempt.
  const isPassphraseModeRef = useRef(false);
  const passphraseBufRef = useRef('');
  const passphraseRetryRef = useRef(0);
  const bellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFocusedRef = useRef(isFocused);
  const wasOfflineRef = useRef(!navigator.onLine);
  const networkReconnectRef = useRef(false);
  const connectionAttemptRef = useRef(false);
  const recordingRef = useRef(false);
  const recordingStartLineRef = useRef(0);
  const { colorMode } = useColorMode();

  const [showSearch, setShowSearch] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [hostKeyPrompt, setHostKeyPrompt] = useState<SshHostKeyEvent | null>(null);
  const [showBellFlash, setShowBellFlash] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const RECORDING_PILL_KEY = 'mobaxtauri-recording-pill-pos';
  const [pillPos, setPillPos] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = localStorage.getItem(RECORDING_PILL_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { x: number; y: number };
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed;
      }
    } catch {
      // malformed storage → fall back to default corner
    }
    return { x: 16, y: 8 };
  });
  const dragStateRef = useRef<{ startX: number; startY: number; pillX: number; pillY: number } | null>(
    null,
  );
  const wasDragRef = useRef(false);
  const pillPosRef = useRef(pillPos);

  useEffect(() => {
    pillPosRef.current = pillPos;
  }, [pillPos]);

  useEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);

  const getSession = useCallback((): Session | undefined => {
    return useSessionStore.getState().sessions.find((s) => s.id === sessionId);
  }, [sessionId]);

  const toggleRecording = async () => {
    if (!recordingRef.current) {
      const buffer = xtermRef.current?.buffer.active;
      recordingStartLineRef.current = buffer ? buffer.baseY + buffer.cursorY : 0;
      recordingRef.current = true;
      setIsRecording(true);
      toaster.create({
        title: 'Recording started',
        description: 'Capturing terminal output from this point.',
        type: 'info',
      });
      return;
    }
    recordingRef.current = false;
    setIsRecording(false);
    const session = getSession();
    try {
      const path = await save({
        defaultPath: `${(session?.name ?? 'terminal').replace(/[^a-z0-9_-]+/gi, '-')}-recording.svg`,
        filters: [{ name: 'SVG terminal recording', extensions: ['svg'] }],
      });
      if (!path) return;
      const buffer = xtermRef.current?.buffer.active;
      const recordedLines: string[] = [];
      if (buffer) {
        for (let index = recordingStartLineRef.current; index < buffer.length; index += 1) {
          recordedLines.push(buffer.getLine(index)?.translateToString(true) ?? '');
        }
      }
      await invoke('export_terminal_recording', {
        path,
        title: `${session?.name ?? 'Terminal'} · ${new Date().toLocaleString()}`,
        lines: recordedLines,
      });
      toaster.create({
        title: 'Recording saved',
        description: path.split(/[\\/]/).pop() ?? path,
        type: 'success',
      });
    } catch (error) {
      toaster.create({ title: 'Export failed', description: String(error), type: 'error' });
    }
  };

  const handlePillPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.currentTarget.parentElement) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      pillX: pillPos.x,
      pillY: pillPos.y,
    };
    wasDragRef.current = false;
  };

  const handlePillPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    const offsetX = event.clientX - drag.startX;
    const offsetY = event.clientY - drag.startY;
    if (!wasDragRef.current && Math.abs(offsetX) + Math.abs(offsetY) <= 3) return;
    wasDragRef.current = true;
    const parent = event.currentTarget.parentElement as HTMLElement;
    const bounds = parent.getBoundingClientRect();
    const pill = event.currentTarget.getBoundingClientRect();
    const nextX = Math.min(Math.max(drag.pillX + offsetX, 0), bounds.width - pill.width);
    const nextY = Math.min(Math.max(drag.pillY + offsetY, 0), bounds.height - pill.height);
    setPillPos({ x: Math.round(nextX), y: Math.round(nextY) });
  };

  const handlePillPointerUp = () => {
    if (dragStateRef.current && wasDragRef.current) {
      try {
        localStorage.setItem(RECORDING_PILL_KEY, JSON.stringify(pillPosRef.current));
      } catch {
        // persistence failure must not break the pill
      }
    }
    dragStateRef.current = null;
  };

  const updateStatus = useCallback(
    (status: SessionStatus, error?: string) => {
      useSessionStore.getState().updateSessionStatus(sessionId, status, error);
    },
    [sessionId],
  );

  // ── Private-key passphrase prompt inside terminal ────────────
  // Reuses the masked-intake machinery of the password prompt: keystrokes
  // stay in refs, backend only ever receives the final attempt payload.
  const promptPassphrase = useCallback((hint: string | null) => {
    const term = xtermRef.current;
    if (!term) return;
    isPassphraseModeRef.current = true;
    passphraseBufRef.current = '';
    if (hint) {
      term.write(`\x1b[33m${hint}\x1b[0m\r\n`);
    }
    term.write('\x1b[33mPrivate key passphrase: \x1b[0m');
  }, []);

  // ── Password prompt inside terminal ─────────────────────────
  const promptPassword = useCallback(() => {
    const term = xtermRef.current;
    const diagnostics = window as unknown as Record<string, unknown>;
    const diagConsole = (diagnostics.__MOBAXTERM_CONSOLE ??= []) as string[];
    diagConsole.push(`${new Date().toISOString()} promptPassword: term=${!!term}`);
    if (diagConsole.length > 200) diagConsole.splice(0, diagConsole.length - 200);
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
    if (isDisconnectedRef.current) return;
    isDisconnectedRef.current = true;
    term.writeln('');
    term.writeln('\x1b[33m──────────────────────────────────────────────────────\x1b[0m');
    term.writeln('\x1b[33m  ⚠  Session disconnected.\x1b[0m');
    term.writeln(
      '\x1b[33m  Press \x1b[1mr\x1b[22m to reconnect  •  \x1b[1mq\x1b[22m to close tab\x1b[0m',
    );
    term.writeln('\x1b[33m──────────────────────────────────────────────────────\x1b[0m');
  }, []);

  // ── Reconnect logic ────────────────────────────────────────────────────────
  const doConnect = useCallback(
    async (password?: string, keyPassphrase?: string) => {
      if (connectionAttemptRef.current) return;
      const session = getSession();
      if (!session || session.type !== 'ssh') return;
      const { host, user } = session;
      if (!host || !user) return;

      const term = xtermRef.current;
      if (!term) return;

      connectionAttemptRef.current = true;

      try {
        updateStatus('connecting');
        term.writeln(
          `\r\n\x1b[38;5;81m● Connecting to ${user}@${host}:${session.port || 22}...\x1b[0m`,
        );

        await invoke('ssh_connect', {
          request: {
            sessionId,
            host,
            port: session.port || 22,
            user,
            password: password ?? session.password ?? null,
            privateKeyPath: session.privateKeyPath ?? null,
            keyPassphrase: keyPassphrase ?? null,
            useSavedCredential: Boolean(session.savePassword && !password && !session.password),
            connectionTimeoutSecs: getSshConnectionTimeoutSeconds(),
          } satisfies SshConnectRequest,
        });
        updateStatus('connected');
        useSessionStore.getState().recordConnection(sessionId, 'connected');
        isDisconnectedRef.current = false;
        passphraseRetryRef.current = 0;
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
        useSessionStore.getState().recordConnection(sessionId, 'failed', errMsg);
        term.writeln(`\x1b[31m✘ Connection failed: ${errMsg}\x1b[0m`);
        if (errMsg.includes('Saved credential is unavailable')) {
          promptPassword();
          return;
        }
        if (errMsg.includes('Password authentication was rejected')) {
          // Wrong credential is the movable part here: let the user retype
          // instead of forcing a reconnect cycle.
          promptPassword();
          return;
        }
        if (errMsg.includes('KEY PASSPHRASE REQUIRED')) {
          promptPassphrase(null);
          return;
        }
        if (errMsg.includes('passphrase is incorrect')) {
          if (++passphraseRetryRef.current >= 3) {
            term.writeln(
              `\x1b[33mPassphrase attempted ${passphraseRetryRef.current} times. Review the key file outside this app if it still fails.\x1b[0m`,
            );
            passphraseRetryRef.current = 0;
            showReconnectBanner(term);
            return;
          }
          promptPassphrase('The key passphrase was rejected. Try again or Ctrl+C to cancel.');
          return;
        }
        showReconnectBanner(term);
      } finally {
        connectionAttemptRef.current = false;
      }
    },
    [
      sessionId,
      getSession,
      updateStatus,
      promptPassword,
      promptPassphrase,
      showReconnectBanner,
    ],
  );

  // Store the presented key and retry the connection (Trust and connect).
  const acceptHostKey = useCallback(
    async (prompt: SshHostKeyEvent) => {
      setHostKeyPrompt(null);
      try {
        await invoke('ssh_trust_host_key', {
          host: prompt.host,
          port: prompt.port,
          keyType: prompt.keyType,
          fingerprint: prompt.fingerprint,
        });
        void doConnect();
      } catch (err) {
        console.error('Failed to store host key:', err);
      }
    },
    [doConnect],
  );

  // Reconnect open SSH terminals when the operating system reports that the
  // network is available again. This reuses the normal credential and key path.
  useEffect(() => {
    const handleOffline = () => {
      const session = getSession();
      if (session?.type !== 'ssh') return;
      wasOfflineRef.current = true;
      networkReconnectRef.current = false;
      isDisconnectedRef.current = true;
      updateStatus('disconnected', 'Network unavailable');
      xtermRef.current?.writeln('\r\n\x1b[33m● Network unavailable. Waiting to reconnect…\x1b[0m');
      invoke('ssh_disconnect', { sessionId }).catch(() => {});
    };

    const handleOnline = async () => {
      const session = getSession();
      if (session?.type !== 'ssh' || !wasOfflineRef.current || networkReconnectRef.current) return;
      wasOfflineRef.current = false;
      networkReconnectRef.current = true;
      xtermRef.current?.writeln('\r\n\x1b[38;5;81m● Network restored. Reconnecting…\x1b[0m');
      try {
        await doConnect();
      } finally {
        networkReconnectRef.current = false;
      }
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [doConnect, getSession, sessionId, updateStatus]);

  // ── Mount: create XTerm, wire up SSH events ──────────────────
  useEffect(() => {
    if (!terminalRef.current) return;

    const isLight = colorMode === 'light';
    const savedFontSize = parseInt(localStorage.getItem('terminal-font-size') || '14', 10);
    const savedFontFamily =
      localStorage.getItem('terminal-font-family') ||
      '"Cascadia Code", Menlo, "Courier New", monospace';
    const savedScrollback = Math.min(
      Math.max(parseInt(localStorage.getItem('terminal-scrollback') || '10000', 10), 1000),
      200000,
    );
    const term = new XTerm({
      cursorBlink: true,
      fontSize: savedFontSize,
      fontFamily: savedFontFamily,
      theme: isLight ? XTERM_THEME_LIGHT : XTERM_THEME_DARK,
      allowProposedApi: true,
      scrollback: savedScrollback,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;

    term.open(terminalRef.current);

    // GPU-accelerated rendering; fall back to the DOM renderer when a
    // WebGL context cannot be created (e.g. missing GPU or blocked driver).
    // Contexts are also lost at runtime under sustained heavy output on
    // some Windows/WebView2 GPU stacks; an unrecovered loss presents as a
    // terminal that stops repainting entirely, so dispose on loss and let
    // xterm drop back to its DOM renderer.
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        try {
          webglAddon.dispose();
        } catch {
          // already disposed / detached
        }
      });
      term.loadAddon(webglAddon);
    } catch {
      // keep default renderer
    }

    // Unicode 11 width rules keep wide chars/emoji and the cursor aligned
    // in TUIs such as vim and htop.
    const unicode11Addon = new Unicode11Addon();
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = '11';

    term.onBell(() => {
      if (bellTimerRef.current) clearTimeout(bellTimerRef.current);
      setShowBellFlash(true);
      bellTimerRef.current = setTimeout(() => setShowBellFlash(false), 700);
      if (!isFocusedRef.current) {
        useSessionStore.getState().updateSessionBell(sessionId, true);
      }
    });

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

    // Diagnostic hook for external tooling (WebDriver stress runs): the
    // buffer stays queryable regardless of the active renderer. Not part
    // of the app API; harmless when unused.
    const diagnostics = window as unknown as Record<string, unknown>;
    const registry = (diagnostics.__MOBAXTERM_TERMS ??= {}) as Record<string, XTerm>;
    registry[sessionId] = term;
    diagnostics.__MOBAXTERM_STORE = useSessionStore;
    // Mirror terminal-lifecycle console failures into an in-memory ring so
    // WebDriver tooling can inspect them; bounded and silent.
    const diagConsole = (diagnostics.__MOBAXTERM_CONSOLE ??= []) as string[];
    const mirror = (label: string, detail: string = '') => {
      diagConsole.push(`${new Date().toISOString()} ${label}: ${detail}`);
      if (diagConsole.length > 200) diagConsole.splice(0, diagConsole.length - 200);
    };
    mirror('mount');

    const session = getSession();
    let disposed = false;
    let pendingOutput: string[] = [];
    let pendingOutputChars = 0;
    let outputWriteInProgress = false;
    let outputFrame: number | null = null;
    let inputChain: Promise<void> = Promise.resolve();

    const flushOutput = () => {
      outputFrame = null;
      if (disposed || outputWriteInProgress || pendingOutput.length === 0) return;

      // Hand xterm at most one frame's worth per write: a single multi-MB
      // term.write parses synchronously and freezes the tab, which is
      // exactly what cat/tail/less bursts escalated into.
      const sliced = takeWriteSlice(pendingOutput, TERM_WRITE_BUDGET_CHARS);
      pendingOutput = sliced.remaining;
      pendingOutputChars = sliced.remainingChars;
      outputWriteInProgress = true;
      term.write(sliced.text, () => {
        outputWriteInProgress = false;
        if (!disposed && pendingOutput.length > 0 && outputFrame === null) {
          outputFrame = requestAnimationFrame(flushOutput);
        }
      });
    };

    const queueOutput = (data: string) => {
      // Render-pace the backlog: an unbounded array under a sustained
      // multi-MB burst grew until GC froze the tab. Bounding it replaces
      // old queued bytes with a drop notice — the same trade scrollback
      // already makes.
      const bounded = appendPendingOutput(pendingOutput, pendingOutputChars, data);
      pendingOutput = bounded.items;
      pendingOutputChars = bounded.totalChars;
      if (!outputWriteInProgress && outputFrame === null) {
        outputFrame = requestAnimationFrame(flushOutput);
      }
    };

    const sendSshData = (data: string, source = 'terminal') => {
      inputChain = inputChain
        .then(async () => {
          if (disposed) return;
          await invoke('ssh_send_data', { sessionId, data });
        })
        .catch((err: unknown) => {
          if (disposed) return;
          console.error(`Failed to send ${source} data:`, err);
          const errStr = String(err);
          if (
            errStr.includes('Send failed') ||
            errStr.includes('Send timed out') ||
            errStr.includes('Session not found')
          ) {
            updateStatus('disconnected', errStr);
            showReconnectBanner(term);
          }
        });
    };

    // ── Welcome banner ─────────────────────────────────────
    term.writeln(`\x1b[38;5;81m● MobaxTauri\x1b[0m v0.4.2`);
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
      const [unData, unState, unHostKey] = await Promise.all([
        listen<string>(`ssh-data-${sessionId}`, (event) => {
          queueOutput(event.payload);
          const now = Date.now();
          if (now - lastActivityUpdateRef.current >= 1000) {
            lastActivityUpdateRef.current = now;
            useSessionStore.getState().updateLastActivity(sessionId);
          }
        }),
        listen<SshSessionStateEvent>(SSH_SESSION_STATE_EVENT, (event) => {
          if (event.payload.sessionId !== sessionId || event.payload.status !== 'disconnected') {
            return;
          }
          updateStatus('disconnected');
          useSessionStore.getState().recordConnection(sessionId, 'disconnected');
          if (event.payload.reason === 'requested') return;
          showReconnectBanner(term);
          invoke('ssh_disconnect', { sessionId }).catch(() => {});
        }),
        listen<SshHostKeyEvent>(SSH_HOST_KEY_EVENT, (event) => {
          if (event.payload.sessionId !== sessionId) return;
          setHostKeyPrompt(event.payload);
        }),
      ]);
      unlistenDataRef.current = () => {
        unData();
        unState();
        unHostKey();
      };
      if (disposed) unlistenDataRef.current();
    };

    if (session?.type === 'ssh') {
      void setupListeners()
        .then(() => {
          if (disposed) {
            mirror('listeners ready but disposed', session?.type);
            return;
          }
          mirror('listeners ready, branching', session.savePassword ? 'saved-c' : 'prompt');
          if (session.password || session.savePassword) {
            void doConnect();
          } else {
            promptPassword();
          }
        })
        .catch((error: unknown) => {
          if (!disposed) {
            mirror(
              'listener setup failed',
              typeof error === 'string' ? error : JSON.stringify(error),
            );
            console.error('Failed to attach SSH terminal listeners:', error);
          }
        });
    }

    // ── Terminal input handler ──────────────────────────────
    const handleTerminalData = (data: string) => {
      // Passphrase mode: masked intake like password mode, submitted to
      // the private-key passphrase retry path.
      if (isPassphraseModeRef.current) {
        if (data === '\r' || data === '\n') {
          term.writeln('');
          isPassphraseModeRef.current = false;
          const passphrase = passphraseBufRef.current;
          passphraseBufRef.current = '';
          doConnect(undefined, passphrase);
        } else if (data === '\x7f' || data === '\b') {
          if (passphraseBufRef.current.length > 0) {
            passphraseBufRef.current = passphraseBufRef.current.slice(0, -1);
            term.write('\b \b');
          }
        } else if (data === '\x03') {
          // Ctrl+C: cancel prompting, return to the reconnect state
          term.writeln('\r\n\x1b[90mCancelled.\x1b[0m');
          isPassphraseModeRef.current = false;
          passphraseBufRef.current = '';
          showReconnectBanner(term);
        } else {
          passphraseBufRef.current += data;
          term.write('*');
        }
        return;
      }

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

      const currentSession = getSession();

      // Handle stale/disconnected sessions even if the backend event arrived
      // before this terminal finished attaching its listener.
      if (isDisconnectedRef.current || currentSession?.status !== 'connected') {
        if (data === '\x03' && currentSession?.status === 'connecting') {
          invoke('ssh_disconnect', { sessionId }).catch(() => {});
          updateStatus('disconnected', 'Connection cancelled');
          isDisconnectedRef.current = true;
          return;
        }
        if (data === 'r' || data === 'R') {
          isDisconnectedRef.current = false;
          if (currentSession?.password || currentSession?.savePassword) {
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
      if (currentSession?.type === 'ssh') {
        sendSshData(data);
      }
    };
    term.onData(handleTerminalData);

    // Diagnostic hook: external tooling feeds text through the exact same
    // onData path as real keystrokes (password prompts included).
    const sendHook = (diagnostics.__MOBAXTERM_SEND ??= {}) as Record<
      string,
      (text: string) => void
    >;
    sendHook[sessionId] = handleTerminalData;

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
        sendSshData(data, 'snippet');
      } else {
        term.write(data);
      }
    });

    // ── Cleanup on tab close ───────────────────────────────
    return () => {
      disposed = true;
      if (outputFrame !== null) cancelAnimationFrame(outputFrame);
      pendingOutput = [];
      pendingOutputChars = 0;
      delete (window as unknown as Record<string, Record<string, unknown>>).__MOBAXTERM_SEND?.[
        sessionId
      ];
      window.removeEventListener('resize', handleResize);
      unlistenSnippet.then((fn) => fn());
      unlistenDataRef.current?.();

      if (bellTimerRef.current) {
        clearTimeout(bellTimerRef.current);
        bellTimerRef.current = null;
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
        if (isFocused) xtermRef.current?.focus();
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
  }, [isVisible, isFocused]);

  // Splitting a flex container changes pane width without firing a window
  // resize event. Observe the real host size so xterm and the PTY stay aligned.
  useEffect(() => {
    const host = terminalRef.current;
    if (!host || !isVisible) return;

    let frame: number | null = null;
    const fitToHost = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        if (host.clientWidth > 0 && host.clientHeight > 0) fitRef.current?.fit();
      });
    };
    const observer = new ResizeObserver(fitToHost);
    observer.observe(host);
    fitToHost();

    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
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
      onPointerDownCapture={() => {
        if (!isFocused) onActivate();
        requestAnimationFrame(() => xtermRef.current?.focus());
      }}
    >
      <Box
        position="absolute"
        inset={0}
        zIndex={5}
        pointerEvents="none"
        border="2px solid"
        borderColor="orange.400"
        boxShadow="inset 0 0 28px rgba(251, 146, 60, 0.22)"
        opacity={showBellFlash ? 1 : 0}
        transition="opacity 180ms ease"
      />
      <Box
        css={{
          position: 'absolute',
          top: `${pillPos.y}px`,
          left: `${pillPos.x}px`,
          zIndex: 30,
          cursor: 'grab',
          userSelect: 'none',
        }}
        bg="bg.panel"
        border="1px solid"
        borderColor="border.subtle"
        borderRadius="full"
        px={1.5}
        py={1}
        boxShadow="sm"
        onPointerDown={handlePillPointerDown}
        onPointerMove={handlePillPointerMove}
        onPointerUp={handlePillPointerUp}
        onPointerCancel={handlePillPointerUp}
      >
        <HStack gap={1}>
          <IconButton
            aria-label={isRecording ? 'Stop and export recording' : 'Start terminal recording'}
            title={
              isRecording
                ? 'Stop and export recording'
                : 'Start terminal recording (drag the pill to move it)'
            }
            size="2xs"
            variant="subtle"
            colorPalette={isRecording ? 'red' : 'gray'}
            onClick={() => {
              if (wasDragRef.current) {
                wasDragRef.current = false;
                return;
              }
              void toggleRecording();
            }}
          >
            {isRecording ? <LuSquare /> : <LuCircle />}
          </IconButton>
          {isRecording && (
            <Text fontSize="10px" color="red.fg" fontWeight="bold" pr={1}>
              REC
            </Text>
          )}
        </HStack>
      </Box>
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
      <HostKeyModal
        prompt={hostKeyPrompt}
        onAccept={acceptHostKey}
        onReject={() => setHostKeyPrompt(null)}
      />
      <div ref={terminalRef} style={{ height: '100%', width: '100%' }} />
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────
// Multi-terminal container — renders ALL open tabs, hiding
// the inactive ones so they stay alive in the background.
// ─────────────────────────────────────────────────────────────

interface TerminalContainerProps {
  isViewVisible?: boolean;
  secondarySessionId?: string | null;
  onActivateSession: (sessionId: string) => void;
}

const TerminalContainer: React.FC<TerminalContainerProps> = ({
  isViewVisible = true,
  secondarySessionId = null,
  onActivateSession,
}) => {
  const openTabs = useSessionStore((state) => state.openTabs);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const visibleIds = [activeSessionId, secondarySessionId].filter(
    (id, index, ids): id is string =>
      Boolean(id) && openTabs.includes(id as string) && ids.indexOf(id) === index,
  );
  const isSplit = visibleIds.length === 2;

  return (
    <Box
      flex={1}
      display="flex"
      position="relative"
      h="full"
      w="full"
      bg="bg.panel"
      overflow="hidden"
    >
      {openTabs.map((tabId) => (
        <Box
          key={tabId}
          flex="1 1 0"
          minW={0}
          h="full"
          position={visibleIds.includes(tabId) ? 'relative' : 'absolute'}
          inset={visibleIds.includes(tabId) ? undefined : 0}
          visibility={visibleIds.includes(tabId) && isViewVisible ? 'visible' : 'hidden'}
          borderLeft={isSplit && tabId === secondarySessionId ? '1px solid' : undefined}
          borderColor="border.subtle"
        >
          <TerminalInstance
            sessionId={tabId}
            isVisible={visibleIds.includes(tabId) && isViewVisible}
            isFocused={tabId === activeSessionId && isViewVisible}
            onActivate={() => onActivateSession(tabId)}
          />
        </Box>
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
