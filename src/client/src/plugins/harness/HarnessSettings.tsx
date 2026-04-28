import type { PluginSettingsProps } from '../types';
import { useI18n } from '../../i18n';

export default function HarnessSettings(_: PluginSettingsProps) {
  const { t } = useI18n();
  return (
    <div className="p-4 border border-warm-200 rounded-xl">
      <h4 className="text-sm font-semibold text-warm-700 mb-1">
        {t('harness.settingsTitle')}
      </h4>
      <p className="text-xs text-warm-400 mb-2">{t('harness.settingsDesc')}</p>
      <p className="text-xs text-warm-400">{t('harness.openTabHint')}</p>
    </div>
  );
}
