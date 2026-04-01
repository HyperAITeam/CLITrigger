# Changelog

## 2026-04-01 — GitHub Issues 연동 + 모델 관리 + 실행 안정성 강화

### 배경

외부 플러그인 생태계를 확장하고 (GitHub Issues 연동), CLI 모델을 유연하게 관리하며, 태스크 실행의 안정성과 효율성을 전반적으로 강화하는 대규모 업데이트.

### 주요 기능 추가

#### 1. GitHub Issues 플러그인 연동 (`471e5b2`)

GitHub 레포지토리의 이슈를 CLITrigger에서 직접 조회하고 AI 태스크로 Import하는 기능.

- **8개 API 엔드포인트**: 연결 테스트, 이슈 CRUD, 코멘트, Import, 라벨 조회
- **프론트엔드 UI** (`GitHubPanel.tsx`): 이슈 브라우징, 검색, 라벨 필터, 상세 보기, Import
- **프로젝트 설정**: GitHub 토글 + Token/Owner/Repo 입력 + Test Connection
- **DB**: `github_enabled`, `github_token`, `github_owner`, `github_repo` 컬럼 추가

#### 2. 모델 수동 관리 시스템 (`760fee2`)

CLI 도구별 모델 목록을 DB에서 관리하는 시스템.

- **`cli_models` 테이블**: 새 테이블 추가 (cli_tool, model_value, model_label, sort_order, is_default)
- **자동 시딩**: 서버 시작 시 기본 모델 목록 자동 생성 (Claude Sonnet/Opus/Haiku, GPT-4.1 계열, Gemini)
- **REST API**: `GET /api/models`, `POST /api/models`, `DELETE /api/models/:id`
- **프론트엔드 UI** (`ModelSettings.tsx`): 모델 추가/삭제/기본값 설정
- **실행 시 모델 변경 핫픽스** (`0f229c6`): 작업 도중 모델이 변경되어도 에러 없이 처리

#### 3. CLI Fallback Chain (`a1992fb`)

컨텍스트 윈도우 소진 시 자동으로 다음 CLI/모델로 재시도하는 폴백 메커니즘.

- **프로젝트 설정**: `cli_fallback_chain` (JSON 배열) 설정 UI
- **자동 감지**: `log-streamer.ts`에서 컨텍스트 소진 패턴 감지
- **자동 재시도**: orchestrator가 다음 fallback CLI로 동일 태스크 자동 재실행
- **컨텍스트 스위치 카운트**: `context_switch_count` 컬럼으로 재시도 횟수 추적

#### 4. Verbose 실행 모드 (`4c7a03c`, `31d79e7`)

Claude CLI의 모든 로그를 필터 없이 스트리밍하는 디버그 모드.

- TODO 실행 시 **Verbose** 토글 추가
- `--verbose` 플래그로 stream-json 출력 활성화
- `log-streamer.ts`에서 verbose 모드일 때 모든 이벤트 기록

#### 5. 토큰 사용량 최적화 (`ff6b637`)

- **기본 턴 제한** (`default_max_turns`): 프로젝트별 Claude CLI 최대 턴 수 설정
- **효율성 지침**: CLAUDE.md에 태스크 실행 가이드라인 추가

#### 6. 프롬프트 인젝션 방어 (`4630c92`)

외부 입력(Notion/GitHub/Jira)에서 프롬프트 인젝션 공격을 방어하는 보안 레이어.

- **`prompt-guard.ts`** 서비스: 구조적 분리, 입력 검증, 위험 패턴 감지
- **감사 로그**: 의심스러운 입력 감지 시 로그 기록
- Notion/GitHub/Jira 라우트에 가드 적용

### 실행 엔진 개선

#### 의존성 시스템 강화
- **자식 태스크 실행 시 부모 의존성 자동 실행** (`1f91eee`): 미완료 부모가 있으면 자동으로 먼저 시작
- **의존성 기반 자동 체이닝** (`c2fa679`): `startNextPending` → `startDependentChildren`으로 교체하여 정밀 제어
- **디펜던시 완료 시 스퀴시 머지** (`c6c1d5b`): 의존성 브랜치 완료 시 자동 squash merge + 부모 워크트리 정리

