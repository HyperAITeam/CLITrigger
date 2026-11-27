import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import crypto from 'crypto';
import { getDatabase } from './db/connection.js';
import { getTodosByStatus, updateTodoStatus, updateTodo, cleanOldLogs, getAllProjects, getDiscussionsByStatus, updateDiscussionStatus, updateDiscussion, getSessionsByStatus, updateSessionStatus, updateSession } from './db/queries.js';
import { migrateAllProjectWikis } from './services/wiki-migration.js';
import { initAuth } from './middleware/auth.js';
import authRouter from './routes/auth.js';
import projectsRouter from './routes/projects.js';
import svnRouter from './routes/svn.js';
import filesRouter from './routes/files.js';
import todosRouter from './routes/todos.js';
import executionRouter from './routes/execution.js';
import logsRouter from './routes/logs.js';
import imagesRouter from './routes/images.js';
import { claudeManager } from './services/claude-manager.js';
import { orchestrator } from './services/orchestrator.js';
import { tunnelManager } from './services/tunnel-manager.js';
import { getSetting as getAppSetting, setSetting as setAppSetting } from './db/app-settings.js';
import { hashPassword } from './utils/password.js';
import { initWebSocket } from './websocket/index.js';
import mcpRouter from './routes/mcp.js';
import { mountMcp } from './mcp/index.js';
import tunnelRouter from './routes/tunnel.js';
import schedulesRouter from './routes/schedules.js';
import pluginsRouter from './routes/plugins.js';
import modelsRouter from './routes/models.js';
import cliStatusRouter from './routes/cli-status.js';
import debugLogsRouter from './routes/debug-logs.js';
import discussionsRouter from './routes/discussions.js';
import analyticsRouter from './routes/analytics.js';
import sessionsRouter from './routes/sessions.js';
import sessionTagsRouter from './routes/session-tags.js';
import sessionAliasesRouter from './routes/session-aliases.js';
import sessionSettingsRouter from './routes/session-settings.js';
import plannerRouter from './routes/planner.js';
import vaultRouter from './routes/vault.js';
import reviewRouter from './routes/review.js';
import personalRouter from './routes/personal.js';
import favoritesRouter from './routes/favorites.js';
import { scheduler } from './services/scheduler.js';
import { debugLogger } from './services/debug-logger.js';
import { logStreamer } from './services/log-streamer.js';
import { checkAllTools } from './services/cli-status.js';
import { registerPlugin, mountPluginRoutes } from './plugins/registry.js';
import { harnessPlugin } from './plugins/harness/index.js';
import { isAllowedHost, isAllowedOrigin } from './middleware/request-origin.js';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Trust X-Forwarded-* only from a proxy on this machine (cloudflared). With a
// blanket `1`, any LAN client could spoof X-Forwarded-For and dodge the login
// rate limit.
app.set('trust proxy', 'loopback');

// DNS rebinding guard: refuse Hosts we don't serve (see request-origin.ts).
app.use((req, res, next) => {
  if (isAllowedHost(req.headers.host)) return next();
  res.status(421).json({ error: 'Host not allowed' });
});

