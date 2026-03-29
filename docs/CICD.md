# CLITrigger CI/CD 가이드

## 개요

CLITrigger는 **GitHub Actions** 기반 CI/CD 파이프라인을 사용합니다.

| 워크플로우 | 트리거 | 목적 |
|-----------|--------|------|
| **CI** (`ci.yml`) | `main` push / PR | 타입 체크, 테스트, 빌드 검증 |
| **Release** (`release.yml`) | `v*` 태그 push | 빌드 + GitHub Release 생성 |
| **Claude Issue Worker** (`claude-issue.yml`) | 이슈에 `claude-fix` 라벨 | Claude Code가 이슈 구현 → PR 생성 |
| **Claude PR Review** (`claude-pr-review.yml`) | PR 생성/업데이트 | Claude Code가 자동 코드 리뷰 → 코멘트 생성 |
| **Claude Comment Command** (`claude-comment.yml`) | 이슈/PR 코멘트에 `@claude` | 코멘트로 Claude Code에 작업 지시 → 변경사항 push |

---

## CI 워크플로우

### 파이프라인 구조

```
push/PR to main
       │
       ├─► typecheck ──────┐
       ├─► test-server ────┤
       └─► test-client ────┤
                           ▼
                        build (아티팩트 업로드)
```

**병렬 실행**: `typecheck`, `test-server`, `test-client`는 독립적으로 병렬 실행되어 빠른 피드백을 제공합니다. `build`는 세 job이 모두 성공한 후에만 실행됩니다.

**동시성 제어**: 같은 브랜치에서 새 push가 발생하면 진행 중인 이전 CI를 자동 취소합니다.

### 각 단계 상세

#### 1. Type Check (`typecheck`)
```bash
npm run typecheck:server   # tsc -p tsconfig.server.json --noEmit
npm run typecheck:client   # cd src/client && npx tsc --noEmit
```
서버와 클라이언트의 TypeScript 타입 오류를 빌드 없이 검증합니다.

#### 2. Server Tests (`test-server`)
```bash
npm run test:server   # vitest run --config vitest.config.ts
```
백엔드 52개 테스트 실행 (DB, 서비스, 미들웨어, WebSocket).

#### 3. Client Tests (`test-client`)
```bash
npm run test:client   # cd src/client && npx vitest run
```
프론트엔드 21개 테스트 실행 (API 클라이언트, 컴포넌트).

#### 4. Build (`build`)
```bash
npm run build   # 클라이언트(Vite) + 서버(tsc) 빌드
```
전체 프로덕션 빌드를 수행하고, `dist/` 아티팩트를 7일간 보관합니다.

---

## Release 워크플로우

### 릴리스 방법

```bash
# 1. 버전 태그 생성
git tag v1.0.0

# 2. 태그 push → 자동으로 Release 워크플로우 실행
git push origin v1.0.0
```

### 파이프라인 구조

```
v* 태그 push
     │
     ▼
 typecheck → test → build → package → GitHub Release
```

### 릴리스 산출물

- **GitHub Release**: 자동 생성 (release notes 자동 포함)
- **아티팩트**: `clitrigger-v{version}.tar.gz`
  - `dist/` — 컴파일된 서버 + 클라이언트 번들
  - `package.json`, `package-lock.json` — 의존성 정보
  - `.env.example` — 환경 변수 템플릿
  - `LICENSE` — 라이선스
  - `docs/` — 문서

### 릴리스 아티팩트로 배포하기

```bash
# 1. 릴리스 아티팩트 다운로드 & 압축 해제
tar -xzf clitrigger-v1.0.0.tar.gz

# 2. 프로덕션 의존성 설치
npm ci --production

# 3. 환경 설정
cp .env.example .env
# .env 편집

# 4. 실행
npm start
```

---

## 브랜치 전략

| 브랜치 | 용도 | CI 실행 |
|--------|------|---------|
| `main` | 안정 브랜치 (프로덕션 준비 상태) | push 시 |
| `feature/*` | 기능 개발 | PR 생성 시 |
| `fix/*` | 버그 수정 | PR 생성 시 |
| `claude/issue-*` | Claude가 자동 생성 | Issue Worker → PR |
| `claude/comment-*` | Claude 코멘트 명령으로 생성 | Comment Command → PR |
| `*` (모든 PR 브랜치) | PR 생성 시 | PR Review → 리뷰 코멘트 |
| `v*` 태그 | 릴리스 | Release 워크플로우 |

### 권장 워크플로우

```
1. feature/my-feature 브랜치 생성
2. 개발 & 커밋
3. main으로 PR 생성 → CI 자동 실행
4. CI 통과 + 코드 리뷰 → 머지
5. 릴리스 시점에 v{version} 태그 push
```

---