#### 프로세스 관리
- **tree-kill** (`b78922d`): 프로세스 트리 전체를 안전하게 종료 (단일 PID kill → tree-kill)
- **컨텍스트 스위치 제한**: 무한 재시도 방지
- **Worktree 유효성 검증**: 실행 전 worktree 경로 존재 확인

#### Codex CLI 개선
- `--full-auto` → `--dangerously-bypass-approvals-and-sandbox` (`fd8c254`)
- Windows cmd.exe 셸 이스케이핑 수정 (`fd80f98`)
- 프롬프트 전달 안정화 (`6c3576f`)

### UI 개선

- **그래프 뷰 엣지 드래그로 의존성 제거/변경** (`efb18d6`)
- **리스트 뷰 드래그&드롭으로 의존성 제거** (`8a180e1`)
- **리스트 뷰 의존성 들여쓰기** (`6c3576f`)
- **모바일 UI 반응형 개선** (`6533fe5`): 패딩, 탭, 모달, 배지 레이아웃 수정
- **실패 작업 → 스케줄 변환 UI** (`c8fb658`): 실패한 작업을 스케줄 작업으로 전환하는 UI + 로직
- **로그인 화면 법적 면책 고지** (`a967f88`)

### 새로 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/server/routes/github.ts` | GitHub API 프록시 라우트 (8개 엔드포인트) |
| `src/server/routes/models.ts` | CLI 모델 관리 REST API |
| `src/server/services/prompt-guard.ts` | 프롬프트 인젝션 방어 서비스 |
| `src/server/services/__tests__/prompt-guard.test.ts` | 프롬프트 가드 테스트 |
| `src/client/src/api/github.ts` | 프론트엔드 GitHub API 클라이언트 |
| `src/client/src/api/models.ts` | 프론트엔드 모델 API 클라이언트 |
| `src/client/src/components/GitHubPanel.tsx` | GitHub Issues 브라우저 패널 UI |
| `src/client/src/components/ModelSettings.tsx` | 모델 관리 설정 UI |
| `src/client/src/hooks/useModels.ts` | 모델 데이터 훅 |

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/services/orchestrator.ts` | fallback chain, 의존성 자동 체이닝, squash merge, 컨텍스트 스위치 제한 |
| `src/server/services/log-streamer.ts` | verbose 모드, 컨텍스트 소진 감지, stderr 분류 |
| `src/server/services/claude-manager.ts` | tree-kill, Windows cmd.exe 이스케이핑, Codex 프롬프트 안정화 |
| `src/server/services/cli-adapters.ts` | 모델 변경 핫픽스, verbose 플래그, Codex 플래그 업데이트 |
| `src/server/services/worktree-manager.ts` | worktree 유효성 검증, squash merge 지원 |
| `src/server/db/schema.ts` | `cli_models` 테이블, github/fallback/context_switch 컬럼 |
| `src/client/src/components/ProjectHeader.tsx` | GitHub 설정, fallback chain, max turns, 모델 관리 UI |
| `src/client/src/components/TodoItem.tsx` | verbose 토글, 스케줄 변환, squash merge 버튼 |
| `src/client/src/components/TaskGraph.tsx` | 엣지 드래그 의존성 변경 |
| `src/client/src/components/TodoList.tsx` | 드래그&드롭 의존성 제거, 들여쓰기 |

---

## 2026-04-01 — Notion 데이터베이스 연동

### 배경

피쳐 개발 문서나 버그 리포트를 Notion에 한곳에 모아 관리하면서, CLITrigger에서 바로 Import하여 AI 태스크로 자동 실행하고 싶은 요구가 있었다. Notion API를 통해 프로젝트별 데이터베이스를 연결하고, 페이지 브라우징/검색/Import/생성 기능을 제공한다.

### 구현 내용

#### Notion API 연동 서버 라우트 (`notion.ts`)
- **연결 테스트**: Notion API 키 유효성 + 사용자 정보 확인
- **페이지 조회**: 데이터베이스 쿼리 (페이지네이션, 검색, 필터링, 정렬)
- **페이지 상세**: 메타데이터 + 블록 콘텐츠 조회 (최대 100블록)
- **페이지 수정**: 상태 등 속성 업데이트
- **페이지 생성**: Notion 데이터베이스에 새 페이지 추가
- **Import**: 페이지 제목/본문 추출 → CLITrigger 태스크로 변환
- **스키마 조회**: 데이터베이스 속성 구조 반환

#### 블록 콘텐츠 파싱
- `extractPageTitle()` — title 속성에서 제목 추출
- `extractRichText()` — Notion rich text → plain text 변환
- `extractBlocksText()` — 블록 → 마크다운 변환 (heading, list, code, divider, checkbox 지원)

#### 프론트엔드 UI (`NotionPanel.tsx`, 414줄)
- **페이지 목록**: 검색, 페이지네이션, 상태별 필터링
- **페이지 상세**: 블록 콘텐츠 렌더링 (heading, list, code, divider, to-do)
- **Import 기능**: 페이지를 CLITrigger 태스크로 변환 (제목 + 본문 자동 추출)
- **페이지 생성**: Notion DB에 새 페이지 추가 폼

#### 프로젝트 설정 UI (`ProjectHeader.tsx`)
- Notion 활성화/비활성화 토글
- API Key 입력 (password 필드)
- Database ID 입력
- Test Connection 버튼 + 연결 상태 피드백
- 도움말: "notion.so/my-integrations에서 Integration 생성 후 DB 공유"

#### REST API 엔드포인트 (8개)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | /api/notion/:projectId/test | 연결 테스트 |
| POST | /api/notion/:projectId/pages | 페이지 목록 (검색/필터/페이지네이션) |
| GET | /api/notion/:projectId/page/:pageId | 페이지 상세 |
| GET | /api/notion/:projectId/page/:pageId/blocks | 페이지 블록 콘텐츠 |
| POST | /api/notion/:projectId/page/:pageId/update | 페이지 속성 수정 |
| POST | /api/notion/:projectId/create | 페이지 생성 |
| POST | /api/notion/:projectId/import/:pageId | 태스크로 Import |
| GET | /api/notion/:projectId/schema | DB 스키마 조회 |

#### 새로 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/server/routes/notion.ts` | Notion API 프록시 라우트 (8개 엔드포인트) |
| `src/client/src/api/notion.ts` | 프론트엔드 Notion API 클라이언트 |
| `src/client/src/components/NotionPanel.tsx` | Notion 브라우저 패널 UI |

#### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/index.ts` | `notionRouter`를 `/api/notion`에 마운트 |
| `src/server/routes/projects.ts` | PUT 업데이트에 notion 필드 처리 (`notion_enabled`, `notion_api_key`, `notion_database_id`) |
| `src/server/db/schema.ts` | `notion_enabled`, `notion_api_key`, `notion_database_id` 컬럼 마이그레이션 추가 |
| `src/server/db/queries.ts` | `Project` 인터페이스 및 `updateProject`에 notion 필드 추가 |
| `src/client/src/types.ts` | `Project`에 notion 필드 + `NotionPage`, `NotionQueryResult` 인터페이스 추가 |
| `src/client/src/components/ProjectHeader.tsx` | 설정 패널에 Notion 설정 UI 추가 |
| `src/client/src/components/ProjectDetail.tsx` | Notion 탭 버튼 + NotionPanel 렌더링 추가 |
| `src/client/src/i18n.tsx` | 한/영 Notion 관련 번역 키 추가 |

#### 아키텍처 결정

1. **프로젝트별 설정**: Notion API 키와 DB ID를 프로젝트 단위로 저장 (Jira 연동과 동일 패턴)
2. **서버 프록시**: 클라이언트가 Notion API를 직접 호출하지 않고 서버를 경유 (API 키 노출 방지)
3. **블록 → 마크다운 변환**: Import 시 Notion 블록을 마크다운으로 변환하여 AI 프롬프트로 활용
4. **DB 저장**: `notion_enabled` (INTEGER 0/1) + `notion_api_key` (TEXT) + `notion_database_id` (TEXT)

