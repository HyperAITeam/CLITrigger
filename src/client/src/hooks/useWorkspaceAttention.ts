// Sidebar badge: per workspace, how many things finished or started waiting
// for input while the user wasn't looking.
//   session          — blocked/done while its pane wasn't focused; clears when
//                      the pane gets focus in any window, the agent resumes, or
//                      the session is deleted.
//   todo, discussion — completed/failed while another workspace was open;
//                      clears when its workspace is opened (or it runs again).
// ponytail: in memory only — a reload starts from zero, like the tab dots.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { WsEvent } from './useWebSocket';
import { isSessionFocused } from './useAgentStates';
import { openBus } from '../components/popout/popoutBus';

// "session:<id>" | "todo:<id>" | "discussion:<id>" → projectId
type Unseen = ReadonlyMap<string, string>;

function withKey(prev: Unseen, key: string, projectId: string | null): Unseen {
  if (projectId ? prev.get(key) === projectId : !prev.has(key)) return prev;
  const next = new Map(prev);
  if (projectId) next.set(key, projectId);
  else next.delete(key);
  return next;
}

function without(prev: Unseen, drop: (key: string, projectId: string) => boolean): Unseen {
  let next: Map<string, string> | null = null;
  for (const [key, projectId] of prev) {
    if (!drop(key, projectId)) continue;
    next ??= new Map(prev);
    next.delete(key);
  }
  return next ?? prev;
}

const isFinished = (status?: string) => status === 'completed' || status === 'failed';

export function useWorkspaceAttention(
  onEvent: (cb: (event: WsEvent) => void) => () => void,
  activeProjectId: string | null,
): Record<string, number> {
  const [unseen, setUnseen] = useState<Unseen>(() => new Map());
  const activeRef = useRef(activeProjectId);
  activeRef.current = activeProjectId;

  useEffect(() => onEvent((event) => {
    if (event.type === 'session:deleted' && event.sessionId) {
      setUnseen((prev) => withKey(prev, `session:${event.sessionId}`, null));
      return;
    }
    // The agent-state resend after `session:subscribe` carries no projectId — not a transition.
    const projectId = event.projectId;
    if (!projectId) return;
    let key: string;
    let raise: boolean;
    if (event.type === 'session:agent-state' && event.sessionId) {
      key = `session:${event.sessionId}`;
      // A user-initiated stop also ends as `done` — that isn't news.
      raise = (event.state === 'blocked' || (event.state === 'done' && event.reason !== 'stopped'))
        && !isSessionFocused(event.sessionId);
    } else if (event.type === 'todo:status-changed' && event.todoId) {
      key = `todo:${event.todoId}`;
      raise = isFinished(event.status) && projectId !== activeRef.current;
    } else if (event.type === 'discussion:status-changed' && event.discussionId) {
      key = `discussion:${event.discussionId}`;
      raise = isFinished(event.status) && projectId !== activeRef.current;
    } else {
      return;
    }
    setUnseen((prev) => withKey(prev, key, raise ? projectId : null));
  }), [onEvent]);

  useEffect(() => {
    const bus = openBus();
    const off = bus.subscribe((msg) => {
      if (msg.t !== 'sessions-seen') return;
      const seen = new Set(msg.ids.map((id) => `session:${id}`));
      setUnseen((prev) => without(prev, (key) => seen.has(key)));
    });
    return () => { off(); bus.close(); };
  }, []);

  // Opening a workspace acknowledges its TODOs and discussions; its sessions
  // wait until their pane is looked at.
  useEffect(() => {
    if (!activeProjectId) return;
    setUnseen((prev) => without(prev, (key, projectId) => projectId === activeProjectId && !key.startsWith('session:')));
  }, [activeProjectId]);

  return useMemo(() => {
    const counts: Record<string, number> = {};
    for (const projectId of unseen.values()) counts[projectId] = (counts[projectId] ?? 0) + 1;
    return counts;
  }, [unseen]);
}
