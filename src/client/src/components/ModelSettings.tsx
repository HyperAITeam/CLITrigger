import { useState, useEffect } from 'react';
import { useI18n } from '../i18n';
import { CLI_TOOLS, type CliTool } from '../cli-tools';
import { useModels } from '../hooks/useModels';
import { getModels, addModel, removeModel, type ModelOption } from '../api/models';

export default function ModelSettings() {
  const { t } = useI18n();
  const { refresh } = useModels();
  const [models, setModels] = useState<Record<string, ModelOption[]>>({});
  const [activeTool, setActiveTool] = useState<CliTool>('claude');
  const [newValue, setNewValue] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const fetchModels = () => {
    getModels().then(setModels).catch(() => {});
  };

  useEffect(() => { fetchModels(); }, []);

  const handleAdd = async () => {
    if (!newValue.trim() || !newLabel.trim()) return;
    setAdding(true);
    setError('');
    try {
      await addModel(activeTool, newValue.trim(), newLabel.trim());
      setNewValue('');
      setNewLabel('');
      fetchModels();
      refresh();
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await removeModel(id);
      fetchModels();
      refresh();
    } catch { /* ignore */ }
  };

  const currentModels = models[activeTool] || [];

  return (
    <div className="mt-6 p-4 border border-warm-200 rounded-xl">
      <h4 className="text-sm font-semibold text-warm-700 mb-3">
        {t('header.modelSettings') || 'AI Model Settings'}
      </h4>

      {/* Tool tabs */}
      <div className="flex gap-1.5 mb-4">
        {CLI_TOOLS.map((tool) => (
          <button
            key={tool.value}
            type="button"
            onClick={() => { setActiveTool(tool.value); setError(''); }}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTool === tool.value
                ? 'bg-accent text-white'
                : 'bg-warm-100 text-warm-500 hover:bg-warm-200'
            }`}
          >
            {tool.label}
          </button>
        ))}
      </div>

      {/* Model list */}
      <div className="space-y-1.5 mb-4">
        {currentModels.map((m) => (
          <div key={m.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-warm-50">
            <div className="min-w-0">
              <span className="text-xs font-medium text-warm-700">{m.label}</span>
              {m.value && (
                <span className="ml-2 text-[10px] text-warm-400 font-mono">{m.value}</span>
              )}
              {m.isDefault && (
                <span className="ml-2 text-[10px] text-warm-300">(built-in)</span>
              )}
            </div>
            {!m.isDefault && (
              <button
                type="button"
                onClick={() => handleRemove(m.id)}
                className="text-warm-300 hover:text-status-error transition-colors p-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add new model */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-[10px] font-medium text-warm-400 mb-1">
            {t('header.modelValue') || 'Model ID'}
          </label>
          <input
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="e.g. claude-sonnet-4-7"
            className="input-field text-xs"
          />
        </div>
        <div className="flex-1">
          <label className="block text-[10px] font-medium text-warm-400 mb-1">
            {t('header.modelLabel') || 'Display Name'}
          </label>
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="e.g. Claude Sonnet 4.7"
            className="input-field text-xs"
          />
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || !newValue.trim() || !newLabel.trim()}
          className="btn-primary text-xs px-3 py-2 flex-shrink-0"
        >
          {adding ? '...' : (t('header.addModel') || 'Add')}
        </button>
      </div>
      {error && <p className="text-xs text-status-error mt-1.5">{error}</p>}

      <p className="text-[10px] text-warm-300 mt-3">
        {t('header.modelSettingsHint') || 'Add custom models here. They will appear in model dropdowns across all projects.'}
      </p>
    </div>
  );
}
