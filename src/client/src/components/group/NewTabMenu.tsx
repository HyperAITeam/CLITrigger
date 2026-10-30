// "▾" next to the tab bar's "+": pick which shell or AI CLI the new tab runs
// (Windows Terminal style). Shells come from the server's detected list.

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useI18n } from '../../i18n';
import { CMD, CMD_FONT } from '../terminal-theme';
import { AnchoredPopover } from '../AnchoredPopover';
import { CLI_TOOLS, type CliTool } from '../../cli-tools';
import { getCliStatus, getShells, type CliToolStatus, type ShellOption } from '../../api/cli-status';

export interface NewTabKind {
  cliTool: CliTool;
  shell?: string;
  label: string;
}

const AI_TOOLS = CLI_TOOLS.filter((tool) => tool.value !== 'raw-shell');

export default function NewTabMenu({ onPick }: { onPick: (kind: NewTabKind) => void }) {
  const { t } = useI18n();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [shells, setShells] = useState<ShellOption[]>([]);
  const [statuses, setStatuses] = useState<CliToolStatus[]>([]);

  useEffect(() => {
    if (!open) return;
    getShells().then(setShells).catch(() => { /* menu still offers AI CLIs */ });
    getCliStatus().then(setStatuses).catch(() => { /* treat all as installed */ });
  }, [open]);

  const pick = (kind: NewTabKind) => {
    setOpen(false);
    onPick(kind);
  };

  const itemStyle: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left',
    background: 'transparent', border: 'none', borderRadius: 4,
    padding: '6px 10px', fontFamily: CMD_FONT, fontSize: 12, color: CMD.text, cursor: 'pointer',
  };
  const hover = (e: React.MouseEvent<HTMLButtonElement>, on: boolean) => {
    if (!e.currentTarget.disabled) e.currentTarget.style.background = on ? '#2d2d2d' : 'transparent';
  };

  return (
    <>
      <button
        ref={buttonRef}
        data-no-drag
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        aria-label="new-tab-menu"
        title={t('group.newTabMenu')}
        style={{
          background: 'transparent', border: 'none', borderRight: `1px solid ${CMD.separator}`,
          color: CMD.titleText, cursor: 'pointer', padding: '0 4px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, height: '100%',
        }}
      >
        <ChevronDown size={12} />
      </button>
      {open && (
        <AnchoredPopover
          anchorRef={buttonRef}
          width={220}
          onClose={() => setOpen(false)}
          className="z-tooltip"
          style={{
            background: '#1e1e1e', border: `1px solid ${CMD.separator}`, borderRadius: 6,
            padding: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
        >
          {/* Portal events still bubble through React ancestors — keep them
              away from the window's chrome-drag mousedown handler. */}
          <div onMouseDown={(e) => e.stopPropagation()}>
            {shells.map((shell) => (
              <button
                key={shell.id}
                style={itemStyle}
                onMouseEnter={(e) => hover(e, true)}
                onMouseLeave={(e) => hover(e, false)}
                onClick={() => pick({ cliTool: 'raw-shell', shell: shell.id, label: shell.name })}
              >
                {shell.name}
              </button>
            ))}
            {shells.length > 0 && <div style={{ height: 1, background: CMD.separator, margin: '4px 0' }} />}
            {AI_TOOLS.map((tool) => {
              const installed = statuses.find((s) => s.tool === tool.value)?.installed ?? true;
              return (
                <button
                  key={tool.value}
                  disabled={!installed}
                  style={{ ...itemStyle, color: installed ? CMD.text : CMD.dim, cursor: installed ? 'pointer' : 'default' }}
                  onMouseEnter={(e) => hover(e, true)}
                  onMouseLeave={(e) => hover(e, false)}
                  onClick={() => pick({ cliTool: tool.value, label: tool.label })}
                >
                  {tool.label}{installed ? '' : t('session.cliNotInstalled')}
                </button>
              );
            })}
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}
