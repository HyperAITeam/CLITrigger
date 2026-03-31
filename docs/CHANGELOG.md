# Changelog

## 2026-03-31 — 태스크 의존성 & 노드 그래프, 토큰 사용량 추적, Jira 연동 외 다수

### 배경

태스크 간 실행 순서 제어, CLI 토큰 사용량 모니터링, 외부 이슈 트래커 연동 등 자동화 품질을 높이기 위한 기능들을 추가했다.

---

### 1. 태스크 의존성 & 노드 그래프 뷰

#### 구현 내용

- **의존성 체인**: TODO에 `depends_on` 필드 추가. 선행 태스크가 완료되어야 다음 태스크 실행 가능
- **Worktree 재사용**: 의존 관계의 하위 태스크가 상위 태스크의 worktree를 상속하여 동일 브랜치에서 연속 작업
- **드래그 앤 드롭 연결**: TODO 리스트에서 드래그로 의존 관계 설정/해제
- **인터랙티브 노드 그래프**: `@xyflow/react` + `dagre` 기반 태스크 의존성 시각화. 노드 클릭 시 상세 정보 표시

#### 새로 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/client/src/components/TaskGraph.tsx` | 노드 그래프 레이아웃 (dagre 자동 배치) |
| `src/client/src/components/TaskNode.tsx` | 그래프 내 태스크 노드 컴포넌트 |
| `src/client/src/components/TaskNodeDetail.tsx` | 노드 클릭 시 상세 패널 |

#### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/db/schema.ts` | `todos` 테이블에 `depends_on` 컬럼 추가 |
| `src/server/db/queries.ts` | TODO CRUD에 depends_on 필드 반영 |
| `src/server/services/orchestrator.ts` | 의존 태스크 완료 시 다음 태스크 자동 시작, worktree 상속 |
| `src/server/routes/todos.ts` | depends_on 필드 처리 |
| `src/client/src/components/TodoList.tsx` | 드래그 앤 드롭 의존 관계 설정 UI |
| `src/client/src/components/TodoItem.tsx` | 의존 관계 표시 및 드래그 핸들 |
| `src/client/src/components/ProjectDetail.tsx` | 그래프 뷰 탭 추가 |
| `src/client/src/types.ts` | Todo에 depends_on 필드, 그래프 관련 타입 추가 |
| `src/client/src/i18n.tsx` | 의존성/그래프 관련 번역 키 추가 |
| `src/client/package.json` | `@xyflow/react`, `dagre`, `@types/dagre` 의존성 추가 |

---

### 2. 토큰 사용량 추적

#### 구현 내용

- **Claude CLI JSON 파싱**: Claude CLI의 구조화된 JSON 출력(stdout + stderr)에서 토큰 사용량 추출
- **토큰 저장**: `todos.token_usage` 컬럼(JSON 텍스트)에 input/output/cache_read/cache_creation 토큰 저장
- **프로젝트 요약**: 프로젝트 내 전체 태스크의 토큰 합계 표시
- **사용량 레벨**: 토큰 소비량에 따른 단계별 표시 (Low / Moderate / High)
- **UI**: 라벨 → 값 순서, 점 구분자, 사용량 링크를 CLI 도구 설정 패널로 이동

#### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/db/schema.ts` | `todos` 테이블에 `token_usage` 컬럼 추가 |
| `src/server/services/log-streamer.ts` | JSON lines 파싱 + stdout/stderr 모두에서 토큰 추출 |
| `src/server/routes/logs.ts` | 토큰 사용량 API 응답 포함 |
| `src/client/src/components/ProjectHeader.tsx` | 프로젝트 토큰 합계 표시, 사용량 링크 |
| `src/client/src/components/TodoItem.tsx` | 개별 태스크 토큰 표시 |
| `src/client/src/i18n.tsx` | 토큰 관련 번역 키 추가 |

---

### 3. Jira Cloud 연동

#### 구현 내용

- **프로젝트 플러그인**: 프로젝트별 Jira Cloud 설정 (Base URL, Email, API Token, Project Key)
- **이슈 관리**: 이슈 목록 조회, 상세 보기, 상태 전이, 코멘트 추가
- **이슈 생성**: CLITrigger에서 Jira 이슈 직접 생성
- **이슈 임포트**: Jira 이슈를 TODO로 변환하여 가져오기
- **연결 테스트**: 설정 저장 전 Jira API 연결 확인

#### 새로 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/server/routes/jira.ts` | Jira REST API 프록시 라우트 (9개 엔드포인트) |
| `src/client/src/api/jira.ts` | 프론트엔드 Jira API 클라이언트 |
| `src/client/src/components/JiraPanel.tsx` | Jira 이슈 목록/상세/임포트 UI |

#### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/db/schema.ts` | `projects` 테이블에 `jira_enabled`, `jira_base_url`, `jira_email`, `jira_api_token`, `jira_project_key` 컬럼 추가 |
| `src/server/db/queries.ts` | Project 인터페이스에 Jira 필드 추가 |
| `src/server/index.ts` | `jiraRouter`를 `/api/jira` 에 마운트 |
| `src/server/routes/projects.ts` | PUT 업데이트에 Jira 필드 처리 |
| `src/client/src/components/ProjectHeader.tsx` | 설정 패널에 Jira 연동 토글 및 설정 폼 추가 |
| `src/client/src/components/ProjectDetail.tsx` | Jira 패널 탭 추가 |
| `src/client/src/types.ts` | Project에 Jira 필드 + JiraIssue 인터페이스 추가 |
| `src/client/src/i18n.tsx` | 한/영 Jira 관련 번역 키 86개 추가 |

#### Jira API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | /api/jira/:projectId/test | 연결 테스트 |
| GET | /api/jira/:projectId/issues | 이슈 목록 |
| GET | /api/jira/:projectId/issue/:issueKey | 이슈 상세 |
| GET | /api/jira/:projectId/issue/:issueKey/transitions | 상태 전이 목록 |
| POST | /api/jira/:projectId/issue/:issueKey/transition | 상태 전이 실행 |
| POST | /api/jira/:projectId/issue/:issueKey/comment | 코멘트 추가 |
| POST | /api/jira/:projectId/issues | 이슈 생성 |
| POST | /api/jira/:projectId/import/:issueKey | 이슈 → TODO 임포트 |
| GET | /api/jira/:projectId/statuses | 프로젝트 상태 목록 |

---

### 4. 일회성 스케줄 & 태스크→스케줄 변환

#### 구현 내용

- **일회성 스케줄**: cron 반복 외에 특정 날짜/시간에 1회만 실행하는 스케줄 타입 추가
- **run_at 필드**: `schedules` 테이블에 `run_at` 컬럼 추가 (DATETIME)
- **태스크→스케줄 변환**: 완료된 TODO를 반복 또는 일회성 스케줄로 변환하는 UI 제공
- **스케줄 폼 개선**: cron/일회성 타입 선택, 날짜/시간 입력 지원

#### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/db/schema.ts` | `schedules` 테이블에 `run_at` 컬럼 추가 |
| `src/server/db/queries.ts` | 스케줄 CRUD에 run_at 필드 반영 |
| `src/server/routes/schedules.ts` | 일회성 스케줄 생성/수정 로직 추가 |
| `src/server/services/scheduler.ts` | 일회성 스케줄 타이머 등록/실행/해제 |
| `src/client/src/components/ScheduleForm.tsx` | cron/일회성 타입 전환 UI |
| `src/client/src/components/ScheduleItem.tsx` | 일회성 스케줄 표시 |
| `src/client/src/components/TodoItem.tsx` | 태스크→스케줄 변환 버튼 |
| `src/client/src/i18n.tsx` | 일회성 스케줄 관련 번역 키 추가 |

---

### 5. 태스크 실행 옵션 추가

#### 구현 내용

- **max_turns**: TODO에 최대 에이전틱 턴 수 설정. Claude CLI `--max-turns` 플래그로 전달
- **태스크 완료 접미사**: stdin 프롬프트에 작업 범위 제한 안내문 자동 추가 (과도한 작업 방지)
- **autoChain 제어**: 태스크 완료 시 다음 대기 태스크를 자동으로 시작할지 여부를 명시적으로 제어

#### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/db/schema.ts` | `todos` 테이블에 `max_turns` 컬럼 추가 |
| `src/server/services/orchestrator.ts` | autoChain 플래그 + max_turns 전달 |
| `src/server/services/cli-adapters.ts` | `--max-turns` 플래그 생성 |
| `src/server/services/claude-manager.ts` | max_turns 파라미터 전달 |
| `src/client/src/components/TodoForm.tsx` | max_turns 입력 필드 추가 |
| `src/client/src/i18n.tsx` | max_turns 관련 번역 키 추가 |

---

### 6. 기타 수정

- **Codex headless 모드 수정**: `codex exec` 서브커맨드 사용으로 "Do you trust this directory?" 프롬프트 회피
- **Log streamer 개선**: stdout뿐 아니라 stderr에서도 JSON lines 파싱
- **gstack 스킬 정리**: `.claude/skills/`에 배치했던 gstack 스킬 파일을 토큰 사용량 이슈로 제거 (서버 리소스의 worktree 주입 기능은 유지)
- **remove-worktree 스킬**: worktree 안전 정리를 위한 Claude 스킬 추가 (`.claude/skills/remove-worktree/SKILL.md`)
- **CLAUDE.md 추가**: 프로젝트 개요, 아키텍처, 명령어 가이드 등 Claude Code용 지침 문서 작성

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
