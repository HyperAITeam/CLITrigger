import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { GitBranch, Play, RotateCcw, Square, Trash2, TerminalSquare, Archive, Edit2, ExternalLink, Maximize2, Plus, CornerDownRight } from 'lucide-react';
import CursorContextMenu, {
  CtxMenuSeparator,
  ctxMenuItemClass,
  ctxMenuDangerItemClass,
  isNativeContextMenuTarget,
} from './CursorContextMenu';
import EmptyState from './EmptyState';
import type { Session, MemoryInjectMode, SessionTag } from '../types';
import { useI18n } from '../i18n';
import { useDialog } from '../hooks/useDialog';
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
import { useSessionWindows, useSessionWindowStates, useSessionWindowGroups, type WindowState } from './SessionWindowsHost';

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
  onReorderSessions: (orderedIds: string[]) => void;
}

// Keep state visible without turning every bit of metadata into a coloured chip.
// The small dot carries the semantic colour; the label stays in the card's
// normal text hierarchy so titles remain the focal point.
const STATUS_DOT: Record<string, string> = {
  pending: 'bg-warm-400',
  running: 'bg-status-success',
  completed: 'bg-accent',
  failed: 'bg-status-error',
  stopped: 'bg-status-warning',
};

/** New flat id order after dropping block `sourceIndex` into gap `gapIndex`
 *  (gap i = before block i), or null when the drop changes nothing. */
export function moveBlock(blocks: string[][], sourceIndex: number, gapIndex: number): string[] | null {
  if (gapIndex === sourceIndex || gapIndex === sourceIndex + 1) return null;
  const reordered = blocks.filter((_, index) => index !== sourceIndex);
  reordered.splice(gapIndex > sourceIndex ? gapIndex - 1 : gapIndex, 0, blocks[sourceIndex]);
  return reordered.flat();
}

/** Sub-sessions (MCP spawn_session) right after their parent, depth-first.
 *  A session whose parent is not in the list shows as top-level. */
