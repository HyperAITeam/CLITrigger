import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { getDatabase } from './db/connection.js';
import { getTodosByStatus, updateTodoStatus, updateTodo, cleanOldLogs } from './db/queries.js';
import { initAuth } from './middleware/auth.js';
import authRouter from './routes/auth.js';
import projectsRouter from './routes/projects.js';
import todosRouter from './routes/todos.js';
import executionRouter from './routes/execution.js';
import logsRouter from './routes/logs.js';
import { claudeManager } from './services/claude-manager.js';
import { tunnelManager } from './services/tunnel-manager.js';
import { initWebSocket } from './websocket/index.js';
import tunnelRouter from './routes/tunnel.js';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Initialize database
getDatabase();

// Startup recovery: reset stale 'running' todos to 'failed'
// (processes are dead after server restart)
const staleTodos = getTodosByStatus('running');
if (staleTodos.length > 0) {
  console.log(`Recovering ${staleTodos.length} stale running task(s)...`);
  for (const todo of staleTodos) {
    updateTodoStatus(todo.id, 'failed');
    updateTodo(todo.id, { process_pid: 0 });
    console.log(`  Reset todo "${todo.title}" (${todo.id}) from running to failed`);
  }
}

// Auto-cleanup old logs (default 30 days)
const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || '30', 10);
const cleaned = cleanOldLogs(LOG_RETENTION_DAYS);
if (cleaned > 0) {
  console.log(`Cleaned up ${cleaned} old log entries (older than ${LOG_RETENTION_DAYS} days)`);
}

// Auth middleware
initAuth(app);
app.use('/api/auth', authRouter);

// --- Routes ---
app.use('/api/projects', projectsRouter);
app.use('/api', todosRouter);
app.use('/api', executionRouter);
app.use('/api', logsRouter);
app.use('/api/tunnel', tunnelRouter);

// --- WebSocket ---
initWebSocket(server);

// --- Tunnel (Phase 7) ---
if (process.env.TUNNEL_ENABLED === 'true') {
  const port = Number(PORT);
  const tunnelName = process.env.TUNNEL_NAME;
  if (tunnelName) {
    tunnelManager.startNamedTunnel(tunnelName, port);
  } else {
    tunnelManager.startTunnel(port);
  }
  tunnelManager.on('url', (url: string) => {
    console.log(`Cloudflare Tunnel URL: ${url}`);
  });
  tunnelManager.on('error', (err: Error) => {
    console.error('Tunnel error:', err.message);
  });
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Cleanup on process exit: kill all Claude CLI processes
function cleanup() {
  console.log('Shutting down: killing all Claude CLI processes and tunnel...');
  Promise.all([
    claudeManager.killAll(),
    tunnelManager.stopTunnel(),
  ]).then(() => {
    process.exit(0);
  }).catch(() => {
    process.exit(1);
  });
}

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

server.listen(PORT, () => {
  console.log(`CLITrigger server running on http://localhost:${PORT}`);
});

export { app, server };
