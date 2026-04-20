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
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev)

</div>

---

> In the age of AI-generated code, the developer's role is shifting toward supervision and review.
> But **vibe coding without understanding** eventually hits a wall.
> CLITrigger lets you run AI in parallel — while keeping you in full context of what's happening.

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

## Features

### Parallel Worktree Execution
Each TODO automatically gets its own git worktree. Claude / Gemini / Codex CLIs execute simultaneously in parallel. Dependency chains let you automatically trigger follow-up tasks and branch merges once prerequisites complete. Per-project worktree toggle plus per-TODO tri-state override (inherit / force-worktree / force-main) give you fine-grained control — main-branch tasks are automatically serialized to avoid conflicts. Drag-and-drop reordering and an iOS-style stack mode keep long task lists manageable.

### Multi-Agent Discussion
AI agents with different roles — architect, developer, reviewer — debate in rounds before implementation. The resulting design is far more robust than a single AI working in isolation. Agents flagged as **Implementers** (`can_implement`) can commit code during their regular turns, while a final implementation round stitches everything together. Auto-implement triggers the code-writing round automatically on consensus.

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

### Planner
A lightweight task planner separate from TODOs — capture ideas, attach images, tag with colors, sort by any column. Convert any planner item into a TODO or a schedule in one click. JSON export/import lets you move plans across machines or share with teammates.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-planer.png" alt="Planner — Lightweight task management" width="800">
  <p><em>Inline editing, color-coded tags, image attachments, and one-click conversion to TODOs or schedules</em></p>
</div>

### Analytics
Per-project cost and execution stats powered by Recharts — stacked bar chart by CLI tool, donut chart for status distribution, line chart for cost/token trends. Denormalized cost fields in the DB keep aggregation fast even on long histories.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-analytics.png" alt="Analytics — Execution stats" width="800">
  <p><em>Cost and token usage broken down by CLI, status, and over time</em></p>
</div>

### Built-in Git Client
A full Git client lives inside the web UI — commit graph, action toolbar, file-status sidebar, worktree list, branch context menu (checkout / merge / rebase / fetch / pull / push / rename / delete), and a commit detail panel with file-level diff viewer. Non-ASCII filenames (Korean, CJK, emoji) render correctly in diff and status output.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-git.png" alt="Git — Built-in client" width="800">
  <p><em>Commit graph, branch actions, file diffs — all in the browser</em></p>
</div>

### Interactive Sessions
Long-lived interactive CLI sessions as first-class entities — bring up a Claude / Gemini / Codex session in an embedded terminal, with optional worktree isolation per session. PTY output is filtered for spinner noise and classified into assistant / tool-use blocks so the Chat-mode log viewer stays readable.

### Live Logs (Chat & Raw)
WebSocket-based real-time log streaming with two view modes — Chat mode renders assistant messages as markdown with collapsible tool-use rows; Raw mode is a flat terminal view. Multi-round continue reuses the same worktree via the CLI's native `--continue` flag.

### Multi-CLI & Sandbox Mode
Select Claude / Gemini / Codex per project, per TODO, or per discussion agent. Strict sandbox mode restricts CLI file access to the worktree directory using each CLI's native sandboxing (Claude settings.json, Codex `--full-auto`, Gemini prompt-level restriction).

### Plugin System
Jira, GitHub, Notion integrations and gstack skill injection ship as self-contained plugins. Two plugin categories — `external-service` (REST proxy + UI panel) and `execution-hook` (pre-execution hook into the orchestrator). Adding a new integration needs only a manifest and `registerPlugin()` call — no core code changes.

### Remote Access
Access and control from anywhere via Cloudflare Tunnel. Browser notifications alert you when tasks or discussions complete, so you can walk away and come back.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Node.js · Express · TypeScript · SQLite · WebSocket |
| Frontend | React 18 · Vite · Tailwind CSS · Recharts |
| AI CLIs | Claude · Gemini · Codex (Adapter Pattern) |
| Git | simple-git (worktree management) |
| Scheduling | node-cron |
| Terminal | node-pty (TTY support) |
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
git clone https://github.com/OSgoodYZ/CLITrigger.git
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

## License

[MIT](LICENSE) — Free to use, modify, and distribute.
