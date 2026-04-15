import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Pause, Trash2 } from 'lucide-react';
import type { Discussion, DiscussionAgent } from '../types';
import { useI18n } from '../i18n';
import * as discussionsApi from '../api/discussions';
import AgentManager from './AgentManager';
import DiscussionForm from './DiscussionForm';

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
  completed: 'bg-accent/10 text-accent',
  failed: 'bg-status-error/10 text-status-error',
  merged: 'bg-accent/10 text-accent',
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
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    discussionsApi.getAgents(projectId).then(setAgents).catch(() => {});
  }, [projectId]);

  const handleCreate = useCallback(async (values: discussionsApi.DiscussionInput) => {
    setCreating(true);
    try {
      const discussion = await discussionsApi.createDiscussion(projectId, values);
      onAddDiscussion(discussion);
      setShowForm(false);
    } finally {
      setCreating(false);
    }
  }, [projectId, onAddDiscussion]);

  const getAgentNames = (agentIdsJson: string): DiscussionAgent[] => {
    try {
      const ids = JSON.parse(agentIdsJson) as string[];
      return ids.map((id) => agents.find((agent) => agent.id === id)).filter((agent): agent is DiscussionAgent => !!agent);
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
            className="btn-secondary text-xs py-2"
          >
            {t('agents.manage')}
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="btn-primary text-xs py-2"
          >
            + {t('discussions.add')}
          </button>
        </div>
      </div>

      {showAgentManager && (
        <div className="card p-4">
          <AgentManager projectId={projectId} agents={agents} onAgentsChange={setAgents} />
        </div>
      )}

      {showForm && (
        <DiscussionForm
          agents={agents}
          mode="create"
          submitting={creating}
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      )}

      {discussions.length === 0 && !showForm ? (
        <div className="card p-10 text-center">
          <p className="text-warm-400 text-sm">{t('discussions.empty')}</p>
          <p className="text-warm-300 text-xs mt-1">{t('discussions.emptyHint')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {discussions.map((discussion, index) => {
            const discussionAgents = getAgentNames(discussion.agent_ids);
            const canStart = discussion.status === 'pending' || discussion.status === 'paused' || discussion.status === 'failed';
            const canStop = discussion.status === 'running';

            return (
              <div
                key={discussion.id}
                className="card p-4 hover:shadow-md transition-all cursor-pointer animate-slide-up"
                onClick={() => navigate(`/projects/${projectId}/discussions/${discussion.id}`)}
                style={{ animationDelay: `${index * 50}ms` }}
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
                        {discussionAgents.slice(0, 5).map((agent) => (
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
                        title={t('header.runAll')}
                      >
                        <Play size={16} />
                      </button>
                    )}
                    {canStop && (
                      <button
                        onClick={() => onStopDiscussion(discussion.id)}
                        className="p-1.5 text-amber-600 hover:bg-amber-50 rounded transition-colors"
                        title={t('discussions.pause')}
                      >
                        <Pause size={16} />
                      </button>
                    )}
                    <button
                      onClick={() => onDeleteDiscussion(discussion.id)}
                      className="p-1.5 text-warm-400 hover:text-status-error rounded transition-colors"
                      title={t('todo.delete')}
                    >
                      <Trash2 size={16} />
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
