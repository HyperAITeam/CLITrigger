import { useI18n } from '../../i18n';
import type { HarnessPlugin } from './types';

interface PluginsPanelProps {
  plugins: HarnessPlugin[] | undefined;
  // Where the on/off state is written, shown in the header.
  source: string;
  // Explains the toggle's reach (per-project vs user-wide).
  note: string;
  saving: boolean;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
}

// Installed plugins the CLI would load in this project, with on/off toggles.
export default function PluginsPanel({ plugins, source, note, saving, onToggle }: PluginsPanelProps) {
  const { t } = useI18n();
  const list = plugins ?? [];

  return (
    <div className="space-y-3 p-4 border border-warm-200 rounded-xl">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-warm-700">Plugins</h4>
        <code className="text-[10px] text-warm-400">{source}</code>
      </div>

      {list.length === 0 ? (
        <p className="text-xs text-warm-400">{t('harness.plugins.empty')}</p>
      ) : (
        <div className="space-y-1.5">
          {list.map((plugin) => {
            const [name, marketplace] = plugin.id.split('@');
            return (
              <label
                key={plugin.id}
                className="flex items-start gap-2 px-3 py-2 border border-warm-150 rounded-lg bg-warm-50 hover:bg-warm-100 transition-colors cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={plugin.enabled}
                  disabled={saving}
                  onChange={() => onToggle(plugin.id, !plugin.enabled)}
                  title={plugin.enabled ? t('harness.toggle.disable') : t('harness.toggle.enable')}
                  className="mt-0.5 flex-shrink-0 cursor-pointer"
                />
                <span className={`min-w-0 flex-1${plugin.enabled ? '' : ' opacity-50'}`}>
                  <span className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="text-xs font-semibold text-warm-700 font-mono">{name}</span>
                    <span className="text-[10px] text-warm-400 font-mono">
                      {marketplace ? `@${marketplace} · ` : ''}{plugin.scope}{plugin.version ? ` · v${plugin.version}` : ''}
                    </span>
                  </span>
                  {plugin.description && (
                    <span className="block text-[11px] text-warm-400 mt-0.5 line-clamp-2">{plugin.description}</span>
                  )}
                </span>
              </label>
            );
          })}
          <p className="text-[11px] text-warm-400">{note}</p>
        </div>
      )}
    </div>
  );
}
