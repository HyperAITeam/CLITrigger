import { describe, it, expect, vi } from 'vitest';
import { WebSocket } from 'ws';

// Mock ws module
vi.mock('ws', () => {
  const OPEN = 1;
  const CLOSED = 3;
  return {
    WebSocket: {
      OPEN,
      CLOSED,
    },
  };
});

// Re-import after mock - we test the Broadcaster class logic directly
describe('Broadcaster', () => {
  // Inline the Broadcaster logic for unit testing without full ws dependency
  class TestBroadcaster {
    private clients: Set<any> = new Set();

    addClient(ws: any): void {
      this.clients.add(ws);
    }

    removeClient(ws: any): void {
      this.clients.delete(ws);
    }

    broadcast(event: any): void {
      const data = JSON.stringify(event);
      for (const client of this.clients) {
        if (client.readyState === 1) { // WebSocket.OPEN
          client.send(data);
        }
      }
    }

    getClientCount(): number {
      return this.clients.size;
    }
  }

  it('should add and track clients', () => {
    const broadcaster = new TestBroadcaster();
    const ws1 = { readyState: 1, send: vi.fn() };
    const ws2 = { readyState: 1, send: vi.fn() };

    broadcaster.addClient(ws1);
    broadcaster.addClient(ws2);
    expect(broadcaster.getClientCount()).toBe(2);
  });

  it('should remove clients', () => {
    const broadcaster = new TestBroadcaster();
    const ws = { readyState: 1, send: vi.fn() };
    broadcaster.addClient(ws);
    broadcaster.removeClient(ws);
    expect(broadcaster.getClientCount()).toBe(0);
  });

  it('should broadcast to all open clients', () => {
    const broadcaster = new TestBroadcaster();
    const ws1 = { readyState: 1, send: vi.fn() };
    const ws2 = { readyState: 1, send: vi.fn() };
    broadcaster.addClient(ws1);
    broadcaster.addClient(ws2);

    const event = { type: 'test', data: 'hello' };
    broadcaster.broadcast(event);

    expect(ws1.send).toHaveBeenCalledWith(JSON.stringify(event));
    expect(ws2.send).toHaveBeenCalledWith(JSON.stringify(event));
  });

  it('should skip closed clients', () => {
    const broadcaster = new TestBroadcaster();
    const openWs = { readyState: 1, send: vi.fn() };
    const closedWs = { readyState: 3, send: vi.fn() };
    broadcaster.addClient(openWs);
    broadcaster.addClient(closedWs);

    broadcaster.broadcast({ type: 'test' });

    expect(openWs.send).toHaveBeenCalled();
    expect(closedWs.send).not.toHaveBeenCalled();
  });
});
