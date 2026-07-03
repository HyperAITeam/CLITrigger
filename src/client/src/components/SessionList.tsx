import { useState, useCallback, useMemo, useEffect } from 'react';
import { GitBranch, Play, RotateCcw, Square, Trash2, TerminalSquare, Archive, Edit2, ExternalLink, Maximize2, Plus } from 'lucide-react';
import CursorContextMenu, {
  CtxMenuSeparator,
  ctxMenuItemClass,
  ctxMenuDangerItemClass,
  isNativeContextMenuTarget,
} from './CursorContextMenu';
import EmptyState from './EmptyState';
import type { Session, MemoryInjectMode, SessionTag } from '../types';
import { useI18n } from '../i18n';
import * as sessionsApi from '../api/sessions';
import * as projectsApi from '../api/projects';
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
import { useSessionWindows, useSessionWindowStates, type WindowState } from './SessionWindowsHost';

interface SessionListProps {
  projectId: string;
  sessions: Session[];
  projectCliTool?: string;
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

// Visual treatment for the per-row window-placement badge.
const WIN_BADGE: Record<Exclude<WindowState, 'closed'>, string> = {
  floating: 'bg-accent/10 text-accent',
  minimized: 'bg-warm-200 text-warm-600',
  popped: 'bg-violet-500/15 text-violet-500',
};

export default function SessionList({
  projectId,
  sessions,
  projectCliTool,
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
  const { openOrFocus, recallPopout } = useSessionWindows();
  const windowStates = useSessionWindowStates();
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [tags, setTags] = useState<SessionTag[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>('');
  // Right-click menu state. sessionId === null → empty-area menu (new
  // terminal only); otherwise the session's state-appropriate actions.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; sessionId: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    tagsApi.getSessionTags()
      .then((list) => { if (!cancelled) setTags(list); })
      .catch(() => { /* tags optional — silent */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isGitRepo) return;
    let cancelled = false;
    projectsApi.getGitStatusTree(projectId)
      .then((result) => { if (!cancelled) setCurrentBranch(result.branch || ''); })
      .catch(() => { /* non-critical */ });
    return () => { cancelled = true; };
  }, [projectId, isGitRepo]);

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
    <div
      // min-h so the blank space under a short list still belongs to this
      // container — right-click there should offer "new terminal" too.
      className="space-y-4 animate-fade-in min-h-[50vh]"
      // Empty-area right-click → "new terminal" menu. Rows stopPropagation and
      // open their own menu; text fields / terminals keep the native menu.
      onContextMenu={(e) => {
        if (isNativeContextMenuTarget(e)) return;
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY, sessionId: null });
      }}
    >
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
            const winState = windowStates[session.id] ?? 'closed';
            const isPopped = winState === 'popped';

