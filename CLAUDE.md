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
- **`plugin/`** — Hecaton TUI plugin (CommonJS, Deno-compatible). Connects to CLITrigger server as a sidecar client. Built/packaged via `scripts/build-plugin.bat`.

### Server

- **Entry**: `src/server/index.ts` — Express app, middleware, route mounting, graceful shutdown.
- **Database**: `src/server/db/` — SQLite via `better-sqlite3` with WAL mode. Schema uses backward-compatible migrations (adds columns dynamically, never drops tables). 10 tables: `projects`, `todos`, `task_logs`, `pipelines`, `pipeline_phases`, `pipeline_logs`, `schedules`, `schedule_runs`, `cli_models`, `plugin_configs`.
- **Routes**: `src/server/routes/` — REST endpoints under `/api/`. Auth, projects, todos, execution, logs, images, pipelines, schedules, plugins, models, tunnel. Integration routes (Jira, GitHub, Notion, gstack) are mounted via the plugin system.
- **Plugins**: `src/server/plugins/` — Modular integration system. Each plugin (jira, github, notion, gstack) is a self-contained module with its own `PluginManifest`, router, and config. Registered in `index.ts` via `registerPlugin()` and auto-mounted via `mountPluginRoutes()`. Two categories: `external-service` (REST proxy + UI panel) and `execution-hook` (orchestrator pre-execution hook). Config stored in generic `plugin_configs` table (key-value per project+plugin). Legacy `projects` table columns maintained for backward compatibility.
- **Services**: `src/server/services/` — Core business logic:
  - `orchestrator.ts` — Task execution engine. Manages concurrency limits, dependency chains, worktree setup, CLI invocation, auto-chaining of dependent children, squash merge on dependency completion, CLI fallback on context exhaustion, plugin execution hooks (e.g. gstack skill injection), and sandbox mode (strict: directory-scoped permissions, permissive: full access).
  - `claude-manager.ts` — Spawns/manages child processes (node-pty for TTY-requiring tools like Codex, child_process for Claude/Gemini). Windows cmd.exe wrapper for .cmd shims.
  - `cli-adapters.ts` — Adapter pattern abstracting Claude/Gemini/Codex CLI differences (args, stdin format, output format). Supports `SandboxMode` (strict/permissive) per CLI tool.
  - `log-streamer.ts` — Streams stdout/stderr to DB. Two modes: JSON lines (Claude structured output) and plain text (Gemini/Codex). Parses token usage and commit hashes. Detects context exhaustion for CLI fallback chain.
  - `worktree-manager.ts` — Git worktree lifecycle via `simple-git`. Branch name sanitization (Korean → slug, `feature/` prefix, 40 char max). Also provides 16 Git action methods (stage, unstage, commit, pull, push, fetch, branch, checkout, merge, stash, discard, tag, diff) for the web Git client.
  - `scheduler.ts` — Cron (recurring) and one-time schedules via `node-cron`.
  - `pipeline-orchestrator.ts` — Multi-phase sequential/parallel pipeline execution.
  - `skill-injector.ts` — Injects gstack skill files into `.claude/skills/` in worktrees (Claude CLI only). Used by gstack plugin's `onBeforeExecution` hook.
  - `prompt-guard.ts` — Prompt injection detection and sanitization for external inputs (Notion/GitHub/Jira imports).
  - `tunnel-manager.ts` — Cloudflare Tunnel management via `cloudflared` subprocess.
- **WebSocket**: `src/server/websocket/` — Real-time log streaming and status broadcasts. Session-authenticated. Supports stdin relay for interactive mode.
- **Auth**: Session-based (`express-session`), password from `AUTH_PASSWORD` env var. Skips `/api/auth/*` and `/api/health`. Disabled entirely when `DISABLE_AUTH=true` (plugin/headless mode).

### Client

