// Draggable separator between two siblings of a split node. The parent
// LayoutNodeView captures the container size at mousedown, then receives
// percent deltas during drag and applies them to the sibling pair's sizes.

import { useCallback } from 'react';
import { CMD } from '../terminal-theme';

interface SplitterProps {
  orientation: 'horizontal' | 'vertical';
  // Called continuously during drag with the cumulative pixel delta from the
  // mousedown position. Parent translates px → % based on its container size.
  onDragStart: () => void;
  onDrag: (deltaPx: number) => void;
  onDragEnd: () => void;
}

export default function Splitter({ orientation, onDragStart, onDrag, onDragEnd }: SplitterProps) {
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    onDragStart();
    const onMove = (ev: MouseEvent) => {
      const delta = orientation === 'horizontal' ? ev.clientX - startX : ev.clientY - startY;
      onDrag(delta);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      onDragEnd();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [orientation, onDragStart, onDrag, onDragEnd]);

  const isHoriz = orientation === 'horizontal';
  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        flex: '0 0 4px',
        background: CMD.separator,
        cursor: isHoriz ? 'col-resize' : 'row-resize',
        position: 'relative',
        zIndex: 1,
      }}
    />
  );
}
