# Changelog

## 2026-04-06 — 다크 모드 + 토론 UX 강화 + 워크트리 안정성

### 배경

토론 기능이 안정화되면서 사용성 개선 요구가 집중됨. 에이전트별 CLI 도구/모델 선택, 토론 완료 후 자동 구현, 메시지 접기/펼치기 등 토론 워크플로우 전반을 강화. 또한 다크 모드 테마 시스템을 도입하고, 워크트리 생성 시 npm 의존성 자동 설치 및 백그라운드 실행으로 안정성과 응답 속도를 개선.

### 주요 변경

#### 1. 다크 모드 테마 시스템 (`3aea8ff`, `0f527f2`, `68a5a64`)

CSS 변수 기반 테마 시스템을 도입하여 라이트/다크 모드를 지원.

- **클라이언트**: `useTheme` 훅 + `ThemeContext` 추가 — `localStorage` 저장, OS 기본값 감지, `data-theme` 어트리뷰트 방식
- **클라이언트**: Tailwind 컬러 팔레트를 하드코딩 HEX에서 CSS 변수(`--color-*`)로 전면 전환
- **클라이언트**: `index.css`에 `[data-theme="light"]` / `[data-theme="dark"]` 변수 셋 정의
- **클라이언트**: `index.html`에 인라인 스크립트로 FOUC(Flash of Unstyled Content) 방지 — 페이지 로드 전 테마 적용
- **클라이언트**: `ProjectList`에 테마 토글 버튼 추가
- **클라이언트**: 다크 모드 누락 스타일 수정 (ScheduleItem, TaskGraph, TaskNode 등)

#### 2. 토론 자동 구현 (`2a3f039`)

토론 완료 후 수동으로 구현 에이전트를 지정하는 대신, 토론 생성 시 자동 구현 옵션을 설정하면 토론 종료 즉시 자동으로 구현 라운드가 시작됨.

- **DB**: `discussions` 테이블에 `auto_implement` (INTEGER), `implement_agent_id` (TEXT) 컬럼 추가
- **서버**: `DiscussionOrchestrator`에 자동 구현 트리거 로직 — 전체 라운드 완료 시 지정 에이전트로 즉시 구현 시작
- **서버**: 구현 에이전트 삭제 시 fallback (정상 완료 처리)
- **서버**: `createDiscussion` API에 `auto_implement`, `implement_agent_id` 파라미터 + 유효성 검증
- **클라이언트**: 토론 생성 폼에 자동 구현 토글 + 구현 에이전트 선택 UI

#### 3. 토론 메시지 접기/펼치기 (`a19cf5b`)

긴 토론에서 이전 메시지를 접어 최신 대화에 집중할 수 있는 기능.

- **클라이언트**: `DiscussionDetail`에 메시지별 접기/펼치기 토글 + 접힌 상태에서 요약 미리보기 (첫 200자)
- **i18n**: 접기/펼치기 관련 번역 키 추가

#### 4. 에이전트별 CLI 도구/모델 선택 (`65af70b`)

에이전트마다 다른 CLI 도구(Claude/Gemini/Codex)와 모델을 지정 가능. 프로젝트 기본값을 사용하거나 에이전트별로 오버라이드.

- **클라이언트**: `AgentManager` 폼에 CLI 도구 드롭다운 + 모델 드롭다운 추가 (프로젝트 기본값 옵션 포함)
- **클라이언트**: 에이전트 목록에 CLI 도구/모델 표시

#### 5. 토론 메타데이터 편집 (`2d095d4`)

토론 생성 후에도 제목, 설명, 참여 에이전트, 최대 라운드를 수정 가능.

- **서버**: `DiscussionDetail` 컴포넌트에 편집 모드 추가
- **서버**: `discussions.ts` 라우트 리팩토링 + `DiscussionForm` 컴포넌트 분리
- **클라이언트**: `DiscussionForm` 신규 — 토론 생성/편집 공용 폼 컴포넌트

