import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FolderInput } from 'lucide-react';
import type { Project } from '../types';
import { useI18n } from '../i18n';

interface MoveToPlannerButtonProps {
  projects: Project[];
  onMove: (projectId: string) => void | Promise<void>;
  title: string; // tooltip + menu header (e.g. "Move to planner")
}

// A small hover-reveal button that opens a portal dropdown listing projects;
// picking one moves/imports the item into that project's planner.
export default function MoveToPlannerButton({ projects, onMove, title }: MoveToPlannerButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let top = r.bottom + 4;
    const drop = dropRef.current;
    if (drop) {
      const dw = drop.offsetWidth, dh = drop.offsetHeight;
      let left = r.right - dw;
      if (left < 8) left = 8;
      if (left + dw > vw - 8) left = vw - 8 - dw;
      if (top + dh > vh - 8) top = r.top - dh - 4;
      setPos({ top, left });
      setPositioned(true);
    } else {
      setPos({ top, left: Math.max(8, r.right - 180) });
    }
  }, []);

  useEffect(() => {
    if (!open) { setPositioned(false); return; }
    updatePos();
    const raf = requestAnimationFrame(updatePos);
    const close = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (btnRef.current?.contains(tgt) || dropRef.current?.contains(tgt)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, updatePos]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
        title={title}
      >
        <FolderInput size={13} style={{ color: 'var(--color-text-muted)' }} />
      </button>
      {open && createPortal(
        <div
          ref={dropRef}
          className={`fixed z-tooltip min-w-[180px] max-h-[280px] overflow-auto rounded-xl py-1 shadow-elevated${positioned ? ' animate-scale-in' : ''}`}
          style={{ top: pos.top, left: pos.left, opacity: positioned ? 1 : 0, backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
        >
          <div className="px-3 py-1 text-2xs uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{title}</div>
          {projects.length === 0 && (
            <div className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('agenda.noProjects')}</div>
          )}
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={(e) => { e.stopPropagation(); setOpen(false); onMove(p.id); }}
              className="block w-full px-3 py-1.5 text-xs text-left hover:bg-warm-100 rounded-md transition-colors truncate"
              style={{ color: 'var(--color-text-primary)' }}
              title={p.name}
            >
              {p.name}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
