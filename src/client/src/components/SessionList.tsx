import { useState, useCallback, useMemo, useEffect } from 'react';
import { GitBranch, Play, RotateCcw, Square, Trash2, TerminalSquare, Archive, Edit2 } from 'lucide-react';
import EmptyState from './EmptyState';
import type { Session, MemoryInjectMode, SessionTag } from '../types';
import { useI18n } from '../i18n';
import * as sessionsApi from '../api/sessions';
import * as tagsApi from '../api/sessionTags';
import { parseMemoryNodeIds } from '../api/memory';

function parseRawFilePaths(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}
import SessionForm, { type SessionFormInitial } from './SessionForm';
import { useSessionWindows } from './SessionWindowsHost';

interface SessionListProps {
  projectId: string;
  sessions: Session[];
  projectCliTool?: string;
  projectCliModel?: string;
  isGitRepo?: boolean;
  projectUseWorktree?: boolean;
  projectDefaultBranch?: string;
  onAddSession: (session: Session) => void;
  onUpdateSession: (session: Session) => void;
  onStopSession: (id: string) => Promise<void>;
  onDeleteSession: (id: string) => Promise<void>;
  onCleanupSession: (id: string, deleteBranch: boolean) => Promise<void>;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-warm-200 text-warm-600',
  running: 'bg-status-success/10 text-status-success',
  completed: 'bg-accent/10 text-accent',
  failed: 'bg-status-error/10 text-status-error',
  stopped: 'bg-amber-100 text-amber-700',
};