#### 6. 워크트리 안정성 개선 (`1b37862`, `58936f1`, `17640d0`)

- **서버**: 워크트리 생성 시 `package.json` 존재하면 자동 `npm install` 실행 (`1b37862`)
- **서버**: npm install을 백그라운드(fire-and-forget)로 실행하여 API 응답 지연 해소 (`58936f1`)
- **서버**: 워크트리 브랜치 이름 생성 시 중복 방지 로직 강화 — 기존 브랜치 존재 시 `-2`, `-3` 접미사 추가 (`17640d0`)

#### 7. 토론 버그 수정 (`72769c4`, `b0bc271`, `ea59400`, `162b902`, `c03a04f`, `fd62b73`)

- 토론 목록 링크가 작업 탭 대신 토론 탭으로 이동하도록 수정 (`72769c4`)
- 토론 mutation 응답에 `agents` 필드 누락 수정 (`b0bc271`, `ea59400`)
- `exitPromise` 미처리 rejection 방어 + 하드코딩 문자열 i18n 적용 (`162b902`)
- 잘못된 i18n 키 참조 수정 (`c03a04f`)
- 토론 생성 폼 UI를 프로젝트 패턴에 맞게 개선 (`fd62b73`)
- 토론 화이트 스크린 수정 (`17640d0`)

#### 8. 기타 수정

