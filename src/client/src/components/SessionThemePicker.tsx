// Per-session terminal theme picker. Renders a palette button in the stack
// header; clicking opens a portal-rendered popover with brand presets and a
// custom color editor. State is stored via useSessionTheme (localStorage),
// so changes propagate to the live SessionTerminal via xterm.js's
// term.options.theme reassignment.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Palette } from 'lucide-react';
import { useSessionTheme, type CustomThemeColors, type SessionThemeId } from '../hooks/useSessionTheme';
import { CMD, CMD_FONT } from './terminal-theme';
import {
  PRESET_IDS,
  TERMINAL_PRESETS,
  type TerminalPreset,
} from '../lib/terminal-presets';

interface SessionThemePickerProps {
  sessionId: string;
}

const POPOVER_WIDTH = 340;

export default function SessionThemePicker({ sessionId }: SessionThemePickerProps) {
  const [state, , setState] = useSessionTheme(sessionId);
  const [open, setOpen] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

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
    } else {
      if (left < 8) left = 8;
    }
    setPos({ top, left });
    setPositioned(true);
  }, []);

  useEffect(() => {
    if (!open) { setPositioned(false); return; }
    updatePos();
    const raf = requestAnimationFrame(updatePos);
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
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, updatePos]);

  const selectPreset = (id: SessionThemeId) => {
    if (id === 'custom') {
      // Seed custom from default if unset so the pickers have starting values.
      const seedCustom: CustomThemeColors = state.custom ?? {
        background: TERMINAL_PRESETS.default.theme.background,
        foreground: TERMINAL_PRESETS.default.theme.foreground,
        cursor: TERMINAL_PRESETS.default.theme.cursor,
        selectionBackground: TERMINAL_PRESETS.default.theme.selectionBackground,
        accent: TERMINAL_PRESETS.default.theme.brightBlue,
      };
      setState({ presetId: 'custom', custom: seedCustom });
    } else {
      setState({ presetId: id, custom: state.custom });
    }
  };

  const updateCustom = (patch: Partial<CustomThemeColors>) => {
    const next: CustomThemeColors = { ...(state.custom ?? {}), ...patch };
    setState({ presetId: 'custom', custom: next });
  };

  return (
    <>
      <button
        ref={btnRef}
        data-no-drag
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        aria-label="terminal-theme"
        title="Terminal theme"
        style={{
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
        }}
      >
        <Palette size={13} />
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: POPOVER_WIDTH,
            zIndex: 9999,
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
          <div style={{ fontSize: 10, color: CMD.dim, marginBottom: 6, letterSpacing: 0.5 }}>
            PRESETS
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 6,
              marginBottom: 10,
            }}
          >
            {PRESET_IDS.map((id) => (
              <PresetCard
                key={id}
                preset={TERMINAL_PRESETS[id]}
                selected={state.presetId === id}
                onClick={() => selectPreset(id)}
              />
            ))}
            <CustomCard
              selected={state.presetId === 'custom'}
              accent={state.custom?.accent ?? TERMINAL_PRESETS.default.theme.brightBlue ?? '#569cd6'}
              onClick={() => selectPreset('custom')}
            />
          </div>

          {state.presetId === 'custom' && (
            <div style={{ borderTop: `1px solid ${CMD.separator}`, paddingTop: 8 }}>
              <div style={{ fontSize: 10, color: CMD.dim, marginBottom: 6, letterSpacing: 0.5 }}>
                CUSTOM COLORS
              </div>
              <ColorRow
                label="Background"
                value={state.custom?.background ?? TERMINAL_PRESETS.default.theme.background ?? '#0c0c0c'}
                onChange={(v) => updateCustom({ background: v })}
              />
              <ColorRow
                label="Foreground"
                value={state.custom?.foreground ?? TERMINAL_PRESETS.default.theme.foreground ?? '#cccccc'}
                onChange={(v) => updateCustom({ foreground: v })}
              />
              <ColorRow
                label="Cursor"
                value={state.custom?.cursor ?? TERMINAL_PRESETS.default.theme.cursor ?? '#f2f2f2'}
                onChange={(v) => updateCustom({ cursor: v })}
              />
              <ColorRow
                label="Selection"
                value={state.custom?.selectionBackground ?? TERMINAL_PRESETS.default.theme.selectionBackground ?? '#264f78'}
                onChange={(v) => updateCustom({ selectionBackground: v })}
              />
              <ColorRow
                label="Accent"
                value={state.custom?.accent ?? TERMINAL_PRESETS.default.theme.brightBlue ?? '#569cd6'}
                onChange={(v) => updateCustom({ accent: v })}
              />
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function PresetCard({
  preset,
  selected,
  onClick,
}: {
  preset: TerminalPreset;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        position: 'relative',
        background: preset.theme.background,
        border: `1px solid ${selected ? preset.accent : CMD.separator}`,
        outline: selected ? `1px solid ${preset.accent}` : 'none',
        outlineOffset: -2,
        borderRadius: 4,
        padding: '6px 8px',
        cursor: 'pointer',
        fontFamily: CMD_FONT,
        fontSize: 10,
        color: preset.theme.foreground,
        textAlign: 'left',
        height: 52,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: preset.accent,
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 600, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {preset.name}
        </span>
        {selected && <Check size={10} style={{ marginLeft: 'auto', flexShrink: 0 }} />}
      </div>
      <div style={{ fontSize: 9, opacity: 0.85, fontFamily: CMD_FONT }}>
        <span style={{ color: preset.theme.green }}>$</span>{' '}
        <span style={{ color: preset.theme.brightBlue }}>ls</span>
      </div>
    </button>
  );
}

function CustomCard({
  selected,
  accent,
  onClick,
}: {
  selected: boolean;
  accent: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        position: 'relative',
        background: '#0c0c0c',
        border: `1px dashed ${selected ? accent : CMD.separator}`,
        outline: selected ? `1px solid ${accent}` : 'none',
        outlineOffset: -2,
        borderRadius: 4,
        padding: '6px 8px',
        cursor: 'pointer',
        fontFamily: CMD_FONT,
        fontSize: 10,
        color: CMD.text,
        textAlign: 'left',
        height: 52,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: accent,
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 600, fontSize: 11 }}>Custom</span>
        {selected && <Check size={10} style={{ marginLeft: 'auto', flexShrink: 0 }} />}
      </div>
      <div style={{ fontSize: 9, opacity: 0.7 }}>edit colors</div>
    </button>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 0',
        fontSize: 11,
        color: CMD.text,
      }}
    >
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ color: CMD.dim, fontSize: 10, fontFamily: CMD_FONT }}>{value}</span>
      <input
        type="color"
        value={normalizeHex(value)}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 28,
          height: 22,
          padding: 0,
          border: `1px solid ${CMD.separator}`,
          borderRadius: 3,
          background: 'transparent',
          cursor: 'pointer',
        }}
      />
    </label>
  );
}

// <input type="color"> only accepts #RRGGBB (no alpha, no shorthand).
// Coerce arbitrary CSS colors back to a 6-digit hex; fall back to black if
// we can't parse so the picker stays operable.
function normalizeHex(v: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return ('#' + v.slice(1).split('').map((c) => c + c).join('')).toLowerCase();
  }
  return '#000000';
}
