import { useState, useEffect } from 'react';
import type { PluginSettingsProps } from '../types';
import type { GstackSkill } from '../../types';
import { useI18n } from '../../i18n';
import * as gstackApi from '../../api/gstack';

export default function GstackSettings({ project, config, onConfigChange }: PluginSettingsProps) {
  const { t, lang } = useI18n();
  const [availableSkills, setAvailableSkills] = useState<GstackSkill[]>([]);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    gstackApi.getAvailableSkills().then(setAvailableSkills).catch(() => {});
  }, []);

  const enabled = config.enabled === '1' || config.enabled === true;
  const isClaudeCli = project.cli_tool === 'claude';

  const selectedSkills: string[] = (() => {
    try {
      const raw = config.skills;
      if (!raw) return [];
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  })();

  const handleToggleSkill = (skillId: string) => {
    const next = selectedSkills.includes(skillId)
      ? selectedSkills.filter(s => s !== skillId)
      : [...selectedSkills, skillId];
    onConfigChange({ skills: next.length > 0 ? JSON.stringify(next) : null });
  };

  return (
    <div className="p-4 border border-warm-200 rounded-xl">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-sm font-semibold text-warm-700">
          {t('header.gstackTitle')}
        </h4>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onConfigChange({ enabled: e.target.checked ? '1' : '0' })}
            disabled={!isClaudeCli}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-warm-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-warm-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-status-success peer-disabled:opacity-50" />
        </label>
      </div>
      <p className="text-xs text-warm-400 mb-3">{t('header.gstackDesc')}</p>

      {!isClaudeCli && (
        <p className="text-xs text-warm-400 mb-3">{t('header.gstackClaudeOnly')}</p>
      )}

      {isClaudeCli && enabled && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setShowGuide(!showGuide)}
            className="flex items-center gap-1 text-xs text-accent-dark hover:text-accent transition-colors"
          >
            <span className={`inline-block transition-transform ${showGuide ? 'rotate-90' : ''}`}>&#9654;</span>
            {t('header.gstackGuideToggle')}
          </button>

          {showGuide && (
            <div className="p-3 bg-warm-50 border border-warm-150 rounded-lg text-xs text-warm-600 space-y-2">
              <div>
                <p className="font-semibold text-warm-700 mb-1">{t('header.gstackGuideHow')}</p>
                <ol className="list-decimal list-inside space-y-0.5 ml-1">
                  <li>{t('header.gstackGuideStep1')}</li>
                  <li>{t('header.gstackGuideStep2')}</li>
                  <li>{t('header.gstackGuideStep3')}</li>
                  <li>{t('header.gstackGuideStep4')}</li>
                </ol>
              </div>
              <p className="text-warm-400">{t('header.gstackGuideNote')}</p>
            </div>
          )}

          {availableSkills.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {availableSkills.map((skill) => (
                <label
                  key={skill.id}
                  className="flex items-start gap-2 p-2 rounded-lg hover:bg-warm-50 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedSkills.includes(skill.id)}
                    onChange={() => handleToggleSkill(skill.id)}
                    className="mt-0.5 rounded border-warm-300 text-status-success focus:ring-status-success"
                  />
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-warm-700">{skill.name}</span>
                    <p className="text-xs text-warm-400 truncate">
                      {lang === 'ko' ? skill.descriptionKo : skill.description}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-warm-300 mt-3">
        {t('header.gstackCredit')}
      </p>
    </div>
  );
}
