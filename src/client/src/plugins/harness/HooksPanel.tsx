import { useState, useEffect } from 'react';
import { Pencil } from 'lucide-react';
import { useI18n } from '../../i18n';
import Button from '../../components/Button';

interface HooksPanelProps {
  // Raw hooks block from .claude/settings.json. Undefined → no hooks key.
  hooks: Record<string, unknown> | undefined;
  // Entries parked in .claude/hooks.disabled.json, same shape as `hooks`.
  disabledHooks: Record<string, unknown> | undefined;
  filePath: string;
  saving: boolean;
  onSave: (hooks: Record<string, unknown> | null) => Promise<void>;
  // index refers to hooks[event] when enabled=false, disabledHooks[event] when enabled=true.
  // Named mode: event is the hook name and index is unused.
  onToggle: (event: string, index: number, enabled: boolean) => Promise<void>;
  // Antigravity shape: { hookName: { enabled?, EventName: [...] } }, toggled per name.
  named?: boolean;
}

// Claude/Codex hooks shape (loosely): { EventName: [{ matcher?, hooks: [{ type, command }] }] }.
// Antigravity non-tool events list handlers ({ type, command }) directly.
// Rendered defensively — anything that doesn't match falls back to JSON text.
interface HookEntry {
  matcher?: string;
  command?: string;
  hooks?: Array<{ type?: string; command?: string }>;
  [k: string]: unknown;
}

function asEntries(value: unknown): HookEntry[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is HookEntry => typeof v === 'object' && v !== null);
}

export default function HooksPanel({ hooks, disabledHooks, filePath, saving, onSave, onToggle, named }: HooksPanelProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const events = Array.from(new Set([...Object.keys(hooks ?? {}), ...Object.keys(disabledHooks ?? {})]));
  const hasHooks = events.length > 0;
  const hasParked = Object.keys(disabledHooks ?? {}).length > 0;

  const renderCommands = (entry: HookEntry) => (
    <>
      {entry.matcher !== undefined && entry.matcher !== '' && (
        <span className="inline-block px-1.5 py-0.5 mr-1.5 rounded-md bg-warm-200/60 text-warm-600 font-mono">
          {entry.matcher}
        </span>
      )}
      {(entry.hooks ?? [entry]).map((h, j) => (
        <code key={j} className="block mt-0.5 px-2 py-1 rounded-md bg-theme-card border border-warm-150 text-warm-600 font-mono whitespace-pre-wrap break-all">
          {h.command ?? JSON.stringify(h)}
        </code>
      ))}
    </>
  );

  const renderEntry = (event: string, entry: HookEntry, index: number, enabled: boolean) => (
    <div key={`${enabled ? 'on' : 'off'}-${index}`} className="flex items-start gap-2 text-[11px]">
      <input
        type="checkbox"
        checked={enabled}
        disabled={saving}
        onChange={() => onToggle(event, index, !enabled)}
        title={enabled ? t('harness.toggle.disable') : t('harness.toggle.enable')}
        className="mt-0.5 flex-shrink-0 cursor-pointer"
      />
      <div className={`min-w-0 flex-1${enabled ? '' : ' opacity-50'}`}>{renderCommands(entry)}</div>
    </div>
  );

  const renderNamedGroup = (name: string) => {
    const value = hooks?.[name];
    const group = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const enabled = group.enabled !== false;
    return (
      <div key={name} className="p-2.5 bg-warm-50 border border-warm-150 rounded-lg">
        <label className="flex items-center gap-2 text-xs font-semibold text-warm-700 font-mono mb-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={() => onToggle(name, 0, !enabled)}
            title={enabled ? t('harness.toggle.disable') : t('harness.toggle.enable')}
            className="flex-shrink-0 cursor-pointer"
          />
          {name}
        </label>
        <div className={`space-y-1.5 text-[11px]${enabled ? '' : ' opacity-50'}`}>
          {Object.entries(group).filter(([key]) => key !== 'enabled').map(([event, entries]) => (
            <div key={event}>
              <span className="font-mono text-warm-500">{event}</span>
              {(asEntries(entries) ?? []).map((entry, i) => <div key={i}>{renderCommands(entry)}</div>)}
            </div>
          ))}
        </div>
      </div>
    );
  };

  useEffect(() => {
    setDraft(JSON.stringify(hooks ?? {}, null, 2));
    setJsonError(null);
  }, [hooks]);

  const handleSave = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch {
      setJsonError(t('harness.hooks.invalidJson') || 'Invalid JSON');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setJsonError(t('harness.hooks.invalidJson') || 'Invalid JSON');
      return;
    }
    setJsonError(null);
    const obj = parsed as Record<string, unknown>;
    // An emptied editor removes the hooks key from settings.json entirely.
    await onSave(Object.keys(obj).length === 0 ? null : obj);
    setEditing(false);
  };

  return (
    <div className="space-y-3 p-4 border border-warm-200 rounded-xl">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-warm-700">Hooks</h4>
        <div className="flex items-center gap-2 min-w-0">
          <code className="text-[10px] text-warm-400 truncate" title={filePath}>{filePath}</code>
          {!editing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(true)}
              className="flex-shrink-0"
            >
              <Pencil size={12} />
              {t('harness.hooks.editJson') || 'Edit JSON'}
            </Button>
          )}
        </div>
      </div>

      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="w-full h-64 px-3 py-2 text-xs font-mono leading-relaxed border border-warm-200 rounded-lg bg-warm-50 text-warm-700 focus:ring-1 focus:ring-accent focus:border-accent resize-y"
          />
          {jsonError && <p className="text-xs text-status-error">{jsonError}</p>}
          <div className="flex items-center gap-3">
            <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
              {saving ? t('harness.saving') : t('harness.save')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(JSON.stringify(hooks ?? {}, null, 2));
                setJsonError(null);
                setEditing(false);
              }}
            >
              {t('harness.cancel')}
            </Button>
          </div>
        </>
      ) : !hasHooks ? (
        <p className="text-xs text-warm-400">{t('harness.hooks.empty') || 'No hooks configured.'}</p>
      ) : named ? (
        <div className="space-y-2">{events.map(renderNamedGroup)}</div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => {
            const value = hooks?.[event];
            const entries = value === undefined ? [] : asEntries(value);
            const parked = asEntries(disabledHooks?.[event]) ?? [];
            return (
              <div key={event} className="p-2.5 bg-warm-50 border border-warm-150 rounded-lg">
                <div className="text-xs font-semibold text-warm-700 font-mono mb-1.5">{event}</div>
                <div className="space-y-1.5">
                  {entries ? (
                    entries.map((entry, i) => renderEntry(event, entry, i, true))
                  ) : (
                    <pre className="text-[11px] text-warm-500 font-mono whitespace-pre-wrap break-all">
                      {JSON.stringify(value, null, 2)}
                    </pre>
                  )}
                  {parked.map((entry, i) => renderEntry(event, entry, i, false))}
                </div>
              </div>
            );
          })}
          {hasParked && <p className="text-[11px] text-warm-400">{t('harness.hooks.parkedNote')}</p>}
        </div>
      )}
    </div>
  );
}
