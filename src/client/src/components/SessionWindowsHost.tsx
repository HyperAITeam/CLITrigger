import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import SessionWindow from './SessionWindow';
import { CMD, CMD_FONT } from './terminal-theme';
import type { Session } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';

interface WindowGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type WindowIntent = 'start' | 'open';

interface OpenWindow extends WindowGeom {
  sessionId: string;
  z: number;
  intent: WindowIntent;
  /**
   * Bumps every time openOrFocus is called for this window. Lets
   * SessionWindow react to a re-focus with intent='start' (e.g. user
   * clicked ▶ on a window that was already open in replay-only mode).
   */
  intentNonce: number;
  minimized: boolean;
}

interface SessionWindowsAPI {
  openOrFocus: (sessionId: string, intent?: WindowIntent) => void;
  close: (sessionId: string) => void;
  focus: (sessionId: string) => void;
  minimize: (sessionId: string) => void;
  restore: (sessionId: string) => void;
  isOpen: (sessionId: string) => boolean;
}

const SessionWindowsContext = createContext<SessionWindowsAPI | null>(null);

export function useSessionWindows(): SessionWindowsAPI {
  const ctx = useContext(SessionWindowsContext);
  if (!ctx) throw new Error('useSessionWindows must be used within SessionWindowsHost');
  return ctx;
}

interface HostProps {
  projectId: string;
  sessions: Session[];
  sendMessage: (event: object) => void;
  subscribeBinary: (sessionId: string, cb: (payload: Uint8Array) => void) => () => void;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  children: ReactNode;
}

const DEFAULT_W = 720;
const DEFAULT_H = 460;
const CASCADE_STEP = 30;
const CASCADE_BASE_X = 80;
const CASCADE_BASE_Y = 80;

function lsKey(projectId: string, sessionId: string) {
  return `sessionWindow:${projectId}:${sessionId}`;
}

