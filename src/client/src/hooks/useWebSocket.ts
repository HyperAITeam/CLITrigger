import { useEffect, useRef, useState, useCallback } from 'react';

export interface WsEvent {
  type: string;
  todoId?: string;
  projectId?: string;
  pipelineId?: string;
  phaseType?: string;
  currentPhase?: string | null;
  status?: string;
  message?: string;
  logType?: string;
  running?: number;
  completed?: number;
  total?: number;
  commitHash?: string;
  mode?: string;
  worktree_path?: string | null;
  branch_name?: string | null;
  scheduleId?: string;
  runId?: string;
  isActive?: boolean;
  reason?: string;
}

type EventCallback = (event: WsEvent) => void;

export function useWebSocket(authenticated: boolean) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const callbacksRef = useRef<Set<EventCallback>>(new Set<EventCallback>());
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attemptsRef = useRef(0);

  const connect = useCallback(() => {
    if (!authenticated) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      attemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data: WsEvent = JSON.parse(event.data);
        callbacksRef.current.forEach((cb) => cb(data));
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Reconnect with exponential backoff
      const delay = Math.min(1000 * 2 ** attemptsRef.current, 30000);
      attemptsRef.current++;
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [authenticated]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const onEvent = useCallback((cb: EventCallback) => {
    callbacksRef.current.add(cb);
    return () => {
      callbacksRef.current.delete(cb);
    };
  }, []);

  const sendMessage = useCallback((event: object) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(event));
    }
  }, []);

  return { connected, onEvent, sendMessage };
}