- **탭 URL 동기화**: 탭 변경 시 URL 쿼리 파라미터를 함께 업데이트하여 새로고침 시 올바른 탭 유지 (`70b3c9d`)
- **터널 빌드 자동화**: `start:tunnel` 실행 전 자동 빌드 추가 (`911c847`)

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/client/src/hooks/useTheme.ts` | 테마 컨텍스트 + 훅 신규 |
| `src/client/tailwind.config.js` | 컬러 팔레트 CSS 변수 전환 |
| `src/client/src/index.css` | 라이트/다크 모드 CSS 변수 정의 |
| `src/client/src/main.tsx` | ThemeContext.Provider 래핑 |
| `src/client/src/components/DiscussionForm.tsx` | 토론 생성/편집 공용 폼 컴포넌트 신규 |
| `src/client/src/components/DiscussionDetail.tsx` | 메시지 접기/펼치기, 메타데이터 편집 |
| `src/client/src/components/DiscussionList.tsx` | 자동 구현 옵션 UI, 폼 분리 |
| `src/client/src/components/AgentManager.tsx` | CLI 도구/모델 선택 UI |
| `src/server/services/discussion-orchestrator.ts` | 자동 구현 트리거 로직 |
| `src/server/services/worktree-manager.ts` | npm 자동 설치, 백그라운드 실행, 브랜치 중복 방지 |
| `src/server/db/schema.ts` | `auto_implement`, `implement_agent_id` 컬럼 마이그레이션 |
| `src/server/routes/discussions.ts` | 메타데이터 편집 + 자동 구현 파라미터 |
| `src/client/src/components/ProjectDetail.tsx` | 탭 URL 쿼리 파라미터 동기화 |

### 아키텍처 결정

1. **CSS 변수 기반 테마**: Tailwind 컬러를 CSS 변수로 간접 참조하여, 테마 전환 시 변수값만 교체. 기존 `warm-*`, `accent-*` 클래스명은 그대로 유지하면서 다크 모드 지원
2. **FOUC 방지 인라인 스크립트**: React hydration 전에 `data-theme` 어트리뷰트를 설정하여 초기 렌더링에서 올바른 테마 적용
3. **자동 구현의 실패 허용**: 구현 에이전트가 삭제된 경우 경고 로그만 남기고 정상 완료 처리 (기존 실패 허용 패턴 일관 적용)
4. **npm install 백그라운드 실행**: 워크트리 생성 API 응답은 즉시 반환하고, npm install은 비동기 실행하여 UX 지연 방지

---

## 2026-04-05/06 — 에이전트 토론 + 디버그 로깅 + 인증 개선

### 배경

단일 에이전트(Todo)나 고정 단계(Pipeline)만으로는 복잡한 기능의 설계 품질을 보장하기 어려웠음. 다수의 AI 에이전트가 역할별로 토론하고 합의 후 구현하는 Discussion 시스템을 도입. 또한 CLI 도구의 실제 입출력을 확인할 방법이 없어 디버깅이 어려운 문제를 해결하기 위해 디버그 로깅 기능을 추가.

### 주요 변경

#### 1. 에이전트 토론 기능 (`f1a1dce`, `7de78df`, `354c924`, `fd62b73`, `c03a04f`, `4222743`)

다수의 AI 에이전트(아키텍트, 개발자, 리뷰어 등)가 라운드 기반으로 피쳐를 토론하고, 합의 후 지정 에이전트가 구현까지 수행하는 협업 시스템.

- **DB**: `discussion_agents`, `discussions`, `discussion_messages`, `discussion_logs` 4개 테이블 + CRUD 쿼리 함수 ~20개 추가
- **서버**: `DiscussionOrchestrator` 서비스 — 라운드 턴제 실행, 프롬프트 빌드 (이전 발언 누적), 자동 라운드 진행, 유저 메시지 주입, 구현 라운드 트리거
- **서버**: `routes/discussions.ts` — 18개 REST 엔드포인트 (에이전트 CRUD, 토론 CRUD, 시작/정지/주입/스킵/구현/머지/diff/cleanup)
- **WebSocket**: `discussion:status-changed`, `discussion:message-changed`, `discussion:log`, `discussion:commit` 4개 이벤트
- **클라이언트**: `DiscussionDetail` 채팅 UI (라운드별 메시지 그룹, 스트리밍 로그, 사용자 개입 입력), `DiscussionList` (토론 목록 + 생성 폼), `AgentManager` (에이전트 페르소나 CRUD)
- **클라이언트**: `ProjectDetail`에 토론 탭 추가, 라우트 `/projects/:id/discussions/:discussionId`
- **i18n**: 한/영 토론 관련 35개 + 버그 수정 6개 번역 키 추가
- **복구**: 서버 재시작 시 running 토론을 paused로 자동 복구
- **버그 수정**: `exitPromise`에 `.catch()` 핸들러 추가 (unhandled rejection 방지), 하드코딩 문자열 i18n 적용

#### 2. CLI 디버그 로깅 (`ba6c8c1`, `a3c219a`)

프로젝트 설정에서 디버그 모드를 켜면 CLI 실행 시 전체 stdin/stdout/stderr를 `.debug-logs/` 디렉토리에 저장.

- **서버**: `debug-logger.ts` 서비스 — PassThrough 스트림으로 기존 logStreamer에 영향 없이 raw 입출력을 파일에 tee 방식 기록
- **서버**: `orchestrator.ts`에 디버그 세션 통합 — `project.debug_logging` 활성화 시 stdout/stderr tee + 종료 시 exit code/소요시간 기록
- **서버**: `debug-logs.ts` API 라우트 — 목록 조회/파일 읽기/삭제 엔드포인트 4개
- **서버**: `claude-manager.ts` 반환값에 `command`/`args` 추가 (로그 헤더용)
- **DB**: `projects` 테이블에 `debug_logging` 컬럼 (INTEGER DEFAULT 0)
- **클라이언트**: 프로젝트 설정에 디버그 로깅 토글 + Debug Logs 배지
- **클라이언트**: `TodoItem`/`TaskNodeDetail`에 Debug Log 버튼 (새 탭에서 로그 파일 열기)
- 서버 시작 시 `LOG_RETENTION_DAYS` 기준 오래된 디버그 로그 자동 정리

#### 3. AUTH_PASSWORD 미설정 시 인증 건너뛰기 (`fd6b80a`)

비밀번호가 설정되지 않은 로컬 환경에서 로그인 화면 없이 바로 사용 가능.

- **서버**: `AUTH_PASSWORD` 미설정 시 auth 미들웨어 통과 + `/api/auth/status`에서 `authenticated=true`, `authRequired=false` 반환
- **클라이언트**: `authRequired` 플래그로 로그인 페이지 스킵 + 로그아웃 버튼 숨김

#### 4. 샌드박스 모드 개선 (`6e9251a`, `276d138`, `4b27e66`, `bbe2378`)

기존 샌드박스 설정의 안정성 및 파이프라인 지원 확대.

- **서버**: `settings.json` 덮어쓰기 → 병합 방식으로 변경 (기존 설정 보존)
- **서버**: `pipeline-orchestrator.ts`에도 샌드박스 모드 적용
- **서버**: strict 모드에서 `--permission-mode dontAsk` 플래그 추가 (Write/Edit 도구 차단 방지)
- **클라이언트**: 샌드박스 배지 텍스트 i18n 적용
- **API**: `updateProject`에 `sandbox_mode` 필드 추가

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/services/discussion-orchestrator.ts` | 토론 오케스트레이터 신규 (라운드 턴제, 프롬프트 빌드, 자동 진행) |
| `src/server/routes/discussions.ts` | 토론 REST 엔드포인트 18개 |
| `src/server/db/queries.ts` | 토론 관련 CRUD 함수 ~20개 + 디버그 로깅 쿼리 |
| `src/server/db/schema.ts` | discussion 4개 테이블 + `debug_logging` 컬럼 마이그레이션 |
| `src/server/services/debug-logger.ts` | 디버그 로깅 서비스 신규 |
| `src/server/routes/debug-logs.ts` | 디버그 로그 API 라우트 신규 |
| `src/server/services/orchestrator.ts` | 디버그 세션 통합 + 샌드박스 settings.json 병합 |
| `src/server/services/pipeline-orchestrator.ts` | 파이프라인 샌드박스 지원 |
| `src/server/services/cli-adapters.ts` | strict 모드 `--permission-mode dontAsk` 추가 |
| `src/server/middleware/auth.ts` | AUTH_PASSWORD 미설정 시 통과 로직 |
| `src/client/src/components/DiscussionDetail.tsx` | 토론 채팅 UI (라운드 메시지, 스트리밍, 구현 모달) |
| `src/client/src/components/DiscussionList.tsx` | 토론 목록 + 생성 폼 |
| `src/client/src/components/AgentManager.tsx` | 에이전트 페르소나 관리 UI |
| `src/client/src/components/ProjectDetail.tsx` | 토론 탭 추가 |
| `src/client/src/i18n.tsx` | 토론·디버그·샌드박스 번역 키 추가 |
| `src/client/src/types.ts` | Discussion 관련 인터페이스 5개 추가 |

