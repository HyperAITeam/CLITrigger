import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import { broadcaster, encodeSessionFrame } from './broadcaster.js';
import { sessionMiddleware } from '../middleware/auth.js';
import { claudeManager } from '../services/claude-manager.js';
import { getTodoById, createTaskLog, getSessionById, createSessionLog, getSessionRawChunks } from '../db/queries.js';

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

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    });
  });

  wss.on('connection', (ws) => {
    broadcaster.addClient(ws);

    ws.on('close', () => {
      broadcaster.removeClient(ws);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      broadcaster.removeClient(ws);
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
        // On subscribe we replay persisted chunks (cross-restart) + the in-memory
        // ring tail (live since last persisted), then send `session:replay-end`.
        if (msg.type === 'session:subscribe' && typeof msg.sessionId === 'string') {
          const session = getSessionById(msg.sessionId);
          if (session) {
            broadcaster.subscribe(ws, msg.sessionId);
            try {
              const chunks = getSessionRawChunks(msg.sessionId);
              for (const c of chunks) {
                ws.send(encodeSessionFrame(msg.sessionId, c.bytes), { binary: true });
              }
              if (session.process_pid) {
                const tail = claudeManager.getRawHistory(session.process_pid);
                if (tail) ws.send(encodeSessionFrame(msg.sessionId, tail), { binary: true });
              }
            } catch { /* ignore replay errors */ }
            ws.send(JSON.stringify({ type: 'session:replay-end', sessionId: msg.sessionId }));
          }
        }

        if (msg.type === 'session:unsubscribe' && typeof msg.sessionId === 'string') {
          broadcaster.unsubscribe(ws, msg.sessionId);
        }

        // Raw keystrokes from xterm.js (CR, arrow keys, Ctrl+C, etc).
        // Bypasses the `\n → submitSeq` translation that `writeToStdin` applies.
        if (msg.type === 'session:terminal-input' && typeof msg.sessionId === 'string' && typeof msg.input === 'string') {
          const session = getSessionById(msg.sessionId);
          if (session && session.process_pid && session.status === 'running') {
            claudeManager.writeStdinRaw(session.process_pid, msg.input);
          }
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
