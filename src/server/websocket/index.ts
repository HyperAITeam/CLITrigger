import { WebSocketServer } from 'ws';
import type { Server } from 'http';
import { broadcaster } from './broadcaster.js';

export function initWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

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
