<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/src/client/public/logo.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/src/client/public/logo.svg">
  <img alt="CLITrigger" src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/src/client/public/logo.svg" width="360">
</picture>

**Your AI Development Command Center**

*Plan your day, delegate to parallel AI agents, review every diff — in one place.*

<p align="center">
  <a href="https://github.com/HyperAITeam/CLITrigger/blob/main/README.md">English</a> ·
  <a href="https://github.com/HyperAITeam/CLITrigger/blob/main/README_KR.md">한국어</a>
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

> ### Plan it. Delegate it. Review it.
>
> CLITrigger brings your day's work and your AI agents into one place. Capture what needs doing — in a personal calendar, a planner, or a project knowledge wiki — then hand it to multiple AI coding agents (**Claude Code · Codex · Gemini CLI**) running in parallel, each in its own isolated git worktree.
>
> While you sleep (or focus elsewhere), they burn through your token quota. Next morning you sit down, review the stack of diffs, and **accept / reject / merge**.
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

And as AI writes more of the code, the developer's real job becomes **capturing intent and reviewing output** — which falls apart the moment your context is scattered across sticky notes, terminals, and a dozen browser tabs.

CLITrigger solves all three:

- **Right now** — Multiple tasks run in isolated git worktrees, with Claude / Gemini / Codex executing in parallel
- **Without hitting limits** — Schedule tasks for off-peak hours to make the most of your token quota
- **Without losing the thread** — Capture in one place (calendar, planner, wiki), delegate, and review every diff holistically
- **Better output** — Multiple AI agents debate and review before implementation, producing higher-quality results than a single AI working alone

---

## Features

CLITrigger spans four layers — **plan & organize** what needs doing, **delegate** it to AI, **review & ship** the results, and **access** it from anywhere.

### 🗂 Plan & Organize

#### My Schedule
A global, project-independent personal hub. One calendar — month / week / day / table views — overlays four sources on a single grid: your own dated **memos**, **schedules** across every project, **planner due dates**, and **Jira issues** assigned to you. Capture quick notes (optional title, body, pasted images, color tags), filter by tag, **drag-resize** the calendar rows, **hover a crowded day** to expand it into a full popover, and **bulk-clean memos by date range** for housekeeping. Connect Jira once (site URL + email + API token, stored server-side, the token never echoed back) to overlay your assigned issues as blue chips and import them into a memo or straight into a project planner. Read-only project / Jira chips deep-link back to their source.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-agenda.png" alt="My Schedule — personal calendar overlaying memos, schedules, planner & Jira" width="800">
  <p><em>One calendar overlaying personal memos, cross-project schedules, planner due dates, and assigned Jira issues</em></p>
</div>

#### Planner
A lightweight task planner separate from TODOs — capture ideas, attach images, tag with colors, sort by any column. Convert any planner item into a TODO or a schedule in one click. Markdown export/import (status sections + GFM checkboxes + HTML-comment metadata) lets you move plans across machines or share via GitHub / Obsidian / any plain Markdown viewer. Drop a `.md` file onto the planner card to import.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-planer.png" alt="Planner — Lightweight task management" width="800">
  <p><em>Inline editing, color-coded tags, image attachments, and one-click conversion to TODOs or schedules</em></p>
</div>

#### Vault (File-based Knowledge)
An Obsidian-style, file-based knowledge vault per project. CLITrigger auto-scans the `.md` / `.html` files in your project root, parses `[[wikilinks]]` and YAML frontmatter (`title`, `tags`), and builds a relationship graph — files *are* the nodes, so there's no separate ingest step. Browse them in the **Files** tab with inline preview, then flip the graph toggle for a ReactFlow force-directed view (tag-based node colors, `.vaultignore` to exclude paths). The markdown preview is interactive: Find/Replace, ephemeral pen/highlighter annotations with undo/redo, and task-checkbox toggles that round-trip `- [ ]` / `- [x]` straight to disk. Inject it into any task / session / discussion prompt — `None` / **`Auto`** (server picks files matching the task text) / `All` / `Selected`, with an **Include linked** toggle that pulls in 1-hop `[[wikilink]]` neighbors (each row previews how many will be added). Serialized as a `<long_term_memory>` wrapper with `<vault_file type="md|html">` blocks — CLI-agnostic, so Claude, Gemini, and Codex all see identical context.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-vault.png" alt="Vault — Obsidian-style file-based knowledge with a link graph" width="800">
  <p><em>The Vault tab — browse project markdown with inline preview and a force-directed wikilink graph, then selectively inject files into prompts</em></p>
</div>

#### Favorites Launcher
Register frequently-used external tools (executables, shell commands, URLs/folders) in a global Favorites section in the sidebar. Fire-and-forget one-click execution from anywhere in CLITrigger — reduces context-switching to the OS shell for environment setup, IDE launches, or external service access.

