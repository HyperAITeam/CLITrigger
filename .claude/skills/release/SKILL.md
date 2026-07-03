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

### Phase 3: 릴리즈 노트 작성

`docs/release-notes/v<new-version>.md`에 **영어로** 릴리즈 노트를 작성한다 (GitHub Release는 영어권 사용자 대상 — 한국어로 쓰지 말 것. 단, 전체 커밋 목록의 커밋 메시지는 원문 그대로 둔다). push 후 GitHub Actions(`.github/workflows/release.yml`)가 태그 체크아웃 tree에서 이 파일을 읽어 GitHub Release body로 사용한다 (파일이 없으면 자동 PR 인덱스로 폴백).

이 phase에서는 **파일만 작성**하고 commit하지 않는다. 다음 Phase 4가 release 커밋에 노트 파일을 함께 stage 해서 태그가 노트를 포함한 커밋을 가리키도록 한다.

#### 3-1. 직전 태그 결정

```
git tag --sort=-v:refname | head -1
```

- 결과가 비어 있으면 첫 릴리즈로 간주하고 노트 본문에 "초기 릴리즈" 명시. 커밋 범위는 첫 커밋부터 HEAD까지.
- 결과가 있으면 `<PREV_TAG>` 변수로 사용. Phase 1에서 새 태그 중복 체크가 끝났으므로 항상 새 태그보다 이전.

#### 3-2. 변경 재료 수집

다음 두 가지를 모아 한 번에 본다:

1. **커밋 인덱스**:
   ```
   git log <PREV_TAG>..HEAD --pretty=format:"%h %s"
   ```
2. **changelog entry 묶음**: `<PREV_TAG>` 커밋의 author date(`git log -1 --format=%ad --date=short <PREV_TAG>`)부터 오늘까지의 `docs/changelog/YYYY-MM/YYYY-MM-DD*.md` 파일 모두 읽기.
   - 이미 한국어로 큐레이션된 본문이 있으므로 release 노트는 이걸 **영어로 요약/재구성**하는 데 집중. 통째 복붙·직역 금지.
   - changelog entry가 0개면(짧은 패치 릴리즈) 커밋 메시지 + 핵심 diff만 보고 직접 작성.

#### 3-3. 노트 파일 작성

`docs/release-notes/v<new-version>.md`를 신규로 만든다. 폴더가 없으면 같이 만든다.

템플릿 (외곽 fence는 4-backtick — 내부 ```bash 블록 보호용):

````markdown
# v<new-version> — <one-line summary title>

Release date: YYYY-MM-DD
Previous version: v<prev-version>

## TL;DR

3–5 lines. Users should immediately understand what changes in this version.

## Highlights

### <feature/topic 1>

- What difference the user sees

### <feature/topic 2>

...

## ⚠️ Breaking Changes

(Only when present. Omit the section entirely otherwise.)

- What behavior changed
- Affected usage scenarios

## Migration

(Only for breaking changes or env var/schema/CLI changes.)

- Step 1: ...
- Step 2: ...

## Install / Update

```bash
npm i -g clitrigger@<new-version>
```

Desktop app: use the `.exe` / `.dmg` / `.AppImage` from the GitHub Release assets.

## Full commit list

<git log --pretty=format:"- %h %s" PREV_TAG..HEAD output verbatim — keep commit messages in their original language>

## Related docs

- [Detailed changelog](../changelog/) — per-date technical decision records
````

**작성 가이드**:

- **노트 본문은 영어로 쓴다.** changelog(한국어)를 재료로 쓰되 직역이 아니라 영어 릴리즈 노트 관례에 맞게 재구성한다.
- "사용자가 무엇을 얻는가"가 1순위. 내부 리팩터·DB 마이그레이션 같은 항목은 *Breaking* 또는 *Migration* 섹션에서만 다룬다.
- "수정된 파일 표"는 changelog 영역이지 release 노트 영역이 아니다. 노트에는 넣지 않는다.
- 같은 주제의 여러 커밋(WIP/fixup 포함)은 하나의 항목으로 통합한다.
- `docs/changelog/` entry가 있으면 그걸 **요약**할 것. 본문을 그대로 옮기지 않는다.

#### 3-4. 사용자 검수 시점 안내 (선택)

이 시점에서 commit·tag를 만들기 전에 노트 본문을 검수받고 싶으면 사용자에게 알리고 잠시 멈출 수 있다. "OK"를 받으면 Phase 4로 진행. 별도 검수 요청이 없으면 바로 Phase 4로 넘어가도 된다 (어차피 Phase 5 종료 후 push 전까지 사용자가 노트를 더 다듬을 기회는 있음).

---

### Phase 4: Commit & Tag

릴리즈 노트 파일을 release 커밋과 같은 커밋에 stage 해서, 태그가 노트를 포함한 커밋을 가리키도록 한다.

1. **Stage files** (노트 파일 포함):
   ```
   git add package.json package-lock.json docs/release-notes/v<new-version>.md
   ```

2. **Commit** with a standardized message:
   ```
   git commit -m "chore(release): v<new-version>"
   ```

3. **Create tag**:
   ```
   git tag v<new-version>
   ```

이제 `git show v<new-version> --stat`에 노트 파일이 포함되어 있어야 한다. 태그 ref만 체크아웃해도 `docs/release-notes/v<new-version>.md`가 보인다.

---

### Phase 5: Summary

Report to the user:
- Previous version -> New version
- Commit hash (노트 파일 포함)
- Tag name
- 릴리즈 노트 파일 경로 (`docs/release-notes/v<new-version>.md`) — 같은 커밋에 포함됨
- Remind them to push: `git push origin main v<new-version>`
- Note: GitHub Actions가 태그 체크아웃 tree에서 노트 파일을 읽어 GitHub Release body로 사용한다. 노트가 없으면 자동 PR 인덱스로 폴백.

**Do NOT push automatically.** Let the user push when ready.