### 아키텍처 결정

1. **턴 기반 순차 실행**: 에이전트가 순서대로 CLI를 spawn하고, 이전 발언을 다음 프롬프트에 누적 포함. 동시 쓰기 충돌 방지 + 컨텍스트 연속성 보장
2. **구현 라운드 분리**: 토론 라운드(코드 작성 금지)와 구현 라운드(max_rounds+1)를 명확히 분리하여 토론 중 의도치 않은 코드 변경 방지
3. **프롬프트 인젝션 방어**: `<user_task>` 태그로 사용자 입력 격리 + untrusted input 경고 명시
4. **디버그 로깅의 tee 방식**: 기존 logStreamer 파이프라인에 영향 없이 PassThrough 스트림으로 파일 기록을 분기
5. **인증 선택적 적용**: `AUTH_PASSWORD` 미설정 시 서버·클라이언트 양쪽에서 인증 흐름 완전 스킵 (Hecaton 사이드카 등 로컬 환경 대응)

---

## 2026-04-04 — Git 클라이언트 + 워크트리 샌드박싱

### 배경

Git 탭이 커밋 히스토리 그래프만 표시하는 읽기 전용 뷰였으나, 웹 UI에서 직접 Git 작업을 수행할 수 있는 완전한 클라이언트로 확장. 또한 CLI 도구가 `--dangerously-skip-permissions` 등 전체 파일시스템 접근 플래그를 사용하고 있어, 보안 강화를 위해 워크트리 디렉토리 내로 접근을 제한하는 샌드박스 모드를 도입.

