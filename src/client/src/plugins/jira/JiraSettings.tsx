import { useState } from 'react';
import type { PluginSettingsProps } from '../types';
import { useI18n } from '../../i18n';
import * as jiraApi from '../../api/jira';

export default function JiraSettings({ project, config, onConfigChange }: PluginSettingsProps) {
  const { t } = useI18n();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);

  const enabled = config.enabled === '1' || config.enabled === true;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await jiraApi.testConnection(project.id);
      setTestResult(result.ok ? 'ok' : 'fail');
    } catch {
      setTestResult('fail');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="p-4 border border-warm-200 rounded-xl">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-warm-700">
          {t('header.jiraTitle')}
        </h4>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onConfigChange({ enabled: e.target.checked ? '1' : '0' })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-warm-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-warm-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-status-success" />
        </label>
      </div>

      {enabled && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-warm-500 block mb-1">{t('header.jiraBaseUrl')}</label>
              <input
                type="text"
                value={config.base_url ?? ''}
                onChange={(e) => onConfigChange({ base_url: e.target.value || null })}
                placeholder={t('header.jiraBaseUrlPlaceholder')}
                className="w-full px-3 py-1.5 text-xs border border-warm-200 rounded-lg bg-warm-50 text-warm-700 focus:ring-1 focus:ring-accent-gold focus:border-accent-gold"
              />
            </div>
            <div>
              <label className="text-xs text-warm-500 block mb-1">{t('header.jiraProjectKey')}</label>
              <input
                type="text"
                value={config.project_key ?? ''}
                onChange={(e) => onConfigChange({ project_key: e.target.value || null })}
                placeholder={t('header.jiraProjectKeyPlaceholder')}
                className="w-full px-3 py-1.5 text-xs border border-warm-200 rounded-lg bg-warm-50 text-warm-700 focus:ring-1 focus:ring-accent-gold focus:border-accent-gold"
              />
            </div>
            <div>
              <label className="text-xs text-warm-500 block mb-1">{t('header.jiraEmail')}</label>
              <input
                type="text"
                value={config.email ?? ''}
                onChange={(e) => onConfigChange({ email: e.target.value || null })}
                placeholder={t('header.jiraEmailPlaceholder')}
                className="w-full px-3 py-1.5 text-xs border border-warm-200 rounded-lg bg-warm-50 text-warm-700 focus:ring-1 focus:ring-accent-gold focus:border-accent-gold"
              />
            </div>
            <div>
              <label className="text-xs text-warm-500 block mb-1">{t('header.jiraApiToken')}</label>
              <input
                type="password"
                value={config.api_token ?? ''}
                onChange={(e) => onConfigChange({ api_token: e.target.value || null })}
                placeholder={t('header.jiraApiTokenPlaceholder')}
                className="w-full px-3 py-1.5 text-xs border border-warm-200 rounded-lg bg-warm-50 text-warm-700 focus:ring-1 focus:ring-accent-gold focus:border-accent-gold"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleTest}
              disabled={testing}
              className="px-3 py-1 text-xs rounded-lg bg-warm-100 text-warm-600 hover:bg-warm-200 disabled:opacity-50 transition-colors"
            >
              {testing ? t('header.jiraTesting') : t('header.jiraTestConnection')}
            </button>
            {testResult === 'ok' && (
              <span className="text-xs text-status-success font-medium">{t('header.jiraConnected')}</span>
            )}
            {testResult === 'fail' && (
              <span className="text-xs text-status-error font-medium">{t('header.jiraFailed')}</span>
            )}
          </div>
          <p className="text-xs text-warm-300">
            {t('header.jiraTokenHint')}
          </p>
        </div>
      )}
    </div>
  );
}
