import { useState, useCallback, useEffect, useRef } from 'react';
import { ChevronRight, GitBranch, Play, Square, Trash2, TerminalSquare, Archive } from 'lucide-react';
import EmptyState from './EmptyState';
import type { Session, SessionLog, TaskLog } from '../types';
import type { WsEvent } from '../hooks/useWebSocket';
import { useI18n } from '../i18n';
import * as sessionsApi from '../api/sessions';
import SessionForm from './SessionForm';
import LogViewer from './LogViewer';
import { CMD, CMD_FONT } from './terminal-theme';

interface SessionListProps {
  projectId: string;
  sessions: Session[];
  projectCliTool?: string;
  projectCliModel?: string;
  isGitRepo?: boolean;
  onAddSession: (session: Session) => void;
  onStartSession: (id: string) => Promise<void>;
  onStopSession: (id: string) => Promise<void>;
  onDeleteSession: (id: string) => Promise<void>;
  onCleanupSession: (id: string) => Promise<void>;
  onSendInput: (sessionId: string, input: string) => void;
  onEvent: (cb: (event: WsEvent) => void) => () => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-warm-200 text-warm-600',
  running: 'bg-status-success/10 text-status-success',
  completed: 'bg-accent/10 text-accent',
  failed: 'bg-status-error/10 text-status-error',
  stopped: 'bg-amber-100 text-amber-700',
};

function sessionLogToTaskLog(log: SessionLog): TaskLog {
  return {
    id: log.id,
    todo_id: log.session_id,
    log_type: log.log_type as TaskLog['log_type'],
    message: log.message,
    created_at: log.created_at,
  };
}

