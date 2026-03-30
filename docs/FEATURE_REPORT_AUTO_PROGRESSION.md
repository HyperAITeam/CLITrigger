# 자동 피쳐 진행 시스템 (Auto Feature Progression) 설계 보고서

> 작성일: 2026-03-30
> 대상 앱: CLITrigger

---

## 1. 개요

### 1.1 목표
사용자가 **중장기 피쳐 목표**를 등록하면, 시스템이 자동으로:
- 피쳐를 분석하여 할 일 목록(Todo)을 생성
- 우선순위에 따라 순차적/병렬적으로 실행
- 실행 결과를 평가하고 다음 단계를 결정
- 피쳐가 완성될 때까지 반복적으로 발전

### 1.2 핵심 가치
| 현재 | 제안 |
|------|------|
| 사용자가 Todo를 하나씩 수동 생성 | 피쳐 목표만 정의하면 Todo 자동 생성 |
| 수동으로 Start 클릭 | 완료 시 다음 단계 자동 진행 |
| 결과 확인 후 수동으로 다음 작업 판단 | AI가 결과를 평가하고 다음 작업을 결정 |
| Pipeline은 고정 5단계 | 피쳐별 동적 단계, 반복 가능 |

---

## 2. 현재 시스템 분석

### 2.1 활용 가능한 기존 인프라

| 기존 컴포넌트 | 재사용 방식 |
|--------------|------------|
| **Orchestrator** | Todo 실행/동시성 제어 그대로 사용 |
| **Worktree Manager** | 피쳐별 브랜치 격리 그대로 사용 |
| **Claude Manager** | CLI 프로세스 실행 그대로 사용 |
| **Pipeline Orchestrator** | 단계별 실행 패턴 참고 (확장 필요) |
| **Scheduler** | 주기적 진행 체크에 활용 |
| **WebSocket Broadcaster** | 실시간 진행 상태 알림 |
| **Log Streamer** | 실행 로그 기록 |

### 2.2 기존 시스템의 한계

1. **Pipeline은 고정 5단계** — 동적 단계 생성 불가
2. **Todo 간 의존성 없음** — 순서/선후관계 표현 불가
3. **결과 평가 루프 없음** — 완료 후 "다음에 뭘 할지" 판단하는 로직 없음
4. **피쳐 수준의 추상화 없음** — 프로젝트 > Todo 2단계 구조만 존재

---

## 3. 제안 아키텍처

### 3.1 새로운 계층 구조

```
Project (프로젝트)
  └── Feature (피쳐) ← 🆕 새로운 계층
        ├── Epic (에픽/마일스톤) ← 🆕
        │     ├── Todo (작업)      ← 기존 재사용
        │     ├── Todo
        │     └── Todo
        ├── Epic
        │     └── Todo ...
        └── Feature Progress Log  ← 🆕 진행 기록
```

### 3.2 핵심 컴포넌트

