import { useEffect, useRef, useState } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { CMD, CMD_FONT, DEFAULT_FONT_SIZE } from './terminal-theme';
import { bumpSessionFontSize } from '../hooks/useSessionFontSize';
import { pasteImage, getClipboardImagePath } from '../api/sessions';
import { TERMINAL_PRESETS } from '../lib/terminal-presets';
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
  /** Per-session terminal font size in px. Defaults to DEFAULT_FONT_SIZE. */
  fontSize?: number;
  /**
   * Per-session xterm.js color theme. Defaults to the cmd-style preset.
   * Can be swapped at runtime — the effect below mirrors the change to
   * the live Terminal instance without re-creating it.
   */
  theme?: ITheme;
  /**
   * When true, swallow keystrokes / paste / clipboard events instead of
   * forwarding them to the PTY. Used while a server-held initial prompt
   * is awaiting Send/Skip — keeps the user's typing from leaking into the
   * CLI before the held prompt is dispatched. Resize / subscribe still
   * pass through.
   */
  inputBlocked?: boolean;
}

const TERMINAL_THEME: ITheme = TERMINAL_PRESETS.default.theme;

export default function SessionTerminal({
  sessionId,
  isRunning,
  subscribed,
  onFitted,
  sendMessage,
  subscribeBinary,
  onEvent,
  height = '100%',
  fontSize = DEFAULT_FONT_SIZE,
  theme,
  inputBlocked = false,
}: SessionTerminalProps) {
  // Latest theme prop is consumed once on mount (xterm Terminal init takes
  // theme by value) and then reapplied via term.options.theme in a separate
  // effect below. Keep a ref so the mount effect uses the most recent value
  // without re-mounting on every theme change.
  const themeRef = useRef<ITheme | undefined>(theme);
  themeRef.current = theme;
  const inputBlockedRef = useRef(inputBlocked);
  inputBlockedRef.current = inputBlocked;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastResizeRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Separate timer for fontSize-driven resizes so ResizeObserver's 150ms
  // debounce can't overwrite (and shorten) the fontSize debounce window.
  const fontSizeResizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscribedSentRef = useRef(false);
  const onFittedRef = useRef(onFitted);
  onFittedRef.current = onFitted;
  // Exposed so the fontSize-change effect can re-fit and broadcast the new
  // cols/rows to the PTY without duplicating the debounce logic from RO.
  const sendResizeRef = useRef<(() => void) | null>(null);
  const [replaying, setReplaying] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Wrap sendMessage so any `session:terminal-input` is silently dropped
    // while the server is holding an initial prompt awaiting Send/Skip.
    // Resize / subscribe / unsubscribe still flow through unchanged so the
    // PTY learns about geometry changes and can be subscribed to.
    const guardedSend = (event: object) => {
      const type = (event as { type?: string }).type;
      if (inputBlockedRef.current && type === 'session:terminal-input') return;
      sendMessage(event);
    };

    const term = new Terminal({
      fontFamily: CMD_FONT,
      fontSize,
      lineHeight: 1.2,
      cursorBlink: isRunning,
      convertEol: false,
      scrollback: 5000,
      theme: themeRef.current ?? TERMINAL_THEME,
      allowProposedApi: true,
      macOptionIsMeta: true,
    });
    // xterm.js core deliberately omits clipboard integration so the host can
    // decide. Without this branch:
    //   - Ctrl/Cmd+C with selection just sends SIGINT (^C) and never copies.
    //   - Ctrl/Cmd+V sends ^V (literal-next) instead of pasting.
    //   - Ctrl/Cmd+X sends ^X.
    //   - On macOS the helper textarea has no text, so the browser's default
    //     Cmd+C/V/X also no-ops.
    // We branch on selection presence (Ctrl+C falls through to SIGINT when
    // nothing is selected, matching iTerm2/Windows Terminal). Alt+V is
    // additionally mapped to paste at the user's request.
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const pasteFromClipboard = async () => {
      if (inputBlockedRef.current) return;
      try {
        // Check OS clipboard for a copied image file path first
        try {
          const clip = await getClipboardImagePath(sessionId);
          if (clip.path) {
            guardedSend({ type: 'session:terminal-input', sessionId, input: clip.path });
            return;
          }
        } catch { /* fall through to browser clipboard */ }

        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find(t => t.startsWith('image/'));
          if (imageType) {
            const blob = await item.getType(imageType);
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = reader.result as string;
              // Server pushes the image into the host OS clipboard; we then
              // trigger the CLI's native Alt+V handler so it reads the bytes
              // itself. ESC+v is the terminal sequence for Alt+V.
              pasteImage(sessionId, dataUrl).then(() => {
                guardedSend({ type: 'session:terminal-input', sessionId, input: '\x1bv' });
              }).catch(() => {});
            };
            reader.readAsDataURL(blob);
            return;
          }
        }
        const text = await navigator.clipboard.readText();
        if (text) guardedSend({ type: 'session:terminal-input', sessionId, input: text });
      } catch {
        // non-secure context — paste-event fallback handles it
      }
    };
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true;

      const mod = isMac ? ev.metaKey : ev.ctrlKey;
      const otherMod = isMac ? ev.ctrlKey : ev.metaKey;
      const onlyMod = mod && !otherMod && !ev.altKey && !ev.shiftKey;
      const key = ev.key.toLowerCase();

      if (onlyMod && key === 'c') {
        if (term.hasSelection()) {
          ev.preventDefault();
          navigator.clipboard.writeText(term.getSelection()).catch(() => {});
          return false;
        }
        return true; // no selection → let SIGINT through
      }
      if (onlyMod && key === 'v') {
        ev.preventDefault();
        pasteFromClipboard();
        return false;
      }
      if (onlyMod && key === 'x') {
        if (term.hasSelection()) {
          ev.preventDefault();
          navigator.clipboard.writeText(term.getSelection()).catch(() => {});
          term.clearSelection();
          return false;
        }
        return true;
      }
      // Alt+V → paste (Linux terminal convention some users prefer).
      // Resolves before macOptionIsMeta's ESC+v conversion.
      if (ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && key === 'v') {
        ev.preventDefault();
        pasteFromClipboard();
        return false;
      }

      // Ctrl/Cmd + '=' / '+' / '-' adjust the per-session font size.
      if ((ev.ctrlKey || ev.metaKey) && !ev.altKey) {
        if (ev.key === '+' || ev.key === '=') {
          ev.preventDefault();
          bumpSessionFontSize(sessionId, +1);
          return false;
        }
        if (ev.key === '-' || ev.key === '_') {
          ev.preventDefault();
          bumpSessionFontSize(sessionId, -1);
          return false;
        }
      }
      return true;
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Ctrl/Cmd + wheel → font zoom. React onWheel is passive by default so we
    // attach natively with passive:false to be able to preventDefault and stop
    // the browser from triggering page zoom. Non-zoom wheel events still get
    // their bubble stopped (page scroll guard) and pass through to xterm's own
    // scrollback handler.
    const onContainerWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        if (e.deltaY === 0) return;
        bumpSessionFontSize(sessionId, e.deltaY < 0 ? +1 : -1);
        return;
      }
      e.stopPropagation();
    };
    container.addEventListener('wheel', onContainerWheel, { passive: false });

    try { fitAddon.fit(); } catch { /* container may be 0×0 momentarily */ }
    if (term.cols > 0 && term.rows > 0) {
      onFittedRef.current?.(term.cols, term.rows);
    }

    // Auto-focus the helper textarea so keystrokes (and IME composition)
    // land in xterm immediately on mount. Without this, focus stays on
    // whatever was focused before (form Submit button, or body) and the
    // user's first keystrokes — including a Hangul jamo that would have
    // started a composition — go nowhere. Only steal from body so we
    // don't yank focus away from someone editing another input.
    if (document.activeElement === document.body || document.activeElement === null) {
      try { term.focus(); } catch { /* ignore */ }
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
    sendResizeRef.current = sendResize;

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
      ? setupMobileImeInput({ container, term, sessionId, sendMessage: guardedSend })
      : setupDesktopInput({ container, term, sessionId, sendMessage: guardedSend });

    // Defer the fit to the next animation frame so the ResizeObserver
    // callback doesn't synchronously mutate layout (which can trigger a
    // RO loop and leave xterm's DOM-rendered rows at stale Y positions).
    // After a successful fit we force `term.refresh()` — without it, the
    // viewport scrollbar that appears when scrollback exceeds the new
    // visible area paints stale rows when dragged.
    let fitPending = false;
    const lastFitRef = { cols: term.cols, rows: term.rows };
    const ro = new ResizeObserver(() => {
      if (fitPending) return;
      fitPending = true;
      requestAnimationFrame(() => {
        fitPending = false;
        const rect = container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        try {
          fitAddon.fit();
          if (term.cols !== lastFitRef.cols || term.rows !== lastFitRef.rows) {
            lastFitRef.cols = term.cols;
            lastFitRef.rows = term.rows;
            term.refresh(0, term.rows - 1);
          }
        } catch { /* ignore */ }
        if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = setTimeout(sendResize, 150);
      });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      if (fontSizeResizeTimerRef.current) clearTimeout(fontSizeResizeTimerRef.current);
      container.removeEventListener('wheel', onContainerWheel);
      inputCleanup();
      unsubBinary();
      unsubEvent();
      try { sendMessage({ type: 'session:unsubscribe', sessionId }); } catch { /* ignore */ }
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      sendResizeRef.current = null;
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

  // Apply font-size changes without re-creating the terminal: update xterm
  // option, re-fit (cols/rows shrink/grow at the same container size), then
  // broadcast the new dimensions to the PTY through a long debounce.
  //
  // The PTY resize is debounced 300ms (vs. ResizeObserver's 150ms) because
  // each SIGWINCH causes Claude/Codex/Gemini to re-emit their welcome banner
  // into the main screen buffer, stacking duplicates in xterm's scrollback.
  // Coalescing rapid Ctrl+=/Ctrl+- presses into a single resize keeps the
  // duplication count bounded. The fontSize timer uses a dedicated ref so
  // ResizeObserver callbacks can't shorten the window.
  useEffect(() => {
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) return;
    if (term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    try {
      fitAddon.fit();
      term.refresh(0, term.rows - 1);
    } catch { /* container may be hidden */ }
    // Skip the resize broadcast entirely if the cell grid didn't actually
    // change — avoids a needless SIGWINCH (and CLI redraw) for sub-pixel
    // font tweaks that fit the same cols/rows.
    if (term.cols === lastResizeRef.current.cols && term.rows === lastResizeRef.current.rows) return;
    if (fontSizeResizeTimerRef.current) clearTimeout(fontSizeResizeTimerRef.current);
    fontSizeResizeTimerRef.current = setTimeout(() => {
      sendResizeRef.current?.();
    }, 300);
  }, [fontSize]);

  // Apply theme changes without re-creating the terminal. xterm.js repaints
  // on options.theme assignment; refresh() is needed because already-rendered
  // rows otherwise keep their old colors until the next write.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = theme ?? TERMINAL_THEME;
    try { term.refresh(0, term.rows - 1); } catch { /* term disposed */ }
  }, [theme]);

  const wrapperBg = theme?.background ?? CMD.bg;
  return (
    <div
      style={{
        position: 'relative',
        background: wrapperBg,
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
  // After compositionend with data, xterm.js's helper textarea fires onData
  // with the same composed string. Drop exactly that one onData by
  // string-equality, then resume — a time-window guard would also drop a
  // space/`?` typed within the window (the original symptom).
  let pendingDedup: string | null = null;

  // xterm.js's CompositionHelper only repositions the helper textarea on
  // compositionupdate (not compositionstart), so on the very first Hangul
  // jamo the OS IME candidate window reads the textarea's default
  // `left: -9999em` (xterm.css) and shows the panel far from the cursor —
  // typically clipped to the viewport's bottom-right. Pre-position the
  // textarea at the cursor on mount and again in the compositionstart
  // capture phase so the OS sees correct coords before drawing the panel.
  // Cell width/height are derived from .xterm-screen's bounding rect to
  // avoid touching xterm's private renderService.
  const positionHelperAtCursor = () => {
    try {
      const helper = container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null;
      const screen = container.querySelector('.xterm-screen') as HTMLElement | null;
      if (!helper || !screen) return;
      const cols = term.cols;
      const rows = term.rows;
      if (cols <= 0 || rows <= 0) return;
      const screenRect = screen.getBoundingClientRect();
      if (screenRect.width === 0 || screenRect.height === 0) return;
      const cellW = screenRect.width / cols;
      const cellH = screenRect.height / rows;
      const buf = term.buffer.active;
      const cursorX = Math.min(buf.cursorX, cols - 1);
      const cursorY = Math.max(0, Math.min(buf.cursorY, rows - 1));
      helper.style.left = `${cursorX * cellW}px`;
      helper.style.top = `${cursorY * cellH}px`;
      helper.style.width = `${Math.max(cellW, 1)}px`;
      helper.style.height = `${Math.max(cellH, 1)}px`;
    } catch { /* defensive: xterm DOM may not be fully built yet */ }
  };
  positionHelperAtCursor();

  const handleCompStart = () => {
    composing = true;
    positionHelperAtCursor();
  };
  const handleCompEnd = (e: Event) => {
    composing = false;
    const data = (e as CompositionEvent).data;
    if (data) {
      pendingDedup = data;
      sendMessage({ type: 'session:terminal-input', sessionId, input: data });
    }
  };
  // Browser paste event fires inside a user gesture even on http:// origins
  // where navigator.clipboard.readText() is blocked, so this catches LAN-IP
  // access via cloudflared-disabled scenarios.
  const handlePaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          e.preventDefault();
          const file = items[i].getAsFile();
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            pasteImage(sessionId, dataUrl, file.name).then(() => {
              sendMessage({ type: 'session:terminal-input', sessionId, input: '\x1bv' });
            }).catch(() => {});
          };
          reader.readAsDataURL(file);
          return;
        }
      }
    }
    const text = e.clipboardData?.getData('text/plain');
    if (text) {
      e.preventDefault();
      sendMessage({ type: 'session:terminal-input', sessionId, input: text });
    }
  };
  container.addEventListener('compositionstart', handleCompStart, true);
  container.addEventListener('compositionend', handleCompEnd, true);
  container.addEventListener('paste', handlePaste, true);
  const onDataDisposable = term.onData((d) => {
    if (composing) return;
    if (pendingDedup !== null && d === pendingDedup) {
      pendingDedup = null;
      return;
    }
    pendingDedup = null;
    sendMessage({ type: 'session:terminal-input', sessionId, input: d });
  });
  return () => {
    onDataDisposable.dispose();
    container.removeEventListener('compositionstart', handleCompStart, true);
    container.removeEventListener('compositionend', handleCompEnd, true);
    container.removeEventListener('paste', handlePaste, true);
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