## Claude Issue Worker 워크플로우

### 개요

GitHub 이슈에 `claude-fix` 라벨을 붙이면, **Self-hosted Runner** 위에서 Claude Code CLI가 이슈 내용을 읽고 코드를 구현하여 PR을 자동 생성합니다.

Claude Max 구독의 Claude Code CLI를 사용하므로 별도 API 비용이 발생하지 않습니다.

### 동작 흐름

```
이슈에 claude-fix 라벨
       │
       ▼
Self-hosted Runner (로컬 PC)
       │
       ├─► checkout + npm ci
       ├─► claude --print --dangerously-skip-permissions (이슈 내용 기반 코드 작성)
       └─► 변경사항이 있으면 → 브랜치 push + PR 생성
                              없으면 → 이슈에 코멘트
```

### 사전 요구사항

Self-hosted Runner PC에 다음이 설치 및 설정되어 있어야 합니다:

| 항목 | 설명 |
|------|------|
| Node.js 20+ | `node --version` |
| Claude Code CLI | `npm install -g @anthropic-ai/claude-code` |
| Claude 인증 | Claude Max 계정으로 로그인 완료 |
| GitHub CLI | `gh auth login` 완료 |
| Git | `git --version` |

### Self-hosted Runner 등록

#### 1. GitHub에서 Runner 토큰 발급

GitHub 저장소 → **Settings** → **Actions** → **Runners** → **New self-hosted runner**

#### 2. Runner 설치 (Windows PowerShell)

```powershell
# 폴더 생성
mkdir C:\actions-runner && cd C:\actions-runner

# 다운로드 & 압축 해제
Invoke-WebRequest -Uri https://github.com/actions/runner/releases/download/v2.322.0/actions-runner-win-x64-2.322.0.zip -OutFile runner.zip
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory("$PWD\runner.zip", "$PWD")

# 등록
.\config.cmd --url https://github.com/OSgoodYZ/CLITrigger --token <GitHub에서_복사한_토큰>

# Windows 서비스로 설치 (PC 부팅 시 자동 시작)
.\svc.cmd install
.\svc.cmd start
```

#### 3. Runner 설치 (macOS / Linux)

```bash
mkdir ~/actions-runner && cd ~/actions-runner
# GitHub 페이지에 표시되는 curl 명령어로 다운로드 & 압축 해제
./config.sh --url https://github.com/OSgoodYZ/CLITrigger --token <토큰>
./svc.sh install
./svc.sh start
```

### 사용법

1. GitHub 이슈 작성 (제목 + 상세 설명)
2. `claude-fix` 라벨 붙이기
3. Actions 탭에서 실행 상태 확인
4. 완료 시 자동으로 PR 생성 (이슈에 `Closes #N` 링크 포함)

### 라벨 변경

`claude-fix` 대신 다른 라벨을 사용하려면 `claude-issue.yml`의 다음 줄을 수정:

```yaml
if: github.event.label.name == 'claude-fix'   # ← 원하는 라벨명으로 변경
```

### 트러블슈팅

#### Runner가 offline으로 표시됨
- PC가 켜져 있고, runner 서비스가 실행 중인지 확인
- Windows: `Get-Service actions.runner.*` / Linux: `sudo ./svc.sh status`

#### Claude CLI 인증 만료
- Runner PC에서 `claude` 명령을 직접 실행하여 재인증

#### 변경사항 없이 종료됨
- 이슈 설명이 너무 모호하면 Claude가 코드를 생성하지 못할 수 있음
- 이슈에 구체적인 요구사항, 파일 경로, 예시 등을 포함

---

## Claude PR Review 워크플로우

### 개요

PR이 생성되거나 업데이트되면, **Self-hosted Runner** 위에서 Claude Code CLI가 diff를 분석하여 코드 리뷰 코멘트를 자동 생성합니다.

### 동작 흐름

```
PR 생성/업데이트 (opened, synchronize, ready_for_review)
       │
       ├─► Draft PR? → 스킵
       │
       ▼
Self-hosted Runner (로컬 PC)
       │
       ├─► checkout (fetch-depth: 0)
       ├─► gh pr diff로 변경사항 추출
       ├─► diff 10,000줄 초과? → 스킵 (코멘트로 알림)
       ├─► 이전 리뷰 코멘트 삭제 (중복 방지)
       ├─► claude --print (diff 기반 코드 리뷰)
       └─► PR에 리뷰 코멘트 게시
```

### 리뷰 범위

| 항목 | 설명 |
|------|------|
| 버그 & 로직 오류 | 잘못된 조건, off-by-one, null/undefined 위험 |
| 보안 | injection, XSS, secrets 노출, 안전하지 않은 입력 처리 |
| 성능 | N+1 쿼리, 불필요한 리렌더링, 누락된 인덱스 |
| 타입 안전성 | 잘못된 타입, 누락된 null 체크, unsafe cast |
| 동시성 | 레이스 컨디션, 누락된 락, 공유 상태 이슈 |