### 주요 변경

#### 1. Git 액션 툴바 + 파일 상태 뷰 (`7891eac`)

Git 탭을 커밋 그래프 뷰어에서 완전한 Git 클라이언트로 확장.

- **서버**: `worktree-manager.ts`에 16개 Git 작업 메서드 추가 (stage, unstage, commit, pull, push, fetch, branch, checkout, merge, stash, discard, tag, diff 등)
- **서버**: `routes/projects.ts`에 대응하는 16개 REST 엔드포인트 추가
- **클라이언트 API**: `api/projects.ts`에 16개 Git 작업 함수 추가
- **클라이언트 UI**: 액션 툴바 (커밋/Pull/Push/패치/브랜치/병합/스태시/폐기/태그)
  - 각 작업별 모달 다이얼로그 (커밋 메시지 입력, 브랜치 생성/삭제, 태그 생성 등)
- **클라이언트 UI**: 좌측 사이드바에 파일 상태 패널 추가
  - Staged/Unstaged/Untracked 파일 분류 표시
  - 파일별 stage/unstage/discard 인라인 액션
- **i18n**: 한/영 35개 번역 키 추가
- **버그 수정**: 커밋 그래프 연결선 y2 좌표 클램핑 오류 수정

#### 2. CLI 도구 워크트리 디렉토리 샌드박싱 (`1537f56`)

프로젝트별 `sandbox_mode` 설정으로 CLI 도구의 파일 접근 범위를 제어.