            return (
              <div
                key={session.id}
                className={`card overflow-hidden animate-slide-up ${isEditing ? 'border-l-4 border-accent bg-warm-100/30' : ''}`}
                style={{ animationDelay: `${index * 50}ms` }}
                onContextMenu={(e) => {
                  if (isNativeContextMenuTarget(e)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setCtxMenu({ x: e.clientX, y: e.clientY, sessionId: session.id });
                }}
              >
                <div
                  className="p-4 cursor-pointer hover:bg-warm-50/50 transition-colors"
                  onClick={() => isPopped ? recallPopout(session.id) : openOrFocus(session.id, 'open')}
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
                        {winState !== 'closed' && (
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium ${WIN_BADGE[winState]}`}
                            title={isPopped ? t('session.dock.poppedHint') : undefined}
                          >
                            {isPopped && <ExternalLink size={10} />}
                            {t(`session.windowState.${winState}`)}
                          </span>
                        )}
                      </div>
                      {session.description && (
                        <p className="text-xs text-warm-400 mt-1 line-clamp-1">{session.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-2xs text-warm-300">
                          {session.cli_tool || 'claude'}
                        </span>
                        {(session.branch_name || (isGitRepo && (currentBranch || projectDefaultBranch))) && (
                          <span className="text-2xs text-accent/70 flex items-center gap-0.5">
                            <GitBranch size={12} />
                            {session.branch_name || currentBranch || projectDefaultBranch}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      {isPopped && (
                        <button
                          onClick={() => recallPopout(session.id)}
                          className="p-1.5 text-violet-500 hover:bg-violet-500/10 rounded transition-colors"
                          title={t('session.recallToMain')}
                        >
                          <Maximize2 size={16} />
                        </button>
                      )}
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

      {/* Right-click menu — mirrors the row buttons for the clicked session,
          or offers "new terminal" on empty space. Items are gated on the same
          status flags as the buttons so only currently-valid actions show. */}
      {ctxMenu && (() => {
        const close = () => setCtxMenu(null);
        const session = ctxMenu.sessionId ? sessions.find((s) => s.id === ctxMenu.sessionId) : undefined;
        if (!session) {
          return (
            <CursorContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={close}>
              <button
                type="button"
                onClick={() => { setEditingId(null); setEditError(null); setShowForm(true); }}
                className={ctxMenuItemClass}
              >
                <Plus size={14} />
                {t('session.new')}
              </button>
            </CursorContextMenu>
          );
        }
        const canStart = ['pending', 'failed', 'stopped', 'completed'].includes(session.status);
        const canStop = session.status === 'running';
        const canEdit = session.status !== 'running';
        const canResume =
          ['stopped', 'failed', 'completed'].includes(session.status) &&
          (session.cli_tool ?? 'claude') === 'claude' &&
          !!session.worktree_path;
        const canCleanup = session.status !== 'running' && (!!session.worktree_path || !!session.branch_name);
        const winState = windowStates[session.id] ?? 'closed';
        const isPopped = winState === 'popped';
        const openLabel = isPopped
          ? t('session.recallToMain')
          : winState === 'minimized'
            ? t('session.restoreWindow')
            : winState === 'floating'
              ? t('session.focusWindow')
              : t('session.openWindow');
        return (
          <CursorContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={close}>
            <button
              type="button"
              onClick={() => isPopped ? recallPopout(session.id) : openOrFocus(session.id, 'open')}
              className={ctxMenuItemClass}
            >
              {isPopped ? <Maximize2 size={14} /> : <TerminalSquare size={14} />}
              {openLabel}
            </button>
            {canStart && (
              <button
                type="button"
                onClick={() => openOrFocus(session.id, 'start')}
                className={ctxMenuItemClass}
              >
                <Play size={14} />
                {t('session.start')}
              </button>
            )}
            {canResume && (
              <button
                type="button"
                onClick={() => openOrFocus(session.id, 'resume')}
                className={ctxMenuItemClass}
                title={t('session.resumeHint') || t('session.resume')}
              >
                <RotateCcw size={14} />
                {t('session.resume')}
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => startEdit(session.id)}
                className={ctxMenuItemClass}
              >
                <Edit2 size={14} />
                {t('session.edit')}
              </button>
            )}
            {canStop && (
              <button
                type="button"
                onClick={() => onStopSession(session.id)}
                className={ctxMenuItemClass}
              >
                <Square size={14} />
                {t('session.stop')}
              </button>
            )}
            {canCleanup && (
              <button
                type="button"
                onClick={() => {
                  const deleteBranch = session.branch_name
                    ? confirm(t('cleanup.confirmDeleteBranch').replace('{name}', session.branch_name))
                    : false;
                  onCleanupSession(session.id, deleteBranch);
                }}
                className={ctxMenuItemClass}
              >
                <Archive size={14} />
                {t('session.cleanup')}
              </button>
            )}
            <CtxMenuSeparator />
            <button
              type="button"
              onClick={() => onDeleteSession(session.id)}
              className={ctxMenuDangerItemClass}
            >
              <Trash2 size={14} />
              {t('session.delete')}
            </button>
          </CursorContextMenu>
        );
      })()}
    </div>
  );
}
