import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import { broadcaster } from './broadcaster.js';
import { sessionMiddleware } from '../middleware/auth.js';
import { claudeManager } from '../services/claude-manager.js';
import { getTodoById, createTaskLog } from '../db/queries.js';

export function initWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  // Handle upgrade manually to validate session auth
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    // Only handle /ws path
    if (req.url !== '/ws') {
      socket.destroy();
      return;
    }

    // Validate Origin header to prevent cross-origin WebSocket hijacking
    const origin = req.headers.origin;
    const allowedOrigins = process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
      : ['http://localhost:5173', 'http://localhost:3000'];
    if (origin && !allowedOrigins.includes(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
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
      } catch {
        // Ignore malformed messages
      }
    });

    // Send welcome message
    ws.send(JSON.stringify({ type: 'connected', clientCount: broadcaster.getClientCount() }));
  });

  console.log('WebSocket server initialized on /ws');
}
