// Titlebar palette that lets the user pick a saved command snippet (alias)
// and insert it into the active session's PTY as terminal input. Enter is
// NOT submitted — the user reviews/edits and presses Enter themselves.
//
// Works for every session type (claude/antigravity/codex/raw-shell): the alias
// is just text routed through the same WS path xterm.js uses for typed
// keystrokes (`session:terminal-input`). The server's WS handler already
// gates that path on session.status === 'running' so clicks against a
// stopped session silently no-op.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Command, Plus, X } from 'lucide-react';
import { CMD, CMD_FONT } from './terminal-theme';
import * as aliasesApi from '../api/sessionAliases';
import type { SessionAlias } from '../types';

interface SessionAliasInserterProps {
  sessionId: string;
  sendMessage: (event: object) => void;
}

const POPOVER_WIDTH = 360;

export default function SessionAliasInserter({ sessionId, sendMessage }: SessionAliasInserterProps) {
  const [open, setOpen] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [aliases, setAliases] = useState<SessionAlias[] | null>(null);
  const [filter, setFilter] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCmd, setNewCmd] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pop = popRef.current;
    let top = r.bottom + 4;
    let left = r.right - POPOVER_WIDTH;
    if (pop) {
      const dh = pop.offsetHeight;
      const dw = pop.offsetWidth;
      left = r.right - dw;
      if (left < 8) left = 8;
      if (left + dw > vw - 8) left = vw - 8 - dw;
      if (top + dh > vh - 8) top = Math.max(8, r.top - dh - 4);
    } else if (left < 8) left = 8;
    setPos({ top, left });
    setPositioned(true);
  }, []);

  // Load aliases on first open and whenever the popover re-opens — keeps the
  // list fresh if the user added one via Settings since the last view.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    aliasesApi.getSessionAliases()
      .then((list) => { if (!cancelled) setAliases(list); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load'); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) { setPositioned(false); return; }
    updatePos();
    const raf = requestAnimationFrame(updatePos);
    // Focus the search input as soon as the popover renders. Two RAFs so the
    // portal node + autoFocus race is settled before we override.
    const focusRaf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => searchRef.current?.focus());
    });
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(focusRaf1);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, updatePos]);

  // Reset transient state when the popover closes.
  useEffect(() => {
    if (open) return;
    setFilter('');
    setAddOpen(false);
    setNewName('');
    setNewCmd('');
    setError(null);
  }, [open]);

  const filtered = useMemo(() => {
    if (!aliases) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return aliases;
    return aliases.filter(
      (a) => a.name.toLowerCase().includes(q) || a.command_template.toLowerCase().includes(q),
    );
  }, [aliases, filter]);

  const insertAlias = (alias: SessionAlias) => {
    sendMessage({ type: 'session:terminal-input', sessionId, input: alias.command_template });
    setOpen(false);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      insertAlias(filtered[0]);
    }
  };

  const canSubmitNew = !!newName.trim() && !!newCmd.trim() && !saving;

  const handleQuickAdd = async () => {
    if (!canSubmitNew) return;
    setSaving(true);
    setError(null);
    try {
      const alias = await aliasesApi.createSessionAlias({
        name: newName.trim(),
        command_template: newCmd.trim(),
      });
      setAliases((prev) => (prev ? [alias, ...prev] : [alias]));
      setNewName('');
      setNewCmd('');
      setAddOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        data-no-drag
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        aria-label="alias-inserter"
        title="Insert saved command (alias) (Ctrl+Shift+A)"
        style={btnStyle}
      >
        <Command size={13} />
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          className="z-tooltip"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: POPOVER_WIDTH,
            background: '#1e1e1e',
            border: `1px solid ${CMD.separator}`,
            borderRadius: 6,
            padding: 10,
            fontFamily: CMD_FONT,
            color: CMD.text,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            opacity: positioned ? 1 : 0,
            transition: 'opacity 80ms',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            ref={searchRef}
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Filter aliases… (Enter inserts first match)"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: '#0c0c0c',
              border: `1px solid ${CMD.separator}`,
              borderRadius: 4,
              color: CMD.bright,
              fontFamily: CMD_FONT,
              fontSize: 11,
              padding: '6px 8px',
              outline: 'none',
            }}
          />

          <div style={{ marginTop: 8, maxHeight: 280, overflowY: 'auto' }}>
            {aliases === null ? (
              <div style={emptyStyle}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={emptyStyle}>
                {aliases.length === 0 ? 'No aliases yet — add one below.' : 'No matches.'}
              </div>
            ) : (
              filtered.map((a) => (
                <button
                  key={a.id}
                  onClick={() => insertAlias(a)}
                  style={rowStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  title={`Insert: ${a.command_template}`}
                >
                  <span style={{ fontSize: 11, color: CMD.bright, fontWeight: 600 }}>{a.name}</span>
                  <code style={{ fontSize: 10, color: CMD.dim, marginLeft: 8, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.command_template}
                  </code>
                </button>
              ))
            )}
          </div>

          <div style={{ borderTop: `1px solid ${CMD.separator}`, marginTop: 8, paddingTop: 8 }}>
            {addOpen ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Name (e.g. git status)"
                  maxLength={64}
                  style={inputStyle}
                />
                <input
                  type="text"
                  value={newCmd}
                  onChange={(e) => setNewCmd(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleQuickAdd(); } }}
                  placeholder="Command (e.g. git status -sb)"
                  maxLength={1024}
                  style={{ ...inputStyle, fontFamily: CMD_FONT }}
                />
                {error && <div style={{ fontSize: 10, color: '#f87171' }}>{error}</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => { setAddOpen(false); setError(null); }}
                    style={ghostBtnStyle}
                  >
                    <X size={10} /> Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleQuickAdd}
                    disabled={!canSubmitNew}
                    style={{ ...primaryBtnStyle, opacity: canSubmitNew ? 1 : 0.5 }}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setAddOpen(true); setError(null); }}
                style={addBtnStyle}
              >
                <Plus size={12} /> New alias
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: CMD.titleText,
  cursor: 'pointer',
  padding: '0 6px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 0,
  flexShrink: 0,
  height: '100%',
};

const emptyStyle: React.CSSProperties = {
  fontSize: 11,
  color: CMD.dim,
  padding: '12px 4px',
  textAlign: 'center',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  background: 'transparent',
  border: 'none',
  padding: '6px 8px',
  cursor: 'pointer',
  textAlign: 'left',
  borderRadius: 3,
  transition: 'background 80ms',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: '#0c0c0c',
  border: `1px solid ${CMD.separator}`,
  borderRadius: 4,
  color: CMD.bright,
  fontSize: 11,
  padding: '5px 7px',
  outline: 'none',
};

const ghostBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  background: 'transparent',
  border: `1px solid ${CMD.separator}`,
  color: CMD.dim,
  fontFamily: CMD_FONT,
  fontSize: 10,
  padding: '3px 8px',
  borderRadius: 4,
  cursor: 'pointer',
};

const primaryBtnStyle: React.CSSProperties = {
  ...ghostBtnStyle,
  background: 'rgba(86,156,214,0.13)',
  border: `1px solid #569cd6`,
  color: CMD.bright,
};

const addBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'transparent',
  border: 'none',
  color: CMD.dim,
  fontFamily: CMD_FONT,
  fontSize: 11,
  padding: '4px 0',
  cursor: 'pointer',
};