### 사전 요구사항

Claude Issue Worker와 동일한 Self-hosted Runner 환경이 필요합니다 (위 섹션 참조).

### 설정 변경

#### diff 크기 제한 변경

`claude-pr-review.yml`에서 다음 줄의 숫자를 수정:

```yaml
if [ "$DIFF_LINES" -gt 10000 ]; then   # ← 원하는 줄 수로 변경
```

#### Draft PR에서도 리뷰 실행

`claude-pr-review.yml`에서 `if` 조건 제거:

```yaml
# 변경 전
if: github.event.pull_request.draft == false
# 변경 후 (삭제 또는 주석 처리)
```

#### 특정 라벨이 붙은 PR만 리뷰

`claude-pr-review.yml`의 `if` 조건 수정:

```yaml
if: github.event.pull_request.draft == false && contains(github.event.pull_request.labels.*.name, 'claude-review')
```

---

## Claude Comment Command 워크플로우

### 개요

이슈 또는 PR의 코멘트에 `@claude`를 멘션하면, **Self-hosted Runner** 위에서 Claude Code CLI가 요청된 작업을 수행합니다.

- **이슈 코멘트**: 새 브랜치 생성 → 작업 수행 → PR 생성
- **PR 코멘트**: 해당 PR 브랜치에서 작업 수행 → 변경사항 push

### 동작 흐름

```
이슈/PR 코멘트: "@claude 이거 리팩토링해줘"
       │
       ├─► 👀 리액션 추가 (처리 중 표시)
       │
       ▼
Self-hosted Runner (로컬 PC)
       │
       ├─► checkout + npm ci
       ├─► 코멘트에서 @claude 이후 명령어 추출
       ├─► claude --print --dangerously-skip-permissions (명령어 기반 작업)
       └─► 이슈: 새 브랜치 push + PR 생성
           PR: 해당 브랜치에 변경사항 push
```

### 사용법

코멘트에 `@claude` 뒤에 원하는 작업을 작성합니다:

| 예시 코멘트 | 설명 |
|------------|------|
| `@claude 이 함수를 리팩토링해줘` | 리팩토링 요청 |
| `@claude Add error handling for edge cases` | 에러 처리 추가 |
| `@claude src/server/index.ts의 라우터 구조를 개선해줘` | 특정 파일 수정 요청 |
| `@claude 이 PR의 리뷰 코멘트를 반영해줘` | PR에서 리뷰 반영 요청 |

### 필터링 조건

- 봇 코멘트(`github-actions[bot]`)는 무시 (무한 루프 방지)
- `@claude`가 코멘트에 포함되어야 트리거

### 사전 요구사항

Claude Issue Worker와 동일한 Self-hosted Runner 환경이 필요합니다 (위 섹션 참조).

---

## 로컬에서 CI 검증하기

PR을 올리기 전에 로컬에서 CI와 동일한 검증을 실행할 수 있습니다:

```bash
# 타입 체크
npm run typecheck

# 전체 테스트
npm test

# 빌드
npm run build
```

### 개별 실행

```bash
npm run typecheck:server    # 서버 타입 체크만
npm run typecheck:client    # 클라이언트 타입 체크만
npm run test:server         # 서버 테스트만
npm run test:client         # 클라이언트 테스트만
npm run test:coverage       # 커버리지 리포트 포함
```

---

## npm 스크립트 요약

| 스크립트 | 설명 | CI 사용 |
|----------|------|---------|
| `npm run typecheck` | 서버+클라이언트 타입 체크 | CI, Release |
| `npm run typecheck:server` | 서버 타입 체크 | CI |
| `npm run typecheck:client` | 클라이언트 타입 체크 | CI |
| `npm test` | 전체 테스트 | Release |
| `npm run test:server` | 서버 테스트 | CI |
| `npm run test:client` | 클라이언트 테스트 | CI |
| `npm run test:coverage` | 커버리지 리포트 | - |
| `npm run build` | 프로덕션 빌드 | CI, Release |

---

## 트러블슈팅

### CI에서 클라이언트 의존성 오류
클라이언트는 별도 `package.json`을 가지므로 `cd src/client && npm ci`가 필요합니다.
로컬에서 `src/client/package-lock.json`이 최신인지 확인하세요.

### 타입 체크 실패
```bash
npm run typecheck 2>&1 | head -50   # 오류 위치 확인
```

### 빌드 아티팩트 다운로드
GitHub Actions 탭 → 해당 워크플로우 실행 → Artifacts 섹션에서 `dist` 다운로드.
