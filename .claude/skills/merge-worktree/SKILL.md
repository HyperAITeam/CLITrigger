---
name: merge-worktree
description: Squash-merge the current worktree branch into the main branch (or a specified target). Analyzes git history and source code to craft a comprehensive commit message.
argument-hint: "[target-branch]"
disable-model-invocation: true
---

# Merge Worktree

Squash-merge the current worktree branch back into the target branch with a comprehensive, structured commit message.

## Current context

- Git dir: `!git rev-parse --git-dir`
- Current branch: `!git branch --show-current`
- Recent commits: `!git log --oneline -20`
- Working tree status: `!git status --short`

## Instructions

Follow these phases exactly, in order. Do NOT skip phases.

---

### Phase 1: Validation

1. **Verify worktree**: Check if the current git directory is a worktree. The output of `git rev-parse --git-dir` must contain `/worktrees/`. If it does not, **stop immediately** and tell the user:
   > "This skill must be run from inside a git worktree. Use `/worktree` to create one first."

2. **Identify current branch**: Get the worktree branch name from `git branch --show-current`.

3. **Resolve target branch**:
   - If `$ARGUMENTS` is provided and non-empty, use it as the target branch.
   - Otherwise, detect the default branch: check if `main` exists, else check `master`. If neither exists, stop and ask the user.

4. **Identify the original repo path**: Parse the original repo root from the git-dir path. The worktree's `.git` file points back to the main repo — use `git rev-parse --git-common-dir` to find it, then derive the original repo working directory (its parent).

5. **Clean working tree**: Run `git status --porcelain`. If there are uncommitted changes, stop and tell the user to commit or stash them first.

---

### Phase 2: Research

This is the most critical phase. You must deeply understand what was done before writing any commit message.

1. **Commit history**: Run `git log --oneline <target>..HEAD` to see all commits on this worktree branch.

2. **File change summary**: Run `git diff <target>...HEAD --stat` to get an overview of what files changed and how much.

3. **Full diff**: Run `git diff <target>...HEAD` to read the complete diff. Study it carefully.

4. **Read key files**: For the most significantly changed files (largest diffs, new files, deleted files), use the Read tool to understand the full context — not just the diff lines.

5. **Categorize changes**: Mentally group all changes into categories:
   - Features (new functionality)
   - Fixes (bug corrections)
   - Refactors (code restructuring without behavior change)
   - Tests (new or updated tests)
   - Docs (documentation changes)
   - Config/Chore (build, CI, tooling, dependencies)

6. **Identify the dominant type**: Determine which conventional commit type (`feat`, `fix`, `refactor`, `docs`, `chore`, `test`) best represents the overall body of work.

---

### Phase 3: Target branch preparation

1. **Get the original repo path** (from Phase 1 step 4).

2. **Check target branch state**: Run `git -C <original-repo-path> log --oneline -10 <target>` to see recent commits on the target branch.

3. **Detect stray WIP commits**: If the target branch has commits that look like auto-generated WIP commits (e.g., messages starting with `wip:`, `auto-commit`, `WIP`), warn the user and ask if they want to reset to the last clean commit before merging.

4. **Fetch latest** (if remote exists): Run `git -C <original-repo-path> fetch origin <target> 2>/dev/null` to ensure target is up to date with remote. Do not fail if no remote.

---

### Phase 4: Squash merge

1. **Ensure target branch is checked out** in the original repo:
   ```
   git -C <original-repo-path> checkout <target>
   ```

2. **Perform the squash merge**:
   ```
   git -C <original-repo-path> merge --squash <worktree-branch>
   ```

3. **Handle conflicts**: If the merge reports conflicts:
   - List all conflicted files
   - Show the conflict markers
   - **Stop and report to the user** — do NOT attempt to auto-resolve
   - Tell them to resolve conflicts in the original repo and then run the skill again

4. If the merge succeeds (no conflicts), proceed to Phase 5.

---

### Phase 5: Craft commit message and commit

Based on your Phase 2 research, write the commit message following this **exact structure**:

```
<type>: <concise summary in imperative mood, under 72 chars, no period>

<2-4 sentence paragraph explaining what was done and WHY. Focus on the
motivation and high-level approach, not implementation details.>

Changes:
- <grouped bullet points of what changed>
- <use sub-bullets for details within a group>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

**Rules:**
- `<type>` must be one of: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`
- If changes span multiple types, use the dominant one
- Summary line: imperative mood ("add", "fix", "refactor"), no period, max 72 chars
- Body paragraph: explain the *why* and *context*, not just *what*
- Changes: group related items together, most important first
- Always end with `Co-Authored-By`

**Create the commit** in the original repo using a heredoc:
```bash
git -C <original-repo-path> commit -m "$(cat <<'EOF'
<your commit message here>
EOF
)"
```

---

### Phase 6: Verification

1. **Confirm the commit**: Run `git -C <original-repo-path> log --oneline -3` and show the result to the user.

2. **Report summary**: Tell the user:
   - The final commit hash
   - The commit summary line
   - Which branch it was merged into
   - Remind them the worktree branch still exists — they can delete it with `git worktree remove <path>` if no longer needed
   - Remind them to `git push` if they want to push to the remote

---

## Important notes

- **Never force-push or use destructive git operations** without explicit user confirmation.
- **Never skip pre-commit hooks** (`--no-verify`).
- If anything unexpected happens at any phase, **stop and explain** rather than guessing.
- The commit message quality is paramount — take time in Phase 2 to truly understand the changes.
