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
      'header.gstackDesc': 'Inject AI skill files into worktrees to improve Claude CLI task quality.',
      'header.gstackGuideToggle': 'How it works',
      'header.gstackGuideHow': 'How gstack skills work',
      'header.gstackGuideStep1': 'Select the skills you want to use below',
      'header.gstackGuideStep2': 'When a task starts, selected skill files are copied to the worktree\'s .claude/skills/ directory',
      'header.gstackGuideStep3': 'Claude CLI automatically recognizes and applies these skills during execution',
      'header.gstackGuideStep4': 'Skills are isolated in gstack-* prefixed directories and don\'t conflict with existing skills',
      'header.gstackGuideNote': 'Only works with Claude CLI. Gemini and Codex do not support skill files.',
    },
    ko: {
      'header.gstackTitle': 'gstack 스킬',
      'header.gstackEnabled': 'gstack 스킬 주입 활성화',
      'header.gstackCredit': 'gstack 기반 (MIT 라이선스, Garry Tan)',
      'header.gstackClaudeOnly': 'gstack 스킬은 Claude CLI에서만 사용 가능합니다.',
      'header.gstackDesc': 'AI 스킬 파일을 worktree에 주입하여 Claude CLI 작업 품질을 높입니다.',
      'header.gstackGuideToggle': '동작 방식',
      'header.gstackGuideHow': 'gstack 스킬 동작 원리',
      'header.gstackGuideStep1': '아래에서 사용할 스킬을 선택합니다',
      'header.gstackGuideStep2': '태스크 실행 시 선택된 스킬 파일이 worktree의 .claude/skills/ 디렉토리에 복사됩니다',
      'header.gstackGuideStep3': 'Claude CLI가 스킬을 자동 인식하여 실행에 적용합니다',
      'header.gstackGuideStep4': '스킬은 gstack-* 접두사 디렉토리에 격리되어 기존 스킬과 충돌하지 않습니다',
      'header.gstackGuideNote': 'Claude CLI 전용 기능입니다. Gemini, Codex에서는 지원되지 않습니다.',
    },
  },
};
