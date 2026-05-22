import { useEffect, useRef, useState, useCallback } from 'react';

export interface WsEvent {
  type: string;
  todoId?: string;
  projectId?: string;
  status?: string;
  message?: string;
  logType?: string;
  running?: number;
  completed?: number;
  total?: number;
  running_sessions?: number;
  running_discussions?: number;
  commitHash?: string;
  mode?: string;
  worktree_path?: string | null;
  branch_name?: string | null;
  scheduleId?: string;
  runId?: string;
  isActive?: boolean;
  reason?: string;
  // Session events
  sessionId?: string;
  // Discussion events
  discussionId?: string;
  messageId?: string;
  agentId?: string;
  agentName?: string;
  currentRound?: number;
  currentAgentId?: string | null;
  // Rate limit events
  resetsAt?: number;
  // Memory ingest events
  sourceType?: string;
  sourceId?: string | null;
  sourceTitle?: string | null;
  created?: number;
  updated?: number;
  edgesAdded?: number;
  skipped?: {
    parseFailed: boolean;
    proposedCreate: number;
    proposedUpdate: number;
    proposedEdges: number;
    duplicateTitle: number;
    uniqueConflict: number;
    emptyTitle: number;
    invalidUpdateId: number;
    invalidEdgeRef: number;
    selfEdge: number;
    edgeUniqueConflict: number;
  };
  error?: string;
}

type EventCallback = (event: WsEvent) => void;
type BinaryCallback = (payload: Uint8Array) => void;

const BINARY_FRAME_SESSION_OUTPUT = 0x01;

export function useWebSocket(authenticated: boolean) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const callbacksRef = useRef<Set<EventCallback>>(new Set<EventCallback>());
  // Per-sessionId binary subscriber map. Bypasses React state to avoid
  // re-render storms when PTY emits hundreds of frames per second.
  const binaryCallbacksRef = useRef<Map<string, Set<BinaryCallback>>>(new Map());
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attemptsRef = useRef(0);

  const connect = useCallback(() => {
    if (!authenticated) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      attemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      // Binary frame (high-frequency PTY output): kind | sidLen | sid | payload.
      if (event.data instanceof ArrayBuffer) {
        const view = new Uint8Array(event.data);
        if (view.length < 2 || view[0] !== BINARY_FRAME_SESSION_OUTPUT) return;
        const sidLen = view[1];
        if (view.length < 2 + sidLen) return;
        const sessionId = new TextDecoder('utf-8').decode(view.subarray(2, 2 + sidLen));
        const payload = view.subarray(2 + sidLen);
        const subs = binaryCallbacksRef.current.get(sessionId);
        if (subs) {
          for (const cb of subs) {
            try { cb(payload); } catch { /* keep other subscribers alive */ }
          }
        }
        return;
      }
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

  const subscribeBinary = useCallback((sessionId: string, cb: BinaryCallback) => {
    let set = binaryCallbacksRef.current.get(sessionId);
    if (!set) {
      set = new Set();
      binaryCallbacksRef.current.set(sessionId, set);
    }
    set.add(cb);
    return () => {
      const s = binaryCallbacksRef.current.get(sessionId);
      if (!s) return;
      s.delete(cb);
      if (s.size === 0) binaryCallbacksRef.current.delete(sessionId);
    };
  }, []);

  return { connected, onEvent, sendMessage, subscribeBinary };
}
