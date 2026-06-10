import { useState, useEffect } from 'react';
import { Pencil } from 'lucide-react';
import { useI18n } from '../../i18n';

interface HooksPanelProps {
  // Raw hooks block from .claude/settings.json. Undefined → no hooks key.
  hooks: Record<string, unknown> | undefined;
  filePath: string;
  saving: boolean;
  onSave: (hooks: Record<string, unknown> | null) => Promise<void>;
}

// Claude hooks shape (loosely): { EventName: [{ matcher?, hooks: [{ type, command }] }] }.
// Rendered defensively — anything that doesn't match falls back to JSON text.
interface HookEntry {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string }>;
  [k: string]: unknown;
}

function asEntries(value: unknown): HookEntry[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is HookEntry => typeof v === 'object' && v !== null);
}

export default function HooksPanel({ hooks, filePath, saving, onSave }: HooksPanelProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const hasHooks = !!hooks && Object.keys(hooks).length > 0;

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
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-warm-500 hover:text-warm-700 hover:bg-warm-100 rounded transition-colors flex-shrink-0"
            >
              <Pencil size={12} />
              {t('harness.hooks.editJson') || 'Edit JSON'}
            </button>
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
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent-dark disabled:opacity-50 transition-colors"
            >
              {saving ? t('harness.saving') : t('harness.save')}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(JSON.stringify(hooks ?? {}, null, 2));
                setJsonError(null);
                setEditing(false);
              }}
              className="px-3 py-1.5 text-xs rounded-lg text-warm-500 hover:bg-warm-100 transition-colors"
            >
              {t('harness.cancel')}
            </button>
          </div>
        </>
      ) : !hasHooks ? (
        <p className="text-xs text-warm-400">{t('harness.hooks.empty') || 'No hooks configured.'}</p>
      ) : (
        <div className="space-y-2">
          {Object.entries(hooks!).map(([event, value]) => {
            const entries = asEntries(value);
            return (
              <div key={event} className="p-2.5 bg-warm-50 border border-warm-150 rounded-lg">
                <div className="text-xs font-semibold text-warm-700 font-mono mb-1.5">{event}</div>
                {entries ? (
                  <div className="space-y-1.5">
                    {entries.map((entry, i) => (
                      <div key={i} className="text-[11px]">
                        {entry.matcher !== undefined && entry.matcher !== '' && (
                          <span className="inline-block px-1.5 py-0.5 mr-1.5 rounded bg-warm-200/60 text-warm-600 font-mono">
                            {entry.matcher}
                          </span>
                        )}
                        {(entry.hooks ?? []).map((h, j) => (
                          <code key={j} className="block mt-0.5 px-2 py-1 rounded bg-theme-card border border-warm-150 text-warm-600 font-mono whitespace-pre-wrap break-all">
                            {h.command ?? JSON.stringify(h)}
                          </code>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre className="text-[11px] text-warm-500 font-mono whitespace-pre-wrap break-all">
                    {JSON.stringify(value, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
