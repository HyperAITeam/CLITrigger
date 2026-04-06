import { useState } from 'react';
import type { DiscussionAgent } from '../types';
import { useI18n } from '../i18n';
import * as discussionsApi from '../api/discussions';

const ROLE_OPTIONS = ['architect', 'developer', 'reviewer', 'pm', 'tester', 'custom'] as const;

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
];

const PRESET_AGENTS: Array<{ name: string; nameKo: string; role: string; prompt: string }> = [
  {
    name: 'Architect',
    nameKo: '아키텍트',
    role: 'architect',
    prompt: 'You are a senior software architect. Focus on system design, scalability, maintainability, and separation of concerns. Evaluate proposals for architectural soundness and suggest patterns that work well.',
  },
  {
    name: 'Developer',
    nameKo: '개발자',
    role: 'developer',
    prompt: 'You are a senior full-stack developer. Focus on implementation feasibility, code quality, existing patterns in the codebase, and developer experience. Be pragmatic about what can realistically be built.',
  },
  {
    name: 'Reviewer',
    nameKo: '리뷰어',
    role: 'reviewer',
    prompt: 'You are a senior code reviewer and quality advocate. Focus on edge cases, error handling, security, performance, and testing strategy. Challenge assumptions and find potential issues.',
  },
  {
    name: 'Product Manager',
    nameKo: 'PM',
    role: 'pm',
    prompt: 'You are a product manager. Focus on user experience, feature scope, priorities, and trade-offs. Ensure the discussion stays grounded in user needs and business value.',
  },
  {
    name: 'Tester',
    nameKo: '테스터',
    role: 'tester',
    prompt: 'You are a QA engineer and testing specialist. Focus on testability, test coverage strategy, edge cases, regression risks, and how to verify the feature works correctly.',
  },
];

interface AgentManagerProps {
  projectId: string;
  agents: DiscussionAgent[];
  onAgentsChange: (agents: DiscussionAgent[]) => void;
}

export default function AgentManager({ projectId, agents, onAgentsChange }: AgentManagerProps) {
  const { t, lang } = useI18n();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('developer');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setName('');
    setRole('developer');
    setSystemPrompt('');
    setAvatarColor(AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]);
    setShowForm(false);
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!name.trim() || !systemPrompt.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        const updated = await discussionsApi.updateAgent(editingId, { name, role, system_prompt: systemPrompt, avatar_color: avatarColor });
        onAgentsChange(agents.map((a) => (a.id === editingId ? updated : a)));
      } else {
        const created = await discussionsApi.createAgent(projectId, { name, role, system_prompt: systemPrompt, avatar_color: avatarColor });
        onAgentsChange([...agents, created]);
      }
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (agent: DiscussionAgent) => {
    setEditingId(agent.id);
    setName(agent.name);
    setRole(agent.role);
    setSystemPrompt(agent.system_prompt);
    setAvatarColor(agent.avatar_color || AVATAR_COLORS[0]);
    setShowForm(true);
  };

  const handleDelete = async (agentId: string) => {
    await discussionsApi.deleteAgent(agentId);
    onAgentsChange(agents.filter((a) => a.id !== agentId));
  };

  const handlePreset = (preset: typeof PRESET_AGENTS[number]) => {
    setName(lang === 'ko' ? preset.nameKo : preset.name);
    setRole(preset.role);
    setSystemPrompt(preset.prompt);
    setAvatarColor(AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]);
    setShowForm(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-warm-700">{t('agents.title')}</h3>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="btn btn-sm text-xs"
        >
          + {t('agents.add')}
        </button>
      </div>

      {agents.length === 0 && !showForm && (
        <p className="text-xs text-warm-400 py-2">{t('agents.empty')}</p>
      )}

      {/* Agent list */}
      <div className="space-y-2">
        {agents.map((agent) => (
          <div key={agent.id} className="flex items-center gap-3 p-3 rounded-xl bg-warm-50 border border-warm-150 hover:border-warm-250 transition-colors group">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-sm"
              style={{ backgroundColor: agent.avatar_color || '#6366f1' }}
            >
              {agent.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-warm-700 truncate">{agent.name}</div>
              <div className="text-xs text-warm-400 mt-0.5">{t(`agents.roles.${agent.role}`) || agent.role}</div>
            </div>
            <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => handleEdit(agent)}
                className="p-1.5 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                onClick={() => handleDelete(agent.id)}
                className="p-1.5 text-warm-400 hover:text-status-error hover:bg-red-50 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div className="space-y-5 p-5 rounded-xl border border-warm-200 bg-theme-card shadow-sm">
          {/* Presets row (only for new agents) */}
          {!editingId && (
            <div>
              <label className="block text-xs font-medium text-warm-500 mb-2">{t('agents.presets')}</label>
              <div className="flex flex-wrap gap-2">
                {PRESET_AGENTS.map((preset) => (
                  <button
                    key={preset.role}
                    onClick={() => handlePreset(preset)}
                    className="px-3 py-1.5 text-xs rounded-lg bg-warm-50 text-warm-600 hover:bg-warm-100 border border-warm-150 hover:border-warm-300 transition-colors font-medium"
                  >
                    {lang === 'ko' ? preset.nameKo : preset.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Name + Role */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-warm-500 mb-2">{t('agents.name')}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field"
                placeholder={lang === 'ko' ? '에이전트 이름' : 'Agent name'}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-warm-500 mb-2">{t('agents.role')}</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} className="input-field">
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>{t(`agents.roles.${r}`)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-xs font-medium text-warm-500 mb-2">{t('agents.systemPrompt')}</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={5}
              className="input-field resize-y min-h-[100px]"
              placeholder={lang === 'ko' ? '이 에이전트의 전문 분야와 관점을 설명하세요...' : "Describe this agent's expertise and perspective..."}
            />
            <p className="text-[10px] text-warm-400 mt-1.5">
              {lang === 'ko' ? '토론 시 이 에이전트가 어떤 관점에서 발언할지 결정합니다.' : 'Determines what perspective this agent brings to the discussion.'}
            </p>
          </div>

          {/* Avatar Color */}
          <div>
            <label className="block text-xs font-medium text-warm-500 mb-2">{t('agents.color')}</label>
            <div className="flex items-center gap-2.5">
              {/* Preview avatar */}
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-sm"
                style={{ backgroundColor: avatarColor }}
              >
                {name ? name.charAt(0).toUpperCase() : '?'}
              </div>
              <div className="flex flex-wrap gap-2">
                {AVATAR_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setAvatarColor(c)}
                    className={`w-7 h-7 rounded-full transition-all ${
                      avatarColor === c
                        ? 'ring-2 ring-offset-2 ring-warm-400 scale-110'
                        : 'hover:scale-105 opacity-70 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2 border-t border-warm-100">
            <button onClick={resetForm} className="btn btn-sm text-xs text-warm-500">{t('header.cancel')}</button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || !systemPrompt.trim() || saving}
              className="btn btn-sm btn-primary text-xs"
            >
              {saving ? t('header.saving') : t('header.save')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
