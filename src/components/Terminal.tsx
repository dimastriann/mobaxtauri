import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useSessionStore } from '../store/useSessionStore';
import { Box } from '@chakra-ui/react';
import '@xterm/xterm/css/xterm.css';

const Terminal: React.FC = () => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const session = useSessionStore((state) => state.sessions.find(s => s.id === activeSessionId));

  useEffect(() => {
    if (!terminalRef.current) return;

    // Initialize XTerm
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Cascadia Code", Menlo, monospace',
      theme: {
        background: '#000000',
        foreground: '#e2e8f0',
        cursor: '#38bdf8',
        selectionBackground: 'rgba(56, 189, 248, 0.3)',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    term.writeln(`\x1b[38;5;81mMobaxTauri\x1b[0m v0.1.0 starting...`);
    term.writeln(`Connected to \x1b[32m${session?.name || 'Session'}\x1b[0m`);
    term.write('\r\n');

    // Subscribe to backend data
    const unlisten = listen(`ssh-data-${activeSessionId}`, (event) => {
      term.write(event.payload as string);
    });

    term.onData(async (data) => {
      // Send to backend
      try {
        if (activeSessionId !== 'local') {
          await invoke('ssh_send_data', { sessionId: activeSessionId, data });
        }
      } catch (err) {
        console.error('Failed to send terminal data:', err);
      }
    });

    xtermRef.current = term;

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      unlisten.then(u => u());
      term.dispose();
    };
  }, [activeSessionId]);

  return (
    <Box h="full" w="full" bg="black" overflow="hidden">
      <div 
        ref={terminalRef} 
        style={{ height: '100%', width: '100%' }}
      />
    </Box>
  );
};

export default Terminal;