#### 검증

- TypeScript 서버 컴파일: 통과
- 기존 테스트 53개: 전체 통과

---

## 2026-03-29 — Cron 스케줄 기반 자동 실행

### 배경

TODO를 수동으로 Start하는 것 외에, 정해진 시간에 자동으로 반복 실행하는 스케줄링 기능이 필요했다. cron 표현식을 사용하여 프로젝트별 반복 작업을 설정할 수 있도록 구현한다.

### 구현 내용

#### Scheduler 서비스 (`scheduler.ts`)
- **cron 기반 반복 실행**: `node-cron` 라이브러리로 cron 표현식에 따라 TODO 자동 생성 + 실행
- **중복 실행 방지**: `skip_if_running` 옵션으로 이전 실행이 진행 중이면 건너뜀
- **수동 트리거**: 스케줄 외에 즉시 실행 가능
- **활성화/비활성화**: 스케줄별 ON/OFF 토글
- **실행 이력**: `schedule_runs` 테이블에 실행 기록 저장

#### REST API 엔드포인트 (9개)
- `POST /api/projects/:id/schedules` — 스케줄 생성 (cron 표현식 검증)
- `GET /api/projects/:id/schedules` — 프로젝트 스케줄 목록
- `GET /api/schedules/:id` — 스케줄 상세
- `PUT /api/schedules/:id` — 스케줄 수정
- `DELETE /api/schedules/:id` — 스케줄 삭제
- `POST /api/schedules/:id/activate` — 활성화
- `POST /api/schedules/:id/pause` — 비활성화
- `GET /api/schedules/:id/runs` — 실행 이력 조회
- `POST /api/schedules/:id/trigger` — 수동 트리거

#### 프론트엔드 UI
- `ScheduleForm.tsx` — 스케줄 생성/수정 폼 (cron 표현식 입력 + 검증)
- `ScheduleItem.tsx` — 스케줄 항목 (상태, 다음 실행 시각, 실행 이력)
- `ScheduleList.tsx` — 스케줄 목록

#### DB 변경
- `schedules` 테이블: id, project_id, title, cron_expression, is_active, skip_if_running, last_run_at 등
- `schedule_runs` 테이블: id, schedule_id, todo_id, status (triggered/skipped/failed)
- `todos` 테이블: `schedule_id` 컬럼 추가 (스케줄에서 생성된 TODO 추적)

#### WebSocket 이벤트 (3개)
- `schedule:run-triggered` — 스케줄 실행 시작
- `schedule:run-skipped` — 중복 실행 건너뜀
- `schedule:status-changed` — 스케줄 상태 변경 (활성화/비활성화)

#### 새로 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/server/services/scheduler.ts` | Scheduler 서비스 (cron 등록/해제/실행) |
| `src/server/routes/schedules.ts` | 스케줄 REST API 라우트 (9개 엔드포인트) |
| `src/client/src/api/schedules.ts` | 프론트엔드 스케줄 API 클라이언트 |
| `src/client/src/components/ScheduleForm.tsx` | 스케줄 생성/수정 폼 |
| `src/client/src/components/ScheduleItem.tsx` | 스케줄 항목 UI |
| `src/client/src/components/ScheduleList.tsx` | 스케줄 목록 UI |

#### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `package.json` | `node-cron`, `@types/node-cron` 의존성 추가 |
| `src/server/db/schema.ts` | `schedules`, `schedule_runs` 테이블 + `todos.schedule_id` 컬럼 추가 |
| `src/server/db/queries.ts` | 스케줄 CRUD 쿼리 함수 추가 |
| `src/server/index.ts` | `schedulesRouter` 마운트 + Scheduler 초기화 |
| `src/client/src/i18n.tsx` | 스케줄 관련 번역 키 30개 추가 (한/영) |

---

