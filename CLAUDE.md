# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CLITrigger is a full-stack app that automates AI-powered task execution. Users write TODO items in a web UI, and the system spawns isolated git worktrees for each task, running Claude/Gemini/Codex CLI tools in parallel. Built with Express + React + SQLite + WebSocket.

## Commands

```bash
# Development (runs server + client concurrently)
npm run dev

# Build
npm run build                  # both client and server
npm run build:server           # server only (outputs to dist/server/)
npm run build:client           # client only (outputs to src/client/dist/)

# Production
npm run start                  # serves built app on PORT (default 3000)
npm run start:tunnel           # with Cloudflare Tunnel enabled

# Tests
npm run test                   # all tests (server + client)
npm run test:server            # server tests only (vitest, node env)
npm run test:client            # client tests only (vitest, jsdom env)
npx vitest run src/server/path/to/file.test.ts   # single server test
cd src/client && npx vitest run src/path/to/file.test.tsx  # single client test

# Type checking
npm run typecheck              # server + client
```

## Architecture

### Monorepo Layout

- **`src/server/`** — Express backend (TypeScript, ESM). Compiled via `tsconfig.server.json` → `dist/server/`.
- **`src/client/`** — React frontend (Vite + TailwindCSS). Has its own `package.json` with separate `npm install`. Dev server proxies API calls to `:3000`.

### Server

- **Entry**: `src/server/index.ts` — Express app, middleware, route mounting, graceful shutdown.
- **Database**: `src/server/db/` — SQLite via `better-sqlite3` with WAL mode. Schema uses backward-compatible migrations (adds columns dynamically, never drops tables). 8 tables: `projects`, `todos`, `task_logs`, `pipelines`, `pipeline_phases`, `pipeline_logs`, `schedules`, `schedule_runs`.
- **Routes**: `src/server/routes/` — REST endpoints under `/api/`. Auth, projects, todos, execution, logs, images, pipelines, schedules, jira, tunnel.
- **Services**: `src/server/services/` — Core business logic:
  - `orchestrator.ts` — Task execution engine. Manages concurrency limits, dependency chains, worktree setup, CLI invocation, and auto-chaining of next tasks.
  - `claude-manager.ts` — Spawns/manages child processes (node-pty for TTY-requiring tools like Codex, child_process for Claude/Gemini). Windows cmd.exe wrapper for .cmd shims.
  - `cli-adapters.ts` — Adapter pattern abstracting Claude/Gemini/Codex CLI differences (args, stdin format, output format).
  - `log-streamer.ts` — Streams stdout/stderr to DB. Two modes: JSON lines (Claude structured output) and plain text (Gemini/Codex). Parses token usage and commit hashes.
  - `worktree-manager.ts` — Git worktree lifecycle via `simple-git`. Branch name sanitization (Korean → slug, `feature/` prefix, 40 char max).
  - `scheduler.ts` — Cron (recurring) and one-time schedules via `node-cron`.
  - `pipeline-orchestrator.ts` — Multi-phase sequential/parallel pipeline execution.
  - `skill-injector.ts` — Injects gstack skill files into `.claude/skills/` in worktrees (Claude CLI only).
  - `tunnel-manager.ts` — Cloudflare Tunnel management via `cloudflared` subprocess.
- **WebSocket**: `src/server/websocket/` — Real-time log streaming and status broadcasts. Session-authenticated. Supports stdin relay for interactive mode.
- **Auth**: Session-based (`express-session`), password from `AUTH_PASSWORD` env var. Skips `/api/auth/*` and `/api/health`.

### Client

- **Entry**: `src/client/src/main.tsx` → `App.tsx` (React Router).
- **Routes**: `/` (ProjectList), `/projects/:id` (ProjectDetail), `/projects/:id/pipelines/:pipelineId` (PipelineDetail).
- **API layer**: `src/client/src/api/` — Fetch wrapper with 401 → auto-logout handling.
- **Hooks**: `useAuth` (session state), `useWebSocket` (auto-reconnect with exponential backoff).
- **i18n**: `src/client/src/i18n.tsx` — Context-based Korean/English translations. All UI strings go through `t(key)`.
- **Components**: 24 components in `src/client/src/components/`. Task graph uses `@xyflow/react` + `dagre` for dependency visualization.

### Key Patterns

- **CLI Adapter Pattern**: All CLI tool differences are isolated in `cli-adapters.ts`. Adding a new CLI means implementing the `CliAdapter` interface.
- **Worktree Isolation**: Each task gets its own git worktree in `.worktrees/`. Child tasks can inherit parent worktrees.
- **Graceful Shutdown**: Server handles SIGTERM/SIGINT — kills running CLI processes, stops scheduler, closes tunnel.
- **DB Migrations**: Schema changes add columns with `ALTER TABLE ... ADD COLUMN` guarded by try/catch, so the app works with both old and new DB files.
- **Failure Tolerance**: On startup, stale "running" todos are reset to "failed". gstack skill injection failures are logged but don't block CLI execution.

## Environment

Config via `.env` (see `.env.example`). Key vars: `AUTH_PASSWORD`, `PORT` (default 3000), `TUNNEL_ENABLED`, `LOG_RETENTION_DAYS`.

## Language

UI and documentation are primarily in Korean. Commit messages use Korean or English. The codebase (variable names, comments in code) is in English.
