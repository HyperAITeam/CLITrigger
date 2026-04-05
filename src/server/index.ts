import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { getDatabase } from './db/connection.js';
import { getTodosByStatus, updateTodoStatus, updateTodo, cleanOldLogs, getPipelinesByStatus, updatePipelineStatus, updatePipeline, getAllProjects } from './db/queries.js';
import { initAuth } from './middleware/auth.js';
import authRouter from './routes/auth.js';
import projectsRouter from './routes/projects.js';
import todosRouter from './routes/todos.js';
import executionRouter from './routes/execution.js';
import logsRouter from './routes/logs.js';
import imagesRouter from './routes/images.js';
import { claudeManager } from './services/claude-manager.js';
import { tunnelManager } from './services/tunnel-manager.js';
import { initWebSocket } from './websocket/index.js';
import tunnelRouter from './routes/tunnel.js';
import pipelinesRouter from './routes/pipelines.js';
import schedulesRouter from './routes/schedules.js';
import pluginsRouter from './routes/plugins.js';
import modelsRouter from './routes/models.js';
import debugLogsRouter from './routes/debug-logs.js';
import { scheduler } from './services/scheduler.js';
import { debugLogger } from './services/debug-logger.js';
import { registerPlugin, mountPluginRoutes } from './plugins/registry.js';
import { jiraPlugin } from './plugins/jira/index.js';
import { githubPlugin } from './plugins/github/index.js';
import { notionPlugin } from './plugins/notion/index.js';
import { gstackPlugin } from './plugins/gstack/index.js';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Trust proxy (needed for Cloudflare Tunnel / X-Forwarded-For)
app.set('trust proxy', 1);

// Middleware
const isDev = process.env.NODE_ENV !== 'production';
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin, curl, etc.)
    if (!origin) {
      callback(null, true);
    // Development mode: allow all origins
    } else if (isDev) {
      callback(null, true);
    } else if (allowedOrigins.includes(origin)) {
      callback(null, true);
    // Allow Cloudflare Tunnel origins (*.trycloudflare.com)
    } else if (/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(helmet({
  contentSecurityPolicy: false,  // Disable CSP for SPA compatibility
}));
app.use(express.json({ limit: '50mb' }));

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

// Startup recovery: reset stale 'running' pipelines to 'paused'
const stalePipelines = getPipelinesByStatus('running');
if (stalePipelines.length > 0) {
  console.log(`Recovering ${stalePipelines.length} stale running pipeline(s)...`);
  for (const pipeline of stalePipelines) {
    updatePipelineStatus(pipeline.id, 'paused');
    updatePipeline(pipeline.id, { process_pid: 0 });
    console.log(`  Reset pipeline "${pipeline.title}" (${pipeline.id}) from running to paused`);
  }
}

// Auto-cleanup old logs (default 30 days)
const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || '30', 10);
const cleaned = cleanOldLogs(LOG_RETENTION_DAYS);
if (cleaned > 0) {
  console.log(`Cleaned up ${cleaned} old log entries (older than ${LOG_RETENTION_DAYS} days)`);
}

// Auto-cleanup old debug log files
for (const p of getAllProjects()) {
  if (p.debug_logging) {
    const debugCleaned = debugLogger.cleanupOldLogs(p.path, LOG_RETENTION_DAYS);
    if (debugCleaned > 0) {
      console.log(`Cleaned up ${debugCleaned} debug log files for project "${p.name}"`);
    }
  }
}

// Auth middleware
initAuth(app);
app.use('/api/auth', authRouter);

// --- Plugins ---
registerPlugin(jiraPlugin);
registerPlugin(githubPlugin);
registerPlugin(notionPlugin);
registerPlugin(gstackPlugin);

// --- Routes ---
app.use('/api/projects', projectsRouter);
app.use('/api', todosRouter);
app.use('/api', executionRouter);
app.use('/api', logsRouter);
app.use('/api', imagesRouter);
app.use('/api', pipelinesRouter);
app.use('/api', schedulesRouter);
app.use('/api/plugins', pluginsRouter);
app.use('/api/tunnel', tunnelRouter);
app.use('/api', modelsRouter);
app.use('/api', debugLogsRouter);
mountPluginRoutes(app);

// --- Scheduler ---
scheduler.initialize();

// --- WebSocket ---
initWebSocket(server);

// --- Tunnel (Phase 7) ---
if (process.env.TUNNEL_ENABLED === 'true') {
  const port = Number(PORT);
  const tunnelName = process.env.TUNNEL_NAME;
  const tunnelPromise = tunnelName
    ? tunnelManager.startNamedTunnel(tunnelName, port)
    : tunnelManager.startTunnel(port);
  tunnelPromise.catch((err: Error) => {
    console.error('Failed to start tunnel:', err.message);
  });
  tunnelManager.on('url', (url: string) => {
    console.log(`Cloudflare Tunnel URL: ${url}`);
  });
  tunnelManager.on('error', (err: Error) => {
    console.error('Tunnel error:', err.message);
  });
}

// Serve frontend static files in production (skip in headless/plugin mode)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.HEADLESS !== 'true') {
  const clientDist = path.resolve(__dirname, '../../src/client/dist');
  app.use(express.static(clientDist));
  app.get(/^\/(?!api|ws).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Cleanup on process exit: kill all Claude CLI processes
function cleanup() {
  console.log('Shutting down: killing all Claude CLI processes, scheduler, and tunnel...');
  scheduler.stopAll();
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

// Plugin mode: shut down when parent process closes stdin
// Only enable stdin-based shutdown in headless/plugin mode (not in dev with concurrently)
if (process.env.HEADLESS === 'true') {
  process.stdin.on('end', cleanup);
  process.stdin.resume();
}

server.listen(PORT, () => {
  console.log(`CLITrigger server running on http://localhost:${PORT}`);
});

export { app, server };
