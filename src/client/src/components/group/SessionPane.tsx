// One session's PTY viewport + phase machine. Lives inside a StackView; the
// pane stays mounted regardless of whether its tab is the active one in the
// stack — visibility is toggled via `display` so live PTY output never drops.
//
// Phase machine (lifted from the original SessionWindow):
//   pendingFit  — visible & intent='start'; waiting for terminal fit dims
//   starting    — POST /start in flight
//   subscribed  — PTY alive, terminal subscribing to bytes
//   replay-only — opened on a non-running session for review (no auto-start)
//   stopping    — user-initiated stop in flight
//   error       — start failed; user can retry
//
// auto-close on status transition out of running: SessionPane fires `onClose`
// (host removes this tab from the group's tree).

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Play, Send, ChevronDown, ChevronUp, Loader2, GitCompare } from 'lucide-react';
import SessionTerminal from '../SessionTerminal';
import SessionDiffPanel from '../SessionDiffPanel';
import { CMD, CMD_FONT } from '../terminal-theme';
import { useI18n } from '../../i18n';
import * as sessionsApi from '../../api/sessions';
import { useSessionFontSize } from '../../hooks/useSessionFontSize';
import { useSessionTheme } from '../../hooks/useSessionTheme';
import type { Session } from '../../types';
import type { WsEvent } from '../../hooks/useWebSocket';

export type PaneIntent = 'start' | 'open' | 'resume';

interface SessionPaneProps {
  session: Session;
  visible: boolean;
  intent: PaneIntent;
  intentNonce: number;
  onClose: () => void;
  sendMessage: (event: object) => void;
  subscribeBinary: (sessionId: string, cb: (payload: Uint8Array) => void) => () => void;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  // Forwarded to SessionTerminal so Ctrl+Tab / Ctrl+Shift+Tab can switch
  // the active tab in the parent stack while the terminal has focus.
  onCycleTab?: (dir: 'next' | 'prev') => void;
  // Used as React key on <SessionTerminal>. Bumping it disposes the xterm.js
  // instance and recreates it; the remount re-fires `session:subscribe` so
  // the server replays from DB chunks (Raw Binary Streaming guarantee). PTY
  // and pane state survive.
  remountKey?: number;
}

type Phase = 'pendingFit' | 'starting' | 'subscribed' | 'replay-only' | 'stopping' | 'error';

