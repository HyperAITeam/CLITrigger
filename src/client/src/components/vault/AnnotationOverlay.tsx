import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

export type AnnotationTool = 'pen' | 'highlighter' | 'eraser';

export interface AnnotationOverlayState {
  canUndo: boolean;
  canRedo: boolean;
}

export interface AnnotationOverlayHandle {
  clearAll: () => void;
  hasStrokes: () => boolean;
  undo: () => void;
  redo: () => void;
}

interface Point { x: number; y: number }
interface Stroke { id: string; tool: 'pen' | 'highlighter'; points: Point[] }

interface Props {
  enabled: boolean;
  tool: AnnotationTool;
  onStateChange?: (state: AnnotationOverlayState) => void;
}

const STROKE_COLOR = '#dc2626';
const ERASER_RADIUS = 8;

function pointsToPath(points: Point[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return `M ${first.x} ${first.y}` + rest.map(p => ` L ${p.x} ${p.y}`).join('');
}

function distSq(a: Point, b: Point): number {
  const dx = a.x - b.x; const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function strokeHitsPoint(stroke: Stroke, p: Point, radiusSq: number): boolean {
  for (const sp of stroke.points) {
    if (distSq(sp, p) <= radiusSq) return true;
  }
  return false;
}

export const AnnotationOverlay = forwardRef<AnnotationOverlayHandle, Props>(
  function AnnotationOverlay({ enabled, tool, onStateChange }, ref) {
    const [strokes, setStrokes] = useState<Stroke[]>([]);
    const [past, setPast] = useState<Stroke[][]>([]);
    const [future, setFuture] = useState<Stroke[][]>([]);
    const [current, setCurrent] = useState<Point[] | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const lastMoveRef = useRef<number>(0);
    const eraseStartRef = useRef<Stroke[] | null>(null);
    const strokesRef = useRef<Stroke[]>(strokes);
    strokesRef.current = strokes;

    useEffect(() => {
      onStateChange?.({ canUndo: past.length > 0, canRedo: future.length > 0 });
    }, [past.length, future.length, onStateChange]);

    useImperativeHandle(ref, () => ({
      clearAll: () => {
        setCurrent(null);
        eraseStartRef.current = null;
        if (strokesRef.current.length === 0) return;
        setPast(p => [...p, strokesRef.current]);
        setStrokes([]);
        setFuture([]);
      },
      hasStrokes: () => strokesRef.current.length > 0,
      undo: () => {
        setCurrent(null);
        eraseStartRef.current = null;
        setPast(p => {
          if (p.length === 0) return p;
          const prev = p[p.length - 1];
          setFuture(f => [...f, strokesRef.current]);
          setStrokes(prev);
          return p.slice(0, -1);
        });
      },
      redo: () => {
        setCurrent(null);
        eraseStartRef.current = null;
        setFuture(f => {
          if (f.length === 0) return f;
          const next = f[f.length - 1];
          setPast(p => [...p, strokesRef.current]);
          setStrokes(next);
          return f.slice(0, -1);
        });
      },
    }), []);

    const toLocal = useCallback((e: React.PointerEvent): Point => {
      const rect = svgRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }, []);

    const eraseAt = useCallback((p: Point) => {
      const r2 = ERASER_RADIUS * ERASER_RADIUS;
      setStrokes(prev => {
        const filtered = prev.filter(s => !strokeHitsPoint(s, p, r2));
        if (filtered.length !== prev.length && eraseStartRef.current === null) {
          eraseStartRef.current = prev;
        }
        return filtered;
      });
    }, []);

    const onPointerDown = useCallback((e: React.PointerEvent) => {
      if (!enabled) return;
      if (e.button !== 0) return;
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      const p = toLocal(e);
      if (tool === 'eraser') {
        eraseStartRef.current = null;
        eraseAt(p);
      } else {
        setCurrent([p]);
      }
    }, [enabled, tool, toLocal, eraseAt]);

    const onPointerMove = useCallback((e: React.PointerEvent) => {
      if (!enabled) return;
      const now = performance.now();
      if (now - lastMoveRef.current < 16) return;
      lastMoveRef.current = now;
      if (tool === 'eraser') {
        if (e.buttons & 1) eraseAt(toLocal(e));
        return;
      }
      if (current === null) return;
      const p = toLocal(e);
      setCurrent(prev => prev ? [...prev, p] : [p]);
    }, [enabled, tool, current, toLocal, eraseAt]);

    const finishStroke = useCallback(() => {
      if (tool === 'eraser') {
        if (eraseStartRef.current !== null) {
          const snapshot = eraseStartRef.current;
          eraseStartRef.current = null;
          setPast(p => [...p, snapshot]);
          setFuture([]);
        }
        setCurrent(null);
        return;
      }
      if (current === null || current.length === 0) { setCurrent(null); return; }
      const stroke: Stroke = {
        id: `s${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        tool,
        points: current,
      };
      setPast(p => [...p, strokesRef.current]);
      setStrokes(prev => [...prev, stroke]);
      setFuture([]);
      setCurrent(null);
    }, [current, tool]);

    const onPointerUp = useCallback(() => { finishStroke(); }, [finishStroke]);
    const onPointerCancel = useCallback(() => {
      setCurrent(null);
      eraseStartRef.current = null;
    }, []);

    return (
      <svg
        ref={svgRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: enabled ? 'auto' : 'none',
          cursor: !enabled ? 'default' : tool === 'eraser' ? 'cell' : 'crosshair',
          touchAction: enabled ? 'none' : 'auto',
          zIndex: 1,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {strokes.map(s => (
          <path
            key={s.id}
            d={pointsToPath(s.points)}
            stroke={STROKE_COLOR}
            strokeWidth={s.tool === 'highlighter' ? 14 : 2}
            opacity={s.tool === 'highlighter' ? 0.4 : 1}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {current && current.length > 0 && tool !== 'eraser' && (
          <path
            d={pointsToPath(current)}
            stroke={STROKE_COLOR}
            strokeWidth={tool === 'highlighter' ? 14 : 2}
            opacity={tool === 'highlighter' ? 0.4 : 1}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    );
  },
);