function readGeom(projectId: string, sessionId: string): WindowGeom | null {
  try {
    const raw = localStorage.getItem(lsKey(projectId, sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.x === 'number' && typeof parsed?.y === 'number' &&
      typeof parsed?.w === 'number' && typeof parsed?.h === 'number'
    ) {
      return parsed as WindowGeom;
    }
  } catch { /* ignore */ }
  return null;
}

function writeGeom(projectId: string, sessionId: string, geom: WindowGeom): void {
  try { localStorage.setItem(lsKey(projectId, sessionId), JSON.stringify(geom)); }
  catch { /* quota exceeded etc — ignore */ }
}

function cascadeGeom(existingCount: number): WindowGeom {
  const i = existingCount % 8;
  return {
    x: CASCADE_BASE_X + i * CASCADE_STEP,
    y: CASCADE_BASE_Y + i * CASCADE_STEP,
    w: DEFAULT_W,
    h: DEFAULT_H,
  };
}

export default function SessionWindowsHost({
  projectId,
  sessions,
  sendMessage,
  subscribeBinary,
  onEvent,
  children,
}: HostProps) {
  const [windows, setWindows] = useState<OpenWindow[]>([]);
  const zCounterRef = useRef(0);

  const openOrFocus = useCallback((sessionId: string, intent: WindowIntent = 'open') => {
    setWindows((prev) => {
      const existing = prev.find((w) => w.sessionId === sessionId);
      zCounterRef.current += 1;
      const z = zCounterRef.current;
      if (existing) {
        // Bump intent only if upgrading from 'open' → 'start'. Going the
        // other direction (e.g. row click on a window already started
        // with intent='start') shouldn't downgrade.
        const newIntent: WindowIntent = intent === 'start' ? 'start' : existing.intent;
        const intentChanged = newIntent !== existing.intent || intent === 'start';
        return prev.map((w) => (
          w.sessionId === sessionId
            ? {
                ...w,
                z,
                intent: newIntent,
                intentNonce: intentChanged ? w.intentNonce + 1 : w.intentNonce,
                minimized: false,
              }
            : w
        ));
      }
      const stored = readGeom(projectId, sessionId);
      const geom = stored ?? cascadeGeom(prev.length);
      return [...prev, { sessionId, z, intent, intentNonce: 0, minimized: false, ...geom }];
    });
  }, [projectId]);

  const focus = useCallback((sessionId: string) => {
    setWindows((prev) => {
      const top = prev.find((w) => w.sessionId === sessionId);
      if (!top) return prev;
      // Cheap optimization: skip state churn if already on top.
      const max = prev.reduce((m, w) => (w.z > m ? w.z : m), 0);
      if (top.z === max) return prev;
      zCounterRef.current += 1;
      const z = zCounterRef.current;
      return prev.map((w) => (w.sessionId === sessionId ? { ...w, z } : w));
    });
  }, []);

  const close = useCallback((sessionId: string) => {
    setWindows((prev) => prev.filter((w) => w.sessionId !== sessionId));
  }, []);

  const minimize = useCallback((sessionId: string) => {
    setWindows((prev) => prev.map((w) => (w.sessionId === sessionId ? { ...w, minimized: true } : w)));
  }, []);

  const restore = useCallback((sessionId: string) => {
    setWindows((prev) => {
      const target = prev.find((w) => w.sessionId === sessionId);
      if (!target) return prev;
      zCounterRef.current += 1;
      const z = zCounterRef.current;
      return prev.map((w) => (w.sessionId === sessionId ? { ...w, minimized: false, z } : w));
    });
  }, []);

  const isOpen = useCallback((sessionId: string) => windows.some((w) => w.sessionId === sessionId), [windows]);

  const updateGeometry = useCallback((sessionId: string, geom: WindowGeom) => {
    setWindows((prev) => prev.map((w) => (w.sessionId === sessionId ? { ...w, ...geom } : w)));
    writeGeom(projectId, sessionId, geom);
  }, [projectId]);

  // Auto-close windows when their session row disappears (e.g. user deleted it).
  useEffect(() => {
    setWindows((prev) => {
      const validIds = new Set(sessions.map((s) => s.id));
      const filtered = prev.filter((w) => validIds.has(w.sessionId));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [sessions]);

  const api = useMemo<SessionWindowsAPI>(() => ({ openOrFocus, close, focus, minimize, restore, isOpen }), [openOrFocus, close, focus, minimize, restore, isOpen]);

  const minimizedWindows = windows.filter((w) => w.minimized);
  const visibleWindows = windows.filter((w) => !w.minimized);

  return (
    <SessionWindowsContext.Provider value={api}>
      {children}
      {visibleWindows.map((w) => {
        const session = sessions.find((s) => s.id === w.sessionId);
        if (!session) return null;
        const neighborGeoms = visibleWindows
          .filter((v) => v.sessionId !== w.sessionId)
          .map(({ x, y, w: nw, h: nh }) => ({ x, y, w: nw, h: nh }));
        return (
          <SessionWindow
            key={w.sessionId}
            projectId={projectId}
            session={session}
            x={w.x}
            y={w.y}
            w={w.w}
            h={w.h}
            zIndex={w.z}
            intent={w.intent}
            intentNonce={w.intentNonce}
            neighbors={neighborGeoms}
            onClose={() => close(w.sessionId)}
            onFocus={() => focus(w.sessionId)}
            onMinimize={() => minimize(w.sessionId)}
            onGeometryChange={(geom) => updateGeometry(w.sessionId, geom)}
            sendMessage={sendMessage}
            subscribeBinary={subscribeBinary}
            onEvent={onEvent}
          />
        );
      })}
      {minimizedWindows.length > 0 && createPortal(
        <div
          style={{
            position: 'fixed',
            bottom: 8,
            left: 8,
            display: 'flex',
            gap: 6,
            zIndex: 900,
            maxWidth: 'calc(100vw - 16px)',
            flexWrap: 'wrap',
          }}
        >
          {minimizedWindows.map((w) => {
            const session = sessions.find((s) => s.id === w.sessionId);
            if (!session) return null;
            return (
              <div
                key={w.sessionId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: CMD.titleBg,
                  border: `1px solid ${CMD.separator}`,
                  borderRadius: 6,
                  padding: '4px 6px 4px 10px',
                  fontFamily: CMD_FONT,
                  fontSize: 12,
                  color: CMD.titleText,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
                  maxWidth: 220,
                  userSelect: 'none',
                }}
                onClick={() => restore(w.sessionId)}
                title={session.title}
              >
                <span style={{ color: CMD.info, fontWeight: 600, letterSpacing: 1 }} aria-hidden>{'>_'}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {session.title}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); close(w.sessionId); }}
                  aria-label="close"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: CMD.titleText,
                    cursor: 'pointer',
                    padding: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 3,
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </SessionWindowsContext.Provider>
  );
}
