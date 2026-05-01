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
    // can listen on term.onData. Mobile browsers (especially iOS Safari 18)
    // mishandle composition inside xterm — in our overlay textarea, iOS does
    // not fire compositionstart/end at all and instead emits
    // deleteContentBackward + insertText(syllable) pairs to splice partial
    // syllables. setupMobileImeInput hides xterm's helper and runs input
    // through an overlay textarea with a client-side Hangul composer that
    // assembles jamo/syllables into precomposed Hangul before sending to PTY.
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
    <div
      style={{
        position: 'relative',
        background: CMD.bg,
        padding: 8,
        height,
        width: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
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
      <div
        ref={containerRef}
        // Block wheel from bubbling up to ancestors. xterm.js handles its own
        // scroll within the viewport; if the user wheels up while there's
        // nothing in the scrollback, the event would otherwise propagate to
        // a parent and scroll the page or the surrounding window chrome.
        onWheel={(e) => { e.stopPropagation(); }}
        style={{ height: '100%', width: '100%' }}
      />
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

// === Hangul jamo composer (mobile fallback) ===
// iOS Safari 18 does not fire compositionstart/end on our overlay textarea.
// It delivers per-jamo input(insertText) events and, when it can compose,
// uses deleteContentBackward + insertText(precomposed syllable) pairs to
// splice in the assembled syllable. To produce stable PTY echoes regardless
// of whether iOS chooses to splice (e.g. ㅈ → "자" → "잘") we run a
// client-side dubeolsik composer: jamo accumulate into cho/jung/jong, and
// syllables iOS already composed are decomposed back into the same slots so
// a following jamo can extend them (e.g. "자" set as cho=ㅈ jung=ㅏ, then ㄹ
// fills jong → "잘"). The committed text is sent only when a new syllable
// begins, a non-Hangul char arrives, on Enter / special keys, or after a
// brief idle timeout. Single-jamo / double-medial / double-final clusters
// are not yet handled (covers the common case; rare clusters fall back to
// a separate-syllable commit).

const HANGUL_CHO_CODES = [
  0x3131, 0x3132, 0x3134, 0x3137, 0x3138, 0x3139, 0x3141, 0x3142, 0x3143,
  0x3145, 0x3146, 0x3147, 0x3148, 0x3149, 0x314A, 0x314B, 0x314C, 0x314D, 0x314E,
];
const HANGUL_JUNG_CODES = [
  0x314F, 0x3150, 0x3151, 0x3152, 0x3153, 0x3154, 0x3155, 0x3156, 0x3157,
  0x3158, 0x3159, 0x315A, 0x315B, 0x315C, 0x315D, 0x315E, 0x315F, 0x3160,
  0x3161, 0x3162, 0x3163,
];
const HANGUL_JONG_CODES = [
  0, 0x3131, 0x3132, 0x3133, 0x3134, 0x3135, 0x3136, 0x3137, 0x3139, 0x313A,
  0x313B, 0x313C, 0x313D, 0x313E, 0x313F, 0x3140, 0x3141, 0x3142, 0x3144,
  0x3145, 0x3146, 0x3147, 0x3148, 0x314A, 0x314B, 0x314C, 0x314D, 0x314E,
];

function isHangulConsCp(cp: number): boolean { return cp >= 0x3131 && cp <= 0x314E; }
function isHangulVowelCp(cp: number): boolean { return cp >= 0x314F && cp <= 0x3163; }
function isHangulJamoCp(cp: number): boolean { return isHangulConsCp(cp) || isHangulVowelCp(cp); }
function isHangulSyllableCp(cp: number): boolean { return cp >= 0xAC00 && cp <= 0xD7A3; }

interface HangulComposer {
  cho: number;
  jung: number;
  jong: number;
}

function newHangulComposer(): HangulComposer {
  return { cho: -1, jung: -1, jong: 0 };
}

function isComposerEmpty(c: HangulComposer): boolean {
  return c.cho < 0 && c.jung < 0 && c.jong === 0;
}

function composerToString(c: HangulComposer): string {
  if (isComposerEmpty(c)) return '';
  if (c.cho >= 0 && c.jung >= 0) {
    return String.fromCharCode(0xAC00 + (c.cho * 21 + c.jung) * 28 + c.jong);
  }
  if (c.cho >= 0) return String.fromCharCode(HANGUL_CHO_CODES[c.cho]);
  if (c.jung >= 0) return String.fromCharCode(HANGUL_JUNG_CODES[c.jung]);
  return '';
}

function flushComposer(c: HangulComposer): string {
  const s = composerToString(c);
  c.cho = -1; c.jung = -1; c.jong = 0;
  return s;
}

function pushJamo(c: HangulComposer, cp: number): string {
  if (isHangulVowelCp(cp)) {
    const j = HANGUL_JUNG_CODES.indexOf(cp);
    if (j < 0) return '';
    if (c.cho < 0 && c.jung < 0) { c.jung = j; return ''; }
    if (c.cho >= 0 && c.jung < 0) { c.jung = j; return ''; }
    if (c.cho < 0 && c.jung >= 0) {
      const out = composerToString(c);
      c.jung = j;
      return out;
    }
    if (c.jong === 0) {
      const out = composerToString(c);
      c.cho = -1; c.jung = j; c.jong = 0;
      return out;
    }
    // jong을 새 음절의 cho로 옮김
    const jongCp = HANGUL_JONG_CODES[c.jong];
    const newCho = HANGUL_CHO_CODES.indexOf(jongCp);
    c.jong = 0;
    const out = composerToString(c);
    if (newCho >= 0) { c.cho = newCho; c.jung = j; c.jong = 0; }
    else { c.cho = -1; c.jung = j; c.jong = 0; }
    return out;
  }
  if (isHangulConsCp(cp)) {
    const choIdx = HANGUL_CHO_CODES.indexOf(cp);
    const jongIdx = HANGUL_JONG_CODES.indexOf(cp);
    if (c.cho < 0 && c.jung < 0) {
      if (choIdx >= 0) { c.cho = choIdx; return ''; }
      return String.fromCharCode(cp);
    }
    if (c.cho >= 0 && c.jung < 0) {
      const out = String.fromCharCode(HANGUL_CHO_CODES[c.cho]);
      if (choIdx >= 0) { c.cho = choIdx; return out; }
      c.cho = -1;
      return out + String.fromCharCode(cp);
    }
    if (c.cho < 0 && c.jung >= 0) {
      const out = composerToString(c);
      c.jung = -1;
      if (choIdx >= 0) { c.cho = choIdx; return out; }
      return out + String.fromCharCode(cp);
    }
    if (c.jong === 0) {
      if (jongIdx > 0) { c.jong = jongIdx; return ''; }
      const out = composerToString(c);
      c.cho = choIdx >= 0 ? choIdx : -1;
      c.jung = -1; c.jong = 0;
      return out;
    }
    const out = composerToString(c);
    c.cho = choIdx >= 0 ? choIdx : -1;
    c.jung = -1; c.jong = 0;
    if (choIdx < 0) return out + String.fromCharCode(cp);
    return out;
  }
  return '';
}

// Decompose a precomposed Hangul syllable into the composer's slots so a
// following jamo can extend it (e.g. iOS sends "자" then user types ㄹ →
// jong=ㄹ → "잘"). Any prior partial in the composer is committed first.
function pushSyllable(c: HangulComposer, cp: number): string {
  const out = composerToString(c);
  const idx = cp - 0xAC00;
  c.cho = Math.floor(idx / (21 * 28));
  c.jung = Math.floor(idx / 28) % 21;
  c.jong = idx % 28;
  return out;
}

// iOS Safari's auto-composition path emits BS to wipe the previous partial
// syllable before sending the new precomposed one, so a backspace event
// must clear the entire composer (not just the last slot). This also
// matches user-facing backspace UX on native Hangul textareas, where one BS
// removes a whole syllable.
function backspaceComposer(c: HangulComposer): boolean {
  if (isComposerEmpty(c)) return false;
  c.cho = -1; c.jung = -1; c.jong = 0;
  return true;
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

  // Our overlay textarea. Idle: full-size transparent — covers the terminal
  // so taps focus it and bring up the keyboard. Composing: small box at the
  // xterm cursor cell with visible text, so the partial Hangul syllable
  // appears at the cursor position. lang/inputmode are explicit hints; the
  // off-by-default IME-blocking attributes (autocorrect/autocapitalize/
  // spellcheck) are intentionally left unset so they don't disable IME on
  // iOS. caretColor is near-transparent rather than fully transparent —
  // iOS appears to track caret position to decide whether composition can
  // continue.
  const overlay = document.createElement('textarea');
  overlay.setAttribute('autocomplete', 'off');
  overlay.setAttribute('lang', 'ko');
  overlay.setAttribute('inputmode', 'text');
  overlay.rows = 1;
  Object.assign(overlay.style, {
    position: 'absolute',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    padding: '0',
    margin: '0',
    fontFamily: CMD_FONT,
    // 16px to suppress iOS Safari's auto-zoom on focus.
    fontSize: '16px',
    lineHeight: '1.2',
    resize: 'none',
    overflow: 'hidden',
    whiteSpace: 'pre',
    caretColor: 'rgba(255,255,255,0.001)',
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
  const composer = newHangulComposer();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelFlushTimer = () => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  };
  const sendText = (text: string) => {
    if (!text) return;
    sendMessage({ type: 'session:terminal-input', sessionId, input: text });
  };
  const flushComposerAndSend = () => {
    const out = flushComposer(composer);
    if (out) sendText(out);
  };
  const updateOverlayPartial = () => {
    const partial = composerToString(composer);
    overlay.value = partial;
    if (partial) setComposingSize(); else setIdleSize();
  };
  const scheduleFlush = () => {
    cancelFlushTimer();
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushComposerAndSend();
      overlay.value = '';
      setIdleSize();
    }, 600);
  };

  const handleCompStart = () => {
    composing = true;
    cancelFlushTimer();
    // OS-native IME took over (Android etc.) — drain composer so we don't
    // double-emit when compositionend resolves.
    flushComposerAndSend();
    setComposingSize();
  };
  const handleCompEnd = (e: CompositionEvent) => {
    composing = false;
    if (e.data) sendText(e.data);
    overlay.value = '';
    setIdleSize();
  };
  overlay.addEventListener('compositionstart', handleCompStart);
  overlay.addEventListener('compositionend', handleCompEnd);

  const handleInput = (e: Event) => {
    if (composing) return;
    const ie = e as InputEvent;
    switch (ie.inputType) {
      case 'insertCompositionText':
      case 'insertFromComposition':
        return;
      case 'deleteContentBackward':
        cancelFlushTimer();
        if (backspaceComposer(composer)) {
          updateOverlayPartial();
        } else {
          sendText('\x7f');
          overlay.value = '';
          setIdleSize();
        }
        return;
      case 'insertLineBreak':
      case 'insertParagraph':
        cancelFlushTimer();
        flushComposerAndSend();
        sendText('\r');
        overlay.value = '';
        setIdleSize();
        return;
      default:
        if (!ie.data) {
          updateOverlayPartial();
          return;
        }
        cancelFlushTimer();
        let toSend = '';
        for (const ch of ie.data) {
          const cp = ch.codePointAt(0)!;
          if (isHangulJamoCp(cp)) {
            toSend += pushJamo(composer, cp);
          } else if (isHangulSyllableCp(cp)) {
            toSend += pushSyllable(composer, cp);
          } else {
            toSend += flushComposer(composer);
            toSend += ch;
          }
        }
        sendText(toSend);
        updateOverlayPartial();
        if (!isComposerEmpty(composer)) scheduleFlush();
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
      cancelFlushTimer();
      if (e.key === 'Backspace') {
        if (backspaceComposer(composer)) {
          updateOverlayPartial();
          return;
        }
      } else {
        flushComposerAndSend();
      }
      sendText(seq);
      overlay.value = '';
      setIdleSize();
      return;
    }
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      const c = e.key.toUpperCase().charCodeAt(0);
      if (c >= 64 && c <= 95) {
        e.preventDefault();
        cancelFlushTimer();
        flushComposerAndSend();
        sendText(String.fromCharCode(c - 64));
        overlay.value = '';
        setIdleSize();
      }
    }
  };
  overlay.addEventListener('keydown', handleKeyDown);

  return () => {
    cancelFlushTimer();
    flushComposerAndSend();
    overlay.remove();
    if (helperTa) {
      helperTa.style.display = prevHelperDisplay;
      helperTa.tabIndex = prevHelperTabIndex;
    }
  };
}
