# Changelog

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