export default function SessionList({
  projectId,
  sessions,
  projectCliTool,
  projectCliModel,
  isGitRepo,
  onAddSession,
  onStartSession,
  onStopSession,
  onDeleteSession,
  onCleanupSession,
  onSendInput,
  onEvent,
}: SessionListProps) {
  const { t } = useI18n();
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sessionLogs, setSessionLogs] = useState<Record<string, TaskLog[]>>({});
  const sessionLogsRef = useRef(sessionLogs);
  sessionLogsRef.current = sessionLogs;

  // Load logs when expanding a session
  useEffect(() => {
    if (!expandedId) return;
    sessionsApi.getSessionLogs(expandedId).then((logs) => {
      setSessionLogs((prev) => ({
        ...prev,
        [expandedId]: logs.map(sessionLogToTaskLog),
      }));
    }).catch(() => {});
  }, [expandedId]);

  // Auto-expand running sessions
  useEffect(() => {
    const running = sessions.find((s) => s.status === 'running');
    if (running && !expandedId) {
      setExpandedId(running.id);
    }
  }, [sessions, expandedId]);

  // Listen for session log events
  useEffect(() => {
    return onEvent((event) => {
      if (event.type === 'session:log' && event.sessionId && event.message) {
        const newLog: TaskLog = {
          id: `ws-${Date.now()}-${Math.random()}`,
          todo_id: event.sessionId,
          log_type: (event.logType || 'output') as TaskLog['log_type'],
          message: event.message,
          created_at: new Date().toISOString(),
        };
        setSessionLogs((prev) => ({
          ...prev,
          [event.sessionId!]: [...(prev[event.sessionId!] || []), newLog],
        }));
      }
    });
  }, [onEvent]);

  const handleCreate = useCallback(async (title: string, description: string, cliTool?: string, cliModel?: string, useWorktree?: boolean) => {
    setCreating(true);
    try {
      const session = await sessionsApi.createSession(projectId, {
        title,
        description: description || undefined,
        cli_tool: cliTool,
        cli_model: cliModel,
        use_worktree: useWorktree,
      });
      onAddSession(session);
      setShowForm(false);
    } finally {
      setCreating(false);
    }
  }, [projectId, onAddSession]);

  const handleSendInput = useCallback((todoId: string, input: string) => {
    onSendInput(todoId, input);
  }, [onSendInput]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-warm-700 tracking-wide uppercase">
          {t('tabs.sessions')}
        </h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn-primary text-xs py-2"
        >
          + {t('session.new')}
        </button>
      </div>

      {showForm && (
        <SessionForm
          onSave={handleCreate}
          onCancel={() => setShowForm(false)}
          projectCliTool={projectCliTool}
          projectCliModel={projectCliModel}
          isGitRepo={isGitRepo}
        />
      )}

      {sessions.length === 0 && !showForm ? (
        <div className="card">
          <EmptyState icon={TerminalSquare} title={t('session.empty')} description={t('session.emptyHint')} />
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session, index) => {
            const isExpanded = expandedId === session.id;
            const canStart = ['pending', 'failed', 'stopped', 'completed'].includes(session.status);
            const canStop = session.status === 'running';
            const logs = sessionLogs[session.id] || [];

            return (
              <div
                key={session.id}
                className="card overflow-hidden animate-slide-up"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div
                  className="p-4 cursor-pointer hover:bg-warm-50/50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : session.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <ChevronRight size={12} className={`text-warm-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        <h3 className="text-sm font-semibold text-warm-700 truncate">{session.title}</h3>
                        <span className={`px-1.5 py-0.5 rounded text-2xs font-semibold uppercase ${STATUS_COLORS[session.status] || ''}`}>
                          {t(`status.${session.status}`) || session.status}
                        </span>
                      </div>
                      {session.description && (
                        <p className="text-xs text-warm-400 mt-1 ml-5 line-clamp-1">{session.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1 ml-5">
                        <span className="text-2xs text-warm-300">
                          {session.cli_tool || 'claude'}
                          {session.cli_model ? ` / ${session.cli_model}` : ''}
                        </span>
                        {session.branch_name && (
                          <span className="text-2xs text-accent/70 flex items-center gap-0.5">
                            <GitBranch size={12} />
                            {session.branch_name}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      {canStart && (
                        <button
                          onClick={() => {
                            onStartSession(session.id);
                            setExpandedId(session.id);
                          }}
                          className="p-1.5 text-status-success hover:bg-status-success/10 rounded transition-colors"
                          title={t('session.start')}
                        >
                          <Play size={16} />
                        </button>
                      )}
                      {canStop && (
                        <button
                          onClick={() => onStopSession(session.id)}
                          className="p-1.5 text-amber-600 hover:bg-amber-50 rounded transition-colors"
                          title={t('session.stop')}
                        >
                          <Square size={16} />
                        </button>
                      )}
                      {session.status !== 'running' && (session.worktree_path || session.branch_name) && (
                        <button
                          onClick={() => onCleanupSession(session.id)}
                          className="p-1.5 text-warm-400 hover:text-amber-600 rounded transition-colors"
                          title={t('session.cleanup')}
                        >
                          <Archive size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => onDeleteSession(session.id)}
                        className="p-1.5 text-warm-400 hover:text-status-error rounded transition-colors"
                        title={t('session.delete')}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="overflow-hidden" style={{ borderTop: `1px solid ${CMD.separator}` }}>
                    {/* Title bar */}
                    <div style={{ display: 'flex', alignItems: 'center', background: CMD.titleBg, padding: '8px 12px', gap: 8, userSelect: 'none' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57', display: 'inline-block' }} />
                        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e', display: 'inline-block' }} />
                        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840', display: 'inline-block' }} />
                      </div>
                      <span style={{ flex: 1, textAlign: 'center', color: CMD.titleText, fontSize: 12, fontFamily: CMD_FONT }}>
                        {session.title}{session.cli_tool ? ` — ${session.cli_tool}${session.cli_model ? `/${session.cli_model}` : ''}` : ''}
                      </span>
                      <div style={{ width: 54 }} />
                    </div>
                    {/* Terminal body */}
                    <div style={{ background: CMD.bg, padding: '12px 16px', fontFamily: CMD_FONT, fontSize: 12, lineHeight: '1.5', color: CMD.text }}>
                      {session.branch_name && (
                        <div style={{ marginBottom: 8 }}>
                          <span style={{ color: CMD.prompt }}>$</span> <span style={{ color: CMD.bright }}>git</span> <span style={{ color: CMD.dim }}>branch</span>
                          <div><span style={{ color: CMD.success }}>*</span> <span style={{ color: CMD.info }}>{session.branch_name}</span></div>
                        </div>
                      )}
                      <LogViewer
                        logs={logs}
                        interactive={session.status === 'running'}
                        todoId={session.id}
                        onSendInput={session.status === 'running' ? handleSendInput : undefined}
                        embedded
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