## 2026-03-29 — TODO별 CLI 도구 & 모델 선택

### 배경

프로젝트 단위로만 CLI 도구(Claude/Gemini/Codex)와 모델을 설정할 수 있었으나, 개별 TODO마다 다른 CLI/모델을 사용하고 싶은 요구가 있었다.

### 구현 내용

- TODO 생성/수정 시 `cli_tool`과 `cli_model` 필드 추가
- 프로젝트 기본값을 상속하되, TODO 레벨에서 오버라이드 가능
- UI에서 TODO별 CLI 도구 및 모델 선택 드롭다운 제공

#### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/db/schema.ts` | `todos` 테이블에 `cli_tool`, `cli_model` 컬럼 추가 |
| `src/server/db/queries.ts` | TODO CRUD에 cli_tool, cli_model 필드 반영 |
| `src/server/services/orchestrator.ts` | TODO 실행 시 개별 cli_tool/cli_model 우선 적용 |
| `src/client/src/components/TodoForm.tsx` | CLI 도구/모델 선택 UI 추가 |
| `src/client/src/types.ts` | Todo 타입에 cli_tool, cli_model 필드 추가 |

---

## 2026-03-29 — Claude Issue Worker (Self-hosted Runner)

### 배경

로컬 PC 없이 GitHub 이슈만으로 코드 작업을 자동화하려는 요구가 있었다. Anthropic API 종량제 대신 Claude Max 구독을 활용하기 위해 Self-hosted Runner 기반으로 구현한다.

### 구현 내용

#### Claude Issue Worker 워크플로우 (`claude-issue.yml`)
- **트리거**: 이슈에 `claude-fix` 라벨 추가 시
- **실행 환경**: Self-hosted Runner (Claude Max 구독 인증된 로컬 PC)
- **동작**: Claude Code CLI가 이슈 내용을 읽고 코드 구현 → `claude/issue-{N}` 브랜치에 커밋 → PR 자동 생성
- **실패 처리**: 변경사항이 없으면 이슈에 코멘트로 알림

#### 새로 생성된 파일

| 파일 | 설명 |
|------|------|
| `.github/workflows/claude-issue.yml` | Claude Issue Worker 워크플로우 |

#### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `docs/CICD.md` | Claude Issue Worker 섹션 추가 (동작 흐름, Runner 등록 가이드, 트러블슈팅) |
| `docs/SETUP.md` | CI/CD 섹션에 Issue 자동 처리 안내 추가 |
| `docs/CHANGELOG.md` | 이 항목 추가 |

---

## 2026-03-26 — CI/CD 파이프라인 구축

### 배경

프로젝트에 자동화된 품질 검증 체계가 없어, PR 머지 시 타입 오류나 테스트 실패가 감지되지 않을 수 있었다. GitHub Actions 기반 CI/CD를 도입하여 코드 품질 게이트를 자동화한다.

### 구현 내용

#### CI 워크플로우 (`ci.yml`)
- **트리거**: `main` 브랜치 push 및 PR
- **병렬 파이프라인**: typecheck → test-server → test-client (병렬) → build (게이트)
- **동시성 제어**: 같은 브랜치의 중복 실행 자동 취소
- **아티팩트**: 빌드 결과물 7일간 보관

#### Release 워크플로우 (`release.yml`)
- **트리거**: `v*` 태그 push
- **산출물**: typecheck → test → build → tar.gz 패키징 → GitHub Release 자동 생성
- release notes 자동 생성 포함

#### npm 스크립트 추가
- `typecheck` — 서버 + 클라이언트 TypeScript 타입 체크 (`--noEmit`)
- `typecheck:server` / `typecheck:client` — 개별 타입 체크

#### 새로 생성된 파일

| 파일 | 설명 |
|------|------|
| `.github/workflows/ci.yml` | CI 워크플로우 |
| `.github/workflows/release.yml` | Release 워크플로우 |
| `docs/CICD.md` | CI/CD 가이드 문서 |

#### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `package.json` | `typecheck`, `typecheck:server`, `typecheck:client` 스크립트 추가 |
| `docs/SETUP.md` | CI/CD 관련 참조 추가 |
| `docs/CHANGELOG.md` | 이 항목 추가 |

---

## 2026-03-26 — gstack 스킬 통합

### 배경

[gstack](https://github.com/garrytan/gstack) (MIT License, Garry Tan)은 Claude Code용 28개 AI 스킬을 제공하는 오픈소스 프로젝트이다. CLITrigger가 TODO를 실행할 때 이 스킬들을 worktree에 자동 주입하면, Claude CLI의 작업 품질을 높일 수 있다.

### 구현 내용

gstack의 28개 스킬 중 자동화 실행에 적합한 **7개 스킬**을 선별하여 CLITrigger에 번들링하고, 프로젝트 설정에서 ON/OFF + 개별 선택이 가능하도록 구현했다.

#### 선별 스킬

- `review` — 코드 리뷰 & 자동 수정 (9/10)
- `qa` — 브라우저 기반 QA 테스트 (9/10)
- `qa-only` — QA 리포트만 (10/10)
- `cso` — OWASP/STRIDE 보안 감사 (9/10)
- `investigate` — 체계적 디버깅 (8/10)
- `benchmark` — 성능 회귀 감지 (10/10)
- `careful` — 위험 명령어 경고 (10/10)

#### 새로 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/server/resources/gstack-skills/` | 7개 스킬 SKILL.md 파일 + LICENSE + 매니페스트 |
| `src/server/services/skill-injector.ts` | 스킬 파싱, 조회, worktree 주입 서비스 |
| `src/client/src/api/gstack.ts` | 프론트엔드 gstack API 클라이언트 |
| `THIRD_PARTY_LICENSES.md` | 서드파티 라이선스 고지 |
| `docs/CHANGELOG.md` | 이 파일 |

#### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/db/schema.ts` | `gstack_enabled`, `gstack_skills` 컬럼 마이그레이션 추가 |
| `src/server/db/queries.ts` | `Project` 인터페이스 및 `updateProject`에 gstack 필드 추가 |
| `src/server/services/orchestrator.ts` | `startSingleTodo()`에서 worktree 생성 후 CLI spawn 전에 스킬 주입 호출 |
| `src/server/routes/projects.ts` | PUT 업데이트에 gstack 필드 처리 + `gstackRouter` 분리 (`GET /api/gstack/skills`) |
| `src/server/index.ts` | `gstackRouter`를 `/api/gstack`에 마운트 |
| `src/client/src/types.ts` | `Project`에 gstack 필드 + `GstackSkill` 인터페이스 추가 |
| `src/client/src/api/projects.ts` | `updateProject` 파라미터에 gstack 필드 추가 |
| `src/client/src/components/ProjectHeader.tsx` | 설정 패널에 gstack 토글 + 스킬 체크박스 UI 추가 |
| `src/client/src/i18n.tsx` | 한/영 gstack 관련 번역 키 추가 |
| `package.json` | `build:server`에 리소스 복사 (`cp -r`) 추가 |
| `docs/SETUP.md` | gstack 스킬 사용법 섹션 + API 테이블에 엔드포인트 추가 |

#### 아키텍처 결정

1. **스킬 격리**: gstack 스킬은 worktree의 `.claude/skills/gstack-{id}/SKILL.md`에 배치되어 기존 스킬과 충돌하지 않음
2. **Claude CLI 전용**: `cliTool === 'claude'`일 때만 주입 (Gemini/Codex는 gstack 스킬 미지원)
3. **실패 허용**: 스킬 주입 실패 시 로그만 남기고 CLI 실행은 계속 진행
4. **DB 저장**: `gstack_enabled` (INTEGER 0/1) + `gstack_skills` (JSON 배열 문자열)로 프로젝트별 설정 저장

#### 검증

- TypeScript 서버 컴파일: 통과
- 기존 테스트 52개: 전체 통과
- MIT 라이선스 고지: `THIRD_PARTY_LICENSES.md` + UI 크레딧 + 리소스 내 LICENSE 파일