```
┌─────────────────────────────────────────────────────┐
│                   Feature Engine                     │
│                                                     │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────┐ │
│  │   Planner   │──▶│   Executor   │──▶│ Evaluator│ │
│  │ (계획 수립)  │   │ (작업 실행)   │   │ (결과 평가)│ │
│  └──────┬──────┘   └──────────────┘   └─────┬────┘ │
│         │                                    │      │
│         ◀────────────────────────────────────┘      │
│                   Feedback Loop                      │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │            Progress Tracker                  │    │
│  │  (진행률 추적, 마일스톤 관리, 히스토리 기록)    │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

---

## 4. 데이터 모델

### 4.1 새로운 테이블

```sql
-- 피쳐 정의
CREATE TABLE features (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,        -- 사용자가 작성한 피쳐 설명
  goal          TEXT,                 -- 완료 조건 (acceptance criteria)
  status        TEXT DEFAULT 'draft', -- draft/planning/active/paused/completed/archived
  priority      INTEGER DEFAULT 0,

  -- 진행 관리
  progress      INTEGER DEFAULT 0,   -- 0~100 진행률
  current_epic_id TEXT,              -- 현재 진행 중인 에픽
  iteration     INTEGER DEFAULT 0,   -- 몇 번째 반복인지

  -- 설정
  auto_advance  INTEGER DEFAULT 1,   -- 자동 진행 여부 (0/1)
  max_iterations INTEGER DEFAULT 10, -- 무한루프 방지
  cli_tool      TEXT DEFAULT 'claude',
  cli_model     TEXT,

  -- 타임스탬프
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at    DATETIME,
  completed_at  DATETIME,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 에픽 (마일스톤)
CREATE TABLE epics (
  id            TEXT PRIMARY KEY,
  feature_id    TEXT NOT NULL REFERENCES features(id),
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT DEFAULT 'pending', -- pending/active/completed/failed/skipped
  order_index   INTEGER NOT NULL,       -- 실행 순서

  -- AI가 생성한 메타데이터
  estimated_todos INTEGER,              -- 예상 Todo 수
  dependencies  TEXT,                   -- JSON: 선행 에픽 ID 배열

  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at  DATETIME
);

-- 피쳐 진행 로그 (AI의 판단 기록)
CREATE TABLE feature_logs (
  id            TEXT PRIMARY KEY,
  feature_id    TEXT NOT NULL REFERENCES features(id),
  log_type      TEXT NOT NULL, -- plan/evaluate/advance/pause/error/decision
  phase         TEXT,          -- planning/execution/evaluation
  message       TEXT NOT NULL,
  metadata      TEXT,          -- JSON: 추가 데이터 (생성된 todo 목록, 평가 점수 등)
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 4.2 기존 테이블 수정

```sql
-- todos 테이블에 추가
ALTER TABLE todos ADD COLUMN feature_id TEXT REFERENCES features(id);
ALTER TABLE todos ADD COLUMN epic_id TEXT REFERENCES epics(id);
ALTER TABLE todos ADD COLUMN depends_on TEXT; -- JSON: 선행 todo ID 배열
```

---

## 5. Feature Engine 상세 설계

### 5.1 Planner (계획 수립기)

피쳐 설명을 받아 실행 가능한 작업 목록을 생성합니다.

```typescript
// src/server/services/feature-engine/planner.ts

interface PlannerOutput {
  epics: {
    title: string;
    description: string;
    order: number;
    todos: {
      title: string;
      description: string;  // CLI에 전달할 프롬프트
      priority: number;
      depends_on?: string[]; // 다른 todo의 임시 ID
    }[];
  }[];
  estimated_progress_per_epic: number; // 에픽 하나 완료 시 진행률 증가분
}
```

**동작 방식:**
1. 피쳐 설명 + 프로젝트 코드베이스 컨텍스트를 Claude에 전달
2. Claude가 에픽/Todo 구조를 JSON으로 반환
3. Planner가 파싱하여 DB에 저장
4. 첫 번째 에픽의 Todo들을 pending 상태로 생성

**프롬프트 템플릿:**
```
당신은 소프트웨어 프로젝트 매니저입니다.
다음 피쳐를 구현하기 위한 작업 계획을 수립하세요.

## 피쳐
{feature.title}: {feature.description}

## 완료 조건
{feature.goal}

## 프로젝트 구조
{프로젝트 디렉토리 트리}

## 최근 변경사항
{git log --oneline -20}

다음 JSON 형식으로 응답하세요:
{schema}
```

### 5.2 Executor (실행기)

기존 Orchestrator를 확장하여 피쳐 컨텍스트를 주입합니다.

```typescript
// src/server/services/feature-engine/executor.ts

class FeatureExecutor {
  // 에픽 내 Todo 실행 - 기존 orchestrator 활용
  async executeEpic(epicId: string): Promise<void> {
    const epic = db.getEpic(epicId);
    const todos = db.getTodosByEpic(epicId);

    // 의존성이 해결된 Todo부터 실행
    const ready = todos.filter(t =>
      t.status === 'pending' &&
      this.dependenciesResolved(t)
    );

    for (const todo of ready) {
      // 피쳐 컨텍스트를 프롬프트에 주입
      const enrichedPrompt = this.buildPrompt(todo, epic);
      await orchestrator.startTodo(todo.id, enrichedPrompt);
    }
  }

  // Todo 완료 시 콜백 (기존 orchestrator의 onComplete 확장)
  async onTodoComplete(todoId: string): Promise<void> {
    const todo = db.getTodo(todoId);
    if (!todo.feature_id) return; // 일반 Todo면 패스

    // 같은 에픽의 다른 Todo 실행 가능한지 체크
    await this.executeEpic(todo.epic_id);

    // 에픽의 모든 Todo가 완료되었으면 → Evaluator로
    if (this.isEpicComplete(todo.epic_id)) {
      await evaluator.evaluate(todo.feature_id, todo.epic_id);
    }
  }
}
```

### 5.3 Evaluator (결과 평가기)

에픽 완료 후 결과를 평가하고 다음 행동을 결정합니다.

```typescript
// src/server/services/feature-engine/evaluator.ts

interface EvaluationResult {
  epic_success: boolean;         // 에픽 목표 달성 여부
  progress_delta: number;        // 진행률 변화 (0~100)
  issues: string[];              // 발견된 문제
  next_action:
    | { type: 'advance' }            // 다음 에픽으로 진행
    | { type: 'retry'; reason: string } // 현재 에픽 재시도
    | { type: 'replan'; reason: string } // 남은 계획 재수립
    | { type: 'pause'; reason: string }  // 사람 개입 필요
    | { type: 'complete' };           // 피쳐 완료
}
```

**평가 기준:**
1. 에픽 내 모든 Todo가 성공적으로 완료되었는가?
2. Git diff를 분석하여 의도한 변경이 이루어졌는가?
3. (선택) 테스트를 실행하여 기존 기능이 깨지지 않았는가?
4. 피쳐 전체 목표 대비 현재 진행 상태는?

**프롬프트 템플릿:**
```
당신은 코드 리뷰어이자 프로젝트 매니저입니다.
방금 완료된 작업의 결과를 평가하세요.

## 피쳐 목표
{feature.title}: {feature.description}
완료 조건: {feature.goal}

## 완료된 에픽
{epic.title}: {epic.description}

## 실행된 작업들
{각 Todo의 제목, 상태, 커밋 목록, diff 요약}

## 남은 에픽들
{remaining epics}

## 현재 진행률: {feature.progress}%

다음을 판단하세요:
1. 이 에픽의 목표가 달성되었는가?
2. 다음 단계로 진행해도 되는가?
3. 수정이 필요한 부분이 있는가?

JSON으로 응답: {schema}
```

### 5.4 Feedback Loop (순환 루프)

```
                    ┌──────────────┐
                    │  Feature 등록 │
                    └──────┬───────┘
                           ▼
                 ┌─────────────────┐
            ┌───▶│    Planner      │
            │    │  (계획 수립)     │
            │    └────────┬────────┘
            │             ▼
            │    ┌─────────────────┐
            │    │   Executor      │
   replan   │    │  (Todo 실행)    │
            │    └────────┬────────┘
            │             ▼
            │    ┌─────────────────┐
            │    │   Evaluator     │◀─── retry (에픽 재실행)
            │    │  (결과 평가)     │
            │    └────────┬────────┘
            │             │
            │    ┌────────┴────────────────┐
            │    │         │               │
            │  advance   pause          complete
            │    │         │               │
            └────┘    사용자 개입      ┌────┴────┐
                    필요 알림        │ 피쳐 완료 │
                                    │  머지 제안 │
                                    └──────────┘
```

---

## 6. API 설계

### 6.1 REST 엔드포인트

```
# 피쳐 CRUD
POST   /api/projects/:id/features          피쳐 생성
GET    /api/projects/:id/features          피쳐 목록
GET    /api/features/:id                   피쳐 상세 (에픽/Todo 포함)
PUT    /api/features/:id                   피쳐 수정
DELETE /api/features/:id                   피쳐 삭제

# 피쳐 실행 제어
POST   /api/features/:id/start             계획 수립 → 자동 실행 시작
POST   /api/features/:id/pause             일시 정지
POST   /api/features/:id/resume            재개
POST   /api/features/:id/stop              중지 (모든 실행 중 Todo 중지)

# 피쳐 진행 관리
POST   /api/features/:id/replan            남은 작업 재계획
POST   /api/features/:id/advance           수동으로 다음 에픽 진행
GET    /api/features/:id/progress          진행 상태 상세
GET    /api/features/:id/logs              AI 판단 기록

# 에픽 관리
PUT    /api/epics/:id                      에픽 수정
POST   /api/epics/:id/skip                 에픽 건너뛰기
POST   /api/epics/:id/retry                에픽 재시도
```

### 6.2 WebSocket 이벤트

```typescript
// 기존 이벤트에 추가
| { type: 'feature:status-changed'; featureId; status; progress }
| { type: 'feature:epic-changed'; featureId; epicId; status }
| { type: 'feature:plan-created'; featureId; epicCount; todoCount }
| { type: 'feature:evaluation'; featureId; result: EvaluationResult }
| { type: 'feature:needs-attention'; featureId; reason: string }
```

---

## 7. UI 설계

### 7.1 새로운 화면

#### Feature Board (피쳐 보드)

```
┌─────────────────────────────────────────────────────────────┐
│  🎯 Features                                    [+ New Feature] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─ Active ────────────────────────────────────────────┐   │
│  │                                                      │   │
│  │  ┌──────────────────────────────────────────────┐   │   │
│  │  │ 🔄 사용자 인증 시스템 리팩토링                    │   │   │
│  │  │ ████████████░░░░░░░░ 62%                     │   │   │
│  │  │ Epic 3/5 진행 중 · Todo 12/20 완료             │   │   │
│  │  │ 마지막 활동: 2분 전                             │   │   │
│  │  │                          [Pause] [View]       │   │   │
│  │  └──────────────────────────────────────────────┘   │   │
│  │                                                      │   │
│  │  ┌──────────────────────────────────────────────┐   │   │
│  │  │ ⏸ API 버전 2.0 마이그레이션                      │   │   │
│  │  │ ████░░░░░░░░░░░░░░░░ 20%                     │   │   │
│  │  │ 사용자 확인 필요: 테스트 실패 3건                 │   │   │
│  │  │                         [Resume] [View]       │   │   │
│  │  └──────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ Draft ─────────────────────────────────────────────┐   │
│  │  다크모드 지원 · 모바일 반응형 개선                      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

#### Feature Detail (피쳐 상세)

```
┌─────────────────────────────────────────────────────────────┐
│  ← Back   사용자 인증 시스템 리팩토링              [Pause] [Stop] │
│  ████████████░░░░░░░░ 62%   Iteration 2                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Timeline                                                   │
│  ─────────────────────────────────────────────────────      │
│  ✅ Epic 1: 기존 인증 코드 분석              (Todo 3/3)      │
│  ✅ Epic 2: JWT 토큰 시스템 구현             (Todo 4/4)      │
│  🔄 Epic 3: 미들웨어 교체                    (Todo 2/5)      │
│     ├── ✅ auth middleware 인터페이스 정의                     │
│     ├── ✅ JWT 검증 미들웨어 구현                             │
│     ├── 🔄 기존 세션 기반 라우트 마이그레이션  ← running       │
│     ├── ⏳ 에러 핸들링 통합                                   │
│     └── ⏳ 인증 테스트 작성                                   │
│  ⏳ Epic 4: 리프레시 토큰 구현               (Todo 0/3)      │
│  ⏳ Epic 5: 문서화 및 정리                   (Todo 0/2)      │
│                                                             │
│  ┌─ AI Decision Log ──────────────────────────────────┐    │
│  │ 14:32 [evaluate] Epic 2 완료. JWT 구현 확인됨.       │    │
│  │       테스트 통과. 다음 에픽으로 진행.                  │    │
│  │ 14:30 [execute] Todo "JWT 검증 로직" 완료 (3 commits) │    │
│  │ 13:15 [replan] Epic 3 Todo 수정: 마이그레이션 단계     │    │
│  │       세분화 (3개 → 5개)                              │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. 구현 계획

### Phase 1: 데이터 모델 + API 기반 (1주)

| 작업 | 파일 | 설명 |
|------|------|------|
| DB 스키마 추가 | `src/server/db/schema.ts` | features, epics, feature_logs 테이블 |
| DB 쿼리 추가 | `src/server/db/queries.ts` | CRUD 쿼리 함수 |
| todos 테이블 수정 | `src/server/db/schema.ts` | feature_id, epic_id, depends_on 컬럼 |
| Feature 라우트 | `src/server/routes/features.ts` | REST API 엔드포인트 |
| 타입 정의 | `src/client/src/types.ts` | Feature, Epic 인터페이스 |
| API 클라이언트 | `src/client/src/api/features.ts` | API 호출 함수 |

### Phase 2: Feature Engine 핵심 (1~2주)

| 작업 | 파일 | 설명 |
|------|------|------|
| Planner | `src/server/services/feature-engine/planner.ts` | 피쳐 → 에픽/Todo 계획 수립 |
| Executor | `src/server/services/feature-engine/executor.ts` | 의존성 기반 Todo 실행 |
| Evaluator | `src/server/services/feature-engine/evaluator.ts` | 결과 평가 + 다음 행동 결정 |
| Feature Engine | `src/server/services/feature-engine/index.ts` | 루프 오케스트레이션 |
| Orchestrator 확장 | `src/server/services/orchestrator.ts` | onComplete 콜백에 Feature 연동 |
| WebSocket 이벤트 | `src/server/websocket/events.ts` | feature 관련 이벤트 추가 |

### Phase 3: UI (1주)

| 작업 | 파일 | 설명 |
|------|------|------|
| Feature Board | `src/client/src/pages/FeatureBoard.tsx` | 피쳐 목록/관리 |
| Feature Detail | `src/client/src/pages/FeatureDetail.tsx` | 에픽/Todo 타임라인 |
| Feature Form | `src/client/src/components/FeatureForm.tsx` | 피쳐 생성/수정 폼 |
| Progress Bar | `src/client/src/components/FeatureProgress.tsx` | 진행률 시각화 |
| Decision Log | `src/client/src/components/DecisionLog.tsx` | AI 판단 기록 뷰 |
| 라우팅 | `src/client/src/App.tsx` | 새 페이지 라우트 추가 |
| i18n | `src/client/src/i18n.tsx` | 한/영 번역 키 |

### Phase 4: 고도화 (1주)

| 작업 | 설명 |
|------|------|
| 테스트 자동 실행 | 에픽 완료 후 `npm test` 실행하여 평가에 반영 |
| 스케줄 연동 | 피쳐를 특정 시간대에만 진행하도록 설정 |
| 알림 시스템 | 사용자 개입 필요 시 알림 (WebSocket + 소리) |
| 브랜치 전략 | 피쳐 브랜치에서 에픽 브랜치 분기 후 머지 |
| Jira 연동 | 외부 이슈 트래커와 양방향 동기화 |

---

## 9. 안전장치

자동 진행 시스템의 **무한루프/폭주 방지**가 핵심입니다.

### 9.1 제한 장치

| 장치 | 설명 | 기본값 |
|------|------|--------|
| `max_iterations` | 피쳐 전체 반복 횟수 제한 | 10회 |
| `max_todos_per_epic` | 에픽당 최대 Todo 수 | 10개 |
| `max_retries_per_epic` | 에픽 재시도 횟수 | 3회 |
| `auto_pause_on_failure` | 연속 실패 시 자동 일시정지 | 3회 연속 실패 |
| `evaluation_timeout` | 평가 단계 타임아웃 | 5분 |
| `require_approval` | 특정 단계에서 사용자 승인 필요 | replan 시 |

### 9.2 사용자 개입 트리거

다음 상황에서 자동 진행을 멈추고 사용자에게 알립니다:

- 에픽이 3회 이상 재시도될 때
- Evaluator가 `pause` 판정을 내릴 때
- 피쳐 진행률이 3회 반복 후에도 변화 없을 때
- Todo 실행 중 머지 충돌이 발생할 때
- max_iterations에 도달했을 때

### 9.3 Dry-run 모드

처음에는 Planner가 계획만 생성하고, 사용자가 검토 후 승인하면 실행하는 모드를 기본값으로 합니다.

```
[Draft] → 사용자 "Start" → [Planning] → 계획 생성 → 사용자 "Approve" → [Active]
```

---

## 10. 기존 코드 수정 영향 분석

### 영향도: 낮음~중간

대부분 **새 파일 추가**이며, 기존 코드 수정은 최소화됩니다.

| 기존 파일 | 수정 내용 | 영향도 |
|-----------|----------|--------|
| `src/server/db/schema.ts` | 테이블 3개 추가, todos에 컬럼 3개 추가 | 낮음 |
| `src/server/db/queries.ts` | Feature/Epic CRUD 쿼리 추가 | 낮음 |
| `src/server/services/orchestrator.ts` | `onTodoComplete`에 Feature 체크 추가 | 중간 |
| `src/server/index.ts` | featureRouter 마운트 | 낮음 |
| `src/server/websocket/events.ts` | 이벤트 타입 추가 | 낮음 |
| `src/client/src/types.ts` | Feature, Epic 타입 추가 | 낮음 |
| `src/client/src/App.tsx` | 라우트 추가 | 낮음 |
| `src/client/src/i18n.tsx` | 번역 키 추가 | 낮음 |

**기존 Todo/Pipeline 기능에 영향 없음** — Feature는 별도 엔진으로 동작하며, 기존 Todo가 feature_id 없이 동작하는 경로는 그대로 유지됩니다.

---

## 11. 향후 확장 가능성

1. **멀티 프로젝트 피쳐** — 하나의 피쳐가 여러 프로젝트에 걸쳐 진행
2. **피쳐 템플릿** — 반복적인 피쳐 유형을 템플릿으로 저장 (예: "API 엔드포인트 추가")
3. **Jira/Linear 연동** — 외부 이슈 트래커의 에픽과 양방향 동기화
4. **코드 리뷰 단계** — 에픽 완료 후 자동 PR 생성 + 리뷰 요청
5. **학습 피드백** — 과거 피쳐의 계획/실행 데이터를 기반으로 점점 더 정확한 계획 수립
6. **비용 추적** — 피쳐당 API 토큰 사용량 추적

---

## 12. 요약

| 항목 | 내용 |
|------|------|
| **새 테이블** | 3개 (features, epics, feature_logs) |
| **새 서비스** | 4개 (planner, executor, evaluator, feature-engine) |
| **새 API** | ~15개 엔드포인트 |
| **새 UI 페이지** | 2개 (Board, Detail) + 컴포넌트 3개 |
| **기존 코드 수정** | 8개 파일 (대부분 추가만) |
| **예상 개발 기간** | Phase 1~3: 3~4주, Phase 4: +1주 |
| **핵심 리스크** | AI 평가 정확도, 무한루프 방지, 비용 |