export default function SessionList({
  projectId,
  sessions,
  projectCliTool,
  projectCliModel,
  isGitRepo,
  projectUseWorktree,
  projectDefaultBranch,
  onAddSession,
  onUpdateSession,
  onStopSession,
  onDeleteSession,
  onCleanupSession,
}: SessionListProps) {
  const { t } = useI18n();
  const { openOrFocus } = useSessionWindows();
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [tags, setTags] = useState<SessionTag[]>([]);

  useEffect(() => {
    let cancelled = false;
    tagsApi.getSessionTags()
      .then((list) => { if (!cancelled) setTags(list); })
      .catch(() => { /* tags optional — silent */ });
    return () => { cancelled = true; };
  }, []);

  const tagsById = useMemo(() => {
    const map = new Map<string, SessionTag>();
    for (const tag of tags) map.set(tag.id, tag);
    return map;
  }, [tags]);

  const editingSession = useMemo(
    () => (editingId ? sessions.find((s) => s.id === editingId) ?? null : null),
    [editingId, sessions],
  );
  const editingInitial: SessionFormInitial | undefined = useMemo(() => {
    if (!editingSession) return undefined;
    return {
      title: editingSession.title,
      description: editingSession.description ?? '',
      cliTool: editingSession.cli_tool ?? '',
      cliModel: editingSession.cli_model ?? '',
      useWorktree: editingSession.use_worktree === 1,
      memoryInjectMode: (editingSession.memory_inject_mode as MemoryInjectMode | null) ?? 'none',
      memoryNodeIds: parseMemoryNodeIds(editingSession.memory_node_ids ?? null),
      memoryRawFilePaths: parseRawFilePaths(editingSession.memory_raw_file_paths ?? null),
      tagId: editingSession.tag_id ?? null,
    };
  }, [editingSession]);

  const startCreate = useCallback(() => {
    setEditingId(null);
    setEditError(null);
    setShowForm((v) => !v);
  }, []);

  const startEdit = useCallback((sessionId: string) => {
    setShowForm(false);
    setEditError(null);
    setEditingId(sessionId);
  }, []);

  const cancelForm = useCallback(() => {
    setShowForm(false);
    setEditingId(null);
    setEditError(null);
  }, []);

  const handleCreate = useCallback(async (
    title: string,
    description: string,
    cliTool?: string,
    cliModel?: string,
    useWorktree?: boolean,
    memoryInjectMode?: MemoryInjectMode,
    memoryNodeIds?: string[],
    memoryRawFilePaths?: string[],
    tagId?: string | null,
  ) => {
    setCreating(true);
    try {
      const session = await sessionsApi.createSession(projectId, {
        title,
        description: description || undefined,
        cli_tool: cliTool,
        cli_model: cliModel,
        use_worktree: useWorktree,
        memory_inject_mode: memoryInjectMode,
        memory_node_ids: memoryNodeIds,
        memory_raw_file_paths: memoryRawFilePaths,
        tag_id: tagId ?? null,
      });
      onAddSession(session);
      setShowForm(false);
    } finally {
      setCreating(false);
    }
  }, [projectId, onAddSession]);

  const handleUpdate = useCallback(async (
    title: string,
    description: string,
    cliTool?: string,
    cliModel?: string,
    useWorktree?: boolean,
    memoryInjectMode?: MemoryInjectMode,
    memoryNodeIds?: string[],
    memoryRawFilePaths?: string[],
    tagId?: string | null,
  ) => {
    if (!editingId) return;
    setSaving(true);
    setEditError(null);
    try {
      const updated = await sessionsApi.updateSession(editingId, {
        title,
        description: description || undefined,
        cli_tool: cliTool,
        cli_model: cliModel,
        use_worktree: useWorktree,
        memory_inject_mode: memoryInjectMode,
        memory_node_ids: memoryNodeIds,
        memory_raw_file_paths: memoryRawFilePaths,
        tag_id: tagId ?? null,
      });
      onUpdateSession(updated);
      setEditingId(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [editingId, onUpdateSession]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-warm-700 tracking-wide uppercase">
          {t('tabs.sessions')}
        </h2>
        <button
          onClick={startCreate}
          className="btn-primary text-xs py-2"
          disabled={creating}
        >
          + {t('session.new')}
        </button>
      </div>

      {showForm && (
        <SessionForm
          projectId={projectId}
          onSave={handleCreate}
          onCancel={cancelForm}
          projectCliTool={projectCliTool}
          projectCliModel={projectCliModel}
          isGitRepo={isGitRepo}
          projectUseWorktree={projectUseWorktree}
        />
      )}

      {editingInitial && editingId && (
        <div className="space-y-2">
          <SessionForm
            key={editingId}
            projectId={projectId}
            initial={editingInitial}
            onSave={handleUpdate}
            onCancel={cancelForm}
            projectCliTool={projectCliTool}
            projectCliModel={projectCliModel}
            isGitRepo={isGitRepo}
          />
          {(saving || editError) && (
            <div className="text-xs px-1">
              {saving && <span className="text-warm-500">{t('session.saving') || 'saving…'}</span>}
              {editError && <span className="text-status-error">{editError}</span>}
            </div>
          )}
        </div>
      )}

      {sessions.length === 0 && !showForm ? (
        <div className="card">
          <EmptyState icon={TerminalSquare} title={t('session.empty')} description={t('session.emptyHint')} />
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session, index) => {
            const canStart = ['pending', 'failed', 'stopped', 'completed'].includes(session.status);
            const canStop = session.status === 'running';
            const canEdit = session.status !== 'running';
            const canResume =
              ['stopped', 'failed', 'completed'].includes(session.status) &&
              (session.cli_tool ?? 'claude') === 'claude' &&
              !!session.worktree_path;
            const isEditing = editingId === session.id;

            return (
              <div
                key={session.id}
                className={`card overflow-hidden animate-slide-up ${isEditing ? 'border-l-4 border-accent bg-warm-100/30' : ''}`}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div
                  className="p-4 cursor-pointer hover:bg-warm-50/50 transition-colors"
                  onClick={() => openOrFocus(session.id, 'open')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {session.tag_id && tagsById.get(session.tag_id) && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium"
                            style={{
                              backgroundColor: `${tagsById.get(session.tag_id)!.color}22`,
                              color: tagsById.get(session.tag_id)!.color,
                            }}
                          >
                            <span
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: tagsById.get(session.tag_id)!.color }}
                            />
                            {tagsById.get(session.tag_id)!.name}
                          </span>
                        )}
                        <h3 className="text-sm font-semibold text-warm-700 truncate">{session.title}</h3>
                        <span className={`px-1.5 py-0.5 rounded text-2xs font-semibold uppercase ${STATUS_COLORS[session.status] || ''}`}>
                          {t(`status.${session.status}`) || session.status}
                        </span>
                      </div>
                      {session.description && (
                        <p className="text-xs text-warm-400 mt-1 line-clamp-1">{session.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-2xs text-warm-300">
                          {session.cli_tool || 'claude'}
                          {session.cli_model ? ` / ${session.cli_model}` : ''}
                        </span>
                        {(session.branch_name || (isGitRepo && projectDefaultBranch)) && (
                          <span className="text-2xs text-accent/70 flex items-center gap-0.5">
                            <GitBranch size={12} />
                            {session.branch_name || projectDefaultBranch}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      {canStart && (
                        <button
                          onClick={() => openOrFocus(session.id, 'start')}
                          className="p-1.5 text-status-success hover:bg-status-success/10 rounded transition-colors"
                          title={t('session.start')}
                        >
                          <Play size={16} />
                        </button>
                      )}
                      {canResume && (
                        <button
                          onClick={() => openOrFocus(session.id, 'resume')}
                          className="p-1.5 text-accent hover:bg-accent/10 rounded transition-colors"
                          title={t('session.resumeHint') || t('session.resume')}
                        >
                          <RotateCcw size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(session.id)}
                        disabled={!canEdit}
                        className="p-1.5 text-warm-500 hover:text-warm-800 hover:bg-warm-100 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-warm-500"
                        title={canEdit ? t('session.edit') : t('session.editDisabledRunning')}
                      >
                        <Edit2 size={16} />
                      </button>
                      {canStop && (
                        <button
                          onClick={() => onStopSession(session.id)}
                          className="p-1.5 text-amber-600 hover:bg-amber-50 rounded transition-colors"
                          title={t('session.stop')}
                        >
                          <Square size={16} />
                        </button>
                      )}
                      {session.status !== 'running' && (!!session.worktree_path || !!session.branch_name) && (
                        <button
                          onClick={() => {
                            const deleteBranch = session.branch_name
                              ? confirm(t('cleanup.confirmDeleteBranch').replace('{name}', session.branch_name))
                              : false;
                            onCleanupSession(session.id, deleteBranch);
                          }}
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
