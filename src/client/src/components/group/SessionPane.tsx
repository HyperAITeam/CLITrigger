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
import { AlertCircle, Play } from 'lucide-react';
import SessionTerminal from '../SessionTerminal';
import { CMD, CMD_FONT } from '../terminal-theme';
import { useI18n } from '../../i18n';
import * as sessionsApi from '../../api/sessions';
import type { Session } from '../../types';
import type { WsEvent } from '../../hooks/useWebSocket';

export type PaneIntent = 'start' | 'open';

interface SessionPaneProps {
  session: Session;
  visible: boolean;
  intent: PaneIntent;
  intentNonce: number;
  onClose: () => void;
  sendMessage: (event: object) => void;
  subscribeBinary: (sessionId: string, cb: (payload: Uint8Array) => void) => () => void;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
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
}: SessionPaneProps) {
  const { t } = useI18n();

  const initialPhase: Phase = (() => {
    if (session.status === 'running') return 'subscribed';
    if (intent === 'start') return 'pendingFit';
    return 'replay-only';
  })();
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fittedRef = useRef<{ cols: number; rows: number } | null>(null);
  const startInFlightRef = useRef(false);
  const lastIntentNonceRef = useRef(intentNonce);
  // Tracks whether this pane has actively run a session in its lifetime
  // (started here OR opened while running). Used to gate auto-close.
  const wasActiveRef = useRef(initialPhase === 'subscribed');

  useEffect(() => {
    if (session.status === 'running' && phase !== 'subscribed' && phase !== 'starting') {
      wasActiveRef.current = true;
      setPhase('subscribed');
    }
  }, [session.status, phase]);

  useEffect(() => {
    if (session.status === 'running') return;
    if (!wasActiveRef.current) return;
    if (phase !== 'subscribed' && phase !== 'starting' && phase !== 'stopping') return;
    const tm = setTimeout(() => onClose(), 300);
    return () => clearTimeout(tm);
  }, [session.status, phase, onClose]);

  const tryStart = useCallback(async () => {
    const dims = fittedRef.current;
    if (!dims) return;
    if (startInFlightRef.current) return;
    startInFlightRef.current = true;
    wasActiveRef.current = true;
    setPhase('starting');
    setErrorMsg(null);
    try {
      await sessionsApi.startSession(session.id, dims);
      setPhase('subscribed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setPhase('error');
    } finally {
      startInFlightRef.current = false;
    }
  }, [session.id]);

  // Re-trigger start if intentNonce bumps with intent='start' on a replay-only pane.
  useEffect(() => {
    if (intentNonce === lastIntentNonceRef.current) return;
    lastIntentNonceRef.current = intentNonce;
    if (intent === 'start' && phase === 'replay-only' && session.status !== 'running') {
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
      void tryStart();
    }
  }, [phase, tryStart]);

  const isRunning = session.status === 'running';
  const subscribed = phase === 'subscribed';

  const overlayContent = (() => {
    if (phase === 'starting' || phase === 'pendingFit') {
      return (
        <div style={overlayStyle}>
          <span style={{ color: CMD.dim, fontFamily: CMD_FONT, fontSize: 12 }}>
            {t('session.starting') || 'starting…'}
          </span>
        </div>
      );
    }
    if (phase === 'stopping') {
      return (
        <div style={overlayStyle}>
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
      style={{
        display: visible ? 'block' : 'none',
        position: 'absolute',
        inset: 0,
        background: CMD.bg,
      }}
    >
      <SessionTerminal
        sessionId={session.id}
        isRunning={isRunning}
        subscribed={subscribed}
        onFitted={handleFitted}
        sendMessage={sendMessage}
        subscribeBinary={subscribeBinary}
        onEvent={onEvent}
      />
      {overlayContent}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute', inset: 0,
  background: 'rgba(12,12,12,0.85)',
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  zIndex: 2,
};
