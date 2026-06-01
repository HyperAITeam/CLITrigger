import { useEffect, useRef, useState } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from '@xterm/addon-canvas';
import '@xterm/xterm/css/xterm.css';
import { CMD, CMD_FONT, DEFAULT_FONT_SIZE } from './terminal-theme';
import { bumpSessionFontSize } from '../hooks/useSessionFontSize';
import { pasteImage, getClipboardImagePath } from '../api/sessions';
import { TERMINAL_PRESETS } from '../lib/terminal-presets';
import { useToast } from '../hooks/useToast';
import ToastContainer from './Toast';
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
  /**
   * Gate for the mount-time `term.focus()` call. Even with the body-only
   * guard, a hidden pane (display:none StackView tab, restored-but-hidden
   * floating window) shouldn't steal focus from a form input the user is
   * actively typing in. Parents set this to true only when the pane is
   * visibly mounted (StackView's active tab in a non-minimized group).
   */
  autoFocusOnMount?: boolean;
  /**
   * When true, skip the image-paste branch (clipboard.read() image MIME +
   * `paste-image` upload + server-side ESC+v). Text paste still works via
   * the normal readText / clipboardData fallback. Set by raw-shell sessions
   * — there's no CLI subprocess waiting for `[Image #N]` to interpret.
   */
  disableImagePaste?: boolean;
  /**
   * Cycle to the next ('next') or previous ('prev') tab in the stack the
   * pane belongs to. Invoked by Ctrl+Tab / Ctrl+Shift+Tab while the
   * terminal has focus. Undefined → shortcut falls through to the PTY.
   */
  onCycleTab?: (dir: 'next' | 'prev') => void;
}

const TERMINAL_THEME: ITheme = TERMINAL_PRESETS.default.theme;

