import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { getDatabase } from './db/connection.js';
import { initAuth } from './middleware/auth.js';
import authRouter from './routes/auth.js';
import projectsRouter from './routes/projects.js';
import todosRouter from './routes/todos.js';
import executionRouter from './routes/execution.js';
import logsRouter from './routes/logs.js';
import { claudeManager } from './services/claude-manager.js';
import { initWebSocket } from './websocket/index.js';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Initialize database
getDatabase();

// Auth middleware
initAuth(app);
app.use('/api/auth', authRouter);

// --- Routes ---
app.use('/api/projects', projectsRouter);
app.use('/api', todosRouter);
app.use('/api', executionRouter);
app.use('/api', logsRouter);

// --- WebSocket ---
initWebSocket(server);

// --- Tunnel (Phase 7) ---
// import { initTunnel } from './services/tunnel-manager';
// if (process.env.TUNNEL_ENABLED === 'true') initTunnel(PORT);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Cleanup on process exit: kill all Claude CLI processes
function cleanup() {
  console.log('Shutting down: killing all Claude CLI processes...');
  claudeManager.killAll().then(() => {
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
