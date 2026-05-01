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

    // Input handling diverges by platform. Desktop browsers compose IME inside
    // xterm's helper textarea and fire onData with the composed result, so we
    // can listen on term.onData. iOS Safari (and to a lesser extent Android)
    // both mishandle composition inside xterm — onData fires per-jamo and
    // xterm's CompositionHelper renders decomposed jamo while typing. On
    // mobile we hide xterm's helper textarea entirely and run input through
    // our own overlay textarea, where the OS's native IME composes correctly.
    const inputCleanup = isMobileImeDevice()
      ? setupMobileImeInput({ container, term, sessionId, sendMessage })
      : setupDesktopInput({ container, term, sessionId, sendMessage });

    const ro = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(sendResize, 150);
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      inputCleanup();
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

function isMobileImeDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iosLike = /iPad|iPhone|iPod/.test(ua) || (/Mac/.test(ua) && navigator.maxTouchPoints > 1);
  return iosLike || /Android/i.test(ua);
}

interface InputSetupArgs {
  container: HTMLDivElement;
  term: Terminal;
  sessionId: string;
  sendMessage: (event: object) => void;
}

function setupDesktopInput({ container, term, sessionId, sendMessage }: InputSetupArgs): () => void {
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
  return () => {
    onDataDisposable.dispose();
    container.removeEventListener('compositionstart', handleCompStart, true);
    container.removeEventListener('compositionend', handleCompEnd, true);
  };
}

