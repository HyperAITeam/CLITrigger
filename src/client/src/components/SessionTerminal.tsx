import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { CMD, CMD_FONT } from './terminal-theme';
import type { WsEvent } from '../hooks/useWebSocket';

interface SessionTerminalProps {
  sessionId: string;
  isRunning: boolean;
  sendMessage: (event: object) => void;
  subscribeBinary: (sessionId: string, cb: (payload: Uint8Array) => void) => () => void;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  height?: number;
}

const TERMINAL_THEME = {
  background: CMD.bg,
  foreground: CMD.text,
  cursor: CMD.bright,
  cursorAccent: CMD.bg,
  selectionBackground: '#264f78',
  black: '#0c0c0c',
  red: '#f14c4c',
  green: '#16c60c',
  yellow: '#cca700',
  blue: '#3b78ff',
  magenta: '#b4009e',
  cyan: '#61d6d6',
  white: '#cccccc',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#16c60c',
  brightYellow: '#f9f1a5',
  brightBlue: '#569cd6',
  brightMagenta: '#b4009e',
  brightCyan: '#9cdcfe',
  brightWhite: '#f2f2f2',
};

export default function SessionTerminal({
  sessionId,
  isRunning,
  sendMessage,
  subscribeBinary,
  onEvent,
  height = 420,
}: SessionTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastResizeRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [replaying, setReplaying] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: CMD_FONT,
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: isRunning,
      convertEol: false,
      scrollback: 5000,
      theme: TERMINAL_THEME,
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    try { fitAddon.fit(); } catch { /* container may be 0×0 momentarily */ }

    const sendResize = () => {
      const cols = term.cols;
      const rows = term.rows;
      if (cols === lastResizeRef.current.cols && rows === lastResizeRef.current.rows) return;
      lastResizeRef.current = { cols, rows };
      sendMessage({ type: 'session:resize', sessionId, cols, rows });
    };
    sendResize();

    // Subscribe to live binary frames first so any bytes arriving during
    // replay aren't dropped — replay frames are also delivered as binary,
    // and `session:replay-end` JSON event flips the spinner off.
    const unsubBinary = subscribeBinary(sessionId, (payload) => {
      try { term.write(payload); } catch { /* term disposed */ }
    });

    const unsubEvent = onEvent((event) => {
      if (event.type === 'session:replay-end' && event.sessionId === sessionId) {
        setReplaying(false);
      }
    });

    sendMessage({ type: 'session:subscribe', sessionId });

    const onDataDisposable = term.onData((d) => {
      sendMessage({ type: 'session:terminal-input', sessionId, input: d });
    });

    const ro = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(sendResize, 150);
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      onDataDisposable.dispose();
      unsubBinary();
      unsubEvent();
      try { sendMessage({ type: 'session:unsubscribe', sessionId }); } catch { /* ignore */ }
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // sessionId is stable per mount; props changing wouldn't preserve replay state anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Reflect running-state cursor blink without re-creating the terminal.
  useEffect(() => {
    if (termRef.current) termRef.current.options.cursorBlink = isRunning;
  }, [isRunning]);

  return (
    <div style={{ position: 'relative', background: CMD.bg, padding: 8 }}>
      {replaying && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 12,
            fontFamily: CMD_FONT,
            fontSize: 11,
            color: CMD.dim,
            zIndex: 1,
            pointerEvents: 'none',
          }}
        >
          loading history…
        </div>
      )}
      <div ref={containerRef} style={{ height, width: '100%' }} />
    </div>
  );
}