// Same-origin requests can still carry an Origin header (Vite's `crossorigin`
// asset tags, POST fetches); isAllowedOrigin matches it against the request's
// own Host so the desktop app's dynamic port (3737+), LAN access and the
// tunnel hostname work. Other origins need CORS_ORIGIN.
app.use(cors((req, callback) => {
  // origin:false just omits CORS headers (browser blocks cross-origin reads)
  // instead of throwing — a 500 here broke same-origin asset loads entirely.
  callback(null, { origin: isAllowedOrigin(req.headers.origin, req.headers.host), credentials: true });
}));
// CSP hashes for the built index.html's inline <script>s (the theme
// bootstrap), so script-src needs neither 'unsafe-inline' nor 'unsafe-eval'.
function inlineScriptHashes(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const dir of [path.resolve(here, '../client'), path.resolve(here, '../../src/client/dist')]) {
    // Same rule as static serving below: only a built dir has assets/ (in dev,
    // ../client is the Vite source folder, whose index.html differs).
    if (!fs.existsSync(path.join(dir, 'assets'))) continue;
    let html: string;
    try { html = fs.readFileSync(path.join(dir, 'index.html'), 'utf-8'); } catch { continue; }
    return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
      // The HTML parser turns CRLF into LF before the browser hashes the script.
      .map((m) => `'sha256-${crypto.createHash('sha256').update(m[1].replace(/\r\n?/g, '\n')).digest('base64')}'`);
  }
  return [];
}

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      // No 'unsafe-inline'/'unsafe-eval': an HTML-injection bug must not be able
      // to run script in the app origin (which can open shell sessions).
      scriptSrc: ["'self'", ...inlineScriptHashes()],
      // Inline style attrs (React `style={…}`) still need 'unsafe-inline'.
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      // Planner page video blocks: served from /api ('self') + blob previews.
      mediaSrc: ["'self'", 'blob:'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      // Served over http on loopback (desktop) — don't force https upgrade.
      upgradeInsecureRequests: null,
    },
  },
}));
// Initialize database
getDatabase();

// Kick off an initial CLI status check so version-change triggers fire and
// model reconciliation runs before the UI loads /api/models. Fire-and-forget
// — failures are swallowed inside checkAllTools / maybeTriggerSync.
checkAllTools().catch(() => { /* ignore */ });

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

// Startup recovery: reset stale 'running' discussions to 'paused'
const staleDiscussions = getDiscussionsByStatus('running');
if (staleDiscussions.length > 0) {
  console.log(`Recovering ${staleDiscussions.length} stale running discussion(s)...`);
  for (const discussion of staleDiscussions) {
    updateDiscussionStatus(discussion.id, 'paused');
    updateDiscussion(discussion.id, { process_pid: 0 });
    console.log(`  Reset discussion "${discussion.title}" (${discussion.id}) from running to paused`);
  }
}

// Startup recovery: reset stale 'running' sessions to 'failed'
const staleSessions = getSessionsByStatus('running');
if (staleSessions.length > 0) {
  console.log(`Recovering ${staleSessions.length} stale running session(s)...`);
  for (const session of staleSessions) {
    updateSessionStatus(session.id, 'failed');
    updateSession(session.id, { process_pid: 0 });
    console.log(`  Reset session "${session.title}" (${session.id}) from running to failed`);
  }
}

