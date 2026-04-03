import type { ClientPluginManifest } from '../types';
import GstackSettings from './GstackSettings';

export const gstackClientPlugin: ClientPluginManifest = {
  id: 'gstack',
  displayName: 'Gstack Skills',
  displayNameKo: 'Gstack 스킬',
  SettingsComponent: GstackSettings,
  hasTab: false,
  isEnabled: (project) => !!project.gstack_enabled,
  translations: {
    en: {
      'header.gstackTitle': 'gstack Skills',
      'header.gstackEnabled': 'Enable gstack skill injection',
      'header.gstackCredit': 'Powered by gstack (MIT License, Garry Tan)',
      'header.gstackClaudeOnly': 'gstack skills are only available with Claude CLI.',
    },
    ko: {
      'header.gstackTitle': 'gstack 스킬',
      'header.gstackEnabled': 'gstack 스킬 주입 활성화',
      'header.gstackCredit': 'gstack 기반 (MIT 라이선스, Garry Tan)',
      'header.gstackClaudeOnly': 'gstack 스킬은 Claude CLI에서만 사용 가능합니다.',
    },
  },
};
