import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MemoryNode } from '../types';

interface WikilinkAutocompleteProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  nodes: MemoryNode[];
  onChange: (next: string) => void;
}

interface TriggerState {
  /** Position in the textarea where the trigger token starts (`[[` or `@`). */
  start: number;
  /** Cursor position (exclusive end of query). */
  cursor: number;
  /** Trigger style — affects what we strip when inserting. */
  trigger: '[[' | '@';
  /** Current query (text after the trigger up to the cursor). */
  query: string;
}

const MAX_RESULTS = 8;

export default function WikilinkAutocomplete({ textareaRef, value, nodes, onChange }: WikilinkAutocompleteProps) {
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [popupPos, setPopupPos] = useState<{ left: number; top: number } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Detect trigger on every value change / cursor move
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) { setTrigger(null); return; }
    const cursor = el.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    // Look back for either `[[` or `@`. Take whichever is closer to cursor without
    // a closing `]]` in between.
    const lastBracket = before.lastIndexOf('[[');
    const lastAt = before.lastIndexOf('@');
    let chosen: { trigger: '[[' | '@'; idx: number } | null = null;
    if (lastBracket !== -1) {
      const between = before.slice(lastBracket + 2);
      if (!between.includes(']]') && !between.includes('\n')) {
        chosen = { trigger: '[[', idx: lastBracket };
      }
    }
    if (lastAt !== -1) {
      const between = before.slice(lastAt + 1);
      const beforeAt = lastAt > 0 ? before[lastAt - 1] : '';
      const validBoundary = !beforeAt || /\s/.test(beforeAt);
      if (validBoundary && !/[\s\]]/.test(between) && between.length <= 60 && (chosen == null || lastAt > chosen.idx)) {
        chosen = { trigger: '@', idx: lastAt };
      }
    }
    if (!chosen) { setTrigger(null); return; }
    const queryStart = chosen.idx + (chosen.trigger === '[[' ? 2 : 1);
    const query = before.slice(queryStart);
    if (chosen.trigger === '[[' && query === '') {
      // Empty `[[` — show full list
    }
    setTrigger({ start: chosen.idx, cursor, trigger: chosen.trigger, query });
    setHighlight(0);
  }, [value, textareaRef]);

  const matches = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    const filtered = q
      ? nodes.filter(n => n.title.toLowerCase().includes(q))
      : nodes.slice();
    return filtered.slice(0, MAX_RESULTS);
  }, [trigger, nodes]);

  // Position popup near the cursor using a hidden mirror div
  useLayoutEffect(() => {
    if (!trigger) { setPopupPos(null); return; }
    const ta = textareaRef.current;
    if (!ta) return;
    const rect = ta.getBoundingClientRect();
    const coords = caretCoordinates(ta, trigger.cursor);
    const VIEW_PADDING = 8;
    let left = rect.left + coords.left - ta.scrollLeft;
    let top = rect.top + coords.top + coords.height - ta.scrollTop + 2;
    // Clamp horizontally
    const popupWidth = 280;
    if (left + popupWidth > window.innerWidth - VIEW_PADDING) {
      left = window.innerWidth - popupWidth - VIEW_PADDING;
    }
    if (left < VIEW_PADDING) left = VIEW_PADDING;
    // Flip above if no room below
    const popupHeight = Math.min(280, matches.length * 36 + 40);
    if (top + popupHeight > window.innerHeight - VIEW_PADDING) {
      top = rect.top + coords.top - ta.scrollTop - popupHeight - 4;
    }
    if (top < VIEW_PADDING) top = VIEW_PADDING;
    setPopupPos({ left, top });
  }, [trigger, matches.length, textareaRef]);

  // Recompute on scroll/resize
  useEffect(() => {
    if (!trigger) return;
    const handler = () => setTrigger(t => (t ? { ...t } : t));
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [trigger]);

  // Keyboard navigation while popup is open
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta || !trigger || matches.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (!trigger || matches.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight(h => (h + 1) % matches.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight(h => (h - 1 + matches.length) % matches.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insert(matches[highlight].title);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setTrigger(null);
      }
    };
    ta.addEventListener('keydown', onKey);
    return () => ta.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, matches, highlight]);

  const insert = (title: string) => {
    if (!trigger) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const before = value.slice(0, trigger.start);
    const after = value.slice(trigger.cursor);
    const link = `[[${title}]]`;
    const next = `${before}${link}${after}`;
    onChange(next);
    setTrigger(null);
    // Restore caret after insertion
    setTimeout(() => {
      ta.focus();
      const pos = before.length + link.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  };

  if (!trigger || matches.length === 0 || !popupPos) return null;

  return createPortal(
    <div
      ref={popupRef}
      className="fixed z-tooltip rounded-lg border border-warm-300 bg-warm-50 shadow-lg overflow-hidden"
      style={{ left: popupPos.left, top: popupPos.top, width: 280 }}
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-warm-500 border-b border-warm-200">
        {trigger.trigger === '@' ? '@mention' : 'wikilink'} · {trigger.query || '…'}
      </div>
      <ul className="max-h-[240px] overflow-y-auto">
        {matches.map((n, i) => (
          <li key={n.id}>
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); insert(n.title); }}
              onMouseEnter={() => setHighlight(i)}
              className={`w-full text-left px-2.5 py-1.5 text-sm ${i === highlight ? 'bg-warm-200 text-warm-900' : 'text-warm-700 hover:bg-warm-100'}`}
            >
              <div className="truncate">{n.title}</div>
              {n.body && (
                <div className="truncate text-[11px] text-warm-500">
                  {n.body.replace(/\s+/g, ' ').slice(0, 60)}
                </div>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}

// ── Caret coordinates helper ──
// Adapted from textarea-caret-position (MIT) — minimal version for our needs.
const MIRROR_PROPS = [
  'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderStyle',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch',
  'fontSize', 'fontSizeAdjust', 'lineHeight', 'fontFamily',
  'textAlign', 'textTransform', 'textIndent', 'textDecoration',
  'letterSpacing', 'wordSpacing',
  'tabSize',
] as const;

function caretCoordinates(el: HTMLTextAreaElement, pos: number): { left: number; top: number; height: number } {
  const div = document.createElement('div');
  div.id = '__wikilink-mirror';
  document.body.appendChild(div);
  const style = div.style;
  const computed = window.getComputedStyle(el);
  style.position = 'absolute';
  style.visibility = 'hidden';
  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';
  style.top = '0';
  style.left = '-9999px';
  for (const prop of MIRROR_PROPS) {
    style[prop as any] = computed[prop as any];
  }
  div.textContent = el.value.slice(0, pos);
  const span = document.createElement('span');
  span.textContent = el.value.slice(pos) || '.';
  div.appendChild(span);
  const coords = {
    top: span.offsetTop,
    left: span.offsetLeft,
    height: parseInt(computed.lineHeight || '16', 10) || 16,
  };
  document.body.removeChild(div);
  return coords;
}
