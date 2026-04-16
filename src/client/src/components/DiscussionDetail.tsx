import { useState, useEffect, useCallback, useRef } from 'react';
import Modal from './Modal';
import { useParams, Link } from 'react-router-dom';
import { ChevronLeft, AlertTriangle, RotateCcw, Play, Pause, Code, GitMerge, Trash2, ChevronRight } from 'lucide-react';
import type { DiscussionWithMessages, DiscussionMessage, DiscussionAgent, DiscussionLog } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import * as discussionsApi from '../api/discussions';
import { useI18n } from '../i18n';
import { useNotification } from '../hooks/useNotification';
import { Skeleton } from './Skeleton';
import DiscussionForm, { type DiscussionFormValues } from './DiscussionForm';
import MarkdownContent from './MarkdownContent';

interface DiscussionDetailProps {
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  connected: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-warm-200 text-warm-600',
  running: 'bg-status-success/10 text-status-success',
  paused: 'bg-amber-100 text-amber-700',
  completed: 'bg-accent/10 text-accent',
  failed: 'bg-status-error/10 text-status-error',
  merged: 'bg-accent/10 text-accent',
};

function parseAgentIds(agentIdsJson: string): string[] {
  try {
    const parsed = JSON.parse(agentIdsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getEditableDiscussionConfig(status: DiscussionWithMessages['status']) {
  if (status === 'pending' || status === 'failed') {
    return { canEdit: true, allowAdvancedFields: true };
  }

  if (status === 'paused' || status === 'completed') {
    return { canEdit: true, allowAdvancedFields: false };
  }

  return { canEdit: false, allowAdvancedFields: false };
}

export default function DiscussionDetail({ onEvent, connected }: DiscussionDetailProps) {
  const { id, discussionId } = useParams<{ id: string; discussionId: string }>();
  const { t, lang } = useI18n();
  const { sendNotification } = useNotification();
  const [discussion, setDiscussion] = useState<DiscussionWithMessages | null>(null);
  const [projectAgents, setProjectAgents] = useState<DiscussionAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [streamingLogs, setStreamingLogs] = useState<Map<string, string[]>>(new Map());
  const [userMessage, setUserMessage] = useState('');
  const [showImplementModal, setShowImplementModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [savingDiscussion, setSavingDiscussion] = useState(false);
  const [collapsedMessages, setCollapsedMessages] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState('');
  const [failureLogs, setFailureLogs] = useState<DiscussionLog[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const toggleCollapse = useCallback((msgId: string) => {
    setCollapsedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    if (!discussion) return;
    const ids = new Set(discussion.messages.filter((message) => message.content && message.status === 'completed').map((message) => message.id));
    setCollapsedMessages(ids);
  }, [discussion]);

  const expandAll = useCallback(() => {
    setCollapsedMessages(new Set());
  }, []);

  const getSummary = (content: string) => {
    const firstLine = content.split('\n').find((line) => line.trim()) || '';
    return firstLine.length > 120 ? `${firstLine.slice(0, 120)}...` : firstLine;
  };

  useEffect(() => {
    if (!discussionId) return;
    discussionsApi.getDiscussion(discussionId)
      .then(setDiscussion)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [discussionId]);

  useEffect(() => {
    if (!id) return;
    discussionsApi.getAgents(id).then(setProjectAgents).catch(() => {});
  }, [id]);

  useEffect(() => {
    return onEvent((event) => {
      if (!discussionId) return;

      if (event.type === 'discussion:status-changed' && event.discussionId === discussionId) {
        if (event.status === 'completed' || event.status === 'failed') {
          sendNotification(
            event.status === 'completed' ? t('notification.discussionCompleted') : t('notification.discussionFailed'),
            discussion?.title ?? ''
          );
        }
        setDiscussion((prev) => prev ? {
          ...prev,
          status: event.status as DiscussionWithMessages['status'],
          current_round: event.currentRound ?? prev.current_round,
          current_agent_id: event.currentAgentId ?? prev.current_agent_id,
        } : prev);
      }

      if (event.type === 'discussion:message-changed' && event.discussionId === discussionId) {
        setDiscussion((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            messages: prev.messages.map((message) =>
              message.id === event.messageId ? { ...message, status: event.status as DiscussionMessage['status'] } : message
            ),
          };
        });

        if (event.status === 'completed' || event.status === 'failed') {
          discussionsApi.getDiscussion(discussionId).then(setDiscussion).catch(() => {});
        }
      }

      if (event.type === 'discussion:log' && event.discussionId === discussionId && event.messageId) {
        setStreamingLogs((prev) => {
          const next = new Map(prev);
          const messageId = event.messageId!;
          const logs = next.get(messageId) || [];
          next.set(messageId, [...logs, event.message || '']);
          return next;
        });
      }
    });
  }, [onEvent, discussionId, sendNotification, t, discussion?.title]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [discussion?.messages, streamingLogs]);

  // Fetch error logs when discussion is failed
  useEffect(() => {
    if (!discussionId || !discussion) return;
    if (discussion.status === 'failed') {
      discussionsApi.getDiscussionLogs(discussionId)
        .then((logs) => setFailureLogs(logs.filter((l) => l.log_type === 'error')))
        .catch(() => {});
    } else {
      setFailureLogs([]);
    }
  }, [discussionId, discussion?.status]);

  const handleStart = useCallback(async () => {
    if (!discussionId) return;
    const updated = await discussionsApi.startDiscussion(discussionId);
    setDiscussion(updated);
    setErrorMessage('');
  }, [discussionId]);

  const handleStop = useCallback(async () => {
    if (!discussionId) return;
    await discussionsApi.stopDiscussion(discussionId);
    const updated = await discussionsApi.getDiscussion(discussionId);
    setDiscussion(updated);
    setErrorMessage('');
  }, [discussionId]);

  const handleInject = useCallback(async () => {
    if (!discussionId || !userMessage.trim()) return;
    await discussionsApi.injectMessage(discussionId, userMessage);
    setUserMessage('');
    const updated = await discussionsApi.getDiscussion(discussionId);
    setDiscussion(updated);
    setErrorMessage('');
  }, [discussionId, userMessage]);

  const handleSkipTurn = useCallback(async () => {
    if (!discussionId) return;
    const updated = await discussionsApi.skipTurn(discussionId);
    setDiscussion(updated);
    setErrorMessage('');
  }, [discussionId]);

  const handleImplement = useCallback(async (agentId: string) => {
    if (!discussionId) return;
    setShowImplementModal(false);
    const updated = await discussionsApi.triggerImplementation(discussionId, agentId);
    setDiscussion(updated);
    setErrorMessage('');
  }, [discussionId]);

  const handleMerge = useCallback(async () => {
    if (!discussionId) return;
    await discussionsApi.mergeDiscussion(discussionId);
    const updated = await discussionsApi.getDiscussion(discussionId);
    setDiscussion(updated);
    setErrorMessage('');
  }, [discussionId]);

  const handleCleanup = useCallback(async () => {
    if (!discussionId) return;
    await discussionsApi.cleanupDiscussion(discussionId);
    const updated = await discussionsApi.getDiscussion(discussionId);
    setDiscussion(updated);
    setErrorMessage('');
  }, [discussionId]);

  const handleUpdateDiscussion = useCallback(async (values: discussionsApi.DiscussionInput) => {
    if (!discussionId || !discussion) return;

    setSavingDiscussion(true);
    try {
      const { allowAdvancedFields } = getEditableDiscussionConfig(discussion.status);
      const payload: discussionsApi.DiscussionUpdateInput = allowAdvancedFields
        ? {
            title: values.title,
            description: values.description,
            agent_ids: values.agent_ids,
            max_rounds: values.max_rounds,
            auto_implement: values.auto_implement,
            implement_agent_id: values.auto_implement ? values.implement_agent_id : null,
          }
        : {
            title: values.title,
            description: values.description,
          };

      await discussionsApi.updateDiscussion(discussionId, payload);
      const refreshed = await discussionsApi.getDiscussion(discussionId);
      setDiscussion(refreshed);
      setShowEditModal(false);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : lang === 'ko' ? '토론 저장에 실패했습니다.' : 'Failed to save discussion.');
    } finally {
      setSavingDiscussion(false);
    }
  }, [discussionId, discussion, lang]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="card p-6 space-y-4">
          <Skeleton className="h-7 w-1/3" />
          <Skeleton className="h-4 w-full" count={2} />
          <div className="flex gap-4 pt-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="space-y-8">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton variant="circular" width={32} height={32} />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-24" />
                <div className="card p-4 space-y-2">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                  <Skeleton className="h-3 w-4/6" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!discussion) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 text-center">
        <p className="text-status-error">{t('discussions.notFound')}</p>
        <Link to={`/projects/${id}?tab=discussions`} className="text-sm text-accent mt-2 inline-block">{t('discussions.back')}</Link>
      </div>
    );
  }

  const agentMap = new Map(discussion.agents.map((agent) => [agent.id, agent]));
  const canStart = discussion.status === 'pending' || discussion.status === 'paused' || discussion.status === 'failed';
  const canStop = discussion.status === 'running';
  const canImplement = discussion.status === 'completed' || discussion.status === 'paused';
  const canMerge = discussion.status === 'completed';
  const canInject = discussion.status === 'paused' || discussion.status === 'running';
  const canCleanup = !canStop && !!discussion.worktree_path;
  const { canEdit, allowAdvancedFields } = getEditableDiscussionConfig(discussion.status);

  const initialEditValues: DiscussionFormValues = {
    title: discussion.title,
    description: discussion.description,
    agent_ids: parseAgentIds(discussion.agent_ids),
    max_rounds: discussion.max_rounds,
    auto_implement: discussion.auto_implement === 1,
    implement_agent_id: discussion.implement_agent_id || '',
  };

  const rounds = new Map<number, DiscussionMessage[]>();
  for (const message of discussion.messages) {
    const current = rounds.get(message.round_number) || [];
    current.push(message);
    rounds.set(message.round_number, current);
  }
  const sortedRounds = [...rounds.keys()].sort((a, b) => a - b);

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-8 flex flex-col" style={{ height: 'calc(100vh - 2rem)' }}>
      <div className="flex items-center gap-3 mb-4">
        <Link
          to={`/projects/${id}?tab=discussions`}
          className="inline-flex items-center gap-1 text-sm text-warm-500 hover:text-accent transition-colors"
        >
          <ChevronLeft size={16} />
          {t('discussions.back')}
        </Link>
        <span className="text-warm-300">/</span>
        <span className="text-sm font-medium text-warm-700 truncate">{discussion.title}</span>
        <span className={`px-1.5 py-0.5 rounded text-2xs font-semibold uppercase ${STATUS_COLORS[discussion.status]}`}>
          {t(`status.${discussion.status}`) || discussion.status}
        </span>
        {discussion.status === 'running' && (
          <span className="text-2xs text-status-success animate-pulse">
            {t('discussions.round')} {discussion.current_round}/{discussion.max_rounds}
          </span>
        )}
        {connected && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-status-success">
            <span className="h-1.5 w-1.5 rounded-full bg-status-success animate-pulse" />
          </span>
        )}
      </div>

      <div className="mb-4 rounded-xl border border-warm-150 bg-warm-50/80 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-warm-800">{discussion.title}</h1>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-warm-500">{discussion.description}</p>
          </div>
          {canEdit && (
            <button
              onClick={() => setShowEditModal(true)}
              className="btn-secondary text-xs py-2 flex-shrink-0"
            >
              {t('todo.edit')}
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-warm-400">
          <span>{t('discussions.maxRounds')}: {discussion.max_rounds}</span>
          <span>{t('discussions.agents')}: {discussion.agents.map((agent) => agent.name).join(', ') || '-'}</span>
          <span>{t('discussions.autoImplement')}: {discussion.auto_implement ? (lang === 'ko' ? '사용' : 'Enabled') : (lang === 'ko' ? '사용 안 함' : 'Disabled')}</span>
        </div>
        {errorMessage && (
          <p className="mt-3 text-xs text-status-error">{errorMessage}</p>
        )}
      </div>

      {/* Failure Panel */}
      {discussion.status === 'failed' && (() => {
        const failedMessage = discussion.messages.find((m) => m.status === 'failed');
        const failedAgent = failedMessage ? agentMap.get(failedMessage.agent_id) : null;
        return (
          <div className="mb-4 rounded-xl border border-status-error/30 bg-status-error/5 overflow-hidden animate-slide-up">
            <div className="flex items-center justify-between px-4 py-2.5 bg-status-error/10 border-b border-status-error/20">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-status-error" />
                <h4 className="text-xs font-semibold text-status-error uppercase tracking-wider">
                  {t('discussions.failureTitle')}
                </h4>
                {failedAgent && (
                  <span className="inline-flex items-center gap-1 text-2xs font-mono px-1.5 py-0.5 rounded bg-status-error/15 text-status-error">
                    <span
                      className="w-3 h-3 rounded-full inline-block"
                      style={{ backgroundColor: failedAgent.avatar_color || '#94a3b8' }}
                    />
                    {failedAgent.name}
                  </span>
                )}
                {failedMessage && (
                  <span className="text-2xs font-mono px-1.5 py-0.5 rounded bg-status-error/15 text-status-error">
                    {t('discussions.round')} {failedMessage.round_number}
                  </span>
                )}
              </div>
              <button
                onClick={handleStart}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-status-success/15 text-status-success hover:bg-status-success/25 border border-status-success/30 transition-colors"
              >
                <RotateCcw size={14} />
                {t('discussions.retry')}
              </button>
            </div>
            <div className="px-4 py-3 space-y-1.5 max-h-48 overflow-y-auto">
              {failureLogs.length > 0 ? failureLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-2 text-xs">
                  <span className="text-warm-500 font-mono flex-shrink-0">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </span>
                  <span className="text-status-error font-mono whitespace-pre-wrap break-all">
                    {log.message}
                  </span>
                </div>
              )) : (
                <span className="text-xs text-warm-400 italic">{t('discussions.noErrorLogs')}</span>
              )}
            </div>
          </div>
        );
      })()}

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {canStart && (
          <button onClick={handleStart} className="btn-primary text-sm">
            <Play size={16} />
            {discussion.status === 'pending' ? t('header.runAll') : t('discussions.resume')}
          </button>
        )}
        {canStop && (
          <button onClick={handleStop} className="btn-danger text-sm">
            <Pause size={16} />
            {t('discussions.pause')}
          </button>
        )}
        {canStop && (
          <button onClick={handleSkipTurn} className="btn btn-sm text-xs text-warm-500">{t('discussions.skipTurn')}</button>
        )}
        {canImplement && (
          <button onClick={() => setShowImplementModal(true)} className="btn-primary text-sm">
            <Code size={16} />
            {t('discussions.implement')}
          </button>
        )}
        {canMerge && discussion.branch_name && (
          <button onClick={handleMerge} className="btn-primary text-sm">
            <GitMerge size={16} />
            {t('todos.merge')}
          </button>
        )}
        {canCleanup && (
          <button onClick={handleCleanup} className="btn-danger text-sm">
            <Trash2 size={16} />
            {t('todo.cleanup')}
          </button>
        )}

        {discussion.messages.some((message) => message.content && message.status === 'completed') && (
          <button
            onClick={collapsedMessages.size > 0 ? expandAll : collapseAll}
            className="btn btn-sm text-xs text-warm-500"
          >
            {collapsedMessages.size > 0 ? t('discussions.expandAll') : t('discussions.collapseAll')}
          </button>
        )}

        <div className="ml-auto flex items-center gap-1">
          {discussion.agents.map((agent) => (
            <div
              key={agent.id}
              className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-2xs font-bold transition-all ${
                discussion.current_agent_id === agent.id ? 'ring-2 ring-status-success ring-offset-1 scale-110' : 'opacity-60'
              }`}
              style={{ backgroundColor: agent.avatar_color || '#6366f1' }}
              title={`${agent.name} (${agent.role})`}
            >
              {agent.name.charAt(0)}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1 pb-4">
        {sortedRounds.map((round) => {
          const messages = rounds.get(round)!;
          const isImplementationRound = round > discussion.max_rounds;
          return (
            <div key={round}>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-warm-200" />
                <span className="text-2xs font-semibold text-warm-400 uppercase tracking-wider">
                  {isImplementationRound ? t('discussions.implementation') : `${t('discussions.round')} ${round}`}
                </span>
                <div className="flex-1 h-px bg-warm-200" />
              </div>

              {messages.map((message) => {
                const agent = agentMap.get(message.agent_id);
                const isUser = message.agent_id === 'user';
                const isRunning = message.status === 'running';
                const logs = streamingLogs.get(message.id) || [];
                const isCollapsed = collapsedMessages.has(message.id);
                const canCollapse = !!message.content && message.status === 'completed' && !isUser;

                return (
                  <div key={message.id} className={`flex gap-3 py-3 ${isUser ? 'justify-end' : ''}`}>
                    {!isUser && (
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${
                          isRunning ? 'ring-2 ring-status-success ring-offset-1 animate-pulse' : ''
                        }`}
                        style={{ backgroundColor: agent?.avatar_color || '#94a3b8' }}
                      >
                        {message.agent_name.charAt(0)}
                      </div>
                    )}
                    <div className={`flex-1 min-w-0 ${isUser ? 'max-w-[80%]' : ''}`}>
                      {!isUser && (
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-warm-700">{message.agent_name}</span>
                          <span className="text-2xs text-warm-400">{t(`agents.roles.${message.role}`) || message.role}</span>
                          {message.status === 'skipped' && (
                            <span className="text-2xs text-warm-300 italic">{t('status.skipped')}</span>
                          )}
                          {canCollapse && (
                            <button
                              onClick={() => toggleCollapse(message.id)}
                              className="text-2xs text-warm-300 hover:text-accent transition-colors flex items-center gap-0.5"
                            >
                              <ChevronRight size={12} className={`transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
                              {isCollapsed ? t('discussions.expand') : t('discussions.collapse')}
                            </button>
                          )}
                        </div>
                      )}
                      <div
                        className={`rounded-xl p-3 text-sm ${
                          isUser
                            ? 'bg-accent/10 text-warm-700 ml-auto'
                            : message.status === 'failed'
                            ? 'bg-status-error/5 border border-status-error/20'
                            : 'bg-warm-50 border border-warm-150'
                        } ${canCollapse ? 'cursor-pointer' : ''}`}
                        onClick={canCollapse ? () => {
                          const sel = window.getSelection();
                          if (sel && sel.toString().length > 0) return;
                          toggleCollapse(message.id);
                        } : undefined}
                      >
                        {isCollapsed && message.content && (
                          <div className="text-xs text-warm-400 italic truncate">{getSummary(message.content)}</div>
                        )}

                        {!isCollapsed && message.content && (
                          <MarkdownContent content={message.content} />
                        )}

                        {isRunning && logs.length > 0 && (
                          <div className="text-xs text-warm-500 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto font-mono">
                            {logs.slice(-50).join('\n')}
                          </div>
                        )}

                        {isRunning && logs.length === 0 && (
                          <div className="flex items-center gap-2 text-xs text-status-success">
                            <span className="h-1.5 w-1.5 rounded-full bg-status-success animate-pulse" />
                            {t('discussions.speaking')}
                          </div>
                        )}

                        {message.status === 'pending' && !message.content && (
                          <div className="text-xs text-warm-300 italic">{t('discussions.waiting')}</div>
                        )}
                      </div>
                    </div>
                    {isUser && (
                      <div className="w-8 h-8 rounded-full bg-warm-300 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        U
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>

      {canInject && (
        <div className="border-t border-warm-200 pt-3 flex gap-2">
          <input
            type="text"
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleInject(); } }}
            placeholder={t('discussions.userMessage')}
            className="input flex-1 text-sm"
          />
          <button
            onClick={handleInject}
            disabled={!userMessage.trim()}
            className="btn btn-primary btn-sm text-xs"
          >
            {t('discussions.inject')}
          </button>
        </div>
      )}

      {showEditModal && (
        <Modal open onClose={() => setShowEditModal(false)} size="xl">
          <div className="max-h-[90vh] overflow-y-auto">
            <DiscussionForm
              agents={allowAdvancedFields ? projectAgents : discussion.agents}
              initialValues={initialEditValues}
              mode="edit"
              allowAdvancedFields={allowAdvancedFields}
              submitting={savingDiscussion}
              onSubmit={handleUpdateDiscussion}
              onCancel={() => setShowEditModal(false)}
            />
          </div>
        </Modal>
      )}

      {showImplementModal && (
        <Modal open onClose={() => setShowImplementModal(false)} size="sm">
          <div className="glass-card rounded-2xl p-6 shadow-elevated space-y-4">
            <h3 className="text-sm font-semibold text-warm-700">{t('discussions.selectAgent')}</h3>
            <p className="text-xs text-warm-400">{t('discussions.implementHint')}</p>
            <div className="space-y-2">
              {discussion.agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => handleImplement(agent.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-warm-200 hover:border-accent hover:bg-accent/5 transition-colors"
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: agent.avatar_color || '#6366f1' }}
                  >
                    {agent.name.charAt(0)}
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-medium text-warm-700">{agent.name}</div>
                    <div className="text-xs text-warm-400">{t(`agents.roles.${agent.role}`) || agent.role}</div>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setShowImplementModal(false)} className="btn btn-sm text-xs text-warm-500 w-full">{t('header.cancel')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
