import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { WsEvent } from './useWebSocket';

const focused = new Set<string>();
vi.mock('./useAgentStates', () => ({ isSessionFocused: (id: string) => focused.has(id) }));

const { useWorkspaceAttention } = await import('./useWorkspaceAttention');

function setup(active: string | null) {
  const listeners = new Set<(event: WsEvent) => void>();
  const onEvent = (cb: (event: WsEvent) => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  };
  const view = renderHook(({ active }) => useWorkspaceAttention(onEvent, active), { initialProps: { active } });
  const emit = (event: WsEvent) => act(() => { listeners.forEach((cb) => cb(event)); });
  return { ...view, emit };
}

describe('useWorkspaceAttention', () => {
  it('counts TODOs and discussions finished in another workspace until that workspace is opened', () => {
    const { result, rerender, emit } = setup('a');
    emit({ type: 'todo:status-changed', projectId: 'b', todoId: 't1', status: 'completed' });
    emit({ type: 'discussion:status-changed', projectId: 'b', discussionId: 'd1', status: 'failed' });
    emit({ type: 'todo:status-changed', projectId: 'a', todoId: 't2', status: 'completed' });
    expect(result.current).toEqual({ b: 2 });

    // Run again → no longer news.
    emit({ type: 'todo:status-changed', projectId: 'b', todoId: 't1', status: 'running' });
    expect(result.current).toEqual({ b: 1 });

    rerender({ active: 'b' });
    expect(result.current).toEqual({});
  });

  it('keeps a session badge until its pane is seen, the agent resumes, or the session is deleted', async () => {
    const { result, rerender, emit } = setup('a');
    emit({ type: 'session:agent-state', projectId: 'a', sessionId: 's1', state: 'blocked' });
    emit({ type: 'session:agent-state', projectId: 'b', sessionId: 's2', state: 'done' });
    // Not news: the resend after subscribe, a user stop, a transition the user watched.
    emit({ type: 'session:agent-state', sessionId: 's3', state: 'done' });
    emit({ type: 'session:agent-state', projectId: 'b', sessionId: 's4', state: 'done', reason: 'stopped' });
    focused.add('s5');
    emit({ type: 'session:agent-state', projectId: 'b', sessionId: 's5', state: 'blocked' });
    expect(result.current).toEqual({ a: 1, b: 1 });

    emit({ type: 'session:agent-state', projectId: 'a', sessionId: 's1', state: 'running' });
    expect(result.current).toEqual({ b: 1 });

    // Opening the workspace doesn't acknowledge a session — looking at its pane does.
    rerender({ active: 'b' });
    expect(result.current).toEqual({ b: 1 });
    const channel = new BroadcastChannel('clitrigger:session-windows:global');
    channel.postMessage({ t: 'sessions-seen', ids: ['s2'] });
    await waitFor(() => expect(result.current).toEqual({}));
    channel.close();

    emit({ type: 'session:agent-state', projectId: 'b', sessionId: 's6', state: 'done' });
    emit({ type: 'session:deleted', sessionId: 's6' });
    expect(result.current).toEqual({});
  });
});