### 🤖 Delegate to AI

#### Parallel Worktree Execution (Tasks)
Each TODO automatically gets its own git worktree. Claude / Gemini / Codex CLIs execute simultaneously in parallel. Dependency chains let you automatically trigger follow-up tasks and branch merges once prerequisites complete. Per-project worktree toggle plus per-TODO tri-state override (inherit / force-worktree / force-main) give you fine-grained control — main-branch tasks are automatically serialized to avoid conflicts. Drag-and-drop reordering and an iOS-style stack mode keep long task lists manageable.

#### Interactive Sessions
Long-lived interactive CLI sessions as first-class entities — bring up a Claude / Gemini / Codex session in a floating draggable window. **VS Code-style window grouping and docking**: drag a tab onto another window for a 5-zone diamond (top/bottom/left/right/center) to either split into resizable panes or merge as tabs, plus **Aero-style edge snapping, sticky window-to-window snapping, and a minimize-to-dock-tray** flow — keeps multi-session screens tidy. Pop a window out into a **separate OS window** (multi-window), and the session list flags it with a badge + a one-click "bring back to the main window" recall — popped windows also appear as chips in the bottom dock tray. **xterm.js rendering** shows ANSI colors, cursor control, and TUI box-drawing identically to a native terminal. PTY spawns at the exact viewport dimensions, with **per-session font size** (A−/A+ buttons or Ctrl/Cmd ±) for readability. Per-session wiki injection plus a **Send/Skip pre-flight banner** lets you review the auto-generated initial prompt before it hits the model. Inline edit button updates non-running sessions in place. iOS Safari mobile Hangul IME is composed via a client-side dubeolsik composer. Window geometry, group tree, and tab arrangement persist and survive tab navigation; works on desktop and mobile (fullscreen on small screens).

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-sessions.png" alt="Sessions — Multi-CLI floating windows with VS Code-style docking" width="800">
  <p><em>Claude, Gemini, and Codex sessions docked side-by-side via VS Code-style window grouping — each running in its own worktree branch</em></p>
</div>

#### Multi-Agent Discussion
AI agents with different roles — architect, developer, reviewer — debate in rounds before implementation. The resulting design is far more robust than a single AI working in isolation. Agents flagged as **Implementers** (`can_implement`) can commit code during their regular turns, while a final implementation round stitches everything together. Auto-implement triggers the code-writing round automatically on consensus. Or hit **Send to Planner** on a finished discussion to have the transcript distilled into curated planner items via a one-shot LLM extraction — review and edit before persisting.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-discussions.png" alt="Discussions — Multi-agent debate" width="800">
  <p><em>Multiple AI agents with different roles debating in the Discussion view</em></p>
</div>

#### Scheduled Execution
Schedule tasks for off-peak hours to avoid rate limits. Supports recurring cron schedules, one-time scheduled runs, and auto-recovery scheduling on rate-limit events — if the CLI hits a token quota, CLITrigger schedules a retry for the exact reset time.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-schedules.png" alt="Schedules — Scheduled execution" width="800">
  <p><em>Cron-based recurring and one-time scheduled task execution</em></p>
</div>

#### Multi-CLI & Sandbox Mode
Select Claude / Gemini / Codex per project, per TODO, or per discussion agent. Strict sandbox mode restricts CLI file access to the worktree directory using each CLI's native sandboxing (Claude settings.json, Codex `--full-auto`, Gemini prompt-level restriction).

### 🔍 Review & Ship

#### Morning Review Queue
A single cross-project triage screen for the "delegate overnight, review next morning" loop. Aggregates every recent TODO across all your projects into a card stack with project label, last-assistant summary, token totals, diff stats, and a server-classified risk badge (low / medium / high based on status and diff size). Keyboard-only operation: `j`/`k` to navigate, `Enter` for the embedded log viewer, `Space` / `→` to expand changed files and diffs inline, `m` to merge, `d` to discard, `Esc` to close — N todos become O(N) keypresses. Time-window selector (12h / 24h / 7d), filter chips (All / Risky / Quick wins / Failed), and a sticky token ribbon with CLI breakdown. Inline diffs survive worktree cleanup by falling back through branch ref → `master`/`main`.

#### Built-in Git Client
A full Git client lives inside the web UI with a Fork/SourceTree-style layout — a workspace menu switches between **File Status** (staged/unstaged file lists, working-tree diff viewer, commit message + push toggle, Cmd/Ctrl+Enter to commit) and **History** (commit graph, action toolbar, worktree list, VS Code-style branch context menu with checkout / merge / rebase / fetch / pull / push / rename / delete, and a commit detail panel with file-level diff viewer). Every split is user-resizable and persisted to localStorage. Non-ASCII filenames (Korean, CJK, emoji) render correctly in diff and status output.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-git.png" alt="Git — Built-in client" width="800">
  <p><em>Commit graph, branch actions, file diffs — all in the browser</em></p>
