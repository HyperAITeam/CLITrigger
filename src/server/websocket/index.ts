import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import { broadcaster, encodeSessionFrame } from './broadcaster.js';
import { sessionMiddleware } from '../middleware/auth.js';
import { claudeManager } from '../services/claude-manager.js';
import { sessionManager } from '../services/session-manager.js';
import { vaultWatcher } from '../services/vault-watcher.js';
import { getTodoById, createTaskLog, getSessionById, createSessionLog, getSessionRawChunks } from '../db/queries.js';
import { getSetting } from '../db/app-settings.js';

export function initWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  // Handle upgrade manually to validate session auth
  const isDev = process.env.NODE_ENV !== 'production';

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    // Only handle /ws path
    if (req.url !== '/ws') {
      socket.destroy();
      return;
    }

    // Validate Origin header to prevent cross-origin WebSocket hijacking
    const origin = req.headers.origin;
    if (origin && !isDev) {
      const allowedOrigins = process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
        : ['http://localhost:5173', 'http://localhost:3000'];
      const isTrycloudflare = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin);
      if (!allowedOrigins.includes(origin) && !isTrycloudflare) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    // Skip auth when DISABLE_AUTH is set (plugin/headless mode)
    if (process.env.DISABLE_AUTH === 'true') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
      return;
    }

    // Use the session middleware to parse the session cookie
    // We create a minimal mock response to satisfy express-session
    const res = Object.create(null);
    res.end = () => {};
    res.writeHead = () => {};
    res.setHeader = () => res;
    res.getHeader = () => undefined;

    sessionMiddleware(req as any, res as any, () => {
      const session = (req as any).session;
      if (!session || !session.authenticated) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      // Reject sessions issued before the last password change (parity with HTTP).
      const changedAt = Number(getSetting('auth.password_changed_at') || 0);
      if (changedAt && (session.createdAt ?? 0) < changedAt) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });
  });

  wss.on('connection', (ws) => {
    broadcaster.addClient(ws);

    ws.on('close', () => {
      broadcaster.removeClient(ws);
      vaultWatcher.removeClient(ws);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      broadcaster.removeClient(ws);
      vaultWatcher.removeClient(ws);
    });

    // Handle incoming messages (stdin for interactive mode)
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'todo:stdin' && msg.todoId && typeof msg.input === 'string') {
          const todo = getTodoById(msg.todoId);
          if (todo && todo.process_pid && todo.status === 'running') {
            const written = claudeManager.writeToStdin(todo.process_pid, msg.input + '\n');
            if (written) {
              createTaskLog(msg.todoId, 'input', msg.input);
              broadcaster.broadcast({
                type: 'todo:log',
                todoId: msg.todoId,
                message: msg.input,
                logType: 'input',
              });
            }
          }
        }
        // Session stdin relay
        if (msg.type === 'session:stdin' && msg.sessionId && typeof msg.input === 'string') {
          const session = getSessionById(msg.sessionId);
          if (session && session.process_pid && session.status === 'running') {
            const written = claudeManager.writeToStdin(session.process_pid, msg.input + '\n');
            if (written) {
              createSessionLog(msg.sessionId, 'input', msg.input);
              broadcaster.broadcast({
                type: 'session:log',
                sessionId: msg.sessionId,
                message: msg.input,
                logType: 'input',
              });
            }
          }
        }

        // ── xterm.js terminal channel (Sessions tab) ──

        // Subscribe a client to the high-frequency binary output for a session.
        // On subscribe we drain any in-flight pending bytes to DB (so the
        // persisted chunks are the single source of truth), then replay
        // them and send `session:replay-end`. Subscribing before the flush
        // is intentional: any chunk delivered after this synchronous handler
        // returns will be live-broadcast, and JS single-threading guarantees
        // no PTY data event interleaves between subscribe and the DB read.
        if (msg.type === 'session:subscribe' && typeof msg.sessionId === 'string') {
          const session = getSessionById(msg.sessionId);
          if (session) {
            broadcaster.subscribe(ws, msg.sessionId);
            try {
              sessionManager.flushPendingRaw(msg.sessionId);
              const chunks = getSessionRawChunks(msg.sessionId);
              // Coalesce DB rows into large frames. A long session holds tens
              // of thousands of tiny rows (one per 100ms flush); one ws frame
              // per row made re-opening a terminal take seconds.
              const REPLAY_FRAME_BYTES = 256 * 1024;
              let batch: Buffer[] = [];
              let batchBytes = 0;
              const sendBatch = () => {
                if (batch.length === 0) return;
                ws.send(encodeSessionFrame(msg.sessionId, Buffer.concat(batch)), { binary: true });
                batch = [];
                batchBytes = 0;
              };
              for (const c of chunks) {
                batch.push(c.bytes);
                batchBytes += c.bytes.length;
                if (batchBytes >= REPLAY_FRAME_BYTES) sendBatch();
              }
              sendBatch();
            } catch { /* ignore replay errors */ }
            ws.send(JSON.stringify({ type: 'session:replay-end', sessionId: msg.sessionId }));
          }
        }

        if (msg.type === 'session:unsubscribe' && typeof msg.sessionId === 'string') {
          broadcaster.unsubscribe(ws, msg.sessionId);
        }

        // Vault (docs tab) file watching — the project root is only watched
        // while at least one client keeps the tab open.
        if (msg.type === 'vault:watch' && typeof msg.projectId === 'string') {
          vaultWatcher.watch(msg.projectId, ws);
        }

        if (msg.type === 'vault:unwatch' && typeof msg.projectId === 'string') {
          vaultWatcher.unwatch(msg.projectId, ws);
        }

        // Raw keystrokes from xterm.js (CR, arrow keys, Ctrl+C, etc).
        // Bypasses the `\n → submitSeq` translation that `writeToStdin` applies.
        if (msg.type === 'session:terminal-input' && typeof msg.sessionId === 'string' && typeof msg.input === 'string') {
          // Defense in depth: drop keystrokes while the server is still
          // holding the initial prompt for review. The client gates this
          // too, but if it ever leaks through (stale build, race), we don't
          // want the user's typing to silently land in the PTY before the
          // held description is dispatched.
          if (sessionManager.hasPendingPrompt(msg.sessionId)) return;
          // Routes through SessionManager so type-ahead arriving while the
          // PTY is still spawning lands in startupInputBuffer instead of
          // being silently dropped at the gate-2 (process_pid=0) check.
          sessionManager.writeTerminalInput(msg.sessionId, msg.input);
        }

        if (msg.type === 'session:resize' && typeof msg.sessionId === 'string' &&
            Number.isFinite(msg.cols) && Number.isFinite(msg.rows)) {
          const session = getSessionById(msg.sessionId);
          if (session && session.process_pid && session.status === 'running') {
            const cols = Math.max(20, Math.min(500, msg.cols | 0));
            const rows = Math.max(5, Math.min(200, msg.rows | 0));
            claudeManager.resize(session.process_pid, cols, rows);
          }
        }
      } catch {
        // Ignore malformed messages
      }
    });

    // Send welcome message
    ws.send(JSON.stringify({ type: 'connected', clientCount: broadcaster.getClientCount() }));
  });
}
