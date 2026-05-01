import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertCircle, Play, Minus } from 'lucide-react';
import SessionTerminal from './SessionTerminal';
import { CMD, CMD_FONT } from './terminal-theme';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useI18n } from '../i18n';
import * as sessionsApi from '../api/sessions';
import type { Session } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import type { WindowIntent } from './SessionWindowsHost';

interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SessionWindowProps {
  projectId: string;
  session: Session;
  x: number;
  y: number;
  w: number;
  h: number;
  zIndex: number;
  intent: WindowIntent;
  intentNonce: number;
  neighbors?: Geometry[];
  onClose: () => void;
  onFocus: () => void;
  onMinimize: () => void;
  onGeometryChange: (geom: Geometry) => void;
  sendMessage: (event: object) => void;
  subscribeBinary: (sessionId: string, cb: (payload: Uint8Array) => void) => () => void;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
}

const MIN_W = 320;
const MIN_H = 200;
const TITLEBAR_VISIBLE = 80; // keep at least this many px of titlebar on screen
const TITLEBAR_HEIGHT = 28;
const SNAP_EDGE_THRESHOLD = 8;
const SNAP_NEIGHBOR_THRESHOLD = 10;

type SnapZone = 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function detectSnapZone(mx: number, my: number, vpW: number, vpH: number): SnapZone | null {
  const nearLeft = mx <= SNAP_EDGE_THRESHOLD;
  const nearRight = mx >= vpW - SNAP_EDGE_THRESHOLD;
  if (!nearLeft && !nearRight) return null;
  const topThird = vpH / 3;
  const bottomThird = (vpH * 2) / 3;
  if (nearLeft) {
    if (my < topThird) return 'top-left';
    if (my > bottomThird) return 'bottom-left';
    return 'left';
  }
  if (my < topThird) return 'top-right';
  if (my > bottomThird) return 'bottom-right';
  return 'right';
}

function snapZoneToGeom(zone: SnapZone, vpW: number, vpH: number): Geometry {
  const halfW = Math.round(vpW / 2);
  const halfH = Math.round(vpH / 2);
  switch (zone) {
    case 'left': return { x: 0, y: 0, w: halfW, h: vpH };
    case 'right': return { x: vpW - halfW, y: 0, w: halfW, h: vpH };
    case 'top-left': return { x: 0, y: 0, w: halfW, h: halfH };
    case 'top-right': return { x: vpW - halfW, y: 0, w: halfW, h: halfH };
    case 'bottom-left': return { x: 0, y: vpH - halfH, w: halfW, h: halfH };
    case 'bottom-right': return { x: vpW - halfW, y: vpH - halfH, w: halfW, h: halfH };
  }
}

function applyNeighborSnap(
  nx: number, ny: number, w: number, h: number,
  neighbors: Geometry[],
): { x: number; y: number } {
  let x = nx, y = ny;
  const left = x, right = x + w, top = y, bottom = y + h;
  for (const n of neighbors) {
    const nLeft = n.x, nRight = n.x + n.w, nTop = n.y, nBottom = n.y + n.h;
    const vOverlap = top < nBottom && bottom > nTop;
    if (vOverlap) {
      if (Math.abs(left - nRight) <= SNAP_NEIGHBOR_THRESHOLD) x = nRight;
      else if (Math.abs(right - nLeft) <= SNAP_NEIGHBOR_THRESHOLD) x = nLeft - w;
      else if (Math.abs(left - nLeft) <= SNAP_NEIGHBOR_THRESHOLD) x = nLeft;
      else if (Math.abs(right - nRight) <= SNAP_NEIGHBOR_THRESHOLD) x = nRight - w;
    }
    const hOverlap = left < nRight && right > nLeft;
    if (hOverlap) {
      if (Math.abs(top - nBottom) <= SNAP_NEIGHBOR_THRESHOLD) y = nBottom;
      else if (Math.abs(bottom - nTop) <= SNAP_NEIGHBOR_THRESHOLD) y = nTop - h;
      else if (Math.abs(top - nTop) <= SNAP_NEIGHBOR_THRESHOLD) y = nTop;
      else if (Math.abs(bottom - nBottom) <= SNAP_NEIGHBOR_THRESHOLD) y = nBottom - h;
    }
  }
  return { x, y };
}