</div>

#### Analytics
Per-project cost and execution stats powered by Recharts — stacked bar chart by CLI tool, donut chart for status distribution, line chart for cost/token trends. Denormalized cost fields in the DB keep aggregation fast even on long histories.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-analytics.png" alt="Analytics — Execution stats" width="800">
  <p><em>Cost and token usage broken down by CLI, status, and over time</em></p>
</div>

#### Live Logs (Chat & Raw)
WebSocket-based real-time log streaming with two view modes — Chat mode renders assistant messages as markdown with collapsible tool-use rows; Raw mode is a flat terminal view. Multi-round continue reuses the same worktree via the CLI's native `--continue` flag.

### 🌐 Access Anywhere

#### Remote Access
Access and control from anywhere via Cloudflare Tunnel. Browser notifications alert you when tasks or discussions complete, so you can walk away and come back. **Route a named tunnel through your own domain** — set Tunnel Name + Custom Hostname in the sidebar ⚙ → Tunnel settings modal, and the displayed URL becomes `https://app.your-domain.com`, sidestepping the browser "dangerous site" warnings that hit `*.trycloudflare.com` / `*.cfargotunnel.com` by inheriting your domain's reputation.

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

### Option A — Desktop App (recommended for end users)

Download the installer for your platform from the [latest GitHub release](https://github.com/HyperAITeam/CLITrigger/releases/latest):

- **Windows** — `CLITrigger-Setup-<version>.exe` (NSIS installer) or the portable `.exe`
- **macOS** — `CLITrigger-<version>.dmg` (Apple Silicon & Intel)
- **Linux** — `CLITrigger-<version>.AppImage`

The desktop app bundles Node.js and the native modules (`better-sqlite3`, `node-pty`, `cloudflared`), so no separate runtime install is needed. On first launch a setup screen appears in the embedded browser — pick a password there and you're in. External sharing (Cloudflare tunnel) stays paused until setup completes, so the first user is guaranteed to be you.

### Option B — npm (recommended for developers)

```bash
# Install
npm i -g clitrigger
clitrigger

# Upgrade to the latest version
npm i -g clitrigger@latest
# Check current version: clitrigger --version
```

On first run the server starts immediately. Open `http://localhost:3000` → set a password on the welcome screen → register a project → write TODOs → click Start. Change the password later via Settings → Account in the web UI.

CLITrigger also prints a one-line `Update available: <new> -> npm i -g clitrigger@latest` hint at startup whenever a newer version is on npm — no auto-update, you decide when to upgrade.

```bash
# Change settings
clitrigger config port 8080    # Change port
clitrigger config tunnel on    # Enable Cloudflare tunnel for external sharing
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
# AUTH_PASSWORD is optional — leave it blank and the dev server will show the
# setup screen on first browser load. Set it only if you want to skip setup.

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

#### Route a named tunnel through your own domain (optional)

To avoid the "dangerous site" browser warnings on `*.trycloudflare.com` / `*.cfargotunnel.com`, point a named tunnel at your own domain. Either use the sidebar ⚙ → Tunnel settings modal (Tunnel Name + Custom Hostname), or the CLI:

```bash
clitrigger config tunnel hostname app.your-domain.com
cloudflared tunnel route dns <tunnel-name> app.your-domain.com   # one-time
```

The displayed URL becomes `https://app.your-domain.com` and reputation tracks your domain.

---

## Documentation

| Doc | Content |
|-----|---------|
| [SETUP.md](docs/SETUP.md) | Detailed installation and usage guide |
| [changelog/](docs/changelog/README.md) | Version history (per-date entries by month) |
| [CICD.md](docs/CICD.md) | GitHub Actions CI/CD setup |
| [TESTING.md](docs/TESTING.md) | Testing guide |

---

## Star & Join Us

If CLITrigger saves you time, please [**give us a star**](https://github.com/HyperAITeam/CLITrigger) — it genuinely helps the project reach more developers.

Want to help shape what comes next? We're actively looking for contributors:

- **File an issue** — bug reports, feature requests, and rough ideas all welcome at [Issues](https://github.com/HyperAITeam/CLITrigger/issues)
- **Open a PR** — start with [`good first issue`](https://github.com/HyperAITeam/CLITrigger/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) labels, or pick anything that itches you
- **Share what you built** — drop your worktree workflows, custom plugins, or productivity tips in [Discussions](https://github.com/HyperAITeam/CLITrigger/discussions)

Every star, issue, and PR moves this faster. Thank you 🙏

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
