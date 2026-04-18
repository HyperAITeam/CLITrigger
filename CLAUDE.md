# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CLITrigger is a full-stack app that automates AI-powered task execution. Users write TODO items in a web UI, and the system spawns isolated git worktrees for each task, running Claude/Gemini/Codex CLI tools in parallel. Built with Express + React + SQLite + WebSocket.

## Commands

```bash
# CLI (npm global install)
npm i -g clitrigger            # global install
clitrigger                     # start server (first run prompts for password)
clitrigger config              # view/change settings (port, password)

# Development (runs server + client concurrently)
npm run dev

# Build
npm run build                  # both client and server (copies client to dist/client/)
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

- **`bin/`** — CLI entry point (`clitrigger.js`). Handles first-run setup (password prompt), reads `~/.clitrigger/config.json`, sets env vars, and imports the compiled server. Supports `config` subcommand for port/password/clear changes. Auto-update check on startup (24h cooldown, npm registry). `postuninstall.js` prints cleanup notice on `npm uninstall`.
- **`src/server/`** — Express backend (TypeScript, ESM). Compiled via `tsconfig.server.json` → `dist/server/`.
- **`src/client/`** — React frontend (Vite + TailwindCSS). Has its own `package.json` with separate `npm install`. Dev server proxies API calls to `:3000`. Build output copied to `dist/client/` for npm packaging.
- **`plugin/`** — Hecaton TUI plugin (CommonJS, Deno-compatible). Connects to CLITrigger server as a sidecar client. Built/packaged via `scripts/build-plugin.bat`.

### Server

- **Entry**: `src/server/index.ts` — Express app, middleware, route mounting, graceful shutdown. Auto-retries next port on EADDRINUSE (up to 10 attempts).
- **Database**: `src/server/db/` — SQLite via `better-sqlite3` with WAL mode. Schema uses backward-compatible migrations (adds columns dynamically, never drops tables). 11 tables: `projects`, `todos`, `task_logs`, `schedules`, `schedule_runs`, `cli_models`, `plugin_configs`, `discussion_agents`, `discussions`, `discussion_messages`, `discussion_logs`.
- **Routes**: `src/server/routes/` — REST endpoints under `/api/`. Auth, projects (including native folder picker via `POST /browse`), todos, execution (including `POST /continue` for multi-round), logs, images, schedules, plugins, models, tunnel, discussions, debug-logs. Integration routes (Jira, GitHub, Notion, gstack) are mounted via the plugin system.
- **Plugins**: `src/server/plugins/` — Modular integration system. Each plugin (jira, github, notion, gstack) is a self-contained module with its own `PluginManifest`, router, and config. Registered in `index.ts` via `registerPlugin()` and auto-mounted via `mountPluginRoutes()`. Two categories: `external-service` (REST proxy + UI panel) and `execution-hook` (orchestrator pre-execution hook). Config stored in generic `plugin_configs` table (key-value per project+plugin). Legacy `projects` table columns maintained for backward compatibility.
- **Services**: `src/server/services/` — Core business logic:
  - `orchestrator.ts` — Task execution engine. Manages concurrency limits, dependency chains, worktree setup (optional per-project `use_worktree` toggle), CLI invocation, auto-chaining of dependent children, squash merge on dependency completion, dependency chain batch merge (leaf branch → main), CLI fallback on context exhaustion, plugin execution hooks (e.g. gstack skill injection), sandbox mode (strict: directory-scoped permissions, permissive: full access), stale process liveness checker (30s interval), and multi-round continue (`continueTodo()` reuses existing worktree with `--continue` flag).
  - `claude-manager.ts` — Spawns/manages child processes (node-pty for TTY-requiring tools like Codex and interactive mode, child_process for headless/verbose). Windows cmd.exe wrapper for .cmd shims. Interactive mode uses PTY with stdin wrapped as Writable for WebSocket relay. Auto-confirms workspace trust prompts in PTY mode via `trustPending` flag (pending-based detection to avoid blocking stdin when workspace is already trusted).
  - `cli-adapters.ts` — Adapter pattern abstracting Claude/Gemini/Codex CLI differences (args, stdin format, output format). Supports `SandboxMode` (strict/permissive) per CLI tool.
  - `log-streamer.ts` — Streams stdout/stderr to DB. Two modes: JSON lines (Claude structured output) and plain text (Gemini/Codex). Parses token usage and commit hashes. Detects context exhaustion for CLI fallback chain. Supports round-based log tagging via `setRound()` for multi-round continue.
  - `worktree-manager.ts` — Git worktree lifecycle via `simple-git`. Branch name sanitization (Korean → slug, `feature/` prefix, 40 char max, duplicate suffix `-2`/`-3`). Auto-runs `npm install` in background on worktree creation when `package.json` exists. Auto-adds `.worktrees` to project `.gitignore`. Squash merge auto-aborts on conflict to prevent dirty worktree state. Also provides 16 Git action methods (stage, unstage, commit, pull, push, fetch, branch, checkout, merge, stash, discard, tag, diff) and commit inspection methods (`getCommitFiles`, `getCommitDiff` with root/merge commit handling) for the web Git client.
  - `scheduler.ts` — Cron (recurring) and one-time schedules via `node-cron`.
  - `skill-injector.ts` — Injects gstack skill files into `.claude/skills/` in worktrees (Claude CLI only). Used by gstack plugin's `onBeforeExecution` hook.
  - `discussion-orchestrator.ts` — Multi-agent discussion engine. Round-based turn execution where agents speak sequentially, each receiving the full discussion history in their prompt. Supports start/stop/pause/resume, user message injection, turn skipping, auto-implement (automatically triggers implementation round on discussion completion), and a special implementation round (max_rounds+1) where a designated agent writes code. Uses worktree isolation and sandbox mode like todos.
  - `debug-logger.ts` — CLI debug logging service. When `project.debug_logging` is enabled, captures raw stdin/stdout/stderr to `.debug-logs/` via PassThrough stream tee (non-invasive to existing log stream). Auto-cleans old logs on startup based on `LOG_RETENTION_DAYS`. Auto-adds `.debug-logs` to project `.gitignore`.
  - `prompt-guard.ts` — Prompt injection detection and sanitization for external inputs (Notion/GitHub/Jira imports).
  - `tunnel-manager.ts` — Cloudflare Tunnel management via `cloudflared` subprocess. Uses bundled npm `cloudflared` package binary as primary source, falls back to system PATH and Windows-specific paths.
- **WebSocket**: `src/server/websocket/` — Real-time log streaming and status broadcasts. Session-authenticated. Supports stdin relay for interactive mode.
- **Auth**: Session-based (`express-session`), password from `AUTH_PASSWORD` env var (required). Skips `/api/auth/*` and `/api/health`. Server refuses to start without `AUTH_PASSWORD` unless `DISABLE_AUTH=true`. Also disabled when `DISABLE_AUTH=true` (plugin/headless mode).

### Client

- **Entry**: `src/client/src/main.tsx` → `App.tsx` (React Router). Wraps app in `ThemeContext.Provider` and `I18nProvider`. Calls `initPlugins()` to register client-side plugins before rendering.
- **Routes**: `/` (ProjectList), `/projects/:id` (ProjectDetail), `/projects/:id/discussions/:discussionId` (DiscussionDetail).
- **API layer**: `src/client/src/api/` — Fetch wrapper with 401 → auto-logout handling. Plugin config API in `plugins.ts`.
- **Plugins**: `src/client/src/plugins/` — Client-side plugin system. Each plugin (jira, github, notion, gstack) provides a `ClientPluginManifest` with `PanelComponent` (tab content), `SettingsComponent` (project settings), `isEnabled()`, and i18n translations. Registered via `registerClientPlugin()` in `plugins/init.ts`. `ProjectDetail.tsx` renders plugin tabs dynamically via `getPluginsWithTabs()`. `ProjectHeader.tsx` renders plugin settings via `getClientPlugins()` loop.
- **Hooks**: `useAuth` (session state), `useWebSocket` (auto-reconnect with exponential backoff), `useTheme` (light/dark mode via CSS variables + `data-theme` attribute, persisted to localStorage, OS default detection), `useModels` (CLI model list for tool/model selection).
- **i18n**: `src/client/src/i18n.tsx` — Context-based Korean/English translations. All UI strings go through `t(key)`. Plugin-specific translations provided by each plugin manifest.
- **Components**: 32 components in `src/client/src/components/`. Task graph uses `@xyflow/react` + `dagre` for dependency visualization. `GitStatusPanel.tsx` provides a full Git client (commit graph + action toolbar + file status sidebar + commit detail panel with file list and diff viewer). `ProjectList.tsx` shows project cards with invalid-path detection — projects whose local folder no longer exists show a red "경로 없음" badge with dimmed opacity; clicking prompts deletion instead of navigating. `DiscussionDetail.tsx` provides a chat UI for multi-agent discussions (round-grouped messages, streaming logs, user injection, implementation modal, message collapse/expand with summary preview, failure error log panel). `DiscussionList.tsx` shows discussion list. `DiscussionForm.tsx` provides shared create/edit form for discussions (auto-implement option, agent selection, turn order UI). `AgentManager.tsx` provides CRUD for agent personas with per-agent CLI tool/model selection. `MarkdownContent.tsx` wraps `react-markdown` + `remark-gfm` for rendering agent responses and discussion messages.

### Key Patterns

- **CLI Adapter Pattern**: All CLI tool differences are isolated in `cli-adapters.ts`. Adding a new CLI means implementing the `CliAdapter` interface.
- **Integration Plugin Pattern**: External service integrations (Jira, GitHub, Notion) and execution hooks (gstack) are self-contained plugins in `src/server/plugins/` and `src/client/src/plugins/`. Each plugin exports a `PluginManifest` (server) and `ClientPluginManifest` (client). Adding a new integration means: create a plugin directory, implement the manifest, and call `registerPlugin()` — no core code changes needed. Config stored in `plugin_configs` table (generic key-value). Two plugin categories: `external-service` (REST proxy routes + panel tab) and `execution-hook` (pre-execution hook in orchestrator).
- **Worktree Isolation**: Each task gets its own git worktree in `.worktrees/`. Child tasks can inherit parent worktrees. Per-project `use_worktree` toggle (default: on) allows running directly on main branch without worktree overhead; when disabled, server forces `max_concurrent=1` to prevent conflicts.
- **Graceful Shutdown**: Server handles SIGTERM/SIGINT — kills running CLI processes, stops scheduler, closes tunnel. Also shuts down on stdin EOF (plugin sidecar mode).
- **Headless Mode**: `HEADLESS=true` skips static file serving (API-only mode for plugin/embedded use). `DISABLE_AUTH=true` removes auth middleware (local-only plugin scenarios).
- **DB Migrations**: Schema changes add columns with `ALTER TABLE ... ADD COLUMN` guarded by try/catch, so the app works with both old and new DB files. Plugin configs use a separate `plugin_configs` table with automatic migration from legacy project columns.
- **Sandbox Mode**: Per-project `sandbox_mode` (strict/permissive). Strict mode uses each CLI's native sandboxing to restrict file access to the worktree directory. Claude: auto-generated `.claude/settings.json` with absolute-path patterns (`${workDir}/**`) for Read/Edit/Write — relative paths like `./` are ineffective because Claude resolves paths to absolute internally; Codex: `--full-auto` + `--add-dir .git`; Gemini: prompt-level path restriction.
- **Agent Discussion**: Multiple AI agents with different roles (architect, developer, reviewer, etc.) discuss a feature in rounds before implementation. Each agent speaks sequentially with full history context. After discussion completes, a designated agent implements the consensus. Uses same worktree isolation and CLI adapter patterns as todos.
- **Failure Tolerance**: On startup, stale "running" todos are reset to "failed", stale "running" discussions are reset to "paused". Plugin execution hook failures are logged but don't block CLI execution.
- **npm CLI Packaging**: Published as `clitrigger` on npm. `bin/clitrigger.js` handles first-run setup, reads config from `~/.clitrigger/config.json`, sets `PORT`/`AUTH_PASSWORD`/`DB_PATH` env vars, then dynamically imports `dist/server/index.js`. Auto-update check on startup (24h cooldown). Build copies client output to `dist/client/`; server resolves static files from `../client` (npm install) or `../../src/client/dist` (dev) via fallback. Cloudflared bundled as npm dependency for zero-config tunnel.

## Environment

Config via `.env` (see `.env.example`) or `~/.clitrigger/config.json` (npm global install). Key vars: `AUTH_PASSWORD`, `PORT` (default 3000), `DB_PATH` (database location), `TUNNEL_ENABLED`, `LOG_RETENTION_DAYS`, `HEADLESS` (skip frontend serving), `DISABLE_AUTH` (skip auth middleware).

## Language

UI and documentation are primarily in Korean. Commit messages use Korean or English. The codebase (variable names, comments in code) is in English.

## UI Guidelines

### Floating elements must render via portal

Tooltips, dropdowns, popovers, hover help boxes, context menus, and "more" menus MUST be rendered through `createPortal(..., document.body)` with `position: fixed` + viewport clamping (using the anchor element's `getBoundingClientRect`). Do NOT rely on `position: absolute` inside the component tree — header cards, list rows, badge rows, and worktree/todo containers all have `overflow`, `border-radius`, or `transform` ancestors that will clip the floating element.

Past bugs from this exact mistake: project header deprecated-model tooltip was clipped by the header card border; todo-item "more" menu (`⋮`) was clipped by the task row. The portal + fixed + clamp pattern lives in `TodoItem.tsx`'s `MoreMenu` and `ProjectHeader.tsx`'s `DeprecatedModelBadge` — copy that pattern for any new floating UI.

Checklist for every floating element:
- Render into `document.body` via `createPortal`
- Use `position: fixed` with top/left computed from the anchor's `getBoundingClientRect()`
- Clamp within viewport: flip above on vertical overflow, shift left on horizontal overflow, keep ≥8px from edges
- Recompute on `scroll` (capture phase) and `resize`
- Use `z-tooltip` z-index class

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