// One-shot legacy paste-images cleanup. Older builds saved clipboard
// screenshots into `<project>/.clitrigger/paste-images/` (and worktrees);
// the new flow writes the image directly to the host OS clipboard, so
// anything still sitting in project trees is leftover noise. Best-effort —
// every fs op is swallowed so a hostile path can't block boot.
for (const p of getAllProjects()) {
  try {
    const projDir = path.join(p.path, '.clitrigger', 'paste-images');
    if (fs.existsSync(projDir)) fs.rmSync(projDir, { recursive: true, force: true });
  } catch { /* ignore */ }
  try {
    const worktreesRoot = path.join(p.path, '.worktrees');
    if (fs.existsSync(worktreesRoot)) {
      for (const wt of fs.readdirSync(worktreesRoot)) {
        try {
          const wtDir = path.join(worktreesRoot, wt, '.clitrigger', 'paste-images');
          if (fs.existsSync(wtDir)) fs.rmSync(wtDir, { recursive: true, force: true });
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

// One-time: write the retired DB wiki out as .clitrigger/wiki/ md files
migrateAllProjectWikis();

// Auto-cleanup old logs (default 30 days)
const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || '30', 10);
const cleaned = cleanOldLogs(LOG_RETENTION_DAYS);
if (cleaned > 0) {
  console.log(`Cleaned up ${cleaned} old log entries (older than ${LOG_RETENTION_DAYS} days)`);
}
// Boot-only cleanup never fires on an always-on server; re-run daily.
setInterval(() => cleanOldLogs(LOG_RETENTION_DAYS), 24 * 60 * 60 * 1000).unref();

// Auto-cleanup old debug log files
for (const p of getAllProjects()) {
  if (p.debug_logging) {
    const debugCleaned = debugLogger.cleanupOldLogs(p.path, LOG_RETENTION_DAYS);
    if (debugCleaned > 0) {
      console.log(`Cleaned up ${debugCleaned} debug log files for project "${p.name}"`);
    }
  }
}

// Password setup gate (unless auth is explicitly disabled)
// - DB hash exists  → normal operation.
// - No hash, but AUTH_PASSWORD env present → one-time migration to scrypt hash.
// - Neither → setup mode: server starts, but tunnel auto-start is held until
//   the user finishes initial setup in the browser (POST /api/auth/setup).
let setupMode = false;
if (process.env.DISABLE_AUTH !== 'true') {
  const existingHash = getAppSetting('auth.password_hash');
  const envPwd = process.env.AUTH_PASSWORD;
  if (!existingHash && envPwd) {
    const migrated = await hashPassword(envPwd);
    setAppSetting('auth.password_hash', migrated);
    setAppSetting('auth.password_changed_at', String(Date.now()));
    console.log('Migrated legacy AUTH_PASSWORD to hashed credential store.');
    // Drop a marker so the launcher (bin/clitrigger.js) can scrub the
    // plaintext field from ~/.clitrigger/config.json on next boot.
    if (process.env.DB_PATH) {
      try {
        fs.writeFileSync(path.join(path.dirname(process.env.DB_PATH), '.password-migrated'), '');
      } catch { /* best-effort */ }
    }
  }
  delete process.env.AUTH_PASSWORD;
  if (!getAppSetting('auth.password_hash')) {
    setupMode = true;
    console.log('No password set. Open the web UI to finish setup.');
    console.log('Tunnel auto-start is paused until setup completes.');
  }
}

// MCP bearer token — generated once, stored in app_settings, shown in the UI's
// "MCP 연결" card so external MCP clients can authenticate.
if (!getAppSetting('mcp.token')) {
  setAppSetting('mcp.token', crypto.randomBytes(32).toString('hex'));
}

// Auth middleware
initAuth(app);

// Body parsing after auth, so an unauthenticated client can't make us buffer
// 50MB. Only base64 image uploads carry multi-MB bodies. body-parser skips a
// request an earlier json parser already consumed, so the big limit stays on
// those paths.
app.use(
  ['/api/todos/:id/images', '/api/planner/:id/images', '/api/planner/pages/:pageId/files', '/api/personal-items/:id/images', '/api/sessions/:id/paste-image'],
  express.json({ limit: '50mb' }),
);
app.use(express.json({ limit: '5mb' }));

app.use('/api/auth', authRouter);

// --- Plugins ---
registerPlugin(harnessPlugin);

// --- Routes ---
app.use('/api/projects', projectsRouter);
app.use('/api/projects', svnRouter);
app.use('/api/projects', filesRouter);
app.use('/api', todosRouter);
app.use('/api', executionRouter);
app.use('/api', logsRouter);
app.use('/api', imagesRouter);
app.use('/api', schedulesRouter);
app.use('/api/plugins', pluginsRouter);
app.use('/api/tunnel', tunnelRouter);
app.use('/api', modelsRouter);
app.use('/api/cli', cliStatusRouter);
app.use('/api', debugLogsRouter);
app.use('/api', discussionsRouter);
app.use('/api', analyticsRouter);
app.use('/api', sessionsRouter);
app.use('/api', sessionTagsRouter);
app.use('/api', sessionAliasesRouter);
app.use('/api', sessionSettingsRouter);
app.use('/api', plannerRouter);
app.use('/api', vaultRouter);
app.use('/api/review', reviewRouter);
app.use('/api', personalRouter);
app.use('/api', favoritesRouter);
app.use('/api', mcpRouter);
mountPluginRoutes(app);

// MCP endpoint (bearer-auth, not under /api). Mount before static/SPA serving
// so the catch-all does not swallow /mcp.
mountMcp(app);

// --- Scheduler ---
scheduler.initialize();

// --- WebSocket ---
initWebSocket(server);

// --- Tunnel (Phase 7) ---
if (setupMode && process.env.TUNNEL_ENABLED === 'true') {
  console.log('Tunnel start blocked: password not initialized — finish setup in browser first.');
}
if (process.env.TUNNEL_ENABLED === 'true' && !setupMode) {
  const port = Number(PORT);
  const tunnelName = getAppSetting('tunnel.name') ?? process.env.TUNNEL_NAME ?? '';
  const customHostname = getAppSetting('tunnel.hostname') ?? process.env.TUNNEL_HOSTNAME ?? '';
  const tunnelPromise = tunnelName
    ? tunnelManager.startNamedTunnel(tunnelName, port, customHostname || undefined)
    : tunnelManager.startTunnel(port);
  tunnelPromise.catch((err: Error) => {
    console.error('Failed to start tunnel:', err.message);
  });
  tunnelManager.on('url', (url: string) => {
    console.log(`    Share with others      →  ${url}`);
    console.log('                              (anyone with this link can reach your server — your password is the only guard)');
    console.log('');
  });
  tunnelManager.on('error', (err: Error) => {
    console.error(`  ✖ Tunnel failed: ${err.message}`);
    console.error('    External sharing is disabled. You can still use the local address above.');
  });
}

// Serve frontend static files in production (skip in headless/plugin mode)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.HEADLESS !== 'true') {
  // Resolve built client directory: check for 'assets/' subdir to avoid
  // accidentally serving the Vite source directory (src/client/) which
  // contains index.html referencing /src/main.tsx — unusable without Vite dev server.
  const candidates = [
    path.resolve(__dirname, '../client'),        // npm package: dist/client/
    path.resolve(__dirname, '../../src/client/dist'), // dev build: src/client/dist/
  ];
  const clientDist = candidates.find(d => fs.existsSync(path.join(d, 'assets')));
  if (clientDist) {
    app.use(express.static(clientDist));
    app.get(/^\/(?!api|ws).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Cleanup on process exit: kill all Claude CLI processes
function cleanup() {
  console.log('Shutting down: killing all Claude CLI processes, scheduler, and tunnel...');
  orchestrator.stopStaleProcessChecker();
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

const MAX_PORT_RETRIES = 10;
const requestedPort = Number(PORT);

// Security: an auth-disabled server must never be publicly reachable.
if (process.env.DISABLE_AUTH === 'true' && process.env.TUNNEL_ENABLED === 'true') {
  console.error('[security] Refusing to start: DISABLE_AUTH=true with TUNNEL_ENABLED=true would expose an unauthenticated server. Disable one of them.');
  process.exit(1);
}
// Bind to loopback when auth is disabled (plugin/headless mode); otherwise all
// interfaces, or BIND_HOST when explicitly set for intentional LAN sharing.
const bindHost = process.env.DISABLE_AUTH === 'true'
  ? '127.0.0.1'
  : (process.env.BIND_HOST || '0.0.0.0');

function tryListen(port: number, attempt: number) {
  server.listen(port, bindHost, () => {
    const tunnelEnabled = process.env.TUNNEL_ENABLED === 'true';
    console.log('');
    console.log('  ✔ CLITrigger is running');
    console.log('');
    console.log(`    Open on this computer  →  http://localhost:${port}`);
    if (port !== requestedPort) {
      console.log(`                              (port ${requestedPort} was in use, using ${port} instead)`);
    }
    if (tunnelEnabled) {
      console.log('    Share with others      →  (tunnel starting…)');
    }
    console.log('');
    console.log('    Login with the password you set on first run.');
    console.log('    Press Ctrl+C to stop.');
    console.log('');
    orchestrator.startStaleProcessChecker();

    // Fetch rate limit reset time in background (lightweight Claude CLI call)
    logStreamer.fetchRateLimitOnStartup();
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && attempt < MAX_PORT_RETRIES) {
      server.removeAllListeners('error');
      const nextPort = port + 1;
      console.log(`  ⚠ Port ${port} busy, trying ${nextPort}…`);
      tryListen(nextPort, attempt + 1);
    } else {
      console.error('Failed to start server:', err.message);
      process.exit(1);
    }
  });
}

tryListen(requestedPort, 0);

export { app, server };
