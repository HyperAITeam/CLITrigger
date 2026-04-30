<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/src/client/public/logo.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/src/client/public/logo.svg">
  <img alt="CLITrigger" src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/src/client/public/logo.svg" width="360">
</picture>

**AI-Powered Parallel Worktree Automation**

*Write tasks. Let AI execute them in parallel. Review and merge.*

<p align="center">
  <a href="https://github.com/OSgoodYZ/CLITrigger/blob/main/README.md">English</a> ·
  <a href="https://github.com/OSgoodYZ/CLITrigger/blob/main/README_KR.md">한국어</a>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/clitrigger.svg)](https://www.npmjs.com/package/clitrigger)
[![npm downloads](https://img.shields.io/npm/dm/clitrigger.svg)](https://www.npmjs.com/package/clitrigger)
[![npm total downloads](https://img.shields.io/npm/dt/clitrigger.svg)](https://www.npmjs.com/package/clitrigger)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev)
[![GitHub stars](https://img.shields.io/github/stars/HyperAITeam/CLITrigger.svg?style=social)](https://github.com/HyperAITeam/CLITrigger/stargazers)

</div>

---

> ### While you sleep, your AI is working.
>
> In the age of AI-generated code, the developer's role is shifting toward supervision and review. But **vibe coding without understanding** eventually hits a wall.
>
> CLITrigger takes the tasks you queued before bed and runs them overnight — multiple AI coding agents (**Claude Code · Codex · Gemini CLI**) working in parallel, each in its own isolated git worktree. Next morning, you just review the stack of diffs and **accept / reject**.
>
> **Parallel AI execution — without losing context.**

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-tasks.png" alt="Tasks — Parallel worktree execution" width="800">
  <p><em>AI CLIs working simultaneously across isolated git worktrees</em></p>
</div>

---

## Why CLITrigger?

Boris Cherny, creator of Claude Code, emphasizes **parallelism** as the key to AI-assisted development. Waiting for one task to finish before starting the next is the new bottleneck.

At the same time, most AI services have **rate limits** — you can burn through your daily quota by noon and be stuck waiting until midnight.

CLITrigger solves both problems:

- **Right now** — Multiple tasks run in isolated git worktrees, with Claude / Gemini / Codex executing in parallel
- **Without hitting limits** — Schedule tasks for off-peak hours to make the most of your token quota
- **Better output** — Multiple AI agents debate and review before implementation, producing higher-quality results than a single AI working alone

---

## How It Works

```
[Write TODOs in the browser]
         ↓
┌──────────────────────────────────────────────────────────────┐
│  TODO 1: Implement login      → worktree/feature-login     → Claude CLI → auto-commit  │
│  TODO 2: Signup page          → worktree/feature-signup    → Gemini CLI → auto-commit  │
│  TODO 3: Dashboard layout     → worktree/feature-dashboard → Claude CLI → auto-commit  │
└──────────────────────────────────────────────────────────────┘
         ↓
[Live log streaming → Review diffs → Merge to main]
```

Each TODO runs in its **own isolated git worktree** — no conflicts, separate branches, independent commit history. You review the results and decide what to merge.

---

## The Workflow — Hand Off, Then Review

**CLITrigger is built for "delegate and review" — not for staring at a progress bar.**

### Scenario 1: The AI night shift — hand off at bedtime, pick up in the morning
Before bed, dump unfinished work and sudden ideas into the Planner, convert them into TODOs or scheduled runs, then close the laptop. While you sleep, Claude / Gemini / Codex burn through your token quota in parallel worktrees. Next morning, sit down with coffee and review the diffs holistically — accept what makes sense, reject what doesn't, merge what's ready.

**Your tokens never sleep. Neither does your codebase.**

### Scenario 2: The background worker
Stay focused on your main work while CLITrigger handles side quests in the background. Refactors, test coverage, doc updates, speculative features — the stuff you never have time for — gets done while you ship the critical path. Browser notifications (or phone alerts via Cloudflare Tunnel) surface completed tasks only when they need your attention.

### The Core Loop

```
    Evening                 Overnight / Sidelined              Morning / Break
  ───────────              ───────────────────────          ────────────────────
   Capture         →         AI executes in parallel   →    Review holistically
   • Planner                 • Worktree isolation           • Diff by diff
   • TODOs                   • Rate-limit auto-recovery     • Log by log
   • Schedules               • Multi-agent discussion       • Accept / Reject / Merge
```

Every feature — Planner, Scheduler, worktree isolation, rate-limit auto-recovery, multi-agent discussion, the built-in Git client — exists to support this loop: **capture → delegate → review**.

---

## Features

### Plugin System (Harness, Jira, GitHub, Notion, gstack)
The **Harness** panel edits Claude / Gemini / Codex user config (settings, memory files, MCP servers) right in the browser — atomic writes with deep-merge preserve untouched fields, and a Codex `trustLevelMissing` warning surfaces when a project isn't trusted. Jira, GitHub, Notion integrations and gstack skill injection ship alongside as self-contained plugins. Two plugin categories — `external-service` (REST proxy + UI panel) and `execution-hook` (pre-execution hook into the orchestrator). Adding a new integration needs only a manifest and `registerPlugin()` call — no core code changes.

### Wiki (Karpathy LLM-Wiki Pattern)
A per-project knowledge graph (nodes + typed edges) that you curate once and selectively inject into TODO and discussion prompts. Stop pasting the same domain context every run. Toggle between List and Graph views (`@xyflow/react` + dagre auto-layout, drag-to-connect edges, cycle guards on `precedes`/`refines`), pick `None` / `All` / `Selected` per task, preview the exact `<long_term_memory>` block before sending. CLI-agnostic — Claude, Gemini, and Codex all see identical context with no adapter changes.

### Planner
A lightweight task planner separate from TODOs — capture ideas, attach images, tag with colors, sort by any column. Convert any planner item into a TODO or a schedule in one click. Markdown export/import (status sections + GFM checkboxes + HTML-comment metadata) lets you move plans across machines or share via GitHub / Obsidian / any plain Markdown viewer. Drop a `.md` file onto the planner card to import.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-planer.png" alt="Planner — Lightweight task management" width="800">
  <p><em>Inline editing, color-coded tags, image attachments, and one-click conversion to TODOs or schedules</em></p>
</div>

### Parallel Worktree Execution (Tasks)
Each TODO automatically gets its own git worktree. Claude / Gemini / Codex CLIs execute simultaneously in parallel. Dependency chains let you automatically trigger follow-up tasks and branch merges once prerequisites complete. Per-project worktree toggle plus per-TODO tri-state override (inherit / force-worktree / force-main) give you fine-grained control — main-branch tasks are automatically serialized to avoid conflicts. Drag-and-drop reordering and an iOS-style stack mode keep long task lists manageable.

### Interactive Sessions
Long-lived interactive CLI sessions as first-class entities — bring up a Claude / Gemini / Codex session in a floating draggable window. **xterm.js rendering** shows ANSI colors, cursor control, and TUI box-drawing identically to a native terminal — no line-by-line scraping, no output mangling. PTY spawns at the exact viewport dimensions so Claude Code's welcome banner and menus render at the correct column width. Optional worktree isolation per session. Chat-mode log viewer classifies output into assistant / tool-use blocks for readability. Window geometry persists per session, survives tab navigation, and works on desktop and mobile (fullscreen on small screens).

### Multi-Agent Discussion
AI agents with different roles — architect, developer, reviewer — debate in rounds before implementation. The resulting design is far more robust than a single AI working in isolation. Agents flagged as **Implementers** (`can_implement`) can commit code during their regular turns, while a final implementation round stitches everything together. Auto-implement triggers the code-writing round automatically on consensus. Or hit **Send to Planner** on a finished discussion to have the transcript distilled into curated planner items via a one-shot LLM extraction — review and edit before persisting.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-discussions.png" alt="Discussions — Multi-agent debate" width="800">
  <p><em>Multiple AI agents with different roles debating in the Discussion view</em></p>
</div>

### Scheduled Execution
Schedule tasks for off-peak hours to avoid rate limits. Supports recurring cron schedules, one-time scheduled runs, and auto-recovery scheduling on rate-limit events — if the CLI hits a token quota, CLITrigger schedules a retry for the exact reset time.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-schedules.png" alt="Schedules — Scheduled execution" width="800">
  <p><em>Cron-based recurring and one-time scheduled task execution</em></p>
</div>

### Built-in Git Client
A full Git client lives inside the web UI with a Fork/SourceTree-style layout — a workspace menu switches between **File Status** (staged/unstaged file lists, working-tree diff viewer, commit message + push toggle, Cmd/Ctrl+Enter to commit) and **History** (commit graph, action toolbar, worktree list, VS Code-style branch context menu with checkout / merge / rebase / fetch / pull / push / rename / delete, and a commit detail panel with file-level diff viewer). Every split is user-resizable and persisted to localStorage. Non-ASCII filenames (Korean, CJK, emoji) render correctly in diff and status output.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-git.png" alt="Git — Built-in client" width="800">
  <p><em>Commit graph, branch actions, file diffs — all in the browser</em></p>
</div>

### Analytics
Per-project cost and execution stats powered by Recharts — stacked bar chart by CLI tool, donut chart for status distribution, line chart for cost/token trends. Denormalized cost fields in the DB keep aggregation fast even on long histories.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-analytics.png" alt="Analytics — Execution stats" width="800">
  <p><em>Cost and token usage broken down by CLI, status, and over time</em></p>
</div>

### Morning Review Queue
A single cross-project triage screen for the "delegate overnight, review next morning" loop. Aggregates every recent TODO across all your projects into a card stack with project label, last-assistant summary, token totals, diff stats, and a server-classified risk badge (low / medium / high based on status and diff size). Keyboard-only operation: `j`/`k` to navigate, `Enter` for the embedded log viewer, `Space` / `→` to expand changed files and diffs inline, `m` to merge, `d` to discard, `Esc` to close — N todos become O(N) keypresses. Time-window selector (12h / 24h / 7d), filter chips (All / Risky / Quick wins / Failed), and a sticky token ribbon with CLI breakdown. Inline diffs survive worktree cleanup by falling back through branch ref → `master`/`main`.

### Live Logs (Chat & Raw)
WebSocket-based real-time log streaming with two view modes — Chat mode renders assistant messages as markdown with collapsible tool-use rows; Raw mode is a flat terminal view. Multi-round continue reuses the same worktree via the CLI's native `--continue` flag.

### Multi-CLI & Sandbox Mode
Select Claude / Gemini / Codex per project, per TODO, or per discussion agent. Strict sandbox mode restricts CLI file access to the worktree directory using each CLI's native sandboxing (Claude settings.json, Codex `--full-auto`, Gemini prompt-level restriction).

### Remote Access
Access and control from anywhere via Cloudflare Tunnel. Browser notifications alert you when tasks or discussions complete, so you can walk away and come back.

### Favorites Launcher
Register frequently-used external tools (executables, shell commands, URLs/folders) in a global Favorites section in the sidebar. Fire-and-forget one-click execution from anywhere in CLITrigger — reduces context-switching to the OS shell for environment setup, IDE launches, or external service access.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Node.js · Express · TypeScript · SQLite · WebSocket |
| Frontend | React 18 · Vite · Tailwind CSS · Recharts |
| AI CLIs | Claude · Gemini · Codex (Adapter Pattern) |
| Git | simple-git (worktree management) |
| Scheduling | node-cron |
| Terminal | node-pty (TTY support) · xterm.js (pixel-perfect rendering) |
| Remote Access | Cloudflare Tunnel (optional) |

---

## Quick Start

```bash
npm i -g clitrigger
clitrigger
```

On first run, you'll be prompted to set a password. Then the server starts immediately.
Open `http://localhost:3000` → Register a project → Write TODOs → Click Start.

```bash
# Change settings
clitrigger config port 8080    # Change port
clitrigger config password     # Change password
```

> **Prerequisites**: Node.js 20+, Git, at least one AI CLI (Claude / Gemini / Codex)
>
> **Supported Platforms**: Windows · macOS · Linux — all core code is cross-platform compatible.
> On macOS, you may need `xcode-select --install` for native module compilation.

### Run from Source (for development)

<details>
<summary>Click to expand</summary>

```bash
# 1. Clone & install
git clone https://github.com/HyperAITeam/CLITrigger.git
cd CLITrigger
npm install
cd src/client && npm install && cd ../..

# 2. Configure environment
cp .env.example .env
# Edit .env and set AUTH_PASSWORD

# 3. Run
npm run dev
```

Open `http://localhost:5173`.

#### Windows One-Click Scripts

Double-click any bat file in `scripts/` — no terminal needed.

| File | Action |
|------|--------|
| `install.bat` | Install dependencies (first time) |
| `dev.bat` | Start development mode |
| `build.bat` | Build project |
| `start.bat` | Start production server |
| `start-tunnel.bat` | Start with Cloudflare Tunnel |
| `test.bat` | Run all tests |

#### macOS / Linux

`npm run` commands work identically on all platforms. Use the terminal instead of `.bat` scripts.

```bash
npm run dev        # Development mode
npm run build      # Build
npm run start      # Production server
npm test           # Run tests
```

</details>

### Remote Access (Cloudflare Tunnel)

```bash
# Install cloudflared
winget install cloudflare.cloudflared    # Windows
brew install cloudflared                  # macOS

# Set TUNNEL_ENABLED=true in .env, then:
npm run start:tunnel
# → Outputs https://xxxx.trycloudflare.com in the console
```

---

## Documentation

| Doc | Content |
|-----|---------|
| [SETUP.md](docs/SETUP.md) | Detailed installation and usage guide |
| [CHANGELOG.md](docs/CHANGELOG.md) | Version history |
| [CICD.md](docs/CICD.md) | GitHub Actions CI/CD setup |
| [TESTING.md](docs/TESTING.md) | Testing guide |

---

## Contributors

Thanks to everyone who has contributed to CLITrigger!

<a href="https://github.com/HyperAITeam/CLITrigger/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=HyperAITeam/CLITrigger" alt="Contributors" />
</a>

---

## Star History

<a href="https://star-history.com/#HyperAITeam/CLITrigger&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=HyperAITeam/CLITrigger&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=HyperAITeam/CLITrigger&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=HyperAITeam/CLITrigger&type=Date" />
  </picture>
</a>

---

## License

[MIT](LICENSE) — Free to use, modify, and distribute.