// Wrap multi-line paste content in DEC bracketed paste sequences so modern
// CLI TUIs (Claude / Gemini / Codex Ink) treat embedded LFs as paste content
// rather than individual Enter keys, which otherwise causes multi-line paste
// to look truncated or scrambled. We only wrap when '\n' is present —
// single-line paste was working as raw input and we don't want to send
// escape sequences for the common case.
function wrapBracketedPaste(text: string): string {
  if (!text.includes('\n')) return text;
  return `\x1b[200~${text}\x1b[201~`;
}

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
  autoFocusOnMount = false,
  disableImagePaste = false,
  onCycleTab,
}: SessionTerminalProps) {
  // Latest theme prop is consumed once on mount (xterm Terminal init takes
  // theme by value) and then reapplied via term.options.theme in a separate
  // effect below. Keep a ref so the mount effect uses the most recent value
  // without re-mounting on every theme change.
  const themeRef = useRef<ITheme | undefined>(theme);
  themeRef.current = theme;
  const inputBlockedRef = useRef(inputBlocked);
  inputBlockedRef.current = inputBlocked;
  const disableImagePasteRef = useRef(disableImagePaste);
  disableImagePasteRef.current = disableImagePaste;
  // Stash the cycle callback in a ref so the mount-only key handler always
  // sees the latest closure (StackView produces a new one whenever activeTab
  // changes, but the handler is registered once per session mount).
  const onCycleTabRef = useRef(onCycleTab);
  onCycleTabRef.current = onCycleTab;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const canvasAddonRef = useRef<CanvasAddon | null>(null);
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
  // Mirror of the in-progress IME composition string. xterm.js doesn't paint
  // composing text into its grid, so on desktop the user previously had to
  // rely on the OS IME candidate panel — which jumps around or disappears
  // when the TUI redraws. We mirror compositionupdate into this state and
  // render it as a fixed overlay in the bottom-left of the session window.
  const [composingText, setComposingText] = useState('');
  const setComposingTextRef = useRef(setComposingText);
  setComposingTextRef.current = setComposingText;

  // useToast must be called from the component body, but pasteFromClipboard
  // lives inside the mount-only useEffect. Stash the dispatcher in a ref so
  // the effect reads the latest reference without re-mounting xterm.
  const { toasts, warning: toastWarning, dismiss: dismissToast } = useToast();
  const toastWarningRef = useRef(toastWarning);
  toastWarningRef.current = toastWarning;

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
      lineHeight: 1,
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
    // Timestamp of the last paste gesture the keydown handler claimed. The
    // container's `paste` event fires for the same Ctrl/Cmd+V, so handlePaste
    // checks this to skip re-running the upload + ESC+v flow.
    let pasteHandledAt = 0;
    const pasteFromClipboard = async () => {
      if (inputBlockedRef.current) {
        console.debug('[paste] inputBlocked → ignored');
        return;
      }
      // The browser fires a `paste` ClipboardEvent for the same Ctrl/Cmd+V
      // (preventDefault on keydown doesn't suppress it), so we claim the
      // gesture synchronously to make handlePaste bail. We only claim when
      // the clipboard API will actually work — on non-secure origins
      // (LAN-IP http://) navigator.clipboard.read throws and we'd need
      // handlePaste's clipboardData path as the real handler, so leave
      // the claim cleared there.
      if (!window.isSecureContext) return;
      pasteHandledAt = Date.now();

      // 1) Try image MIME via clipboard.read(). On HTTP/LAN-IP origins this
      //    rejects — we swallow that and fall through to readText() so the
      //    text path isn't lost along with the image probe.
      //    Skipped entirely for raw-shell sessions: there's no AI CLI to
      //    interpret `[Image #N]`, so an image paste just becomes a regular
      //    text paste (whatever text the clipboard also holds, if any).
      if (!disableImagePasteRef.current) {
        try {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            const imageType = item.types.find(t => t.startsWith('image/'));
            if (imageType) {
              const blob = await item.getType(imageType);
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                console.debug('[paste] image via clipboard.read(), bytes=', blob.size);
                // Server pushes the image into the host OS clipboard AND injects
                // ESC+v into the PTY in the same transaction (see paste-image
                // route) so two concurrent paste-image requests can't race on
                // the shared OS clipboard. We don't send ESC+v here.
                pasteImage(sessionId, dataUrl).catch((err) => console.warn('[paste] pasteImage failed:', err));
              };
              reader.readAsDataURL(blob);
              return;
            }
          }
        } catch (err) {
          console.debug('[paste] clipboard.read() rejected, falling through:', err);
        }
      }

      // 2) Try plain text. readText() is more permissive than read() and may
      //    succeed even when read() rejects.
      let text: string | null = null;
      try {
        text = await navigator.clipboard.readText();
      } catch (err) {
        console.warn('[paste] clipboard.readText() failed:', err);
      }
      if (text) {
        const multiline = text.includes('\n');
        console.debug('[paste] sending text, len=', text.length, 'multiline=', multiline);
        guardedSend({ type: 'session:terminal-input', sessionId, input: wrapBracketedPaste(text) });
        return;
      }

      // 3) Text empty — fall back to OS-clipboard image-file-path lookup
      //    (Windows Explorer file copy / recent Screenshots polyfill). Only
      //    runs when the browser clipboard had no usable text/image, so it
      //    can't intercept a real text paste anymore.
      try {
        const clip = await getClipboardImagePath(sessionId);
        if (clip.path) {
          console.debug('[paste] empty browser clipboard, using OS file path:', clip.path);
          guardedSend({ type: 'session:terminal-input', sessionId, input: clip.path });
          return;
        }
      } catch (err) {
        console.debug('[paste] getClipboardImagePath failed:', err);
      }

      // Truly nothing to paste. Surface this so the user knows it wasn't
      // silently dropped — most common cause is HTTP-origin clipboard
      // permission denial; the right-click → Paste menu fires the native
      // paste event and uses the container fallback below.
      console.warn('[paste] no content available (text empty, no image, no file path)');
      toastWarningRef.current?.('붙여넣을 내용을 클립보드에서 읽지 못했습니다. 우클릭 → 붙여넣기를 시도해 보세요.');
    };
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true;

      const mod = isMac ? ev.metaKey : ev.ctrlKey;
      const otherMod = isMac ? ev.ctrlKey : ev.metaKey;
      const onlyMod = mod && !otherMod && !ev.altKey && !ev.shiftKey;
      const modWithShift = mod && !otherMod && !ev.altKey && ev.shiftKey;
      const key = ev.key.toLowerCase();

      // Ctrl+Tab / Ctrl+Shift+Tab → cycle stack tabs. Only intercepted when
      // a handler is bound (multi-tab stacks); otherwise the key falls
      // through to the PTY as usual.
      if (key === 'tab' && (onlyMod || modWithShift) && onCycleTabRef.current) {
        ev.preventDefault();
        onCycleTabRef.current(modWithShift ? 'prev' : 'next');
        return false;
      }

      // Ctrl+T (Cmd+T on Mac) → new raw-shell tab. The actual creation runs
      // off a window-level keydown handler in SessionWindowsHost; here we
      // just swallow the combo so xterm doesn't also send ^T to the PTY.
      if (key === 't' && onlyMod) {
        ev.preventDefault();
        return false;
      }

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

    // CanvasAddon draws box/block characters (█ ▀ ▄ ▌ ▐ etc.) as filled
    // cell-sized rects instead of stamping font glyphs, removing both the
    // vertical (font leading) AND horizontal (glyph-vs-cell-width) gaps that
    // the default DOM renderer leaves in ASCII art. Loaded after term.open()
    // (Canvas requires the host DOM to exist). The canvases it inserts may
    // sit above sibling overlays' default z-index — SessionPane bumps its
    // overlay z-index high enough that the "Start" button still receives
    // clicks. Stored in a ref so the fontSize-change effect can rebuild the
    // glyph atlas for the new cell size.
    try {
      const addon = new CanvasAddon();
      term.loadAddon(addon);
      canvasAddonRef.current = addon;
    } catch {
      canvasAddonRef.current = null;
    }


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

    // Best-effort initial fit so xterm has a sensible cols/rows for any
    // synchronous writes that arrive before the first ResizeObserver tick.
    // We do NOT call onFitted here — the portal/container can still be
    // settling on mount (especially after a workspace switch with state
    // rehydrated from localStorage), so the rect may briefly be tiny or
    // 0×0. Notifying the parent here would SIGWINCH the PTY at a wrong
    // size; the ResizeObserver callback below waits for a stable, non-zero
    // measurement before firing onFitted exactly once.
    try { fitAddon.fit(); } catch { /* container may be 0×0 momentarily */ }

    // Auto-focus the helper textarea so keystrokes (and IME composition)
    // land in xterm immediately on mount. Without this, focus stays on
    // whatever was focused before (form Submit button, or body) and the
    // user's first keystrokes — including a Hangul jamo that would have
    // started a composition — go nowhere. Gated on `autoFocusOnMount` so
    // hidden panes (display:none tabs, minimized floating windows) don't
    // race against a user typing in a form input elsewhere. Also defends
    // against any focusable element below body (input/textarea/select/
    // contenteditable) in case a parent forgot to pass the gate.
    if (autoFocusOnMount) {
      const ae = document.activeElement as HTMLElement | null;
      const isFormish = !!ae && (
        ae.tagName === 'INPUT' ||
        ae.tagName === 'TEXTAREA' ||
        ae.tagName === 'SELECT' ||
        ae.isContentEditable
      );
      if (!isFormish && (ae === null || ae === document.body)) {
        try { term.focus(); } catch { /* ignore */ }
      }
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
    const isPasteAlreadyHandled = () => Date.now() - pasteHandledAt < 300;
    const isImagePasteDisabled = () => disableImagePasteRef.current;
    const onComposingChange = (text: string) => setComposingTextRef.current(text);
    const inputCleanup = isMobileImeDevice()
      ? setupMobileImeInput({ container, term, sessionId, sendMessage: guardedSend, isPasteAlreadyHandled, isImagePasteDisabled })
      : setupDesktopInput({ container, term, sessionId, sendMessage: guardedSend, isPasteAlreadyHandled, isImagePasteDisabled, onComposingChange });

    // Defer the fit to the next animation frame so the ResizeObserver
    // callback doesn't synchronously mutate layout (which can trigger a
    // RO loop and leave xterm's DOM-rendered rows at stale Y positions).
    // After a successful fit we force `term.refresh()` — without it, the
    // viewport scrollbar that appears when scrollback exceeds the new
    // visible area paints stale rows when dragged.
    let fitPending = false;
    let firstFitNotified = false;
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
        // Fire onFitted once with a stable measurement. The parent uses this
        // to either POST /start (new session) or transition a restored
        // running session to 'subscribed' — both paths must see the real
        // viewport dims, not the transient values from the immediate-mount
        // fit. Thresholds guard against the brief sub-cell-grid measurements
        // we've observed during portal mount on workspace switch.
        if (!firstFitNotified && term.cols >= 20 && term.rows >= 5) {
          firstFitNotified = true;
          onFittedRef.current?.(term.cols, term.rows);
        }
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
      canvasAddonRef.current?.dispose();
      canvasAddonRef.current = null;
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
  //
  // Alternate buffer has no scrollback, and xterm.js truncates from the top
  // when rows shrink there — so a fit() that lowers rows permanently drops
  // the oldest TUI lines (Claude/Codex/Gemini conversation history above the
  // input box). We only mutate the glyph size in that mode and leave cols/
  // rows pinned to whatever the CLI last drew at; the layout becomes a bit
  // smaller/larger than the viewport but no data is lost. Normal buffer
  // (plain shells) keeps the old fit + refresh + SIGWINCH path because its
  // reflow preserves scrollback.
  useEffect(() => {
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) return;
    if (term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    // CanvasAddon caches a glyph atlas sized for the old cell dimensions; after
    // fontSize changes it keeps stamping old-size glyphs at new-size cell grid
    // positions, producing visibly torn/misaligned ASCII art. Dispose+reload
    // rebuilds the atlas at the new size.
    if (canvasAddonRef.current) {
      try { canvasAddonRef.current.dispose(); } catch { /* ignore */ }
      canvasAddonRef.current = null;
      try {
        const addon = new CanvasAddon();
        term.loadAddon(addon);
        canvasAddonRef.current = addon;
      } catch { /* DOM renderer fallback */ }
    }
    const bufferType = term.buffer.active.type;
    if (bufferType === 'alternate') {
      if (import.meta.env.DEV) {
        console.debug(
          `[session-fontsize] sessionId=${sessionId} type=alternate cols=${term.cols} rows=${term.rows} length=${term.buffer.active.length} cursorY=${term.buffer.active.cursorY} action=skip-alternate`,
        );
      }
      return;
    }
    try {
      fitAddon.fit();
      term.refresh(0, term.rows - 1);
    } catch { /* container may be hidden */ }
    if (import.meta.env.DEV) {
      console.debug(
        `[session-fontsize] sessionId=${sessionId} type=${term.buffer.active.type} cols=${term.cols} rows=${term.rows} length=${term.buffer.active.length} cursorY=${term.buffer.active.cursorY} action=fit`,
      );
    }
    // Skip the resize broadcast entirely if the cell grid didn't actually
    // change — avoids a needless SIGWINCH (and CLI redraw) for sub-pixel
    // font tweaks that fit the same cols/rows.
    if (term.cols === lastResizeRef.current.cols && term.rows === lastResizeRef.current.rows) return;
    if (fontSizeResizeTimerRef.current) clearTimeout(fontSizeResizeTimerRef.current);
    fontSizeResizeTimerRef.current = setTimeout(() => {
      sendResizeRef.current?.();
    }, 300);
  }, [fontSize, sessionId]);

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
      {composingText && (
        // xterm doesn't paint composing text into the grid, so we mirror the
        // compositionupdate string here. Bottom-left of the session window,
        // pointer-events: none so selection/click in the terminal still work.
        <div
          style={{
            position: 'absolute',
            left: 12,
            bottom: 12,
            maxWidth: 'calc(100% - 24px)',
            padding: '3px 8px',
            background: 'rgba(0,0,0,0.72)',
            border: `1px solid ${CMD.separator}`,
            borderRadius: 4,
            fontFamily: CMD_FONT,
            fontSize: Math.max(12, fontSize),
            color: CMD.bright,
            lineHeight: 1.3,
            zIndex: 2,
            pointerEvents: 'none',
            whiteSpace: 'pre',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <span style={{ color: CMD.dim, marginRight: 6 }}>IME</span>
          {composingText}
        </div>
      )}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
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
  // True when the xterm keydown handler just claimed this paste gesture.
  // The browser still fires a `paste` ClipboardEvent for the same Ctrl/Cmd+V
  // (preventDefault on keydown doesn't suppress it), so without this gate
  // every image paste runs the upload + ESC+v path twice and the CLI renders
  // `[Image #1]` followed by a duplicate `[Image #2]`.
  isPasteAlreadyHandled: () => boolean;
  // True for raw-shell sessions: skip the image MIME branch of the paste
  // fallback so a clipboard image doesn't get uploaded. Text paste path
  // still runs.
  isImagePasteDisabled?: () => boolean;
  // Mirrors the current IME composition string to the React layer so the
  // session window can render it in a bottom-left overlay. Called with the
  // empty string to clear (compositionend / no in-flight composition).
  onComposingChange?: (text: string) => void;
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

function setupDesktopInput({ container, term, sessionId, sendMessage, isPasteAlreadyHandled, isImagePasteDisabled, onComposingChange }: InputSetupArgs): () => void {
  let composing = false;
  const reportComposing = (text: string) => {
    try { onComposingChange?.(text); } catch { /* host setter may have torn down */ }
  };
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
    // Hide xterm's block cursor while composing: the buffer cursor doesn't
    // advance until commit, so it would otherwise sit awkwardly to the left
    // of the in-flight Hangul (drawn inline by xterm's .composition-view).
    // DECTCEM (CSI ?25 l/h) toggles xterm's LOCAL render only — it's not sent
    // to the PTY and isn't part of the raw replay stream, so no desync.
    // Renderer-independent (works for canvas and DOM-fallback cursors alike).
    try { term.write('\x1b[?25l'); } catch { /* term may be disposing */ }
    reportComposing('');
  };
  // compositionupdate fires for every keystroke that mutates the in-flight
  // composition (jamo addition / syllable rebuild), so this is what we
  // mirror to the bottom-left overlay. compositionstart only fires once
  // and carries no data.
  const handleCompUpdate = (e: Event) => {
    reportComposing((e as CompositionEvent).data ?? '');
  };
  const handleCompEnd = (e: Event) => {
    composing = false;
    try { term.write('\x1b[?25h'); } catch { /* term may be disposing */ }
    reportComposing('');
    const data = (e as CompositionEvent).data;
    if (data) {
      pendingDedup = data;
      sendMessage({ type: 'session:terminal-input', sessionId, input: data });
    }
  };
  // Browser paste event fires inside a user gesture even on http:// origins
  // where navigator.clipboard.readText() is blocked, so this catches LAN-IP
  // access via cloudflared-disabled scenarios. It ALSO fires for the same
  // Ctrl/Cmd+V the keydown handler already handled (preventDefault on
  // keydown doesn't suppress the paste event), so we bail when the keydown
  // path just claimed the gesture.
  const handlePaste = (e: ClipboardEvent) => {
    if (isPasteAlreadyHandled()) {
      e.preventDefault();
      return;
    }
    const items = e.clipboardData?.items;
    // Raw-shell sessions skip image upload — there's no AI CLI to interpret
    // `[Image #N]`. Text on the clipboard still pastes through the branch
    // below.
    if (items && !isImagePasteDisabled?.()) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          e.preventDefault();
          const file = items[i].getAsFile();
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            console.debug('[paste-fallback] image via paste event, bytes=', file.size);
            // Server injects ESC+v after writing the clipboard; see the
            // paste-image route. We don't send it from the client.
            pasteImage(sessionId, dataUrl, file.name).catch((err) => console.warn('[paste-fallback] pasteImage failed:', err));
          };
          reader.readAsDataURL(file);
          return;
        }
      }
    }
    const text = e.clipboardData?.getData('text/plain');
    if (text) {
      e.preventDefault();
      const multiline = text.includes('\n');
      console.debug('[paste-fallback] sending text, len=', text.length, 'multiline=', multiline);
      sendMessage({ type: 'session:terminal-input', sessionId, input: wrapBracketedPaste(text) });
    } else {
      console.debug('[paste-fallback] paste event had no usable text/image');
    }
  };
  container.addEventListener('compositionstart', handleCompStart, true);
  container.addEventListener('compositionupdate', handleCompUpdate, true);
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
    container.removeEventListener('compositionupdate', handleCompUpdate, true);
    container.removeEventListener('compositionend', handleCompEnd, true);
    container.removeEventListener('paste', handlePaste, true);
    // Restore the cursor in case teardown interrupts an active composition.
    try { term.write('\x1b[?25h'); } catch { /* term may be disposing */ }
    reportComposing('');
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
