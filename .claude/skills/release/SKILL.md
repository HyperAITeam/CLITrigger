---
name: release
description: Bump package.json version and create a git tag for npm release. Accepts semver bump type (patch/minor/major) or explicit version.
argument-hint: "[patch|minor|major|x.y.z]"
disable-model-invocation: true
---

# Release

Bump `package.json` version, commit, and create a git tag for npm release.

## Current context

- Current branch: `!git branch --show-current`
- Working tree status: `!git status --short`
- Current version: `!node -p "require('./package.json').version"`
- Recent tags: `!git tag --sort=-v:refname | head -5`

## Instructions

Follow these phases exactly, in order.

---

### Phase 1: Validation

1. **Branch check**: Must be on `main` (or `master`). If not, stop and tell the user.

2. **Clean working tree**: Run `git status --porcelain`. If there are uncommitted changes, stop and tell the user to commit or stash first.

3. **Parse argument**:
   - If `` is `patch`, `minor`, or `major`: calculate the next version from the current version using semver rules.
   - If `` is an explicit version (e.g., `1.2.3`): use it directly. Validate it's a valid semver string.
   - If `` is empty or not provided: default to `patch`.

4. **Duplicate check**: Verify the target version tag (`v<version>`) does not already exist. If it does, stop and tell the user.

---

### Phase 2: Version bump

1. **Update `package.json`**: Change the `"version"` field to the new version.

2. **Update `package-lock.json`**: Run `npm install --package-lock-only` to sync the lockfile version without installing packages.

---

### Phase 3: Commit & Tag

1. **Stage files**:
   ```
   git add package.json package-lock.json
   ```

2. **Commit** with a standardized message:
   ```
   git commit -m "chore(release): v<new-version>"
   ```

3. **Create tag**:
   ```
   git tag v<new-version>
   ```

---

### Phase 4: Summary

Report to the user:
- Previous version -> New version
- Commit hash
- Tag name
- Remind them to push: `git push origin main v<new-version>`
- Note: GitHub Actions will automatically run typecheck, tests, build, and publish to npm.

**Do NOT push automatically.** Let the user push when ready.
