#!/usr/bin/env node
/**
 * seed-demo.mjs — populate CLITrigger with believable demo data for recording the README GIF.
 *
 * Creates a throwaway demo git repo (with real branches + worktrees + diffs) and a
 * "CLITrigger Demo ✨" project whose tasks are split across three CLIs in mixed states:
 *   - 3 running tasks  → the "parallel execution" shot (Tasks board)
 *   - 2 completed + 1 failed task → the "morning review" shot (Review queue, with real diffs)
 *
 * Your real projects are never touched. Everything lives under the demo repo dir and a
 * single demo project row, both removable with `--clean`.
 *
 * Usage:
 *   node scripts/seed-demo.mjs              # seed (default repo dir: ../clitrigger-demo)
 *   node scripts/seed-demo.mjs --repo D:\demo
 *   node scripts/seed-demo.mjs --db <path>  # override DB (default: $DB_PATH or ./clitrigger.db)
 *   node scripts/seed-demo.mjs --clean      # remove the demo project + repo + worktrees
 *
 * IMPORTANT timing (verified against the orchestrator):
 *   - Seed while the server is ALREADY RUNNING, then just refresh the browser.
 *   - Do NOT restart the server afterwards — startup recovery resets all 'running' tasks to 'failed'.
 *   - Running tasks use process_pid=0, which the 30s stale-checker skips, so they stay "running".
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ---- args ----------------------------------------------------------------
const args = process.argv.slice(2);
const getFlag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const CLEAN = args.includes('--clean');
const DB_PATH = getFlag('--db') || process.env.DB_PATH || path.join(PROJECT_ROOT, 'clitrigger.db');
const REPO_DIR = path.resolve(getFlag('--repo') || path.join(PROJECT_ROOT, '..', 'clitrigger-demo'));
const WT_ROOT = `${REPO_DIR}-wt`;
const PROJECT_NAME = 'CLITrigger Demo ✨';

const git = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const slug = (branch) => branch.replace(/[^a-z0-9]+/gi, '-');
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

// ---- base repo files -----------------------------------------------------
const BASE_FILES = {
  'package.json': JSON.stringify({ name: 'demo-api', version: '1.0.0', type: 'module', main: 'src/server.js' }, null, 2) + '\n',
  'README.md': '# demo-api\n\nA tiny Express API used for the CLITrigger demo.\n',
  'src/server.js': `import express from 'express';\nimport { router } from './routes.js';\n\nconst app = express();\napp.use(express.json());\napp.use('/api', router);\n\napp.listen(3000, () => console.log('listening on :3000'));\n`,
  'src/routes.js': `import { Router } from 'express';\n\nexport const router = Router();\n\nrouter.get('/health', (_req, res) => res.json({ ok: true }));\nrouter.get('/items', (_req, res) => res.json({ items: [] }));\n`,
  'src/auth.js': `// Auth helpers\nexport function getUser(req) {\n  return req.headers['x-user'] || null;\n}\n`,
  'src/db.js': `// Naive sync DB pool\nexport function query(sql) {\n  return pool.querySync(sql);\n}\n`,
};

// ---- task definitions ----------------------------------------------------
// `edits` (completed/failed only) become a real commit on `branch`, producing a real diff.
const TASKS = [
  // --- running: the parallel-execution shot. branch + worktree created, left WIP. ---
  { title: 'Add exponential backoff to the API client', cli: 'claude', status: 'running',
    branch: 'feat/api-backoff', wip: { 'src/client.js': `// WIP: retry with backoff\nexport async function call(fn, tries = 5) {\n  // ...\n}\n` } },
  { title: 'Migrate config loader to a zod schema', cli: 'gemini', status: 'running',
    branch: 'feat/zod-config', wip: { 'src/config.js': `// WIP: zod-based config\nimport { z } from 'zod';\n` } },
  { title: 'Add WebSocket auto-reconnect', cli: 'codex', status: 'running',
    branch: 'feat/ws-reconnect', wip: { 'src/ws.js': `// WIP: reconnect loop\n` } },

  // --- completed / failed: the morning-review shot with real diffs. ---
  { title: 'Add JWT auth middleware', cli: 'claude', status: 'completed',
    branch: 'feat/jwt-auth', cost: 0.42, tokens: 31840,
    summary: 'Added a JWT verification middleware and wired it into the protected routes. Tokens are read from the Authorization header and verified against JWT_SECRET; invalid/expired tokens return 401, and a role guard helper was added for admin-only endpoints.',
    edits: {
      'src/auth.js': `// Auth helpers\nimport jwt from 'jsonwebtoken';\n\nconst SECRET = () => {\n  const s = process.env.JWT_SECRET;\n  if (!s) throw new Error('JWT_SECRET is not set');\n  return s;\n};\n\nexport function getUser(req) {\n  return req.user || req.headers['x-user'] || null;\n}\n\nfunction extractToken(req) {\n  const header = req.headers.authorization || '';\n  if (header.startsWith('Bearer ')) return header.slice(7);\n  if (req.cookies && req.cookies.token) return req.cookies.token;\n  return null;\n}\n\nexport function requireAuth(req, res, next) {\n  const token = extractToken(req);\n  if (!token) return res.status(401).json({ error: 'missing token' });\n  try {\n    req.user = jwt.verify(token, SECRET());\n    next();\n  } catch (err) {\n    const code = err.name === 'TokenExpiredError' ? 'token expired' : 'invalid token';\n    return res.status(401).json({ error: code });\n  }\n}\n\nexport function requireRole(role) {\n  return (req, res, next) => {\n    if (!req.user) return res.status(401).json({ error: 'not authenticated' });\n    if (req.user.role !== role) return res.status(403).json({ error: 'forbidden' });\n    next();\n  };\n}\n\nexport function signToken(payload, ttl = '1h') {\n  return jwt.sign(payload, SECRET(), { expiresIn: ttl });\n}\n`,
      'src/routes.js': `import { Router } from 'express';\nimport { requireAuth, requireRole } from './auth.js';\n\nexport const router = Router();\n\nrouter.get('/health', (_req, res) => res.json({ ok: true }));\nrouter.get('/items', requireAuth, (_req, res) => res.json({ items: [] }));\nrouter.delete('/items/:id', requireAuth, requireRole('admin'), (req, res) => res.json({ deleted: req.params.id }));\n`,
    } },
  { title: 'Fix off-by-one in pagination offset', cli: 'codex', status: 'completed',
    branch: 'fix/pagination-offset', cost: 0.06, tokens: 4120,
    summary: 'Pagination skipped one row per page because the offset used page*size instead of (page-1)*size. Corrected the formula and added a guard for page < 1.',
    edits: {
      'src/routes.js': `import { Router } from 'express';\n\nexport const router = Router();\n\nrouter.get('/health', (_req, res) => res.json({ ok: true }));\nrouter.get('/items', (req, res) => {\n  const page = Math.max(1, Number(req.query.page) || 1);\n  const size = Number(req.query.size) || 20;\n  const offset = (page - 1) * size;\n  res.json({ items: [], offset });\n});\n`,
    } },
  { title: 'Refactor DB pool to async/await', cli: 'gemini', status: 'failed',
    branch: 'refactor/db-pool-async', cost: 0.51, tokens: 38900,
    summary: 'Conversion of the sync DB pool to async/await left 3 call sites still using the old sync API, so the build fails to type-check. Needs the remaining callers migrated before this can merge.',
    edits: {
      'src/db.js': `// Async DB pool (INCOMPLETE — 3 sync callers still need migrating)\nexport async function query(sql, params = []) {\n  const conn = await pool.acquire();\n  try {\n    return await conn.query(sql, params);\n  } finally {\n    await pool.release(conn);\n  }\n}\n\nexport async function transaction(fn) {\n  const conn = await pool.acquire();\n  try {\n    await conn.begin();\n    const result = await fn(conn);\n    await conn.commit();\n    return result;\n  } catch (err) {\n    await conn.rollback();\n    throw err;\n  } finally {\n    await pool.release(conn);\n  }\n}\n`,
    } },
];

const LOGS = {
  running: (cli) => [
    ['info', `Starting ${cli} in isolated worktree…`],
    ['stdout', '● Reading project context (CLAUDE.md, src/**)…'],
    ['stdout', '● Drafting an implementation plan…'],
    ['stdout', '✏  Editing src/…'],
  ],
  completed: (cli) => [
    ['info', `Starting ${cli} in isolated worktree…`],
    ['stdout', '● Implementing the change…'],
    ['stdout', '✏  Applied edits across the worktree'],
    ['stdout', '✓ Committed to branch'],
    ['info', 'Task completed.'],
  ],
  failed: (cli) => [
    ['info', `Starting ${cli} in isolated worktree…`],
    ['stdout', '● Implementing the change…'],
    ['error', '✗ Type check failed: 3 call sites still use the sync API'],
    ['error', 'Task failed — left for review.'],
  ],
};

// ==========================================================================
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

function clean(db) {
  const proj = db.prepare('SELECT id FROM projects WHERE name = ?').get(PROJECT_NAME);
  if (proj) {
    db.pragma('foreign_keys = ON');
    db.prepare('DELETE FROM projects WHERE id = ?').run(proj.id); // cascades todos/logs/sessions
    console.log(`  removed demo project (${proj.id})`);
  } else {
    console.log('  no demo project row found');
  }
  // Remove worktrees registered against the repo, then the dirs.
  if (fs.existsSync(REPO_DIR)) {
    try { git(REPO_DIR, 'worktree', 'prune'); } catch {}
  }
  rmrf(WT_ROOT);
  rmrf(REPO_DIR);
  console.log(`  removed ${REPO_DIR} and ${WT_ROOT}`);
}

function buildRepo() {
  rmrf(REPO_DIR); rmrf(WT_ROOT);
  fs.mkdirSync(REPO_DIR, { recursive: true });
  git(REPO_DIR, 'init', '-q');
  git(REPO_DIR, 'config', 'user.email', 'demo@clitrigger.local');
  git(REPO_DIR, 'config', 'user.name', 'CLITrigger Demo');
  for (const [rel, content] of Object.entries(BASE_FILES)) {
    const abs = path.join(REPO_DIR, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  git(REPO_DIR, 'add', '-A');
  git(REPO_DIR, 'commit', '-q', '-m', 'chore: initial demo API');
  git(REPO_DIR, 'branch', '-M', 'main');
}

function makeBranchWorktree(task) {
  const wtPath = path.join(WT_ROOT, slug(task.branch));
  // Create branch off main and add a worktree checked out to it.
  git(REPO_DIR, 'branch', task.branch, 'main');
  fs.mkdirSync(WT_ROOT, { recursive: true });
  git(REPO_DIR, 'worktree', 'add', '-q', wtPath, task.branch);

  if (task.edits) {
    for (const [rel, content] of Object.entries(task.edits)) {
      const abs = path.join(wtPath, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    git(wtPath, 'add', '-A');
    git(wtPath, 'commit', '-q', '-m', task.title);
    // Derive real diff stats (vs main) so the stored badge matches the rendered diff.
    const numstat = git(REPO_DIR, 'diff', `main...${task.branch}`, '-M0', '--numstat');
    let files = 0, lines = 0;
    for (const line of numstat.split('\n')) {
      const parts = line.trim().split('\t');
      if (parts.length < 3) continue;
      files += 1;
      lines += (parseInt(parts[0], 10) || 0) + (parseInt(parts[1], 10) || 0);
    }
    return { wtPath, diff_files: files, diff_lines: lines };
  } else if (task.wip) {
    // Running task: leave an uncommitted WIP edit so the worktree looks in-flight.
    for (const [rel, content] of Object.entries(task.wip)) {
      const abs = path.join(wtPath, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
  }
  return { wtPath };
}

function seed(db) {
  clean(db); // idempotent — wipe any previous demo data first
  console.log('Building demo git repo…');
  buildRepo();

  const projectId = randomUUID();
  db.prepare(
    `INSERT INTO projects (id, name, path, default_branch, is_git_repo, vcs_type, use_worktree, max_concurrent, cli_tool, color, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, 'main', 1, 'git', 1, 3, 'claude', '#8b5cf6', 9999, ?, ?)`
  ).run(projectId, PROJECT_NAME, REPO_DIR, iso(), iso());

  const insertTodo = db.prepare(
    `INSERT INTO todos (id, project_id, title, description, status, priority, branch_name, worktree_path,
       process_pid, cli_tool, cli_model, summary, diff_lines, diff_files, total_cost_usd, total_tokens,
       position_x, position_y, created_at, updated_at)
     VALUES (@id, @project_id, @title, @description, @status, @priority, @branch_name, @worktree_path,
       @process_pid, @cli_tool, @cli_model, @summary, @diff_lines, @diff_files, @total_cost_usd, @total_tokens,
       @position_x, @position_y, @created_at, @updated_at)`
  );
  const insertLog = db.prepare(
    `INSERT INTO task_logs (id, todo_id, log_type, message, round_number, created_at) VALUES (?, ?, ?, ?, 1, ?)`
  );

  const tx = db.transaction(() => {
    TASKS.forEach((task, i) => {
      console.log(`  + [${task.status}] ${task.cli}  ${task.title}`);
      const { wtPath, diff_files = null, diff_lines = null } = makeBranchWorktree(task);
      const todoId = randomUUID();
      const running = task.status === 'running';
      // Lay out: running tasks in the left column, review tasks in the right.
      const col = running ? 0 : 1;
      const row = running ? i : i - 3;
      insertTodo.run({
        id: todoId,
        project_id: projectId,
        title: task.title,
        description: task.summary || '',
        status: task.status,
        priority: 0,
        branch_name: task.branch,
        worktree_path: wtPath,
        process_pid: 0, // 0 → stale-checker skips it, so 'running' persists
        cli_tool: task.cli,
        cli_model: '',
        summary: task.summary || null,
        diff_lines: diff_lines,
        diff_files: diff_files,
        total_cost_usd: task.cost ?? null,
        total_tokens: task.tokens ?? null,
        position_x: 80 + col * 380,
        position_y: 80 + row * 220,
        // completed/failed must be recent so the 24h review window includes them
        created_at: iso(running ? 8 * 60 * 1000 : 6 * 60 * 60 * 1000),
        updated_at: iso(running ? 60 * 1000 : 30 * 60 * 1000),
      });
      const lines = (LOGS[task.status] || LOGS.running)(task.cli);
      lines.forEach(([type, msg], j) => insertLog.run(randomUUID(), todoId, type, msg, iso((lines.length - j) * 4000)));
    });
  });
  tx();

  console.log('\n✅ Seeded. Demo project: ' + PROJECT_NAME);
  console.log('   DB:   ' + DB_PATH);
  console.log('   Repo: ' + REPO_DIR);
  console.log('\nNext:');
  console.log('   1. Refresh the browser (do NOT restart the server — it would reset running tasks).');
  console.log('   2. Tasks board → "parallel execution" shot (3 running across Claude/Gemini/Codex).');
  console.log('   3. Review queue → "morning review" shot (2 completed + 1 failed, with real diffs).');
  console.log('\nWhen done recording:  node scripts/seed-demo.mjs --clean');
}

// ==========================================================================
if (!fs.existsSync(DB_PATH)) {
  console.error(`DB not found at ${DB_PATH}.\nStart CLITrigger once (so the DB is created), or pass --db <path>.`);
  process.exit(1);
}
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
try {
  if (CLEAN) {
    console.log('Cleaning demo data…');
    clean(db);
    console.log('✅ Clean complete.');
  } else {
    seed(db);
  }
} finally {
  db.close();
}
