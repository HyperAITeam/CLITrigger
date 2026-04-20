import { useState } from 'react';
import { Hammer, Pencil, Trash2, Users } from 'lucide-react';
import type { DiscussionAgent } from '../types';
import { useI18n } from '../i18n';
import { CLI_TOOLS, type CliTool } from '../cli-tools';
import { useModels } from '../hooks/useModels';
import * as discussionsApi from '../api/discussions';
import EmptyState from './EmptyState';

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
  const [cliTool, setCliTool] = useState<CliTool | ''>('');
  const [cliModel, setCliModel] = useState('');
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [canImplement, setCanImplement] = useState(false);
  const [saving, setSaving] = useState(false);
  const { getToolConfig } = useModels();

  const resetForm = () => {
    setName('');
    setRole('developer');
    setSystemPrompt('');
    setCliTool('');
    setCliModel('');
    setAvatarColor(AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]);
    setCanImplement(false);
    setShowForm(false);
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!name.trim() || !systemPrompt.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        const updated = await discussionsApi.updateAgent(editingId, {
          name, role, system_prompt: systemPrompt, avatar_color: avatarColor,
          cli_tool: cliTool || null, cli_model: cliModel || null,
          can_implement: canImplement,
        });
        onAgentsChange(agents.map((a) => (a.id === editingId ? updated : a)));
      } else {
        const created = await discussionsApi.createAgent(projectId, {
          name, role, system_prompt: systemPrompt, avatar_color: avatarColor,
          ...(cliTool ? { cli_tool: cliTool } : {}),
          ...(cliModel ? { cli_model: cliModel } : {}),
          can_implement: canImplement,
        });
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
    setCliTool((agent.cli_tool as CliTool) || '');
    setCliModel(agent.cli_model || '');
    setAvatarColor(agent.avatar_color || AVATAR_COLORS[0]);
    setCanImplement(!!agent.can_implement);
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
        <EmptyState icon={Users} title={t('agents.empty')} size="sm" />
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
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-warm-700 truncate">{agent.name}</span>
                {!!agent.can_implement && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium bg-amber-50 text-amber-700 border border-amber-200"
                    title={t('agents.canImplementHelp')}
                  >
                    <Hammer size={10} />
                    {t('agents.canImplementBadge')}
                  </span>
                )}
              </div>
              <div className="text-xs text-warm-400 mt-0.5">
                {t(`agents.roles.${agent.role}`) || agent.role}
                {agent.cli_tool && (
                  <span className="ml-1.5 text-warm-300">
                    · {CLI_TOOLS.find(t => t.value === agent.cli_tool)?.label || agent.cli_tool}
                    {agent.cli_model ? ` / ${agent.cli_model}` : ''}
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => handleEdit(agent)}
                className="p-1.5 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-lg transition-colors"
              >
                <Pencil size={16} />
              </button>
              <button
                onClick={() => handleDelete(agent.id)}
                className="p-1.5 text-warm-400 hover:text-status-error hover:bg-red-50 rounded-lg transition-colors"
              >
                <Trash2 size={16} />
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
            <p className="text-2xs text-warm-400 mt-1.5">
              {lang === 'ko' ? '토론 시 이 에이전트가 어떤 관점에서 발언할지 결정합니다.' : 'Determines what perspective this agent brings to the discussion.'}
            </p>
          </div>

          {/* CLI Tool & Model */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-warm-500 mb-2">{t('agents.cliTool')}</label>
              <select
                value={cliTool}
                onChange={(e) => { setCliTool(e.target.value as CliTool | ''); setCliModel(''); }}
                className="input-field text-sm"
              >
                <option value="">{lang === 'ko' ? '프로젝트 기본값 사용' : 'Use project default'}</option>
                {CLI_TOOLS.map((tool) => (
                  <option key={tool.value} value={tool.value}>{tool.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-warm-500 mb-2">{t('agents.cliModel')}</label>
              <select
                value={cliModel}
                onChange={(e) => setCliModel(e.target.value)}
                className="input-field text-sm"
                disabled={!cliTool}
              >
                {cliTool
                  ? getToolConfig(cliTool).models.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))
                  : <option value="">{lang === 'ko' ? '프로젝트 기본값 사용' : 'Use project default'}</option>
                }
              </select>
            </div>
          </div>

          {/* Can Implement toggle */}
          <div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={canImplement}
                onChange={(e) => setCanImplement(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-warm-300 text-warm-600 focus:ring-warm-400"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 text-xs font-medium text-warm-700">
                  <Hammer size={12} />
                  {t('agents.canImplement')}
                </div>
                <p className="text-2xs text-warm-400 mt-0.5">{t('agents.canImplementHelp')}</p>
              </div>
            </label>
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