export function nestSessions(sessions: Session[]): { session: Session; depth: number }[] {
  const ids = new Set(sessions.map((session) => session.id));
  const childrenOf = new Map<string, Session[]>();
  const roots: Session[] = [];
  for (const session of sessions) {
    const parentId = session.parent_session_id;
    if (parentId && ids.has(parentId)) childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), session]);
    else roots.push(session);
  }
  const result: { session: Session; depth: number }[] = [];
  const visit = (session: Session, depth: number) => {
    result.push({ session, depth });
    for (const child of childrenOf.get(session.id) ?? []) visit(child, depth + 1);
  };
  roots.forEach((session) => visit(session, 0));
  return result;
}

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
  onReorderSessions,
}: SessionListProps) {
  const { t } = useI18n();
  const { confirm } = useDialog();
  const { openOrFocus, recallPopout } = useSessionWindows();
  const windowStates = useSessionWindowStates();
  const windowGroups = useSessionWindowGroups();
  // Pull sessions sharing a window up to their first member's slot so the rows
  // render as one joined block, mirroring the tabs docked together.
  const orderedSessions = useMemo(() => {
    const nested = nestSessions(sessions);
    const depthById = new Map(nested.map(({ session, depth }) => [session.id, depth]));
    const byGroup = new Map<string, Session[]>();
    for (const { session: s } of nested) {
      const groupId = windowGroups[s.id];
      if (groupId) byGroup.set(groupId, [...(byGroup.get(groupId) ?? []), s]);
    }
    const placed = new Set<string>();
    const result: { session: Session; position: 'single' | 'first' | 'middle' | 'last'; depth: number }[] = [];
    for (const { session: s } of nested) {
      if (placed.has(s.id)) continue;
      const members = byGroup.get(windowGroups[s.id] ?? '') ?? [s];
      members.forEach((member, i) => {
        placed.add(member.id);
        const position = members.length === 1 ? 'single' : i === 0 ? 'first' : i === members.length - 1 ? 'last' : 'middle';
        result.push({ session: member, position, depth: depthById.get(member.id) ?? 0 });
      });
    }
    return result;
  }, [sessions, windowGroups]);

  // Drag reorder moves blocks: sessions sharing a window travel together.
  const blocks = useMemo(() => {
    const result: string[][] = [];
    for (const { session, position } of orderedSessions) {
      if (position === 'middle' || position === 'last') result[result.length - 1].push(session.id);
      else result.push([session.id]);
    }
    return result;
  }, [orderedSessions]);
  const blockIndexById = useMemo(() => {
    const map = new Map<string, number>();
    blocks.forEach((ids, index) => ids.forEach((id) => map.set(id, index)));
    return map;
  }, [blocks]);
  const listRef = useRef<HTMLDivElement>(null);
  // gapIndex i = drop before block i (blocks.length = after the last).
  const [drag, setDrag] = useState<{ sourceIndex: number; gapIndex: number } | null>(null);
  // Swallows the click that follows mouseup so a drop doesn't open the window.
  const dragJustHappenedRef = useRef(false);

  // Mouse events, not HTML5 draggable — same reason as the Sidebar project
  // reorder (Edge/Chrome show an undismissable split-view drop target).
  const handleRowMouseDown = useCallback((sessionId: string, event: React.MouseEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    const sourceIndex = blockIndexById.get(sessionId);
    if (sourceIndex === undefined) return;
    event.preventDefault(); // no text selection while dragging
    const startX = event.clientX;
    const startY = event.clientY;
    let gapIndex: number | null = null;

    // A block counts as passed once the cursor is below its vertical midpoint.
    const computeGapIndex = (clientY: number): number => {
      const bounds: { top: number; bottom: number }[] = [];
      listRef.current?.querySelectorAll<HTMLElement>('[data-block-index]').forEach((row) => {
        const index = Number(row.dataset.blockIndex);
        const rect = row.getBoundingClientRect();
        bounds[index] = { top: bounds[index]?.top ?? rect.top, bottom: rect.bottom };
      });
      const index = bounds.findIndex((bound) => clientY < (bound.top + bound.bottom) / 2);
      return index === -1 ? bounds.length : index;
    };

    const onMove = (moveEvent: MouseEvent) => {
      if (gapIndex === null && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) return;
      const next = computeGapIndex(moveEvent.clientY);
      if (next === gapIndex) return;
      gapIndex = next;
      setDrag({ sourceIndex, gapIndex: next });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
      if (gapIndex === null) return; // plain click
      dragJustHappenedRef.current = true;
      requestAnimationFrame(() => { dragJustHappenedRef.current = false; });
      setDrag(null);
      const nextOrder = commit ? moveBlock(blocks, sourceIndex, gapIndex) : null;
      if (nextOrder) onReorderSessions(nextOrder);
    };
    const onUp = () => finish(true);
    const onKey = (keyEvent: KeyboardEvent) => { if (keyEvent.key === 'Escape') finish(false); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
  }, [blockIndexById, blocks, onReorderSessions]);
  const dropGapIndex = drag && drag.gapIndex !== drag.sourceIndex && drag.gapIndex !== drag.sourceIndex + 1
    ? drag.gapIndex
    : null;

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
      className="space-y-4 min-h-[50vh]"
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
        <div className="space-y-3" ref={listRef}>
          {orderedSessions.map(({ session, position, depth }) => {
            const canStart = ['pending', 'failed', 'stopped', 'completed'].includes(session.status);
            const canStop = session.status === 'running';
            const canEdit = session.status !== 'running';
            // Server-decided (saved conversation exists, CLI supports it).
            const canResume = ['stopped', 'failed', 'completed'].includes(session.status) && !!session.resumable;
            const isEditing = editingId === session.id;
            const winState = windowStates[session.id] ?? 'closed';
            const isPopped = winState === 'popped';
            // Joined block: inner seams lose their rounding and the gap, and
            // the hover lift is disabled so members don't split apart.
            const joinClass = {
              single: '',
              first: 'rounded-b-none hover:!translate-y-0',
              middle: '!mt-0 rounded-none border-t-0 hover:!translate-y-0',
              last: '!mt-0 rounded-t-none border-t-0 hover:!translate-y-0',
            }[position];
            const blockIndex = blockIndexById.get(session.id) ?? 0;
            // Drop marker as the card's own shadow: no layout shift (which
            // would move the rects mid-drag), and not clipped by overflow-hidden.
            const dropAbove = dropGapIndex === blockIndex && (position === 'single' || position === 'first');
            const dropBelow = dropGapIndex === blocks.length && blockIndex === blocks.length - 1 && (position === 'single' || position === 'last');

            return (
              <div
                key={session.id}
                data-block-index={blockIndex}
                className={`card overflow-hidden ${joinClass} ${isEditing ? 'border-l-4 border-accent bg-warm-100/30' : ''} ${drag?.sourceIndex === blockIndex ? 'opacity-50' : ''}`}
                style={{
                  marginLeft: depth * 24 || undefined,
                  boxShadow: dropAbove ? '0 -3px 0 0 var(--color-accent)' : dropBelow ? '0 3px 0 0 var(--color-accent)' : undefined,
                }}
                onContextMenu={(e) => {
                  if (isNativeContextMenuTarget(e)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setCtxMenu({ x: e.clientX, y: e.clientY, sessionId: session.id });
                }}
              >
                <div
                  className="p-4 cursor-pointer hover:bg-warm-50/50 transition-colors"
                  onMouseDown={(e) => handleRowMouseDown(session.id, e)}
                  onClick={() => {
                    if (dragJustHappenedRef.current) return;
                    if (isPopped) recallPopout(session.id);
                    else openOrFocus(session.id, 'open');
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {depth > 0 && <CornerDownRight size={14} className="shrink-0 text-warm-400" aria-hidden="true" />}
                        {session.tag_id && tagsById.get(session.tag_id) && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-2xs font-medium"
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
                        <span className="inline-flex items-center gap-1.5 text-2xs font-medium text-warm-500 whitespace-nowrap">
                          <span
                            aria-hidden="true"
                            className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[session.status] || 'bg-warm-400'}`}
                          />
                          {t(`status.${session.status}`) || session.status}
                        </span>
                        {winState !== 'closed' && (
                          <span
                            className="inline-flex items-center gap-1 text-2xs text-warm-400 whitespace-nowrap"
                            title={isPopped ? t('session.dock.poppedHint') : undefined}
                          >
                            {isPopped ? <ExternalLink size={12} /> : <span aria-hidden="true">·</span>}
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
                          className="p-1.5 text-accent hover:bg-accent/10 rounded-md transition-colors"
                          title={t('session.recallToMain')}
                        >
                          <Maximize2 size={16} />
                        </button>
                      )}
                      {canStart && (
                        <button
                          onClick={() => openOrFocus(session.id, 'start')}
                          className="p-1.5 text-status-success hover:bg-status-success/10 rounded-md transition-colors"
                          title={t('session.start')}
                        >
                          <Play size={16} />
                        </button>
                      )}
                      {canResume && (
                        <button
                          onClick={() => openOrFocus(session.id, 'resume')}
                          className="p-1.5 text-accent hover:bg-accent/10 rounded-md transition-colors"
                          title={t('session.resumeHint') || t('session.resume')}
                        >
                          <RotateCcw size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(session.id)}
                        disabled={!canEdit}
                        className="p-1.5 text-warm-500 hover:text-warm-800 hover:bg-warm-100 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-warm-500"
                        title={canEdit ? t('session.edit') : t('session.editDisabledRunning')}
                      >
                        <Edit2 size={16} />
                      </button>
                      {canStop && (
                        <button
                          onClick={() => onStopSession(session.id)}
                          className="p-1.5 text-status-warning hover:bg-status-warning/10 rounded-md transition-colors"
                          title={t('session.stop')}
                        >
                          <Square size={16} />
                        </button>
                      )}
                      {session.status !== 'running' && (!!session.worktree_path || !!session.branch_name) && (
                        <button
                          onClick={async () => {
                            const deleteBranch = session.branch_name
                              ? await confirm({ message: t('cleanup.confirmDeleteBranch').replace('{name}', session.branch_name), danger: true })
                              : false;
                            onCleanupSession(session.id, deleteBranch);
                          }}
                          className="p-1.5 text-warm-400 hover:text-status-warning rounded-md transition-colors"
                          title={t('session.cleanup')}
                        >
                          <Archive size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => onDeleteSession(session.id)}
                        className="p-1.5 text-warm-400 hover:text-status-error rounded-md transition-colors"
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
        const canResume = ['stopped', 'failed', 'completed'].includes(session.status) && !!session.resumable;
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
                onClick={async () => {
                  const deleteBranch = session.branch_name
                    ? await confirm({ message: t('cleanup.confirmDeleteBranch').replace('{name}', session.branch_name), danger: true })
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