export default function SessionPane({
  session,
  visible,
  intent,
  intentNonce,
  onClose,
  sendMessage,
  subscribeBinary,
  onEvent,
  onCycleTab,
  remountKey = 0,
}: SessionPaneProps) {
  const { t } = useI18n();

  // Always start at 'pendingFit' when an interactive PTY is expected — even
  // for restored running sessions. Going straight to 'subscribed' at mount
  // lets SessionTerminal's `subscribed` effect fire `session:subscribe` +
  // `session:resize` before the portal/container has settled, which SIGWINCHs
  // the PTY at a transient tiny size and corrupts the buffer (visible the
  // moment the user resizes the window). handleFitted promotes to 'subscribed'
  // once the RO has produced a stable measurement.
  const initialPhase: Phase = (() => {
    if (session.status === 'running') return 'pendingFit';
    if (intent === 'start' || intent === 'resume') return 'pendingFit';
    return 'replay-only';
  })();
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // On-demand Diff side panel — docked on the right, resizable. Only fetches
  // when opened; the terminal reflows (its ResizeObserver refits) as it shrinks.
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffWidth, setDiffWidth] = useState(480);
  // Diff only works on a git repo; hide the button/shortcut/panel otherwise.
  const canDiff = !!session.is_git_repo;
  const paneRef = useRef<HTMLDivElement>(null);
  const startDiffResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const pane = paneRef.current;
    if (!pane) return;
    const onMove = (ev: MouseEvent) => {
      const rect = pane.getBoundingClientRect();
      const min = 240;
      const max = Math.max(min, rect.width - 200);
      setDiffWidth(Math.min(max, Math.max(min, rect.right - ev.clientX)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);
  // Terminal-requested rebuild (alt-screen font zoom settled). Composes with
  // the host-driven remountKey in the React key below so either source
  // disposes/recreates xterm — the remount's subscribe replay + resize make
  // the TUI repaint at the new glyph size.
  const [autoRefreshNonce, setAutoRefreshNonce] = useState(0);
  const handleRequestRefresh = useCallback(() => setAutoRefreshNonce((n) => n + 1), []);
  const fittedRef = useRef<{ cols: number; rows: number } | null>(null);
  const startInFlightRef = useRef(false);
  const lastIntentNonceRef = useRef(intentNonce);

  // Initial-prompt pre-flight panel state. Populated when /start reports the
  // server is holding a prompt for review; cleared after Send/Skip/error.
  const [pendingPromptLength, setPendingPromptLength] = useState<number | null>(null);
  const [pendingPromptText, setPendingPromptText] = useState<string | null>(null);
  const [pendingPreviewOpen, setPendingPreviewOpen] = useState(false);
  const [pendingActionInFlight, setPendingActionInFlight] = useState<'send' | 'skip' | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  // Tracks whether this pane has actively run a session in its lifetime
  // (started here OR opened while running). Used to gate auto-close.
  const wasActiveRef = useRef(session.status === 'running');

  useEffect(() => {
    // Don't auto-promote out of 'pendingFit' — handleFitted does that with
    // valid cols/rows in hand. Otherwise SIGWINCHing the PTY at transient
    // dims races with replay and corrupts the screen buffer.
    if (session.status === 'running' && phase !== 'subscribed' && phase !== 'starting' && phase !== 'pendingFit') {
      wasActiveRef.current = true;
      setPhase('subscribed');
    }
  }, [session.status, phase]);

  useEffect(() => {
    if (session.status === 'running') return;
    if (!wasActiveRef.current) return;
    if (phase !== 'subscribed' && phase !== 'stopping') return;
    const tm = setTimeout(() => onClose(), 300);
    return () => clearTimeout(tm);
  }, [session.status, phase, onClose]);

  const tryStart = useCallback(async () => {
    const dims = fittedRef.current;
    if (!dims) return;
    if (startInFlightRef.current) return;
    startInFlightRef.current = true;
    setPhase('starting');
    setErrorMsg(null);
    setPendingError(null);
    try {
      const result = await sessionsApi.startSession(
        session.id,
        dims,
        intent === 'resume' ? { continueSession: true } : undefined,
      );
      setPhase('subscribed');
      if (result.pendingInitialPrompt) {
        setPendingPromptLength(result.pendingInitialPromptLength ?? 0);
        setPendingPromptText(null);
        setPendingPreviewOpen(false);
      } else {
        setPendingPromptLength(null);
        setPendingPromptText(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setPhase('error');
    } finally {
      startInFlightRef.current = false;
    }
  }, [session.id, intent]);

  const togglePreview = useCallback(async () => {
    if (pendingPreviewOpen) {
      setPendingPreviewOpen(false);
      return;
    }
    setPendingPreviewOpen(true);
    if (pendingPromptText !== null) return;
    try {
      const res = await sessionsApi.getPendingInitialPrompt(session.id);
      setPendingPromptText(res.prompt ?? '');
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : String(err));
    }
  }, [pendingPreviewOpen, pendingPromptText, session.id]);

  const handleSendInitial = useCallback(async () => {
    if (pendingActionInFlight) return;
    setPendingActionInFlight('send');
    setPendingError(null);
    try {
      await sessionsApi.submitInitialPrompt(session.id);
      setPendingPromptLength(null);
      setPendingPromptText(null);
      setPendingPreviewOpen(false);
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingActionInFlight(null);
    }
  }, [pendingActionInFlight, session.id]);

  const handleSkipInitial = useCallback(async () => {
    if (pendingActionInFlight) return;
    setPendingActionInFlight('skip');
    setPendingError(null);
    try {
      await sessionsApi.skipInitialPrompt(session.id);
      setPendingPromptLength(null);
      setPendingPromptText(null);
      setPendingPreviewOpen(false);
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingActionInFlight(null);
    }
  }, [pendingActionInFlight, session.id]);

  // Re-trigger start if intentNonce bumps with intent='start'/'resume' on a replay-only pane.
  useEffect(() => {
    if (intentNonce === lastIntentNonceRef.current) return;
    lastIntentNonceRef.current = intentNonce;
    const isStart = intent === 'start' || intent === 'resume';
    if (isStart && phase === 'replay-only' && session.status !== 'running') {
      if (fittedRef.current) {
        void tryStart();
      } else {
        setPhase('pendingFit');
      }
    }
  }, [intentNonce, intent, phase, session.status, tryStart]);

  const handleStartClick = useCallback(() => {
    if (fittedRef.current) {
      void tryStart();
    } else {
      setPhase('pendingFit');
    }
  }, [tryStart]);

  const handleFitted = useCallback((cols: number, rows: number) => {
    fittedRef.current = { cols, rows };
    if (phase === 'pendingFit') {
      if (session.status === 'running') {
        // Restored running session (e.g. user switched projects and came
        // back) — the PTY is already alive, so skip POST /start (which would
        // spawn a duplicate) and go straight to subscribed now that we have
        // real dims to send with session:resize.
        wasActiveRef.current = true;
        setPhase('subscribed');
      } else {
        void tryStart();
      }
    }
  }, [phase, tryStart, session.status]);

  const isRunning = session.status === 'running';
  const subscribed = phase === 'subscribed';
  const [fontSize] = useSessionFontSize(session.id);
  const [, terminalTheme] = useSessionTheme(session.id);

  const overlayContent = (() => {
    if (phase === 'starting' || phase === 'pendingFit') {
      return (
        <div style={{ ...overlayStyle, pointerEvents: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: CMD.dim }} />
            <span style={{ color: CMD.dim, fontFamily: CMD_FONT, fontSize: 12 }}>
              {t('session.starting') || 'starting…'}
            </span>
          </div>
          <span style={{ color: CMD.dim, fontFamily: CMD_FONT, fontSize: 10, marginTop: 6 }}>
            {t('session.starting.typeAhead') || 'type-ahead is captured and replayed once ready'}
          </span>
        </div>
      );
    }
    if (phase === 'stopping') {
      return (
        <div style={{ ...overlayStyle, pointerEvents: 'none' }}>
          <span style={{ color: CMD.dim, fontFamily: CMD_FONT, fontSize: 12 }}>
            {t('session.stopping') || 'stopping…'}
          </span>
        </div>
      );
    }
    if (phase === 'replay-only') {
      return (
        <div style={overlayStyle}>
          <button
            onClick={handleStartClick}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: CMD_FONT, fontSize: 14, color: CMD.bright,
              background: 'transparent', border: `1px solid ${CMD.separator}`,
              padding: '10px 22px', borderRadius: 6, cursor: 'pointer',
            }}
          >
            <Play size={16} /> {t('session.startInWindow') || 'Start'}
          </button>
        </div>
      );
    }
    if (phase === 'error') {
      return (
        <div style={overlayStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: CMD.error, fontFamily: CMD_FONT, fontSize: 12, marginBottom: 8 }}>
            <AlertCircle size={14} /> {t('session.startFailed') || 'failed to start'}
          </div>
          {errorMsg && <div style={{ color: CMD.dim, fontFamily: CMD_FONT, fontSize: 11, marginBottom: 8, maxWidth: 360, textAlign: 'center', wordBreak: 'break-word' }}>{errorMsg}</div>}
          <button
            onClick={() => { void tryStart(); }}
            style={{
              fontFamily: CMD_FONT, fontSize: 12, color: CMD.bright,
              background: 'transparent', border: `1px solid ${CMD.separator}`,
              padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
            }}
          >
            {t('common.retry') || 'Retry'}
          </button>
        </div>
      );
    }
    return null;
  })();

  return (
    <div
      ref={paneRef}
      style={{
        display: visible ? 'flex' : 'none',
        flexDirection: 'row',
        position: 'absolute',
        inset: 0,
        background: CMD.bg,
      }}
    >
      <div style={{ position: 'relative', flex: 1, minWidth: 0, height: '100%' }}>
      <SessionTerminal
        key={`${remountKey}:${autoRefreshNonce}`}
        sessionId={session.id}
        isRunning={isRunning}
        subscribed={subscribed}
        onFitted={handleFitted}
        sendMessage={sendMessage}
        subscribeBinary={subscribeBinary}
        onEvent={onEvent}
        fontSize={fontSize}
        theme={terminalTheme}
        inputBlocked={pendingPromptLength !== null}
        autoFocusOnMount={visible}
        onRequestRefresh={handleRequestRefresh}
        disableImagePaste={session.cli_tool === 'raw-shell'}
        onCycleTab={onCycleTab}
        onToggleDiff={() => { if (canDiff) setDiffOpen((o) => !o); }}
      />
      {overlayContent}
      {canDiff && !diffOpen && (
        <button
          onClick={() => setDiffOpen(true)}
          title={`${t('session.diff.title') || 'Diff'} (${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl'}+Shift+D)`}
          style={{
            position: 'absolute', top: 4, right: 8, zIndex: 1002,
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontFamily: CMD_FONT, fontSize: 10, color: CMD.dim,
            background: 'rgba(20,20,28,0.7)',
            border: `1px solid ${CMD.separator}`,
            padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
          }}
        >
          <GitCompare size={11} /> Diff
        </button>
      )}
      {pendingPromptLength !== null && (
        <div style={pendingBannerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span aria-hidden style={{ color: CMD.info, fontSize: 14 }}>📋</span>
            <span style={{ flex: 1 }}>
              {(t('session.initialPrompt.ready') || 'Initial prompt ready')}
              <span style={{ color: CMD.dim, marginLeft: 8 }}>
                {pendingPromptLength.toLocaleString()} chars
              </span>
              <div style={{ color: CMD.warning, fontSize: 10, marginTop: 2 }}>
                {t('session.initialPrompt.blocked') || 'Press Send or Skip before typing — keystrokes are ignored until then.'}
              </div>
            </span>
            <button
              onClick={togglePreview}
              style={pendingButtonStyle('neutral')}
              title={pendingPreviewOpen ? (t('session.initialPrompt.hidePreview') || 'Hide preview') : (t('session.initialPrompt.preview') || 'Preview')}
            >
              {pendingPreviewOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {pendingPreviewOpen ? (t('session.initialPrompt.hidePreview') || 'Hide') : (t('session.initialPrompt.preview') || 'Preview')}
            </button>
            <button
              onClick={handleSendInitial}
              disabled={pendingActionInFlight !== null}
              style={pendingButtonStyle('primary')}
            >
              {pendingActionInFlight === 'send' ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={11} />}
              {t('session.initialPrompt.send') || 'Send'}
            </button>
            <button
              onClick={handleSkipInitial}
              disabled={pendingActionInFlight !== null}
              style={pendingButtonStyle('danger')}
            >
              {t('session.initialPrompt.skip') || 'Skip'}
            </button>
          </div>
          {pendingError && (
            <div style={{ color: CMD.error, fontSize: 10, marginTop: 4 }}>{pendingError}</div>
          )}
          {pendingPreviewOpen && (
            <pre
              style={{
                margin: 0,
                marginTop: 6,
                maxHeight: 240,
                overflow: 'auto',
                background: 'rgba(0,0,0,0.4)',
                padding: 8,
                fontFamily: CMD_FONT,
                fontSize: 10,
                color: CMD.bright,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                border: `1px solid ${CMD.separator}`,
                borderRadius: 4,
              }}
            >
              {pendingPromptText === null ? (t('session.initialPrompt.loading') || 'loading…') : pendingPromptText}
            </pre>
          )}
        </div>
      )}
      </div>
      {canDiff && diffOpen && (
        <>
          <div
            onMouseDown={startDiffResize}
            style={{
              width: 5, flexShrink: 0, cursor: 'col-resize',
              background: CMD.separator,
            }}
          />
          <div style={{ width: diffWidth, flexShrink: 0, minWidth: 0, height: '100%' }}>
            <SessionDiffPanel sessionId={session.id} onClose={() => setDiffOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
}

const pendingBannerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0, left: 0, right: 0,
  background: 'rgba(28,28,38,0.96)',
  borderBottom: `1px solid ${CMD.separator}`,
  borderLeft: `3px solid ${CMD.warning}`,
  padding: '8px 10px',
  color: CMD.bright,
  fontFamily: CMD_FONT,
  fontSize: 11,
  zIndex: 3,
  display: 'flex',
  flexDirection: 'column',
};

function pendingButtonStyle(variant: 'primary' | 'neutral' | 'danger'): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontFamily: CMD_FONT,
    fontSize: 10,
    padding: '3px 8px',
    borderRadius: 4,
    cursor: 'pointer',
    border: `1px solid ${CMD.separator}`,
    background: 'transparent',
  };
  if (variant === 'primary') {
    return { ...base, color: CMD.bright, borderColor: CMD.info, background: `${CMD.info}22` };
  }
  if (variant === 'danger') {
    return { ...base, color: CMD.dim };
  }
  return { ...base, color: CMD.bright };
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute', inset: 0,
  background: 'rgba(12,12,12,0.85)',
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  // CanvasAddon stacks multiple <canvas> layers inside the xterm container,
  // some of which may resolve above z-index:2 in the parent stacking context
  // and visually cover this overlay's button. Bumping high keeps clicks
  // (Start / Retry) reliably reaching the overlay regardless of renderer.
  zIndex: 1000,
};
