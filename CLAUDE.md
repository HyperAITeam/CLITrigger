# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CLITrigger is a full-stack app that automates AI-powered task execution. Users write TODO items in a web UI, and the system spawns isolated git worktrees for each task, running Claude/Antigravity/Codex CLI tools in parallel. Built with Express + React + SQLite + WebSocket.

## Commands

```bash
# Development (runs server + client concurrently)
npm run dev

# Build
npm run build                  # both client and server
npm run build:server           # server only (→ dist/server/)
npm run build:client           # client only (→ src/client/dist/)

# Tests
npm run test                   # all tests (server + client)
npm run test:server            # server tests only (vitest, node env)
npm run test:client            # client tests only (vitest, jsdom env)
npx vitest run src/server/path/to/file.test.ts   # single server test
cd src/client && npx vitest run src/path/to/file.test.tsx  # single client test

# Type checking
npm run typecheck              # server + client

# Desktop (Windows)
scripts/build-win.bat          # --skip-install/-s skips npm ci; --msix for appx target
```

## Architecture

### Monorepo Layout

- **`src/server/`** — Express backend (TypeScript, ESM). Entry: `src/server/index.ts`. DB: SQLite (`better-sqlite3`, WAL) in `src/server/db/`. Services in `src/server/services/`, routes in `src/server/routes/`, plugins in `src/server/plugins/`.
- **`src/client/`** — React frontend (Vite + TailwindCSS). Separate `package.json`. Entry: `src/client/src/main.tsx` → `App.tsx`.
- **`bin/clitrigger.js`** — npm CLI entry.
- **`plugin/`** — Hecaton TUI plugin (CommonJS, Deno-compatible).

## Key Patterns & Gotchas

These encode constraints that aren't obvious from the code. Apply when touching related areas.

- **Sandbox Mode — Claude absolute path gotcha**: `.claude/settings.json` patterns MUST use absolute paths (`${workDir}/**`) — Claude resolves relative paths internally and the match fails. Also normalize `workDir` to forward slashes (`workDir.replace(/\\/g, '/')`) on Windows — mixed separators silently reject every Edit/Write match.
- **Wiki naming convention**: UI was renamed Memory→Wiki but DB tables, routes (`/api/projects/:id/memory/*`), files (`MemoryList.tsx`, `memory-injector.ts`), and the `<long_term_memory>` prompt tag intentionally retain "memory" — don't rename them. The XML tag is a semantic hint to LLMs.
- **Floating Window state gating**: `SessionWindowsHost` persists `OpenGroup[]` to `sessionGroups:{projectId}` localStorage. Persist must be **gated on `sessions` having loaded** so empty-during-load doesn't nuke restored state. Hydrate in `useState` initializer (synchronous), not a post-mount effect — a persist effect can race and write `[]` first.
- **Raw Binary Streaming**: **DB `session_raw_chunks` are the single source of truth for replay** — `session:subscribe` flushes the in-flight buffer then sends only DB chunks. Never replay from both ring buffer + DB (causes duplicate output).
- **Native Focus Handoff (Electron)**: React `element.focus()` doesn't reclaim native HWND focus from xterm.js. Use the IPC bridge: `electronAPI.imeReset()` → `mainWindow.webContents.focus()` in main process, then RAF twice before focusing the target.

## UI Guidelines

> 시각 디자인 결정은 `.claude/docs/design.md`를 기준으로 참조할 것.

### Floating elements must render via portal

Tooltips, dropdowns, popovers, context menus, and "more" menus MUST use `createPortal(..., document.body)` with `position: fixed` + viewport clamping. Do NOT use `position: absolute` — parent containers have `overflow`/`transform` that clip.

Checklist:
- `createPortal` into `document.body`
- `position: fixed`, top/left from anchor's `getBoundingClientRect()`
- Clamp within viewport (flip/shift), ≥8px from edges
- Recompute on `scroll` (capture) and `resize`
- `z-tooltip` z-index class

## Environment

Config via `.env` (see `.env.example`), `~/.clitrigger/config.json`, or Electron `userData/config.json`.
Key vars: `PORT` (default 3000), `DB_PATH`, `TUNNEL_ENABLED`, `HEADLESS`, `DISABLE_AUTH`.

## Language

UI and documentation are primarily in Korean. Commit messages: Korean or English. Codebase (identifiers, comments): English.

## Task Execution Guidelines

### Efficiency
- Use grep/glob to find relevant files FIRST. Do NOT read files one by one to explore.
- Only read files you intend to modify or that are directly needed.
- Do NOT launch Agent/Explore subagents for simple tasks. Use direct grep → read → edit.
- Make all related edits in a single pass. Prefer `replace_all: true` for repetitive changes.
- Aim for under 15 tool calls for simple tasks, under 30 for complex ones.

### Completion
- Once done, commit and stop immediately.
- Do not perform additional refactoring, optimization, or testing beyond what was requested.
- Do not add comments, docstrings, or type annotations to unchanged code.
