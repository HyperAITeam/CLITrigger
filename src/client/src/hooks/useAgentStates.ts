// Client mirror of the server's heuristic agent state per session, fed by
// `session:agent-state` WS events. Also tracks which sessions need attention:
// a session that turned blocked (waiting for input) or done while it was NOT
// the visible+focused pane keeps a badge until it gets focus.
//
// Each browser window (main app, every popout) runs its own instance and
// recomputes from the same WS stream — nothing is synced over popoutBus.

import { createContext, useEffect, useRef, useState } from 'react';
import type { WsEvent } from './useWebSocket';
import type { AgentState } from '../types';
import { openBus, type PopoutBus } from '../components/popout/popoutBus';

// The sidebar's workspace badge (useWorkspaceAttention) runs in the main
// window. It checks this window's focused panes synchronously and hears about
// panes looked at in any window (popouts too) over the bus.
const mountedFocus = new Set<{ current: ReadonlySet<string> }>();
let seenBus: PopoutBus | null = null;

export function isSessionFocused(sessionId: string): boolean {
  for (const ref of mountedFocus) if (ref.current.has(sessionId)) return true;
  return false;
}

function postSessionsSeen(ids: Iterable<string>): void {
  const list = [...ids];
  if (list.length > 0) (seenBus ??= openBus()).post({ t: 'sessions-seen', ids: list });
}

export type AttentionState = 'blocked' | 'done';

export interface AgentStatesValue {
  states: Record<string, AgentState>;
  attention: ReadonlySet<string>;
}

export const EMPTY_AGENT_STATES: AgentStatesValue = { states: {}, attention: new Set() };
export const AgentStatesContext = createContext<AgentStatesValue>(EMPTY_AGENT_STATES);

/**
 * @param focusedIds sessions that are visible AND in the focused window right
 *   now — a transition on one of these never raises attention, and focusing a
 *   badged session clears its badge.
 * @param onAttention fired once per transition that raised attention; callers
 *   filter to the sessions whose tab THEY render so each event notifies once.
 */
export function useAgentStates(
  onEvent: (cb: (event: WsEvent) => void) => () => void,
  focusedIds: ReadonlySet<string>,
  onAttention?: (sessionId: string, state: AttentionState) => void,
): AgentStatesValue {
  const [states, setStates] = useState<Record<string, AgentState>>({});
  const [attention, setAttention] = useState<ReadonlySet<string>>(() => new Set());
  const statesRef = useRef(states);
  statesRef.current = states;
  const focusedRef = useRef(focusedIds);
  focusedRef.current = focusedIds;
  const onAttentionRef = useRef(onAttention);
  onAttentionRef.current = onAttention;

  useEffect(() => {
    mountedFocus.add(focusedRef);
    return () => { mountedFocus.delete(focusedRef); };
  }, []);

  useEffect(() => onEvent((event) => {
    if (event.type !== 'session:agent-state' || !event.sessionId || !event.state) return;
    const sid = event.sessionId;
    const next = event.state as AgentState;
    // The server re-sends the current state right after `session:subscribe`.
    if (statesRef.current[sid] === next) return;
    setStates((prev) => ({ ...prev, [sid]: next }));

    // A user-initiated stop also ends as `done` — that isn't news.
    const noteworthy = next === 'blocked' || (next === 'done' && event.reason !== 'stopped');
    if (noteworthy && !focusedRef.current.has(sid)) {
      setAttention((prev) => (prev.has(sid) ? prev : new Set(prev).add(sid)));
      onAttentionRef.current?.(sid, next as AttentionState);
    } else {
      // Seen in a popout — the main window's sidebar can't check that focus itself.
      if (noteworthy) postSessionsSeen([sid]);
      // Agent resumed (or the change happened in plain sight) — a stale badge would lie.
      setAttention((prev) => {
        if (!prev.has(sid)) return prev;
        const copy = new Set(prev);
        copy.delete(sid);
        return copy;
      });
    }
  }), [onEvent]);

  // Focusing a pane acknowledges its badge.
  useEffect(() => {
    postSessionsSeen(focusedIds);
    setAttention((prev) => {
      let copy: Set<string> | null = null;
      for (const sid of focusedIds) {
        if (!prev.has(sid)) continue;
        if (!copy) copy = new Set(prev);
        copy.delete(sid);
      }
      return copy ?? prev;
    });
  }, [focusedIds]);

  return { states, attention };
}