function setupMobileImeInput({ container, term, sessionId, sendMessage }: InputSetupArgs): () => void {
  // Hide xterm's helper textarea so it can't intercept input and so its
  // CompositionHelper can't draw the decomposed-jamo overlay.
  const helperTa = container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null;
  let prevHelperDisplay = '';
  let prevHelperTabIndex = 0;
  if (helperTa) {
    prevHelperDisplay = helperTa.style.display;
    prevHelperTabIndex = helperTa.tabIndex;
    helperTa.style.display = 'none';
    helperTa.tabIndex = -1;
  }

  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  // Our overlay textarea. Idle state: full-size, transparent — covers the
  // terminal so taps focus it and bring up the keyboard. Composing state:
  // small box positioned at xterm's cursor cell with visible text, so the
  // OS-native IME's underlined composition appears at the cursor location.
  // Once compositionend fires we send the composed text to the PTY and the
  // PTY echo lands on the proper grid cell via term.write.
  const overlay = document.createElement('textarea');
  overlay.setAttribute('autocapitalize', 'off');
  overlay.setAttribute('autocorrect', 'off');
  overlay.setAttribute('autocomplete', 'off');
  overlay.setAttribute('spellcheck', 'false');
  overlay.rows = 1;
  Object.assign(overlay.style, {
    position: 'absolute',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    padding: '0',
    margin: '0',
    // CMD_FONT(영문 monospace)만이면 iOS Safari가 IME 조합 중 한글을
    // 자모 단위로 fallback해 분리되어 보임. 한글 시스템 폰트를 stack 뒤에
    // 붙여 영문은 기존 monospace, 한글은 시스템 한글 폰트로 그려지게 함.
    fontFamily: `${CMD_FONT}, 'Apple SD Gothic Neo', 'Noto Sans CJK KR', 'Noto Sans KR', sans-serif`,
    // 16px to suppress iOS Safari's auto-zoom on focus.
    fontSize: '16px',
    lineHeight: '1.2',
    resize: 'none',
    overflow: 'hidden',
    whiteSpace: 'pre',
    caretColor: 'transparent',
    zIndex: '5',
  });

  const setIdleSize = () => {
    Object.assign(overlay.style, {
      inset: '0',
      left: 'auto',
      top: 'auto',
      width: '100%',
      height: '100%',
      color: 'transparent',
    });
  };

  const setComposingSize = () => {
    const screen = container.querySelector('.xterm-screen') as HTMLElement | null;
    if (!screen) return;
    const cols = term.cols;
    const rows = term.rows;
    if (cols <= 0 || rows <= 0) return;
    const cellW = screen.clientWidth / cols;
    const cellH = screen.clientHeight / rows;
    const cursorX = term.buffer.active.cursorX;
    const cursorY = term.buffer.active.cursorY;
    const screenRect = screen.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    Object.assign(overlay.style, {
      inset: 'auto',
      left: `${(screenRect.left - containerRect.left) + cursorX * cellW}px`,
      top: `${(screenRect.top - containerRect.top) + cursorY * cellH}px`,
      width: `${Math.max(cellW * 30, 240)}px`,
      height: `${Math.max(cellH, 20)}px`,
      color: CMD.text,
    });
  };

  setIdleSize();
  container.appendChild(overlay);

  let composing = false;
  let lastCompositionEndAt = 0;

  // iOS 한글 키보드에서 IME composition이 trigger되지 않은 채 호환 자모
  // (U+3130-U+318F) 또는 conjoining jamo가 input 이벤트로 누출될 수 있음.
  // 단독 jamo는 사용자가 음절 조합을 의도한 것이므로 PTY로 보내지 않는다
  // (compositionend 경로에서만 음절로 합쳐 전달).
  const HANGUL_JAMO_RE = /^[ᄀ-ᇿ㄰-㆏ꥠ-꥿ힰ-퟿]+$/;

  const handleCompStart = () => {
    composing = true;
    setComposingSize();
  };
  const handleCompEnd = (e: CompositionEvent) => {
    composing = false;
    lastCompositionEndAt = Date.now();
    if (e.data) {
      // iOS는 간혹 NFD conjoining jamo로 e.data를 줘서 PTY echo가 분리되어
      // 보이게 됨. NFC로 정규화해 음절(precomposed Hangul)로 보냄.
      sendMessage({ type: 'session:terminal-input', sessionId, input: e.data.normalize('NFC') });
    }
    overlay.value = '';
    setIdleSize();
  };
  overlay.addEventListener('compositionstart', handleCompStart);
  overlay.addEventListener('compositionend', handleCompEnd);

  const handleInput = (e: Event) => {
    if (composing) return;
    // compositionend 직후 잔여 input 이벤트(보통 inputType=undefined)가
    // 자모를 다시 흘리는 경우가 있어 짧은 윈도우 동안 입력을 무시.
    if (Date.now() - lastCompositionEndAt < 50) {
      overlay.value = '';
      return;
    }
    const ie = e as InputEvent;
    switch (ie.inputType) {
      case 'insertCompositionText':
      case 'insertFromComposition':
        return;
      case 'deleteContentBackward':
        sendMessage({ type: 'session:terminal-input', sessionId, input: '\x7f' });
        overlay.value = '';
        return;
      case 'insertLineBreak':
      case 'insertParagraph':
        sendMessage({ type: 'session:terminal-input', sessionId, input: '\r' });
        overlay.value = '';
        return;
      default:
        if (ie.data) {
          // 단독 한글 자모는 IME composition이 누락된 것으로 간주하고 무시.
          // 사용자가 의도적으로 자모만 치는 경우(예: ㅋㅋ)는 어차피
          // compositionend 경로에서 NFC로 정규화되어 전달됨.
          if (HANGUL_JAMO_RE.test(ie.data)) {
            overlay.value = '';
            return;
          }
          sendMessage({ type: 'session:terminal-input', sessionId, input: ie.data.normalize('NFC') });
        }
        overlay.value = '';
    }
  };
  overlay.addEventListener('input', handleInput);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (composing || e.isComposing) return;
    let seq: string | null = null;
    switch (e.key) {
      case 'Enter': seq = '\r'; break;
      case 'Backspace': seq = '\x7f'; break;
      case 'Tab': seq = '\t'; break;
      case 'Escape': seq = '\x1b'; break;
      case 'ArrowUp': seq = '\x1b[A'; break;
      case 'ArrowDown': seq = '\x1b[B'; break;
      case 'ArrowRight': seq = '\x1b[C'; break;
      case 'ArrowLeft': seq = '\x1b[D'; break;
      case 'Home': seq = '\x1b[H'; break;
      case 'End': seq = '\x1b[F'; break;
    }
    if (seq) {
      e.preventDefault();
      sendMessage({ type: 'session:terminal-input', sessionId, input: seq });
      overlay.value = '';
      return;
    }
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      const c = e.key.toUpperCase().charCodeAt(0);
      if (c >= 64 && c <= 95) {
        e.preventDefault();
        sendMessage({ type: 'session:terminal-input', sessionId, input: String.fromCharCode(c - 64) });
        overlay.value = '';
      }
    }
  };
  overlay.addEventListener('keydown', handleKeyDown);

  return () => {
    overlay.remove();
    if (helperTa) {
      helperTa.style.display = prevHelperDisplay;
      helperTa.tabIndex = prevHelperTabIndex;
    }
  };
}