- **Entry**: `src/client/src/main.tsx` → `App.tsx` (React Router). Calls `initPlugins()` to register client-side plugins before rendering.
- **Routes**: `/` (ProjectList), `/projects/:id` (ProjectDetail), `/projects/:id/pipelines/:pipelineId` (PipelineDetail).
- **API layer**: `src/client/src/api/` — Fetch wrapper with 401 → auto-logout handling. Plugin config API in `plugins.ts`.
- **Plugins**: `src/client/src/plugins/` — Client-side plugin system. Each plugin (jira, github, notion, gstack) provides a `ClientPluginManifest` with `PanelComponent` (tab content), `SettingsComponent` (project settings), `isEnabled()`, and i18n translations. Registered via `registerClientPlugin()` in `plugins/init.ts`. `ProjectDetail.tsx` renders plugin tabs dynamically via `getPluginsWithTabs()`. `ProjectHeader.tsx` renders plugin settings via `getClientPlugins()` loop.
- **Hooks**: `useAuth` (session state), `useWebSocket` (auto-reconnect with exponential backoff).
- **i18n**: `src/client/src/i18n.tsx` — Context-based Korean/English translations. All UI strings go through `t(key)`. Plugin-specific translations provided by each plugin manifest.
- **Components**: 24 components in `src/client/src/components/`. Task graph uses `@xyflow/react` + `dagre` for dependency visualization. `GitStatusPanel.tsx` provides a full Git client (commit graph + action toolbar + file status sidebar).

### Key Patterns

- **CLI Adapter Pattern**: All CLI tool differences are isolated in `cli-adapters.ts`. Adding a new CLI means implementing the `CliAdapter` interface.
- **Integration Plugin Pattern**: External service integrations (Jira, GitHub, Notion) and execution hooks (gstack) are self-contained plugins in `src/server/plugins/` and `src/client/src/plugins/`. Each plugin exports a `PluginManifest` (server) and `ClientPluginManifest` (client). Adding a new integration means: create a plugin directory, implement the manifest, and call `registerPlugin()` — no core code changes needed. Config stored in `plugin_configs` table (generic key-value). Two plugin categories: `external-service` (REST proxy routes + panel tab) and `execution-hook` (pre-execution hook in orchestrator).
- **Worktree Isolation**: Each task gets its own git worktree in `.worktrees/`. Child tasks can inherit parent worktrees.
- **Graceful Shutdown**: Server handles SIGTERM/SIGINT — kills running CLI processes, stops scheduler, closes tunnel. Also shuts down on stdin EOF (plugin sidecar mode).
- **Headless Mode**: `HEADLESS=true` skips static file serving (API-only mode for plugin/embedded use). `DISABLE_AUTH=true` removes auth middleware (local-only plugin scenarios).
- **DB Migrations**: Schema changes add columns with `ALTER TABLE ... ADD COLUMN` guarded by try/catch, so the app works with both old and new DB files. Plugin configs use a separate `plugin_configs` table with automatic migration from legacy project columns.
- **Sandbox Mode**: Per-project `sandbox_mode` (strict/permissive). Strict mode uses each CLI's native sandboxing to restrict file access to the worktree directory. Claude: auto-generated `.claude/settings.json`; Codex: `--full-auto` + `--add-dir .git`; Gemini: prompt-level path restriction.
- **Failure Tolerance**: On startup, stale "running" todos are reset to "failed". Plugin execution hook failures are logged but don't block CLI execution.

## Environment

Config via `.env` (see `.env.example`). Key vars: `AUTH_PASSWORD`, `PORT` (default 3000), `TUNNEL_ENABLED`, `LOG_RETENTION_DAYS`, `HEADLESS` (skip frontend serving), `DISABLE_AUTH` (skip auth middleware).

## Language

UI and documentation are primarily in Korean. Commit messages use Korean or English. The codebase (variable names, comments in code) is in English.

## Task Execution Guidelines

When working on tasks in this repository (especially via CLITrigger worktrees), follow these efficiency rules:

### Efficiency
- Use grep/glob to find relevant files FIRST. Do NOT read files one by one to explore the codebase.
- Only read files you intend to modify or that are directly needed to understand the change.
- Do NOT launch Agent/Explore subagents for simple, targeted tasks (e.g., CSS changes, config updates, single-file fixes). Use direct grep → read → edit.
- Make all related edits in a single pass. Do not re-read files you already read.
- Prefer `replace_all: true` for repetitive changes across a file.
- Aim for under 15 tool calls for simple tasks, under 30 for complex ones.

### Completion
- Once the task is complete, commit and stop immediately.
- Do not perform additional refactoring, optimization, or testing beyond what was explicitly requested.
- Do not add comments, docstrings, or type annotations to unchanged code.
- Do not review your own changes unless asked.
