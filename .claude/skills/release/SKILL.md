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

### Phase 4: 릴리즈 노트 작성

`docs/release-notes/v<new-version>.md`에 한국어 사용자 대상 릴리즈 노트를 작성한다. push 후 GitHub Actions(`.github/workflows/release.yml`)가 이 파일을 GitHub Release body로 사용한다 (파일이 없으면 자동 PR 인덱스로 폴백).

#### 4-1. 직전 태그 결정

```
git tag --sort=-v:refname | head -1
```

- 결과가 비어 있으면 첫 릴리즈로 간주하고 노트 본문에 "초기 릴리즈" 명시. 커밋 범위는 첫 커밋부터 HEAD까지.
- 결과가 있으면 `<PREV_TAG>` 변수로 사용. Phase 1에서 새 태그 중복 체크가 끝났으므로 항상 새 태그보다 이전.

#### 4-2. 변경 재료 수집

다음 두 가지를 모아 한 번에 본다:

1. **커밋 인덱스**:
   ```
   git log <PREV_TAG>..HEAD --pretty=format:"%h %s"
   ```
2. **changelog entry 묶음**: `<PREV_TAG>` 커밋의 author date(`git log -1 --format=%ad --date=short <PREV_TAG>`)부터 오늘까지의 `docs/changelog/YYYY-MM/YYYY-MM-DD*.md` 파일 모두 읽기.
   - 이미 한국어로 큐레이션된 본문이 있으므로 release 노트는 이걸 **요약/재구성**하는 데 집중. 통째 복붙 금지.
   - changelog entry가 0개면(짧은 패치 릴리즈) 커밋 메시지 + 핵심 diff만 보고 직접 작성.

#### 4-3. 노트 파일 작성

`docs/release-notes/v<new-version>.md`를 신규로 만든다. 폴더가 없으면 같이 만든다.

템플릿 (외곽 fence는 4-backtick — 내부 ```bash 블록 보호용):

````markdown
# v<new-version> — <한 줄 요약 제목>

릴리즈 일자: YYYY-MM-DD
이전 버전: v<prev-version>

## 요약 (TL;DR)

3~5줄. 사용자가 이번 버전에서 무엇이 바뀌는지 즉시 알 수 있게.

## 주요 변경

### <기능/주제 1>

- 사용자 관점에서 어떤 차이가 생기는지

### <기능/주제 2>

...

## ⚠️ Breaking Changes

(있을 때만 표시. 없으면 섹션 자체 생략.)

- 어떤 동작이 바뀌었는지
- 영향받는 사용 시나리오

## 마이그레이션

(Breaking 또는 환경 변수/스키마/CLI 변경이 있을 때만.)

- 1단계: ...
- 2단계: ...

## 설치 / 업데이트

```bash
npm i -g clitrigger@<new-version>
```

데스크탑 앱: GitHub Release 자산의 `.exe` / `.dmg` / `.AppImage` 사용.

## 전체 커밋 목록

<git log --pretty=format:"- %h %s" PREV_TAG..HEAD 결과 그대로 붙임>

## 관련 문서

- [상세 changelog](../changelog/) — 날짜별 기술 결정 기록
````

**작성 가이드**:

- "사용자가 무엇을 얻는가"가 1순위. 내부 리팩터·DB 마이그레이션 같은 항목은 *Breaking* 또는 *마이그레이션* 섹션에서만 다룬다.
- "수정된 파일 표"는 changelog 영역이지 release 노트 영역이 아니다. 노트에는 넣지 않는다.
- 한국어 톤은 `docs/changelog/2026-04-*`, `docs/changelog/2026-05-02-*` 본문 스타일을 그대로 참조.
- 같은 주제의 여러 커밋(WIP/fixup 포함)은 하나의 항목으로 통합한다.
- `docs/changelog/` entry가 있으면 그걸 **요약**할 것. 본문을 그대로 옮기지 않는다.

#### 4-4. 사용자에게 안내

스킬은 파일만 작성하고 자동 commit하지 않는다. 다음 안내를 출력한다:

```
릴리즈 노트 초안: docs/release-notes/v<new-version>.md

이 파일을 검토/수정한 뒤 별도 커밋으로 push 하세요:
  git add docs/release-notes/v<new-version>.md
  git commit -m "docs(release): v<new-version> notes"
  git push origin main v<new-version>
```

자동 commit/amend는 하지 않는다. Phase 1~3에서 만든 release 커밋·태그의 일관성을 깨뜨릴 수 있고, 노트는 사람이 한 번 검수하는 게 안전하다.

---

### Phase 5: Summary

Report to the user:
- Previous version -> New version
- Commit hash
- Tag name
- 릴리즈 노트 파일 경로 (`docs/release-notes/v<new-version>.md`)
- Remind them to push: `git push origin main v<new-version>` (노트를 별도 커밋한 뒤)
- Note: GitHub Actions will automatically run typecheck, tests, build, and publish to npm. 노트 파일이 있으면 GitHub Release body로 그대로 사용된다.

**Do NOT push automatically.** Let the user push when ready.
