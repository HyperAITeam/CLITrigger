import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { CMD, CMD_FONT } from './terminal-theme';
import type { WsEvent } from '../hooks/useWebSocket';

interface SessionTerminalProps {
  sessionId: string;
  isRunning: boolean;
  /**
   * Gate for `session:subscribe`. SessionWindow flips this to true only
   * after the PTY has been spawned at the fitted size (POST /start
   * resolved). Prevents binary frames from arriving for a PTY that's
   * still at the wrong size.
   */
  subscribed: boolean;
  /**
   * Fires once after FitAddon settles with the actual cols/rows. The
   * window uses this to POST /start with the right dimensions.
   */
  onFitted?: (cols: number, rows: number) => void;
  sendMessage: (event: object) => void;
  subscribeBinary: (sessionId: string, cb: (payload: Uint8Array) => void) => () => void;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  height?: number | string;
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
  subscribed,
  onFitted,
  sendMessage,
  subscribeBinary,
  onEvent,
  height = '100%',
}: SessionTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastResizeRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscribedSentRef = useRef(false);
  const onFittedRef = useRef(onFitted);
  onFittedRef.current = onFitted;
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
    if (term.cols > 0 && term.rows > 0) {
      onFittedRef.current?.(term.cols, term.rows);
    }

    const sendResize = () => {
      const cols = term.cols;
      const rows = term.rows;
      if (cols === lastResizeRef.current.cols && rows === lastResizeRef.current.rows) return;
      lastResizeRef.current = { cols, rows };
      // Server gates session:resize behind process_pid && running, so
      // a resize fired before subscribe is a safe no-op.
      sendMessage({ type: 'session:resize', sessionId, cols, rows });
    };

    // Binary frames may start arriving as soon as session:subscribe lands;
    // attach the subscriber up front so nothing is dropped during replay.
    const unsubBinary = subscribeBinary(sessionId, (payload) => {
      try { term.write(payload); } catch { /* term disposed */ }
    });

    const unsubEvent = onEvent((event) => {
      if (event.type === 'session:replay-end' && event.sessionId === sessionId) {
        setReplaying(false);
      }
    });

    // IME composition handling for mobile (iOS) Korean/CJK input.
    // Without this, xterm's onData fires per-jamo on iOS Safari so typing
    // "사과" arrives at the PTY as "ㅅㅏㄱㅗㅏ". We suppress onData during
    // composition and send the composed text from compositionend.data, then
    // shadow-suppress onData briefly because xterm's CompositionHelper also
    // emits the composed text asynchronously (setTimeout 0) and would
    // otherwise double-send.
    let composing = false;
    let lastCompositionEndAt = 0;
    const handleCompStart = () => { composing = true; };
    const handleCompEnd = (e: Event) => {
      composing = false;
      lastCompositionEndAt = Date.now();
      const data = (e as CompositionEvent).data;
      if (data) {
        sendMessage({ type: 'session:terminal-input', sessionId, input: data });
      }
    };
    container.addEventListener('compositionstart', handleCompStart, true);
    container.addEventListener('compositionend', handleCompEnd, true);

    const onDataDisposable = term.onData((d) => {
      if (composing) return;
      if (Date.now() - lastCompositionEndAt < 50) return;
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
      container.removeEventListener('compositionstart', handleCompStart, true);
      container.removeEventListener('compositionend', handleCompEnd, true);
      unsubBinary();
      unsubEvent();
      try { sendMessage({ type: 'session:unsubscribe', sessionId }); } catch { /* ignore */ }
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      subscribedSentRef.current = false;
    };
    // sessionId is stable per mount; props changing wouldn't preserve replay state anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Send session:subscribe once `subscribed` flips to true (i.e. after the
  // PTY has been spawned at the correct size). Also resend the current size
  // so the freshly-spawned PTY learns about any container changes that
  // happened between mount and subscribe.
  useEffect(() => {
    if (!subscribed || subscribedSentRef.current) return;
    subscribedSentRef.current = true;
    const term = termRef.current;
    if (term && term.cols > 0 && term.rows > 0) {
      lastResizeRef.current = { cols: 0, rows: 0 };
      sendMessage({ type: 'session:resize', sessionId, cols: term.cols, rows: term.rows });
    }
    sendMessage({ type: 'session:subscribe', sessionId });
  }, [subscribed, sessionId, sendMessage]);

  // Reflect running-state cursor blink without re-creating the terminal.
  useEffect(() => {
    if (termRef.current) termRef.current.options.cursorBlink = isRunning;
  }, [isRunning]);

  return (
    <div style={{ position: 'relative', background: CMD.bg, padding: 8, height, width: '100%' }}>
      {replaying && subscribed && (
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
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}
