#!/usr/bin/env bash
# Hook: Stop
# On session end: stages all changes, generates a conventional commit message
# via Claude headless mode (claude -p), and commits.
# Falls back to a generic WIP message if claude -p fails.
# Changelog updates are handled by the /update-docs skill, not this hook.

set -euo pipefail

# Resolve the git repo root (worktree-safe)
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || REPO_ROOT="$CLAUDE_PROJECT_DIR"
cd "$REPO_ROOT" || exit 0

# Stage all changes
git add -A 2>/dev/null || true

# Exit if nothing to commit
if git diff-index --quiet HEAD 2>/dev/null; then
  exit 0
fi

# Extract diff for commit message generation (truncated to 2000 lines)
DIFF=$(git diff --cached 2>/dev/null | head -2000)

# Generate commit message via Claude headless mode
COMMIT_MSG=""
if command -v claude &>/dev/null; then
  COMMIT_MSG=$(echo "$DIFF" | claude -p \
    "You are a commit message generator. Based on the following git diff, write a single commit message.
Rules:
- First line MUST start with 'WIP(scope): short summary' (max 72 chars)
- Always use 'WIP' as the type prefix, never feat/fix/refactor/etc.
- If needed, add a blank line then bullet points for details
- Be concise and specific
- Output ONLY the commit message, nothing else" 2>/dev/null) || true
fi

# Distrust output that ignored the format (e.g. preamble like "The commit
# message:") — only accept a first line that starts with the required 'WIP(' prefix.
if ! printf '%s' "$COMMIT_MSG" | head -1 | grep -q '^WIP('; then
  COMMIT_MSG=""
fi

# Fallback if claude -p failed or returned empty
if [ -z "$COMMIT_MSG" ]; then
  FILE_COUNT=$(git diff --cached --name-only | wc -l | tr -d ' ')
  COMMIT_MSG="wip: update $FILE_COUNT files"
fi

# Commit using -F - to safely handle special characters
echo "$COMMIT_MSG" | git commit -F - --no-verify 2>/dev/null || true
