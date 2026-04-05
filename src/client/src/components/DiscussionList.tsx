import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Discussion, DiscussionAgent } from '../types';
import { useI18n } from '../i18n';
import * as discussionsApi from '../api/discussions';
import AgentManager from './AgentManager';

interface DiscussionListProps {
  projectId: string;
  discussions: Discussion[];
  onAddDiscussion: (discussion: Discussion) => void;
  onStartDiscussion: (id: string) => Promise<void>;
  onStopDiscussion: (id: string) => Promise<void>;
  onDeleteDiscussion: (id: string) => Promise<void>;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-warm-200 text-warm-600',
  running: 'bg-status-success/10 text-status-success',
  paused: 'bg-amber-100 text-amber-700',
  completed: 'bg-accent-gold/10 text-accent-gold',
  failed: 'bg-status-error/10 text-status-error',
  merged: 'bg-accent-gold/10 text-accent-gold',
};

export default function DiscussionList({
  projectId,
  discussions,
  onAddDiscussion,
  onStartDiscussion,
  onStopDiscussion,
  onDeleteDiscussion,
}: DiscussionListProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [agents, setAgents] = useState<DiscussionAgent[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showAgentManager, setShowAgentManager] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [maxRounds, setMaxRounds] = useState(3);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    discussionsApi.getAgents(projectId).then(setAgents).catch(() => {});
  }, [projectId]);

  const handleCreate = useCallback(async () => {
    if (!title.trim() || !description.trim() || selectedAgentIds.length < 2) return;
    setCreating(true);
    try {
      const discussion = await discussionsApi.createDiscussion(projectId, {
        title,
        description,
        agent_ids: selectedAgentIds,
        max_rounds: maxRounds,
      });
      onAddDiscussion(discussion);
      setTitle('');
      setDescription('');
      setSelectedAgentIds([]);
      setMaxRounds(3);
      setShowForm(false);
    } finally {
      setCreating(false);
    }
  }, [projectId, title, description, selectedAgentIds, maxRounds, onAddDiscussion]);

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  };

  const getAgentNames = (agentIdsJson: string): DiscussionAgent[] => {
    try {
      const ids = JSON.parse(agentIdsJson) as string[];
      return ids.map((id) => agents.find((a) => a.id === id)).filter((a): a is DiscussionAgent => !!a);
    } catch {
      return [];
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-warm-700 tracking-wide uppercase">{t('discussions.title')}</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAgentManager(!showAgentManager)}
            className="btn btn-sm text-xs"
          >
            {t('agents.manage')}
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="btn btn-sm btn-primary text-xs"
          >
            + {t('discussions.add')}
          </button>
        </div>
      </div>

      {/* Agent Manager */}
      {showAgentManager && (
        <div className="card p-4">
          <AgentManager projectId={projectId} agents={agents} onAgentsChange={setAgents} />
        </div>
      )}

      {/* Create Form */}
      {showForm && (
        <div className="card p-4 space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input text-sm"
            placeholder={t('discussions.add') + ' — ' + t('todos.titlePlaceholder')}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="input text-sm resize-none"
            placeholder="Describe the feature to discuss..."
          />
          <div>
            <label className="text-xs font-medium text-warm-600">{t('discussions.agents')} ({selectedAgentIds.length} selected, min 2)</label>
            {agents.length === 0 ? (
              <p className="text-xs text-warm-400 mt-1">{t('agents.empty')}</p>
            ) : (
              <div className="flex flex-wrap gap-2 mt-2">
                {agents.map((agent) => {
                  const selected = selectedAgentIds.includes(agent.id);
                  return (
                    <button
                      key={agent.id}
                      onClick={() => toggleAgent(agent.id)}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                        selected
                          ? 'border-accent-gold bg-accent-gold/5 text-warm-700'
                          : 'border-warm-200 bg-warm-50 text-warm-500 hover:border-warm-300'
                      }`}
                    >
                      <div
                        className="w-4 h-4 rounded-full flex-shrink-0"
                        style={{ backgroundColor: agent.avatar_color || '#6366f1' }}
                      />
                      {agent.name}
                      {selected && (
                        <span className="text-[10px] text-warm-400 ml-1">#{selectedAgentIds.indexOf(agent.id) + 1}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-warm-600">{t('discussions.maxRounds')}</label>
            <input
              type="number"
              min={1}
              max={10}
              value={maxRounds}
              onChange={(e) => setMaxRounds(Number(e.target.value))}
              className="input w-20 text-sm text-center"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="btn btn-sm text-xs text-warm-500">{t('header.cancel')}</button>
            <button
              onClick={handleCreate}
              disabled={!title.trim() || !description.trim() || selectedAgentIds.length < 2 || creating}
              className="btn btn-sm btn-primary text-xs"
            >
              {creating ? t('header.saving') : t('discussions.add')}
            </button>
          </div>
        </div>
      )}

      {/* Discussion list */}
      {discussions.length === 0 && !showForm ? (
        <div className="card p-10 text-center">
          <p className="text-warm-400 text-sm">{t('discussions.empty')}</p>
          <p className="text-warm-300 text-xs mt-1">{t('discussions.emptyHint')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {discussions.map((discussion) => {
            const dAgents = getAgentNames(discussion.agent_ids);
            const canStart = discussion.status === 'pending' || discussion.status === 'paused' || discussion.status === 'failed';
            const canStop = discussion.status === 'running';

            return (
              <div
                key={discussion.id}
                className="card p-4 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => navigate(`/projects/${projectId}/discussions/${discussion.id}`)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-warm-700 truncate">{discussion.title}</h3>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${STATUS_COLORS[discussion.status] || ''}`}>
                        {t(`status.${discussion.status}`) || discussion.status}
                      </span>
                    </div>
                    <p className="text-xs text-warm-400 mt-1 line-clamp-1">{discussion.description}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[10px] text-warm-400">
                        {t('discussions.round')} {discussion.current_round}/{discussion.max_rounds}
                      </span>
                      <div className="flex -space-x-1">
                        {dAgents.slice(0, 5).map((agent) => (
                          <div
                            key={agent.id}
                            className="w-5 h-5 rounded-full border-2 border-white text-[8px] text-white font-bold flex items-center justify-center"
                            style={{ backgroundColor: agent.avatar_color || '#6366f1' }}
                            title={agent.name}
                          >
                            {agent.name.charAt(0)}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    {canStart && (
                      <button
                        onClick={() => onStartDiscussion(discussion.id)}
                        className="p-1.5 text-status-success hover:bg-status-success/10 rounded transition-colors"
                        title="Start"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                      </button>
                    )}
                    {canStop && (
                      <button
                        onClick={() => onStopDiscussion(discussion.id)}
                        className="p-1.5 text-amber-600 hover:bg-amber-50 rounded transition-colors"
                        title="Pause"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
                      </button>
                    )}
                    <button
                      onClick={() => onDeleteDiscussion(discussion.id)}
                      className="p-1.5 text-warm-400 hover:text-status-error rounded transition-colors"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
