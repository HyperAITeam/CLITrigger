import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { DiscussionWithMessages, DiscussionMessage, DiscussionAgent, DiscussionLog } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import * as discussionsApi from '../api/discussions';
import { useI18n } from '../i18n';

interface DiscussionDetailProps {
  onEvent: (cb: (event: WsEvent) => void) => () => void;
  connected: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-warm-200 text-warm-600',
  running: 'bg-status-success/10 text-status-success',
  paused: 'bg-amber-100 text-amber-700',
  completed: 'bg-accent-gold/10 text-accent-gold',
  failed: 'bg-status-error/10 text-status-error',
  merged: 'bg-accent-gold/10 text-accent-gold',
};

export default function DiscussionDetail({ onEvent, connected }: DiscussionDetailProps) {
  const { id, discussionId } = useParams<{ id: string; discussionId: string }>();
  const { t } = useI18n();
  const [discussion, setDiscussion] = useState<DiscussionWithMessages | null>(null);
  const [loading, setLoading] = useState(true);
  const [streamingLogs, setStreamingLogs] = useState<Map<string, string[]>>(new Map());
  const [userMessage, setUserMessage] = useState('');
  const [showImplementModal, setShowImplementModal] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load discussion
  useEffect(() => {
    if (!discussionId) return;
    discussionsApi.getDiscussion(discussionId)
      .then(setDiscussion)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [discussionId]);

  // WebSocket events
  useEffect(() => {
    return onEvent((event) => {
      if (!discussionId) return;

      if (event.type === 'discussion:status-changed' && event.discussionId === discussionId) {
        setDiscussion((prev) => prev ? {
          ...prev,
          status: event.status as any,
          current_round: event.currentRound ?? prev.current_round,
          current_agent_id: event.currentAgentId ?? prev.current_agent_id,
        } : prev);
      }

      if (event.type === 'discussion:message-changed' && event.discussionId === discussionId) {
        setDiscussion((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            messages: prev.messages.map((m) =>
              m.id === event.messageId ? { ...m, status: event.status as any } : m
            ),
          };
        });
        // If completed, reload to get content
        if (event.status === 'completed' || event.status === 'failed') {
          discussionsApi.getDiscussion(discussionId).then(setDiscussion).catch(() => {});
        }
      }

      if (event.type === 'discussion:log' && event.discussionId === discussionId && event.messageId) {
        setStreamingLogs((prev) => {
          const next = new Map(prev);
          const logs = next.get(event.messageId!) || [];
          next.set(event.messageId!, [...logs, event.message || '']);
          return next;
        });
      }
    });
  }, [onEvent, discussionId]);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [discussion?.messages, streamingLogs]);

  const handleStart = useCallback(async () => {
    if (!discussionId) return;
    const updated = await discussionsApi.startDiscussion(discussionId);
    setDiscussion(updated);
  }, [discussionId]);

  const handleStop = useCallback(async () => {
    if (!discussionId) return;
    await discussionsApi.stopDiscussion(discussionId);
    const updated = await discussionsApi.getDiscussion(discussionId);
    setDiscussion(updated);
  }, [discussionId]);

  const handleInject = useCallback(async () => {
    if (!discussionId || !userMessage.trim()) return;
    await discussionsApi.injectMessage(discussionId, userMessage);
    setUserMessage('');
    const updated = await discussionsApi.getDiscussion(discussionId);
    setDiscussion(updated);
  }, [discussionId, userMessage]);

  const handleSkipTurn = useCallback(async () => {
    if (!discussionId) return;
    const updated = await discussionsApi.skipTurn(discussionId);
    setDiscussion(updated);
  }, [discussionId]);

  const handleImplement = useCallback(async (agentId: string) => {
    if (!discussionId) return;
    setShowImplementModal(false);
    const updated = await discussionsApi.triggerImplementation(discussionId, agentId);
    setDiscussion(updated);
  }, [discussionId]);

  const handleMerge = useCallback(async () => {
    if (!discussionId) return;
    await discussionsApi.mergeDiscussion(discussionId);
    const updated = await discussionsApi.getDiscussion(discussionId);
    setDiscussion(updated);
  }, [discussionId]);

  if (loading) {
    return <div className="mx-auto max-w-4xl px-4 py-8 text-center text-warm-500">{t('detail.loading')}</div>;
  }

  if (!discussion) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 text-center">
        <p className="text-status-error">{t('discussions.notFound')}</p>
        <Link to={`/projects/${id}`} className="text-sm text-accent-gold mt-2 inline-block">{t('discussions.back')}</Link>
      </div>
    );
  }

  const agentMap = new Map(discussion.agents.map((a) => [a.id, a]));
  const canStart = discussion.status === 'pending' || discussion.status === 'paused' || discussion.status === 'failed';
  const canStop = discussion.status === 'running';
  const canImplement = discussion.status === 'completed' || discussion.status === 'paused';
  const canMerge = discussion.status === 'completed';
  const canInject = discussion.status === 'paused' || discussion.status === 'running';

  // Group messages by round
  const rounds = new Map<number, DiscussionMessage[]>();
  for (const msg of discussion.messages) {
    const arr = rounds.get(msg.round_number) || [];
    arr.push(msg);
    rounds.set(msg.round_number, arr);
  }
  const sortedRounds = [...rounds.keys()].sort((a, b) => a - b);

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-8 flex flex-col" style={{ height: 'calc(100vh - 2rem)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link
          to={`/projects/${id}`}
          className="inline-flex items-center gap-1 text-sm text-warm-500 hover:text-accent-gold transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t('discussions.back')}
        </Link>
        <span className="text-warm-300">/</span>
        <span className="text-sm font-medium text-warm-700 truncate">{discussion.title}</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${STATUS_COLORS[discussion.status]}`}>
          {t(`status.${discussion.status}`) || discussion.status}
        </span>
        {discussion.status === 'running' && (
          <span className="text-[10px] text-status-success animate-pulse">
            {t('discussions.round')} {discussion.current_round}/{discussion.max_rounds}
          </span>
        )}
        {connected && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-status-success">
            <span className="h-1.5 w-1.5 rounded-full bg-status-success animate-pulse" />
          </span>
        )}
      </div>

      {/* Control bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {canStart && (
          <button onClick={handleStart} className="btn btn-sm btn-primary text-xs flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            {discussion.status === 'pending' ? t('header.runAll') : 'Resume'}
          </button>
        )}
        {canStop && (
          <button onClick={handleStop} className="btn btn-sm text-xs flex items-center gap-1 text-amber-600">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
            Pause
          </button>
        )}
        {canStop && (
          <button onClick={handleSkipTurn} className="btn btn-sm text-xs text-warm-500">{t('discussions.skipTurn')}</button>
        )}
        {canImplement && (
          <button onClick={() => setShowImplementModal(true)} className="btn btn-sm text-xs text-accent-gold border-accent-gold">
            {t('discussions.implement')}
          </button>
        )}
        {canMerge && discussion.branch_name && (
          <button onClick={handleMerge} className="btn btn-sm text-xs text-accent-gold">{t('todos.merge')}</button>
        )}

        {/* Agent avatars */}
        <div className="ml-auto flex items-center gap-1">
          {discussion.agents.map((agent) => (
            <div
              key={agent.id}
              className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold transition-all ${
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

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto space-y-1 pb-4">
        {sortedRounds.map((round) => {
          const msgs = rounds.get(round)!;
          const isImplRound = round > discussion.max_rounds;
          return (
            <div key={round}>
              {/* Round separator */}
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-warm-200" />
                <span className="text-[10px] font-semibold text-warm-400 uppercase tracking-wider">
                  {isImplRound ? t('discussions.implementation') : `${t('discussions.round')} ${round}`}
                </span>
                <div className="flex-1 h-px bg-warm-200" />
              </div>

              {msgs.map((msg) => {
                const agent = agentMap.get(msg.agent_id);
                const isUser = msg.agent_id === 'user';
                const isRunning = msg.status === 'running';
                const logs = streamingLogs.get(msg.id) || [];

                return (
                  <div key={msg.id} className={`flex gap-3 py-3 ${isUser ? 'justify-end' : ''}`}>
                    {!isUser && (
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${
                          isRunning ? 'ring-2 ring-status-success ring-offset-1 animate-pulse' : ''
                        }`}
                        style={{ backgroundColor: agent?.avatar_color || '#94a3b8' }}
                      >
                        {msg.agent_name.charAt(0)}
                      </div>
                    )}
                    <div className={`flex-1 min-w-0 ${isUser ? 'max-w-[80%]' : ''}`}>
                      {!isUser && (
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-warm-700">{msg.agent_name}</span>
                          <span className="text-[10px] text-warm-400">{t(`agents.roles.${msg.role}`) || msg.role}</span>
                          {msg.status === 'skipped' && (
                            <span className="text-[10px] text-warm-300 italic">skipped</span>
                          )}
                        </div>
                      )}
                      <div className={`rounded-xl p-3 text-sm ${
                        isUser
                          ? 'bg-accent-gold/10 text-warm-700 ml-auto'
                          : msg.status === 'failed'
                          ? 'bg-status-error/5 border border-status-error/20'
                          : 'bg-warm-50 border border-warm-150'
                      }`}>
                        {/* Completed message content */}
                        {msg.content && (
                          <div className="whitespace-pre-wrap text-xs leading-relaxed">{msg.content}</div>
                        )}

                        {/* Streaming output */}
                        {isRunning && logs.length > 0 && (
                          <div className="text-xs text-warm-500 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto font-mono">
                            {logs.slice(-50).join('\n')}
                          </div>
                        )}

                        {/* Running indicator */}
                        {isRunning && logs.length === 0 && (
                          <div className="flex items-center gap-2 text-xs text-status-success">
                            <span className="h-1.5 w-1.5 rounded-full bg-status-success animate-pulse" />
                            {t('discussions.speaking')}
                          </div>
                        )}

                        {/* Pending */}
                        {msg.status === 'pending' && !msg.content && (
                          <div className="text-xs text-warm-300 italic">waiting...</div>
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

      {/* User input */}
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

      {/* Implementation modal */}
      {showImplementModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowImplementModal(false)}>
          <div className="bg-white rounded-xl p-6 w-80 shadow-xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-warm-700">{t('discussions.selectAgent')}</h3>
            <p className="text-xs text-warm-400">{t('discussions.implementHint')}</p>
            <div className="space-y-2">
              {discussion.agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => handleImplement(agent.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border border-warm-200 hover:border-accent-gold hover:bg-accent-gold/5 transition-colors"
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
        </div>
      )}
    </div>
  );
}