- **Claude CLI**: strict 모드에서 워크트리에 `.claude/settings.json` 자동 생성 (dontAsk + 디렉토리 스코프 권한), `--dangerously-skip-permissions` 플래그 제거
- **Codex CLI**: strict 모드에서 `--full-auto` + `--add-dir .git`으로 워크스페이스 샌드박스 활성화 (git 메타데이터 접근은 허용)
- **Gemini CLI**: 네이티브 샌드박싱 미지원으로 프롬프트 수준 경로 제한만 적용
- **DB**: `projects` 테이블에 `sandbox_mode` 컬럼 추가 (`strict`/`permissive`, 기본값 `strict`)
- **UI**: 프로젝트 설정에 샌드박스 모드 토글 + 경고 다이얼로그 + 뱃지 표시

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/services/worktree-manager.ts` | 16개 Git 작업 메서드 추가 |
| `src/server/routes/projects.ts` | 16개 Git 작업 REST 엔드포인트 추가 |
| `src/server/services/cli-adapters.ts` | `SandboxMode` 타입 + CLI별 샌드박스 분기 로직 |
| `src/server/services/orchestrator.ts` | strict 모드 시 `.claude/settings.json` 생성 + 프롬프트 경로 제한 |
| `src/server/services/claude-manager.ts` | `projectPath`, `sandboxMode` 파라미터 전달 |
| `src/server/services/pipeline-orchestrator.ts` | 파이프라인에도 샌드박스 모드 적용 |
| `src/server/db/schema.ts` | `sandbox_mode` 컬럼 마이그레이션 |
| `src/server/db/queries.ts` | `Project` 인터페이스에 `sandbox_mode` 추가 |
| `src/client/src/components/GitStatusPanel.tsx` | 액션 툴바 + 파일 상태 사이드바 UI |
| `src/client/src/components/ProjectHeader.tsx` | 샌드박스 모드 토글 + 경고 다이얼로그 UI |
| `src/client/src/api/projects.ts` | Git 작업 API 함수 + `sandbox_mode` 필드 |
| `src/client/src/i18n.tsx` | 샌드박스 + Git 작업 번역 키 추가 |
| `src/client/src/types.ts` | `Project`에 `sandbox_mode` 필드 추가 |

### 아키텍처 결정

1. **기본값 strict**: 새 프로젝트는 기본적으로 strict 모드로 생성되어 보안 우선
2. **CLI별 네이티브 샌드박싱 활용**: 각 CLI의 자체 샌드박스 메커니즘을 활용하되, Gemini는 미지원이므로 프롬프트 수준 제한
3. **Git 메타데이터 허용**: Codex strict 모드에서 `--add-dir .git`으로 워크트리 외부의 git 메타데이터 접근 허용 (커밋/푸시에 필요)
4. **실패 허용**: settings.json 생성 실패 시 로그만 남기고 실행 계속

---

## 2026-04-03 — 플러그인 아키텍처 추출

### 배경

Jira, GitHub, Notion, gstack 통합이 코어 코드에 하드코딩되어 있어, 새 통합 추가 시 index.ts, ProjectDetail.tsx, ProjectHeader.tsx, schema.ts, queries.ts 등 다수의 파일을 수정해야 했음. 이를 자기완결적인 플러그인 모듈로 추출하여 확장성을 확보.

### 주요 변경

#### 1. 서버 플러그인 시스템

- **`src/server/plugins/types.ts`**: `PluginManifest`, `PluginHelpers`, `ExecutionContext` 인터페이스 정의
- **`src/server/plugins/registry.ts`**: `registerPlugin()`, `mountPluginRoutes()`, `getExecutionHookPlugins()` 레지스트리
- **플러그인 모듈**: `src/server/plugins/{jira,github,notion,gstack}/` — 각 플러그인이 자체 manifest + router 보유
- **2가지 카테고리**: `external-service` (REST 프록시 + 패널 탭) / `execution-hook` (오케스트레이터 실행 전 훅)
- **`src/server/routes/plugins.ts`**: 플러그인 설정 CRUD API (`GET/PUT /api/plugins/:id/config/:projectId`)

#### 2. DB 스키마

- **`plugin_configs` 테이블 추가**: 프로젝트×플러그인×키 단위 제네릭 key-value 저장소
- **자동 마이그레이션**: 서버 시작 시 기존 `projects` 테이블의 레거시 컬럼 → `plugin_configs`로 idempotent 복사
- **하위 호환**: 레거시 컬럼 유지, 저장 시 양쪽 동기화

#### 3. 오케스트레이터 제네릭 훅

- **기존**: `if (cliTool === 'claude' && project.gstack_enabled)` 하드코딩
- **변경**: `getExecutionHookPlugins()` 루프로 모든 execution-hook 플러그인의 `onBeforeExecution()` 호출
- 실패 시 로그만 남기고 실행 계속 (failure tolerance 유지)

#### 4. 클라이언트 플러그인 시스템

- **`src/client/src/plugins/`**: `ClientPluginManifest` 기반 레지스트리
- **동적 탭 렌더링**: `ProjectDetail.tsx`에서 하드코딩 3개 탭 → `getPluginsWithTabs(project).map(...)` 루프
- **동적 설정 UI**: `ProjectHeader.tsx`에서 하드코딩 ~23개 useState → `pluginConfigs` 단일 상태 + 플러그인 SettingsComponent 루프
- **i18n**: 각 플러그인이 자체 번역 키 보유

### 파일 구조

```
src/server/plugins/
├── types.ts, registry.ts
├── jira/    (index.ts, router.ts)
├── github/  (index.ts, router.ts)
├── notion/  (index.ts, router.ts)
└── gstack/  (index.ts — with onBeforeExecution hook)

src/client/src/plugins/
├── types.ts, registry.ts, init.ts
├── jira/    (index.ts, JiraSettings.tsx)
├── github/  (index.ts, GitHubSettings.tsx)
├── notion/  (index.ts, NotionSettings.tsx)
└── gstack/  (index.ts, GstackSettings.tsx)
```

### 검증

- 서버 TypeScript 컴파일: 통과
- 서버 빌드: 통과
- 서버 테스트 69개: 전체 통과
- 기존 API 경로 유지 (`/api/jira`, `/api/github`, `/api/notion`, `/api/gstack` — `routePrefix` 사용)

---

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
