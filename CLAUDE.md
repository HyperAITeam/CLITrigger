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

# Desktop (Windows)
scripts/build-win.bat          # EXE + portable (NSIS). --skip-install/-s skips npm ci; --msix switches to appx target with auto-generated self-signed cert; set CSC_KEY_PASSWORD env var to override the default PFX password (defaults to 'clitrigger' if unset)
```

## Architecture

### Monorepo Layout

- **`bin/clitrigger.js`** — CLI entry. Reads `~/.clitrigger/config.json`, sets env vars, imports compiled server. Password is set via web UI (Settings → Account); legacy plaintext is one-shot migrated to a scrypt hash. Non-blocking npm-registry update check prints an upgrade hint.
- **`src/server/`** — Express backend (TypeScript, ESM). Compiled via `tsconfig.server.json` → `dist/server/`.
- **`src/client/`** — React frontend (Vite + TailwindCSS). Separate `package.json` and `npm install`. Build output copied to `dist/client/` for npm packaging.
- **`plugin/`** — Hecaton TUI plugin (CommonJS, Deno-compatible). Sidecar client. Built via `scripts/build-plugin.bat`.

### Server

- **Entry**: `src/server/index.ts` — Express app, middleware, route mounting, graceful shutdown. Auto-retries next port on EADDRINUSE.
- **Database**: `src/server/db/` — SQLite (`better-sqlite3`, WAL). Backward-compatible migrations (`ALTER TABLE ADD COLUMN` guarded by try/catch). Visual schema at `docs/ERD.md` (regenerate via `npm run docs:erd`). Key tables:
  - Per-project: `projects` (carries `vcs_type`/`svn_enabled`/`is_git_repo`), `todos`, `task_logs`, `schedules`, `schedule_runs`, `discussion_agents`, `discussions`, `discussion_messages`, `discussion_logs`, `sessions`, `session_logs`, `session_raw_chunks`, `planner_items`, `planner_tags`, `memory_nodes`, `memory_edges`, `memory_logs`.
  - Global: `cli_models`, `cli_versions`, `plugin_configs`, `session_tags`, `favorites`, `app_settings` (KV — tunnel name/hostname, auth password hash + changed_at, session defaults).
  - Denormalized `todos.total_cost_usd`/`total_tokens` for analytics. `session_raw_chunks` stores binary PTY output (~2MB rolling cap/session) for xterm.js replay.
- **Routes**: `src/server/routes/` — REST under `/api/`. One file per resource (`auth`, `projects`, `todos`, `execution`, `logs`, `images`, `schedules`, `plugins`, `models`, `cli-status`, `analytics`, `sessions`, `session-tags`, `session-settings`, `planner`, `review`, `memory`, `tunnel`, `discussions`, `svn`, `favorites`, `debug-logs`). Integration routes (Jira, GitHub, Notion, gstack, harness) mounted via the plugin system. SVN routes are gated on `project.svn_enabled && vcs_type==='svn'` — they 400 for non-SVN projects and never spawn `svn`.
- **Plugins**: `src/server/plugins/` — Modular integrations (`jira`, `github`, `notion`, `gstack`, `harness`), each with its own `PluginManifest`, router, and config (stored in `plugin_configs` KV). Two categories: `external-service` (REST proxy + UI panel) and `execution-hook` (orchestrator pre-execution hook). The `harness` plugin edits Claude/Gemini/Codex global config dirs (NOT worktree-scoped — client shows a warning banner).
- **Services**: `src/server/services/` — Core business logic. Each file is the canonical place to read for that subsystem; see the file for full detail.
  - `orchestrator.ts` — Task execution engine. Concurrency limits, dependency chains, worktree setup, CLI invocation, auto-chaining, squash merge on dependency completion, CLI fallback on context/quota exhaustion, plugin hooks, memory injection, sandbox mode, stale-process liveness check, multi-round continue (`--continue`).
  - `discussion-orchestrator.ts` — Multi-agent discussion engine. Round-based sequential turns with full history context; supports auto-implement, per-agent `can_implement` (commits during regular turn). Same worktree/sandbox/memory pipeline as todos.
  - `session-manager.ts` — Interactive session engine. Per-session long-lived CLI via PTY. Worktree opt-in, stale-session recovery, raw PTY bytes → `session_raw_chunks` (batched 4KB-or-100ms). **DB chunks are the single source of truth for replay** — `session:subscribe` flushes the in-flight buffer first, then sends only DB chunks. Initial prompts are stashed (`pendingInitialPrompts`), not auto-written; client uses `/pending-prompt` + `/submit-initial` or `/skip-initial`. `startupInputBuffer` queues keystrokes during the spawn window so type-ahead survives.
  - `claude-manager.ts` — Child-process spawner. node-pty for interactive/TTY-requiring tools (Codex), child_process for headless. Adapter-driven `stdinSubmitSequence` (`\r` for Claude/Codex, `\r\n` for Gemini) and `autoRespondRules` for CLI-specific dialogs.
  - `cli-adapters.ts` — Adapter pattern abstracting Claude/Gemini/Codex differences (args, stdin format, output format, session resume, interactive mode, sandbox flags). Adding a new CLI = implement `CliAdapter`.
  - `log-streamer.ts` — Streams stdout/stderr to DB. Two modes: Claude stream-json (typed `assistant`/`tool_use`/`tool_result` events, not flattened) and plain text (Gemini/Codex, gated through `pty-output-filter.isPlainTextNoise`). Parses token usage, commit hashes, rate-limit events. Detects context exhaustion AND Gemini quota exhaustion (sliding-window — Gemini retries internally without exiting, so we kill from outside to trigger fallback).
  - `worktree-manager.ts` — Git worktree lifecycle via `simple-git`. Branch sanitization (Korean → slug, `feature/` prefix). `createWorktree(..., autoInstall)` opt-in `npm install` only when `project.npm_auto_install` is set. `gitPush(dir, opts)` is object-form for SourceTree-style multi-branch push (`--force` always becomes `--force-with-lease`; `setUpstream:true` splits into a second `-u` call). All `simpleGit()` goes through `createGit()` in `lib/git.ts` which sets `core.quotePath=false` (CJK/emoji filenames). Exports `resolveLocalBaseBranch(git, configured)` — shared base-branch fallback used by `routes/{review,logs,discussions}.ts`.
  - `svn-manager.ts` — Mirrors `worktree-manager`'s GUI-consumed surface for SVN. Normalizes SVN status to git porcelain shape (`{path, index:' ', working_dir:<svn char>}`) so `DiffViewer`/`CommitFileList` work unchanged. `lib/svn.ts::runSvn` uses UTF-8 env + `--non-interactive` to prevent credential-prompt hangs.
  - `memory-injector.ts` — Builds the `<long_term_memory>` block from `memory_nodes`+`memory_edges` (arrow-notation edges). CLI-agnostic plain text. Four modes: `none`/`all`/`selected`/`auto`. Token-safety: per-node line cap with title-only fallback. Also exports `buildRawFileBlock(...)` for verbatim `.clitrigger/raw/*.md` injection (50KB/file cap, traversal-guarded). Selector is orthogonal to mode.
  - `memory-retriever.ts` — Backs `auto` mode. One-shot headless LLM call scores candidates from title/body/tags.
  - `memory-inject-hook.ts` — Wrapper used by orchestrator/session-manager. Logs mode + node count. Concatenates curated-node block + raw-file block with blank line between (single prepend). Gate: `mode !== 'none' || rawFilePaths.length > 0`.
  - `memory-ingest.ts` — Source → wiki ingest. Splits >8000-char sources at paragraph boundaries (max 4 chunks of 7000), re-fetches nodes between chunks so dedup sees earlier additions. Broadcasts `memory:ingest-finished` WS event.
  - `memory-wikilinks.ts` — `[[wikilink]]` parser. Used by node merge to rewrite references.
  - `wiki-exporter.ts` — One-way DB → `.clitrigger/wiki/<entity>/<slug>.md` with YAML frontmatter. **Truth source stays in DB**; Rebuild overwrites disk from DB.
  - `wiki-index.ts` — Auto-maintains System nodes (Schema + Index). Excluded from entry groups, lint, retrieval, and `all`-mode injection.
  - `discussion-extractor.ts` — Headless one-shot LLM that converts a completed discussion into curated planner items. stdin-piped prompt (bypasses Windows cmd.exe argument-length limit). 120s timeout.
  - `review-capture.ts` — Best-effort capture of summary/diff stats for finished todos. All failures swallowed so it never blocks orchestration.
  - `scheduler.ts` — Cron + one-time schedules via `node-cron`.
  - `skill-injector.ts` — Injects gstack skills into `.claude/skills/` in worktrees. Used by gstack plugin `onBeforeExecution`.
  - `pty-output-filter.ts` — Noise filter for PTY and headless plain-text streams. Drops spinners/status bars/TUI menu chars/path echoes. Stateful block filter (`PtyFilterState`) absorbs multi-line xterm.js parser dumps and conpty/node-pty stack traces (200-line runaway guard). `isPlainTextNoise(line, state)` consumed by `log-streamer.ts` so cleanup applies to headless Gemini/Codex output too.
  - `cli-status.ts` — `--version` parallel probe with 60s cache. Fire-and-forget triggers `model-sync.ts`.
  - `model-sync.ts` — Probes each CLI's `--help` for supported models and merges with `src/server/data/cli-models-registry.json` (probe + registry hybrid because probe alone breaks on help-format changes, registry alone misses new models).
  - `debug-logger.ts` — Tees stdin/stdout/stderr to `.debug-logs/` when `project.debug_logging` is on. Non-invasive PassThrough. Auto-adds `.debug-logs` to `.gitignore`.
  - `prompt-guard.ts` — Prompt-injection sanitization for external imports (Notion/GitHub/Jira).
  - `tunnel-manager.ts` — Cloudflare Tunnel via `cloudflared`. Primary source = bundled npm `cloudflared` package binary; falls back to PATH/Windows-specific paths.
  - `clipboard-writer.ts` — Pushes raw image bytes to host OS clipboard so CLI subprocess picks them up via native Alt+V — no file ever lands in the project tree. Platform writers: Windows in-memory PowerShell `Clipboard.SetImage`, macOS brief tmp + osascript + unlink, Linux `wl-copy`/`xclip`. Process-wide promise-chain mutex serializes concurrent calls. 10s spawn timeout.
- **WebSocket**: `src/server/websocket/` — Real-time log streaming, binary PTY frames, status broadcasts. Session-authenticated. Per-client binary subscription mgmt (`session:subscribe/unsubscribe`, `session:terminal-input/resize`).
- **Auth**: `express-session`. Password stored as `node:crypto.scrypt` hash in `app_settings.auth.password_hash`. `auth.password_changed_at` invalidates older sessions on change. **Setup mode**: when no hash exists and `DISABLE_AUTH !== 'true'`, server boots but Cloudflare tunnel start is held until `POST /api/auth/setup` (prevents external access during initial setup). Legacy `AUTH_PASSWORD` env migrated on first boot then scrubbed. Routes: `login`, `setup` (one-shot, 409 once initialized), `password` (oldPassword verify, keeps own session alive), `logout`, `status`. `DISABLE_AUTH=true` removes middleware entirely.

### Client

- **Entry**: `src/client/src/main.tsx` → `App.tsx` (React Router). Wraps in `ThemeContext`, `NotificationProvider`, `I18nProvider`. `initPlugins()` registers client-side plugins before render.
- **Routes**: `/` (ProjectList), `/review` (cross-project Morning Review Queue), `/projects/:id` (ProjectDetail — Todos, Sessions, Planner, Analytics, Wiki, Discussions, Schedules, Git, plugin tabs), `/projects/:id/discussions/:discussionId`.
- **API layer**: `src/client/src/api/` — Fetch wrapper with 401 → auto-logout.
- **Plugins**: `src/client/src/plugins/` — Mirror of server plugin system. Each plugin provides `ClientPluginManifest` with `PanelComponent`, `SettingsComponent`, `isEnabled()`, i18n. Registered via `registerClientPlugin()` in `plugins/init.ts`. `ProjectDetail.tsx` renders plugin tabs dynamically.
- **Hooks**: `useAuth`, `useWebSocket` (auto-reconnect with exponential backoff), `useTheme` (CSS variables + `data-theme` attribute, localStorage, OS default detection), `useModels`, `useNotification` (browser Notification API + permission flow), `useToast`. Per-session terminal hooks `useSessionFontSize` and `useSessionTheme` use module-level caches + listener sets and localStorage keys `sessionFontSize:{id}` / `sessionTheme:{id}`.
- **i18n**: `src/client/src/i18n.tsx` — Context-based Korean/English. All UI strings go through `t(key)`. Plugin translations supplied by each plugin manifest.
- **Components**: ~60 components in `src/client/src/components/`. For file-by-file detail, read the components directly — the source is the doc. High-level map:
  - Git/VCS: `GitStatusPanel.tsx` (Fork/SourceTree-style File Status + History views, `WorkspaceMenu` sidebar), `PushDialog.tsx` (multi-branch push, `--force-with-lease`, tracking toggle), `SvnStatusPanel.tsx` (mirror of GitStatusPanel for SVN — reuses `DiffViewer`/`CommitFileList` because svn-manager normalizes to git porcelain shape), `DiffViewer.tsx` (shared file list + diff, fixed dark palette for green/red overlay readability).
  - Review: `ReviewQueue.tsx`/`ReviewCard.tsx` — keyboard nav (`j/k`/arrows), `Enter` opens `LogViewer`, `Space`/`→` toggles inline `DiffViewer`, `m`/`d` merge/discard. Risk badge classified server-side.
  - Wiki (UI rename — DB tables/routes/files keep "memory"): `MemoryList.tsx`, `MemoryGraph.tsx`, `MemoryNodeDetail.tsx`, `MemoryForm.tsx`, `MemoryNetworkGraph.tsx` (`@xyflow/react` + dagre). `MemoryInjectControl.tsx` is the reusable selector (mode + node IDs + orthogonal raw-md file multi-select) wired into TodoForm/DiscussionForm/SessionForm.
  - Sessions: `SessionList.tsx`, `SessionForm.tsx`, `SessionWindowsHost.tsx` (ProjectDetail-scoped provider, persists `OpenGroup[]` to `sessionGroups:{projectId}`), `SessionWindow.tsx` (portal-rendered, Aero edge/neighbor snap, 8-direction resize), `SessionTerminal.tsx` (xterm.js + FitAddon). Group primitives in `src/client/src/components/group/`: `groupTree.ts` (pure tree ops), `colors.ts`, `SessionPane.tsx`, `StackView.tsx`, `Splitter.tsx`, `LayoutNodeView.tsx`, `DockOverlay.tsx`. See **Floating Window + Group Pattern** below for the cross-cutting rules.
  - Todos/Planner/Discussion: `TodoList.tsx` (status tabs, iOS stack mode, gap-zone DnD), `TodoForm.tsx` (tri-state worktree radio), `TodoItem.tsx`, `PlannerList.tsx`/`PlannerItem.tsx`/`PlannerForm.tsx`/`PlannerConvertDialog.tsx` (Markdown Export/Import), `DiscussionDetail.tsx` (round-grouped messages + "Send to Planner" extract modal), `DiscussionForm.tsx`, `AgentManager.tsx` (per-agent CLI/model + `can_implement` flag).
  - Shared primitives: `Modal.tsx`, `EmptyState.tsx`, `Toast.tsx`, `Skeleton.tsx`, `Resizer.tsx` (axis x/y + min/max + per-key localStorage), `MarkdownContent.tsx` (`react-markdown` + `remark-gfm`), `FavoriteForm.tsx`, `lib/cn.ts`. Icons: `lucide-react` (brand logo + Git graph SVGs kept inline).

## Key Patterns

These are cross-cutting patterns that explain *why* the code is shaped this way. Apply them when adding similar features.

- **CLI Adapter Pattern**: All CLI tool differences are isolated in `cli-adapters.ts`. Adding a new CLI = implement the `CliAdapter` interface.
- **Integration Plugin Pattern**: External services (Jira/GitHub/Notion) and execution hooks (gstack/harness) are self-contained in `src/server/plugins/` and `src/client/src/plugins/`. Adding one = create directory + manifest + `registerPlugin()`. No core code changes.
- **Worktree Isolation**: Each task gets its own git worktree in `.worktrees/`. Per-project `use_worktree` toggle (default: on) + per-todo tri-state override (`todos.use_worktree`: null=inherit, 0=force-main, 1=force-worktree). Main-branch effective todos are gated to run alone via `canStartNow` and retried via `startDependentChildren` when siblings finish. When `use_worktree=off` project-wide, server forces `max_concurrent=1`. SVN-enabled projects also force `max_concurrent=1` (no worktree-equivalent in phase 1).
- **Opt-in VCS Pattern**: SVN exists alongside git but is gated by `project.svn_enabled` (default 0). Detection (`isSvnRepository`) runs lazily — only when the flag is set. Same shape extends to future VCS: add a `vcs_type` value, an opt-in flag, and a normalizer that maps the VCS's status output to git porcelain shape (`{path, index, working_dir}`) so the diff/commit components work unchanged. `cli-status.ts` carries an `isVcs` flag to skip `model-sync.ts` for non-model CLIs.
- **Sandbox Mode**: Per-project `sandbox_mode` (strict/permissive). Strict uses each CLI's native sandboxing scoped to the worktree dir.
  - **Claude gotcha**: `.claude/settings.json` patterns MUST use absolute paths (`${workDir}/**`) — Claude resolves relative paths like `./` to absolute internally and the match fails. Also normalize `workDir` to forward slashes (`workDir.replace(/\\/g, '/')`) before substitution — mixed-separator patterns on Windows silently reject every Edit/Write match and force a Bash fallback.
  - Codex: `--full-auto` + `--add-dir .git`. Gemini: prompt-level path restriction.
- **Wiki Injection (Karpathy LLM-Wiki pattern)**: Per-project knowledge graph (`memory_nodes`+`memory_edges`) selectively prepended to prompts as a `<long_term_memory>` block. Plain text, CLI-agnostic. Four modes: `none`/`all`/`selected`/`auto`. Orthogonal raw-md injection via `memory_raw_file_paths` (wrapped in `<raw_source_files>`) — works even with `mode='none'`. **The `<long_term_memory>` XML tag is kept verbatim** — LLMs treat the literal phrase as a semantic hint; don't rename it. UI was renamed Memory→Wiki but DB tables, routes (`/api/projects/:id/memory/*`), files (`MemoryList.tsx`, `memory-injector.ts`), and the prompt tag intentionally retain "memory" — don't rename them.
- **Agent Discussion**: Multi-agent feature design before implementation. Round-based sequential turns with full history. Designated implementer (or per-agent `can_implement`) commits to the shared worktree. Transcripts can be extracted into curated planner items via `discussion-extractor.ts`.
- **Floating Window + Group Pattern**: `SessionWindow` renders via `createPortal(..., document.body)` so groups survive tab switches. State as a layout tree (`stack` | `split`) per `OpenGroup`, persisted to `sessionGroups:{projectId}` localStorage and **gated on `sessions` having loaded** so empty-during-load doesn't nuke restored state. Drag/resize/split mutate `style.transform`/`flex-basis` directly during gestures (bypass React, keep xterm canvas stable) and commit to state on mouseup. Viewport clamp keeps titlebar ≥80px visible. VS Code-style 5-zone docking via `document.elementFromPoint` against `data-group-id`/`data-stack-path`; eager tab-tear at ≥12px outside source rect. Single-stack chrome drag sets `pointer-events: none` on the wrapper during the gesture so elementFromPoint finds destination stacks instead of self-hitting. **All tabs in a group stay mounted** (`display` toggled) so xterm state and live PTY output never drop. Mobile (<768px) is fullscreen of active tab only. Apply this pattern for any persistent multi-pane floating UI.
- **Raw Binary Streaming for xterm.js**: Sessions stream raw PTY bytes (not stripped) for pixel-perfect rendering. Server has a 256KB per-pid ring buffer in `claudeManager` and a ~2MB rolling-cap `session_raw_chunks` DB table. **DB chunks are the single source of truth for replay** — `session:subscribe` calls `flushPendingRaw(sessionId)` (sync buffer drain) then sends only DB chunks. The ring is a strict subset of DB; replaying both produced duplicate welcome banners. Binary frame parsing bypasses React state (direct per-sessionId callback Map in `useWebSocket`).
- **Native Focus Handoff (Electron)**: Renderer `element.focus()` and React `autoFocus` only move DOM focus — they don't reclaim native HWND keyboard focus when an embedded native view (xterm.js helper textarea) has captured it. Fix is a main-process IPC bridge: preload exposes `electronAPI.imeReset` → `ipcRenderer.send('ime:reset')` → `mainWindow.webContents.focus()` in main. Renderer code mounting after capture (e.g., `SessionForm`) calls `imeReset()`, RAFs twice, then focuses the target. Same pattern for lock-screen/screensaver resume: `mainWindow.on('focus', () => webContents.focus())`.
- **Electron Auto-Update**: Packaged builds use `electron-updater` against GitHub Releases. `electron/main.cjs::setupAutoUpdater()` runs only when `app.isPackaged`. Help menu has manual "업데이트 확인" with `updateCheckInFlight` guard. `latest.yml` + blockmap already published by `release.yml --publish always`.
- **Tunnel Custom Hostname**: Named tunnels can route through a user's domain to inherit reputation (avoids `*.trycloudflare.com` warnings). Stored in `app_settings` (`tunnel.name`/`tunnel.hostname`), env fallback `TUNNEL_NAME`/`TUNNEL_HOSTNAME`. `tunnel-manager.ts` keeps cloudflared CLI args unchanged — custom hostname is purely display/config; user runs `cloudflared tunnel route dns <name> <hostname>` themselves.
- **Graceful Shutdown**: Server handles SIGTERM/SIGINT — kills running CLI processes, stops scheduler, closes tunnel. Also shuts down on stdin EOF (plugin sidecar mode).
- **Headless Mode**: `HEADLESS=true` skips static file serving (API-only). `DISABLE_AUTH=true` removes auth middleware (local-only plugin scenarios).
- **DB Migrations**: `ALTER TABLE ADD COLUMN` guarded by try/catch — app works with both old and new DB files. Plugin configs use a separate `plugin_configs` table.
- **Failure Tolerance**: On startup, stale "running" todos → "failed", stale "running" discussions → "paused". Plugin hook failures are logged but don't block CLI execution.
- **npm CLI Packaging**: Published as `clitrigger`. `bin/clitrigger.js` handles first-run setup, sets `PORT`/`AUTH_PASSWORD`/`DB_PATH`, dynamically imports `dist/server/index.js`. Static file resolution: `../client` (npm install) or `../../src/client/dist` (dev) via fallback. Cloudflared bundled as npm dependency.

## Environment

Config via `.env` (see `.env.example`), `~/.clitrigger/config.json` (npm install), or Electron `userData/config.json`. Key vars:

- `AUTH_PASSWORD` — one-shot migration source for the scrypt hash on first boot. Web UI Setup screen is the canonical entry.
- `PORT` (default 3000), `DB_PATH`, `LOG_RETENTION_DAYS`
- `TUNNEL_ENABLED`, `TUNNEL_NAME`, `TUNNEL_HOSTNAME`
- `HEADLESS`, `DISABLE_AUTH`

DB-stored `app_settings` takes precedence over env vars for tunnel name/hostname. The password hash lives ONLY in `app_settings.auth.password_hash`.

## Language

UI and documentation are primarily in Korean. Commit messages: Korean or English. Codebase (identifiers, in-code comments): English.

## UI Guidelines

> 시각 디자인 결정(색상, 타이포그래피, spacing, 컴포넌트 스타일)은 `.claude/docs/design.md`를 기준 레퍼런스로 참조할 것.

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
