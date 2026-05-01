#!/usr/bin/env bash
# Hook: SessionStart
# Loads recent changelog entries and git log as context for new sessions.

set -euo pipefail

# Resolve the git repo root. In worktrees, $CLAUDE_PROJECT_DIR may point to the
# original repo, so prefer git rev-parse from the current working directory.
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || REPO_ROOT="$CLAUDE_PROJECT_DIR"
cd "$REPO_ROOT" || exit 0

CHANGELOG_DIR="$REPO_ROOT/docs/changelog"

# Build context string
CONTEXT=""

# Most recent changelog entry (latest dated file under docs/changelog/YYYY-MM/)
if [ -d "$CHANGELOG_DIR" ]; then
  LATEST_ENTRY=$(find "$CHANGELOG_DIR" -mindepth 2 -name '*.md' 2>/dev/null | sort -r | head -1)
  if [ -n "$LATEST_ENTRY" ] && [ -f "$LATEST_ENTRY" ]; then
    RECENT_CHANGELOG=$(head -40 "$LATEST_ENTRY" 2>/dev/null || true)
    if [ -n "$RECENT_CHANGELOG" ]; then
      CONTEXT="Most recent changelog entry:\n$RECENT_CHANGELOG\n\n"
    fi
  fi
fi

# Recent git commits
RECENT_COMMITS=$(git log --oneline -10 2>/dev/null || true)
if [ -n "$RECENT_COMMITS" ]; then
  CONTEXT="${CONTEXT}Recent commits:\n$RECENT_COMMITS"
fi

# Load project lessons
LESSONS_FILE="$REPO_ROOT/.claude/lessons.md"
if [ -f "$LESSONS_FILE" ]; then
  LESSONS=$(cat "$LESSONS_FILE" 2>/dev/null || true)
  if [ -n "$LESSONS" ]; then
    CONTEXT="${CONTEXT}\n\nProject Lessons:\n$LESSONS"
  fi
fi

# Output as JSON for Claude Code hook system
if [ -n "$CONTEXT" ]; then
  # Escape for JSON
  ESCAPED=$(echo -e "$CONTEXT" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo "\"$CONTEXT\"")
  echo "{\"additionalContext\": $ESCAPED}"
fi
