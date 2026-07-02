import { useState, useEffect } from 'react';
import { useI18n } from '../../i18n';
import type { CliId, HarnessSettings } from './types';

interface SettingsFormProps {
  cli: CliId;
  settings: HarnessSettings;
  saving: boolean;
  onSave: (patch: HarnessSettings) => Promise<void>;
}

const APPROVAL_OPTIONS: Record<CliId, string[]> = {
  claude: ['ask', 'accept', 'auto', 'bypassPermissions'],
  // PROVISIONAL: Antigravity approval-mode values unconfirmed (verify via `agy inspect`).
  antigravity: ['default', 'auto', 'all'],
  codex: ['untrusted', 'on-request', 'on-failure', 'never'],
};

const SANDBOX_OPTIONS: Record<CliId, string[]> = {
  claude: [],
  // PROVISIONAL: Antigravity sandbox values unconfirmed (verify via `agy inspect`).
  antigravity: ['true', 'false', 'docker', 'podman'],
  codex: ['read-only', 'workspace-write', 'danger-full-access'],
};

export default function SettingsForm({ cli, settings, saving, onSave }: SettingsFormProps) {
  const { t } = useI18n();
  const [model, setModel] = useState(settings.model ?? '');
  const [approvalMode, setApprovalMode] = useState(settings.approvalMode ?? '');
  const [sandbox, setSandbox] = useState(settings.sandbox ?? '');

  useEffect(() => {
    setModel(settings.model ?? '');
    setApprovalMode(settings.approvalMode ?? '');
    setSandbox(settings.sandbox ?? '');
  }, [settings.model, settings.approvalMode, settings.sandbox]);

  const dirty =
    (settings.model ?? '') !== model ||
    (settings.approvalMode ?? '') !== approvalMode ||
    (settings.sandbox ?? '') !== sandbox;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty || saving) return;
    const patch: HarnessSettings = {};
    if ((settings.model ?? '') !== model) patch.model = model || undefined;
    if ((settings.approvalMode ?? '') !== approvalMode) patch.approvalMode = approvalMode || undefined;
    if ((settings.sandbox ?? '') !== sandbox) patch.sandbox = sandbox || undefined;
    await onSave(patch);
  };

  const sandboxOpts = SANDBOX_OPTIONS[cli];

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-4 border border-warm-200 rounded-xl">
      <h4 className="text-sm font-semibold text-warm-700">{t('harness.section.settings')}</h4>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-warm-500 block mb-1">{t('harness.field.model')}</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t(`harness.field.modelPlaceholder.${cli}`)}
            className="w-full px-3 py-1.5 text-xs border border-warm-200 rounded-lg bg-warm-50 text-warm-700 focus:ring-1 focus:ring-accent focus:border-accent"
          />
        </div>

        <div>
          <label className="text-xs text-warm-500 block mb-1">{t('harness.field.approvalMode')}</label>
          <select
            value={approvalMode}
            onChange={(e) => setApprovalMode(e.target.value)}
            className="w-full px-3 py-1.5 text-xs border border-warm-200 rounded-lg bg-warm-50 text-warm-700 focus:ring-1 focus:ring-accent focus:border-accent"
          >
            <option value="">{t('harness.field.unset')}</option>
            {APPROVAL_OPTIONS[cli].map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        {sandboxOpts.length > 0 && (
          <div>
            <label className="text-xs text-warm-500 block mb-1">{t('harness.field.sandbox')}</label>
            <select
              value={sandbox}
              onChange={(e) => setSandbox(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-warm-200 rounded-lg bg-warm-50 text-warm-700 focus:ring-1 focus:ring-accent focus:border-accent"
            >
              <option value="">{t('harness.field.unset')}</option>
              {sandboxOpts.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!dirty || saving}
          className="px-4 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent-dark disabled:opacity-50 transition-colors"
        >
          {saving ? t('harness.saving') : t('harness.save')}
        </button>
        {!dirty && <span className="text-xs text-warm-400">{t('harness.noChanges')}</span>}
      </div>
    </form>
  );
}