type Phase = 'pendingFit' | 'starting' | 'subscribed' | 'replay-only' | 'stopping' | 'error';

export default function SessionWindow({
  projectId: _projectId,
  session,
  x,
  y,
  w,
  h,
  zIndex,
  intent,
  intentNonce,
  neighbors,
  onClose,
  onFocus,
  onMinimize,
  onGeometryChange,
  sendMessage,
  subscribeBinary,
  onEvent,
}: SessionWindowProps) {
  const { t } = useI18n();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Track latest geometry for use during drag/resize without re-rendering.
  const geomRef = useRef<Geometry>({ x, y, w, h });
  geomRef.current = { x, y, w, h };

  // Phase semantics:
  // - 'pendingFit'   waiting for SessionTerminal to call onFitted with cols/rows
  //                  before POSTing /start (auto-start path)
  // - 'starting'     POST /start in flight
  // - 'subscribed'   PTY alive at correct size, terminal subscribing to bytes
  // - 'replay-only'  opened on a non-running session for review; terminal
  //                  shows history but no auto-start. Does NOT auto-close on
  //                  status change (user opened it intentionally to look)
  // - 'stopping'     user-initiated stop in flight, waiting for status flip
  //                  to actually close the window
  // - 'error'        start failed; user can retry
  const initialPhase: Phase = (() => {
    if (session.status === 'running') return 'subscribed';
    if (intent === 'start') return 'pendingFit';
    return 'replay-only';
  })();
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [snapZone, setSnapZone] = useState<SnapZone | null>(null);
  const snapZoneRef = useRef<SnapZone | null>(null);
  const neighborsRef = useRef<Geometry[]>(neighbors ?? []);
  neighborsRef.current = neighbors ?? [];
  const fittedRef = useRef<{ cols: number; rows: number } | null>(null);
  const startInFlightRef = useRef(false);
  const lastIntentNonceRef = useRef(intentNonce);
  // Tracks whether this window has actively run a session in its lifetime
  // (started here OR opened while running). Used to gate auto-close: a
  // window opened in replay-only mode shouldn't auto-close on status changes
  // since the user opened it intentionally to review.
  const wasActiveRef = useRef(initialPhase === 'subscribed');

  // If the session row's status flips to running while we were in some
  // pre-running state, treat it as subscribed (e.g. another tab started it).
  useEffect(() => {
    if (session.status === 'running' && phase !== 'subscribed' && phase !== 'starting') {
      wasActiveRef.current = true;
      setPhase('subscribed');
    }
  }, [session.status, phase]);

  // Auto-close on status transition out of running. Only fires for windows
  // that were actively running (not opened in pure replay-only mode). Brief
  // delay so the user sees the final terminal output (e.g. "Goodbye!").
  useEffect(() => {
    if (session.status === 'running') return;
    if (!wasActiveRef.current) return;
    if (phase !== 'subscribed' && phase !== 'starting' && phase !== 'stopping') return;
    const t = setTimeout(() => onClose(), 300);
    return () => clearTimeout(t);
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

  // External re-focus with intent='start' on an already-open replay-only
  // window (e.g. user clicked the row's ▶ button on an open window).
  useEffect(() => {
    if (intentNonce === lastIntentNonceRef.current) return;
    lastIntentNonceRef.current = intentNonce;
    if (intent === 'start' && phase === 'replay-only' && session.status !== 'running') {
      // If we already have fitted dims, start now; else flip to pendingFit
      // so the next onFitted callback triggers tryStart.
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

  const handleCloseClick = useCallback(() => {
    if (session.status === 'running' && phase === 'subscribed') {
      const msg = t('session.confirmStop') || '이 세션을 종료할까요? 진행 중인 작업이 종료됩니다.';
      if (!confirm(msg)) return;
      setPhase('stopping');
      sessionsApi.stopSession(session.id).catch((err) => {
        const m = err instanceof Error ? err.message : String(err);
        // Idempotent: server returns 400 if already non-running. Just close.
        // eslint-disable-next-line no-console
        console.warn('stopSession failed:', m);
        onClose();
      });
      // status flip → auto-close effect fires onClose()
      return;
    }
    onClose();
  }, [session.status, session.id, phase, t, onClose]);

  const handleFitted = useCallback((cols: number, rows: number) => {
    fittedRef.current = { cols, rows };
    if (phase === 'pendingFit') {
      void tryStart();
    }
  }, [phase, tryStart]);

  // ── Drag (titlebar) ──
  const onTitlebarMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isMobile) return;
    if (e.button !== 0) return;
    // Don't initiate drag from the close button.
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-drag]')) return;
    e.preventDefault();
    onFocus();
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startGeom = { ...geomRef.current };
    const wrapper = wrapperRef.current;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startMouseX;
      const dy = ev.clientY - startMouseY;
      let nx = clamp(startGeom.x + dx, -(startGeom.w - TITLEBAR_VISIBLE), vpW - TITLEBAR_VISIBLE);
      let ny = clamp(startGeom.y + dy, 0, vpH - TITLEBAR_HEIGHT);
      // Window-to-window edge snap (active during drag — sticky feel).
      const ns = neighborsRef.current;
      if (ns.length > 0) {
        const snapped = applyNeighborSnap(nx, ny, startGeom.w, startGeom.h, ns);
        nx = snapped.x;
        ny = snapped.y;
      }
      // Mutate DOM directly during drag to avoid React re-render storms.
      if (wrapper) {
        wrapper.style.left = `${nx}px`;
        wrapper.style.top = `${ny}px`;
      }
      geomRef.current.x = nx;
      geomRef.current.y = ny;
      // Edge zone detection — preview only, applied on mouseup.
      const zone = detectSnapZone(ev.clientX, ev.clientY, vpW, vpH);
      if (zone !== snapZoneRef.current) {
        snapZoneRef.current = zone;
        setSnapZone(zone);
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (snapZoneRef.current) {
        const target = snapZoneToGeom(snapZoneRef.current, vpW, vpH);
        if (wrapper) {
          wrapper.style.left = `${target.x}px`;
          wrapper.style.top = `${target.y}px`;
          wrapper.style.width = `${target.w}px`;
          wrapper.style.height = `${target.h}px`;
        }
        geomRef.current = target;
        snapZoneRef.current = null;
        setSnapZone(null);
      }
      // Commit to React state + persistence.
      onGeometryChange({ ...geomRef.current });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [isMobile, onFocus, onGeometryChange]);

  // ── Resize (bottom-right corner) ──
  const onResizeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isMobile) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onFocus();
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startGeom = { ...geomRef.current };
    const wrapper = wrapperRef.current;
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;

    const onMove = (ev: MouseEvent) => {
      const dw = ev.clientX - startMouseX;
      const dh = ev.clientY - startMouseY;
      const maxW = vpW - startGeom.x;
      const maxH = vpH - startGeom.y;
      const nw = clamp(startGeom.w + dw, MIN_W, Math.max(MIN_W, maxW));
      const nh = clamp(startGeom.h + dh, MIN_H, Math.max(MIN_H, maxH));
      if (wrapper) {
        wrapper.style.width = `${nw}px`;
        wrapper.style.height = `${nh}px`;
      }
      geomRef.current.w = nw;
      geomRef.current.h = nh;
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      onGeometryChange({ ...geomRef.current });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [isMobile, onFocus, onGeometryChange]);

  // Re-clamp into viewport when the browser is resized.
  useEffect(() => {
    if (isMobile) return;
    const onResize = () => {
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      const cur = geomRef.current;
      const nx = clamp(cur.x, -(cur.w - TITLEBAR_VISIBLE), vpW - TITLEBAR_VISIBLE);
      const ny = clamp(cur.y, 0, vpH - TITLEBAR_HEIGHT);
      if (nx !== cur.x || ny !== cur.y) {
        onGeometryChange({ ...cur, x: nx, y: ny });
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isMobile, onGeometryChange]);

  const isRunning = session.status === 'running';
  const subscribed = phase === 'subscribed';
  const titleSuffix = session.cli_tool ? ` — ${session.cli_tool}${session.cli_model ? `/${session.cli_model}` : ''}` : '';

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
            <Play size={16} /> {t('session.startInWindow') || '시작'}
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

  // ── Mobile: render fullscreen, no chrome ──
  if (isMobile) {
    return createPortal(
      <div
        style={{
          position: 'fixed', inset: 0, background: CMD.bg,
          display: 'flex', flexDirection: 'column',
          zIndex: 110,
        }}
      >
        <div style={mobileBarStyle}>
          <span style={{ flex: 1, color: CMD.titleText, fontFamily: CMD_FONT, fontSize: 12, paddingLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.title}{titleSuffix}
          </span>
          <button data-no-drag onClick={handleCloseClick} style={closeBtnStyle} aria-label="close">
            <X size={14} />
          </button>
        </div>
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
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
      </div>,
      document.body,
    );
  }

  // ── Desktop: floating, draggable, resizable ──
  const snapPreview = snapZone ? (() => {
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const target = snapZoneToGeom(snapZone, vpW, vpH);
    return createPortal(
      <div
        style={{
          position: 'fixed',
          left: target.x, top: target.y, width: target.w, height: target.h,
          background: `${CMD.info}33`,
          border: `2px dashed ${CMD.info}`,
          borderRadius: 8,
          pointerEvents: 'none',
          zIndex: 2000,
          transition: 'left 80ms ease-out, top 80ms ease-out, width 80ms ease-out, height 80ms ease-out',
          boxSizing: 'border-box',
        }}
      />,
      document.body,
    );
  })() : null;

  const desktopWindow = createPortal(
    <div
      ref={wrapperRef}
      onMouseDown={onFocus}
      style={{
        position: 'fixed',
        left: x, top: y, width: w, height: h,
        zIndex,
        background: CMD.bg,
        border: `1px solid ${CMD.separator}`,
        borderRadius: 8,
        boxShadow: '0 10px 40px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        onMouseDown={onTitlebarMouseDown}
        style={{
          background: CMD.titleBg, color: CMD.titleText,
          height: TITLEBAR_HEIGHT, display: 'flex', alignItems: 'center',
          padding: '0 8px', userSelect: 'none', cursor: 'move',
          borderBottom: `1px solid ${CMD.separator}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginRight: 10,
            fontFamily: CMD_FONT,
            fontSize: 13,
            fontWeight: 600,
            color: CMD.info,
            letterSpacing: 1,
            userSelect: 'none',
          }}
          aria-hidden
        >
          {'>_'}
        </div>
        <span style={{ flex: 1, textAlign: 'center', fontFamily: CMD_FONT, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.title}{titleSuffix}
        </span>
        <button data-no-drag onClick={onMinimize} style={closeBtnStyle} aria-label="minimize" title={t('session.minimize') || 'Minimize'}>
          <Minus size={14} />
        </button>
        <button data-no-drag onClick={onClose} style={closeBtnStyle} aria-label="close">
          <X size={14} />
        </button>
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
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
      <div
        onMouseDown={onResizeMouseDown}
        title="resize"
        style={{
          position: 'absolute', right: 0, bottom: 0,
          width: 14, height: 14, cursor: 'nwse-resize',
          background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.2) 50%)',
        }}
      />
    </div>,
    document.body,
  );

  return (
    <>
      {desktopWindow}
      {snapPreview}
    </>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute', inset: 0,
  background: 'rgba(12,12,12,0.85)',
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  zIndex: 2,
};

const mobileBarStyle: React.CSSProperties = {
  background: CMD.titleBg,
  height: TITLEBAR_HEIGHT,
  display: 'flex', alignItems: 'center',
  borderBottom: `1px solid ${CMD.separator}`,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: CMD.titleText,
  cursor: 'pointer',
  padding: 4,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 4,
};
