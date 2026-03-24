import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { getDatabase } from './db/connection.js';
import projectsRouter from './routes/projects.js';
import todosRouter from './routes/todos.js';
import executionRouter from './routes/execution.js';
import logsRouter from './routes/logs.js';
import { initWebSocket } from './websocket/index.js';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Initialize database
getDatabase();

// --- Auth middleware (Phase 7) ---
// import { initAuth } from './middleware/auth';
// initAuth(app);

// --- Routes ---
app.use('/api/projects', projectsRouter);
app.use('/api', todosRouter);
app.use('/api', executionRouter);
app.use('/api', logsRouter);

// --- WebSocket (Phase 5) ---
initWebSocket(server);

// --- Tunnel (Phase 7) ---
// import { initTunnel } from './services/tunnel-manager';
// if (process.env.TUNNEL_ENABLED === 'true') initTunnel(PORT);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

server.listen(PORT, () => {
  console.log(`CLITrigger server running on http://localhost:${PORT}`);
});

export { app, server };
