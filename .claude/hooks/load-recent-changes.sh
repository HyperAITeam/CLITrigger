#!/usr/bin/env bash
# Hook: SessionStart
# Loads recent changelog entries and git log as context for new sessions.

set -euo pipefail

# Resolve the git repo root. In worktrees, $CLAUDE_PROJECT_DIR may point to the
# original repo, so prefer git rev-parse from the current working directory.
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || REPO_ROOT="$CLAUDE_PROJECT_DIR"
cd "$REPO_ROOT" || exit 0

CHANGELOG="$REPO_ROOT/docs/CHANGELOG.md"

# Build context string
CONTEXT=""

# Recent changelog entries
if [ -f "$CHANGELOG" ]; then
  RECENT_CHANGELOG=$(tail -20 "$CHANGELOG" 2>/dev/null || true)
  if [ -n "$RECENT_CHANGELOG" ]; then
    CONTEXT="Recent CHANGELOG entries:\n$RECENT_CHANGELOG\n\n"
  fi
fi

# Recent git commits
RECENT_COMMITS=$(git log --oneline -10 2>/dev/null || true)
if [ -n "$RECENT_COMMITS" ]; then
  CONTEXT="${CONTEXT}Recent commits:\n$RECENT_COMMITS"
fi

# Output as JSON for Claude Code hook system
if [ -n "$CONTEXT" ]; then
  # Escape for JSON
  ESCAPED=$(echo -e "$CONTEXT" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo "\"$CONTEXT\"")
  echo "{\"additionalContext\": $ESCAPED}"
fi
