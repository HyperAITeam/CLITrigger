// Portal-rendered swatch popover used by the sidebar workspace items.
// Right-click a project → pick a tag color. Reset removes the explicit
// color so the project falls back to the id-hashed palette default.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from '../types';
import { PROJECT_COLOR_PALETTE, resolveProjectColor } from '../lib/projectColor';

interface ProjectColorPickerProps {
  project: Project;
  anchorX: number;
  anchorY: number;
  onPick: (color: string | null) => void;
  onClose: () => void;
}

const POPOVER_WIDTH = 192;
const POPOVER_HEIGHT = 88;
const VIEWPORT_MARGIN = 8;

export default function ProjectColorPicker({ project, anchorX, anchorY, onPick, onClose }: ProjectColorPickerProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: anchorX, top: anchorY });
  const current = resolveProjectColor(project);

  useLayoutEffect(() => {
    const left = Math.min(
      Math.max(anchorX, VIEWPORT_MARGIN),
      window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN,
    );
    const top = Math.min(
      Math.max(anchorY, VIEWPORT_MARGIN),
      window.innerHeight - POPOVER_HEIGHT - VIEWPORT_MARGIN,
    );
    setPos({ left, top });
  }, [anchorX, anchorY]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={popoverRef}
      role="menu"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width: POPOVER_WIDTH,
        zIndex: 1000,
        background: 'var(--color-bg-elevated, #1f1f23)',
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        padding: 10,
        boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        {PROJECT_COLOR_PALETTE.map((c) => {
          const selected = project.color
            ? c.toLowerCase() === project.color.toLowerCase()
            : c === current && !project.color;
          return (
            <button
              key={c}
              onClick={() => onPick(c)}
              aria-label={c}
              style={{
                width: 20, height: 20, borderRadius: 6,
                background: c,
                border: selected ? '2px solid var(--color-text-primary)' : '2px solid transparent',
                cursor: 'pointer',
                padding: 0,
              }}
            />
          );
        })}
      </div>
      <button
        onClick={() => onPick(null)}
        style={{
          width: '100%',
          background: 'transparent',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-tertiary)',
          padding: '4px 8px',
          borderRadius: 6,
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        자동 색 (기본값)
      </button>
    </div>,
    document.body,
  );
}
