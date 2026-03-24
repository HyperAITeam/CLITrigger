import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import { broadcaster } from './broadcaster.js';
import { sessionMiddleware } from '../middleware/auth.js';

export function initWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  // Handle upgrade manually to validate session auth
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    // Only handle /ws path
    if (req.url !== '/ws') {
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

    // Send welcome message
    ws.send(JSON.stringify({ type: 'connected', clientCount: broadcaster.getClientCount() }));
  });

  console.log('WebSocket server initialized on /ws');
}
