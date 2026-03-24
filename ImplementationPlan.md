# CLITrigger 상세 구현 계획

## 프로젝트 개요

로컬 컴퓨터의 특정 프로젝트 폴더에 대해 TODO 리스트를 작성하고, 원격에서 Start 버튼을 누르면 각 TODO 항목마다 독립적인 git worktree + Claude CLI 인스턴스가 실행되어 자동으로 작업/커밋하는 시스템.

---

## 아키텍처 구성

```
[외부: 폰/노트북/PC 브라우저]
        ↓ HTTPS
[Cloudflare Tunnel]  ←── cloudflared (로컬 데몬)
        ↓ localhost:3000
[Backend API Server (Express)] <--WS--> [Web UI (React)]
        |
        ├──→ [SQLite DB] (TODO/로그 저장)
        └──→ [Local Agent Engine]
                  ├── Git Worktree Manager (simple-git)
                  └── Claude CLI 프로세스 관리 (child_process)
```

### 기술 스택

| 구성요소 | 기술 | 선택 이유 |
|---------|------|----------|
| Backend | Node.js + TypeScript | Claude CLI와 동일 런타임, child_process 관리 용이 |
| API | Express.js | 경량, 빠른 구현 |
| 실시간 통신 | WebSocket (ws) | 작업 상태 실시간 전달 |
| DB | SQLite (better-sqlite3) | 로컬 설치 무의존, 파일 기반 |
| Frontend | React + Vite | 빠른 개발, SPA |
| 프로세스 관리 | Node child_process | Claude CLI 실행/종료 제어 |
| Git 관리 | simple-git | git worktree 생성/삭제 자동화 |
| 외부 접속 | Cloudflare Tunnel (cloudflared) | 무료, 별도 서버 불필요, HTTPS 자동 |
| 인증 | 세션 기반 비밀번호 인증 | 외부 노출 시 무단 접근 방지 |

---

## 단계별 구현 계획

---

### Phase 1: 프로젝트 초기 설정

#### 1-1. 프로젝트 구조 생성

```
CLITrigger/
├── package.json
├── tsconfig.json
├── .gitignore
├── .env.example
├── src/
│   ├── server/           # Backend
│   │   ├── index.ts      # 서버 엔트리포인트
│   │   ├── routes/       # API 라우트
│   │   ├── services/     # 비즈니스 로직
│   │   ├── middleware/    # 인증 미들웨어
│   │   ├── db/           # DB 스키마 & 쿼리
│   │   └── websocket/    # WS 핸들러
│   └── client/           # Frontend (Vite + React)
│       ├── index.html
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   ├── hooks/
│       │   └── api/
│       └── vite.config.ts
├── Plan.md
└── ImplementationPlan.md
```

#### 1-2. 작업 내용

1. `npm init` 및 `package.json` 설정 (workspaces: `src/server`, `src/client`)
2. TypeScript 설정 (`tsconfig.json` - server/client 각각)
3. `.gitignore` 작성 (node_modules, dist, .env, *.db)
4. ESLint + Prettier 기본 설정
5. 의존성 설치:
   - **Server**: `express`, `ws`, `better-sqlite3`, `simple-git`, `dotenv`, `cors`, `uuid`
   - **Client**: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`
   - **Dev**: `typescript`, `tsx`, `@types/*`, `concurrently`

---

### Phase 2: 데이터베이스 설계 및 구현

#### 2-1. DB 스키마

```sql
-- 프로젝트 (로컬 폴더 단위)
CREATE TABLE projects (
  id            TEXT PRIMARY KEY,    -- UUID
  name          TEXT NOT NULL,
  path          TEXT NOT NULL UNIQUE, -- 로컬 프로젝트 폴더 경로
  default_branch TEXT DEFAULT 'main',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- TODO 리스트 (피쳐 단위)
CREATE TABLE todos (
  id            TEXT PRIMARY KEY,    -- UUID
  project_id    TEXT NOT NULL REFERENCES projects(id),
  title         TEXT NOT NULL,       -- 피쳐 이름 (브랜치명으로도 사용)
  description   TEXT,                -- 세부 작업 설명 (Claude에게 전달할 프롬프트)
  status        TEXT DEFAULT 'pending',  -- pending | running | completed | failed | stopped
  priority      INTEGER DEFAULT 0,
  branch_name   TEXT,                -- 자동 생성될 브랜치명
  worktree_path TEXT,                -- worktree 경로
  process_pid   INTEGER,             -- Claude CLI 프로세스 PID
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 작업 로그
CREATE TABLE task_logs (
  id            TEXT PRIMARY KEY,
  todo_id       TEXT NOT NULL REFERENCES todos(id),
  log_type      TEXT NOT NULL,       -- info | error | output | commit
  message       TEXT NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### 2-2. 작업 내용

1. `src/server/db/schema.ts` - 테이블 생성 마이그레이션
2. `src/server/db/connection.ts` - SQLite 연결 싱글톤
3. `src/server/db/queries.ts` - CRUD 쿼리 함수들

---

### Phase 3: Backend API 서버 구현

#### 3-1. REST API 엔드포인트

```
# 프로젝트 관리
POST   /api/projects              - 프로젝트 등록 (로컬 폴더 경로 지정)
GET    /api/projects              - 프로젝트 목록
GET    /api/projects/:id          - 프로젝트 상세
DELETE /api/projects/:id          - 프로젝트 삭제

# TODO 관리
POST   /api/projects/:id/todos    - TODO 추가
GET    /api/projects/:id/todos    - TODO 목록
PUT    /api/todos/:id             - TODO 수정
DELETE /api/todos/:id             - TODO 삭제
PATCH  /api/todos/:id/reorder     - TODO 순서 변경

# 실행 제어
POST   /api/projects/:id/start    - 전체 TODO 실행 시작 (★ 핵심)
POST   /api/projects/:id/stop     - 전체 TODO 실행 중지 (★ 핵심)
POST   /api/todos/:id/start       - 개별 TODO 실행
POST   /api/todos/:id/stop        - 개별 TODO 중지

# 로그/상태
GET    /api/todos/:id/logs        - 작업 로그 조회
GET    /api/projects/:id/status   - 프로젝트 전체 상태
```

#### 3-2. 작업 내용

1. `src/server/index.ts` - Express 서버 부트스트랩 (포트, 미들웨어, 라우트 등록)
2. `src/server/routes/projects.ts` - 프로젝트 CRUD 라우트
3. `src/server/routes/todos.ts` - TODO CRUD 라우트
4. `src/server/routes/execution.ts` - Start/Stop 실행 제어 라우트
5. `src/server/routes/logs.ts` - 로그 조회 라우트

---

### Phase 4: 핵심 엔진 - Worktree + Claude CLI 관리 (★ 가장 중요)

#### 4-1. Git Worktree 매니저

```typescript
// src/server/services/worktree-manager.ts
class WorktreeManager {
  // 프로젝트 경로 기반으로 worktree 생성
  async createWorktree(projectPath: string, branchName: string): Promise<string>

  // worktree 삭제 및 정리
  async removeWorktree(worktreePath: string): Promise<void>

  // 해당 프로젝트의 모든 worktree 목록
  async listWorktrees(projectPath: string): Promise<WorktreeInfo[]>
}
```

**동작 흐름:**
1. TODO의 title을 기반으로 브랜치명 생성 (예: `feature/todo-로그인-기능-추가`)
2. `git worktree add ../worktrees/<branch-name> -b <branch-name>` 실행
3. worktree 경로를 DB에 저장
4. 작업 완료/중지 시 worktree 정리 (선택적 - 결과 확인 후 삭제)

#### 4-2. Claude CLI 프로세스 매니저

```typescript
// src/server/services/claude-manager.ts
class ClaudeManager {
  // Claude CLI 프로세스 시작
  async startClaude(todo: Todo, worktreePath: string): Promise<ChildProcess>

  // Claude CLI 프로세스 중지
  async stopClaude(pid: number): Promise<void>

  // 실행 중인 프로세스 상태 확인
  async getProcessStatus(pid: number): Promise<ProcessStatus>
}
```

**Claude CLI 실행 방식:**
```bash
# 각 worktree 디렉토리에서 Claude CLI를 headless 모드로 실행
cd <worktree-path>
claude --dangerously-skip-permissions -p "다음 작업을 수행하세요: <TODO 세부설명>. 작업이 완료되면 변경사항을 커밋하세요."
```

**핵심 고려사항:**
- `child_process.spawn()` 으로 프로세스 생성, stdio를 파이프로 연결
- stdout/stderr를 task_logs 테이블에 실시간 기록
- 프로세스 종료 이벤트 감지 → DB 상태 업데이트 (completed / failed)
- 동시 실행 수 제한 옵션 (CPU/메모리 고려, 기본값: 3개)

#### 4-3. 오케스트레이터 (실행 흐름 총괄)

```typescript
// src/server/services/orchestrator.ts
class Orchestrator {
  // 프로젝트의 모든 pending TODO를 병렬 실행
  async startProject(projectId: string): Promise<void> {
    // 1. pending 상태 TODO 목록 조회
    // 2. 각 TODO에 대해:
    //    a. worktree 생성
    //    b. Claude CLI 프로세스 시작
    //    c. DB 상태 업데이트 (running)
    //    d. 로그 스트리밍 시작
    // 3. 동시실행 수 제한 적용 (큐잉)
  }

  // 프로젝트의 모든 실행 중인 작업 중지
  async stopProject(projectId: string): Promise<void> {
    // 1. running 상태 TODO 목록 조회
    // 2. 각 TODO에 대해:
    //    a. Claude CLI 프로세스 종료 (SIGTERM → SIGKILL)
    //    b. DB 상태 업데이트 (stopped)
    //    c. worktree는 유지 (결과 확인용)
  }
}
```

#### 4-4. 작업 내용

1. `src/server/services/worktree-manager.ts` - git worktree CRUD
2. `src/server/services/claude-manager.ts` - Claude CLI 프로세스 생명주기 관리
3. `src/server/services/orchestrator.ts` - 전체 실행 흐름 오케스트레이션
4. `src/server/services/log-streamer.ts` - 프로세스 출력 실시간 수집 및 DB 저장

---

### Phase 5: WebSocket 실시간 통신

#### 5-1. 이벤트 설계

```typescript
// Server → Client 이벤트
type WSEvent =
  | { type: 'todo:status-changed'; todoId: string; status: string }
  | { type: 'todo:log'; todoId: string; message: string; logType: string }
  | { type: 'project:status-changed'; projectId: string; running: number; completed: number }
  | { type: 'todo:commit'; todoId: string; commitHash: string; message: string }
```

#### 5-2. 작업 내용

1. `src/server/websocket/index.ts` - WS 서버 설정 (Express 서버에 attach)
2. `src/server/websocket/events.ts` - 이벤트 타입 정의
3. `src/server/websocket/broadcaster.ts` - 이벤트 브로드캐스터 (서비스 레이어에서 호출)

---

### Phase 6: Frontend 구현

#### 6-1. 페이지 구성

```
/ (메인)
├── 프로젝트 목록 (카드 형태)
├── + 새 프로젝트 등록

/projects/:id (프로젝트 상세)
├── 프로젝트 정보 (이름, 경로)
├── [▶ START ALL] [■ STOP ALL] 버튼
├── TODO 리스트
│   ├── TODO 항목 1 - [상태 뱃지] [▶] [■] [✎] [🗑]
│   │   └── 펼치면: 세부 설명, 로그 실시간 출력
│   ├── TODO 항목 2 - ...
│   └── + TODO 추가
└── 전체 진행 상황 프로그레스 바
```

#### 6-2. 컴포넌트 구조

```
App.tsx
├── ProjectList.tsx          - 프로젝트 목록
├── ProjectDetail.tsx        - 프로젝트 상세 페이지
│   ├── ProjectHeader.tsx    - 이름, 경로, START/STOP 버튼
│   ├── TodoList.tsx         - TODO 목록
│   │   ├── TodoItem.tsx     - 개별 TODO 항목
│   │   └── TodoForm.tsx     - TODO 추가/수정 폼
│   ├── LogViewer.tsx        - 실시간 로그 뷰어
│   └── ProgressBar.tsx      - 전체 진행률
├── ProjectForm.tsx          - 프로젝트 등록 모달
└── StatusBadge.tsx          - 상태 표시 뱃지 (pending/running/completed/failed/stopped)
```

#### 6-3. 작업 내용

1. Vite + React 프로젝트 초기화 (`src/client/`)
2. API 클라이언트 모듈 (`src/client/src/api/`) - fetch wrapper
3. WebSocket 훅 (`src/client/src/hooks/useWebSocket.ts`) - 실시간 이벤트 수신
4. 각 컴포넌트 구현 (위 목록 순서대로)
5. 기본 CSS/스타일링 (Tailwind CSS 사용)

---

### Phase 7: Cloudflare Tunnel 외부 접속 및 인증

#### 7-1. Cloudflare Tunnel 연동

**사전 요구사항:**
- `cloudflared` 설치 (`winget install cloudflare.cloudflared`)
- Cloudflare 계정 로그인 (`cloudflared tunnel login`)

**동작 방식:**
```
[외부 브라우저] → https://trigger.yourdomain.com → [Cloudflare Edge] → [cloudflared 데몬] → localhost:3000
```

**두 가지 모드 지원:**

1. **Quick 모드** (도메인 없이 바로 사용):
   ```bash
   cloudflared tunnel --url http://localhost:3000
   # → https://xxxx-xxxx.trycloudflare.com 임시 URL 자동 생성
   ```

2. **Named Tunnel 모드** (커스텀 도메인 연결):
   ```bash
   cloudflared tunnel create clitrigger
   cloudflared tunnel route dns clitrigger trigger.yourdomain.com
   cloudflared tunnel run clitrigger
   ```

#### 7-2. 인증 시스템 (외부 접속 보안)

Cloudflare Tunnel로 외부에 노출되므로 **비밀번호 인증 필수**.

```typescript
// src/server/middleware/auth.ts

// 1. 환경변수로 비밀번호 설정
//    .env: AUTH_PASSWORD=my-secret-password

// 2. 로그인 API
//    POST /api/auth/login  { password: string } → 세션 쿠키 발급
//    POST /api/auth/logout → 세션 쿠키 삭제

// 3. 인증 미들웨어
//    - /api/auth/* 제외한 모든 API 요청에 세션 검증
//    - 미인증 시 401 반환 → 프론트엔드에서 로그인 페이지로 리다이렉트
```

**프론트엔드 로그인 페이지:**
- 비밀번호 입력 필드 1개 + 로그인 버튼
- 로그인 성공 시 메인 페이지로 이동
- 세션 만료 시 자동 로그인 페이지 리다이렉트

#### 7-3. 터널 자동 실행 설정

```typescript
// src/server/services/tunnel-manager.ts
class TunnelManager {
  // cloudflared 프로세스 시작 (서버 부팅 시 자동)
  async startTunnel(): Promise<string>  // 생성된 URL 반환

  // cloudflared 프로세스 중지
  async stopTunnel(): Promise<void>

  // 현재 터널 상태/URL 조회
  getTunnelStatus(): TunnelStatus
}
```

**서버 시작 시 자동 흐름:**
1. Express 서버 시작 (localhost:3000)
2. `.env`에 `TUNNEL_ENABLED=true` 설정 시 → cloudflared 자동 실행
3. 생성된 외부 URL을 콘솔에 출력 + DB에 저장
4. 프론트엔드 상단에 현재 외부 접속 URL 표시

#### 7-4. 작업 내용

1. `src/server/middleware/auth.ts` - 비밀번호 인증 미들웨어
2. `src/server/routes/auth.ts` - 로그인/로그아웃 API
3. `src/server/services/tunnel-manager.ts` - cloudflared 프로세스 관리
4. `src/client/src/components/LoginPage.tsx` - 로그인 UI
5. `src/client/src/hooks/useAuth.ts` - 인증 상태 관리 훅
6. `.env.example` 업데이트: `AUTH_PASSWORD`, `TUNNEL_ENABLED`, `TUNNEL_NAME` 추가
7. `package.json`에 스크립트 추가: `npm run start:tunnel` (서버 + 터널 동시 실행)

#### 7-5. WebSocket 인증

```typescript
// WebSocket 연결 시에도 세션 쿠키 검증
// 미인증 WS 연결 시도 → 즉시 close(4401, 'Unauthorized')
```

---

### Phase 8: 통합 테스트 및 안정화

#### 8-1. 작업 내용

1. 전체 흐름 E2E 테스트:
   - 프로젝트 등록 → TODO 작성 → Start → 작업 진행 확인 → Stop → 결과 확인
   - 외부 접속 테스트: Cloudflare Tunnel 경유 → 로그인 → Start/Stop → 실시간 로그 수신
2. 예외 처리 강화:
   - Claude CLI가 비정상 종료될 경우 복구
   - git worktree 충돌 처리
   - 동일 프로젝트 중복 Start 방지
   - cloudflared 프로세스 비정상 종료 시 자동 재시작
3. 프로세스 좀비화 방지:
   - 서버 재시작 시 기존 프로세스 정리 (Claude CLI + cloudflared)
   - 주기적 health check
4. 로그 정리:
   - 오래된 로그 자동 삭제 (설정 가능)

---

### Phase 9: 편의 기능 추가

#### 9-1. 작업 내용

1. 작업 완료된 worktree의 diff 요약 보기
2. 완료된 TODO의 변경사항을 메인 브랜치로 merge하는 버튼
3. TODO 템플릿 기능 (자주 쓰는 작업 패턴 저장)
4. 동시 실행 수 설정 UI
5. Claude CLI에 전달할 추가 옵션 설정 (모델 선택, 컨텍스트 파일 지정 등)

---

## 구현 순서 요약

| 순서 | Phase | 예상 난이도 | 의존성 |
|------|-------|-----------|--------|
| 1 | Phase 1: 프로젝트 초기 설정 | ★☆☆ | 없음 |
| 2 | Phase 2: DB 설계 및 구현 | ★☆☆ | Phase 1 |
| 3 | Phase 3: Backend API | ★★☆ | Phase 2 |
| 4 | Phase 4: 핵심 엔진 (Worktree + Claude CLI) | ★★★ | Phase 3 |
| 5 | Phase 5: WebSocket | ★★☆ | Phase 4 |
| 6 | Phase 6: Frontend | ★★☆ | Phase 3, 5 |
| 7 | Phase 7: Cloudflare Tunnel + 인증 | ★★☆ | Phase 6 |
| 8 | Phase 8: 통합 테스트 및 안정화 | ★★☆ | Phase 7 |
| 9 | Phase 9: 편의 기능 | ★★☆ | Phase 8 |

---

## 핵심 리스크 및 대응

| 리스크 | 대응 방안 |
|--------|----------|
| Claude CLI 동시 실행 시 리소스 과부하 | 동시 실행 수 제한 (concurrency limit), 큐 기반 순차 실행 옵션 |
| Claude CLI가 무한 루프에 빠질 경우 | 타임아웃 설정 (기본 30분), 강제 종료 로직 |
| Git worktree 간 충돌 | 각 TODO를 독립 브랜치로 분리, 같은 파일 수정 시 경고 |
| 서버 비정상 종료 시 고아 프로세스 | 서버 시작 시 PID 기반 프로세스 정리 루틴 |
| Claude CLI 인증/API 키 문제 | 서버 시작 시 `claude --version` 으로 사전 검증 |
| Cloudflare Tunnel 연결 끊김 | cloudflared 프로세스 health check, 자동 재시작 로직 |
| 외부 무단 접근 | 비밀번호 인증 필수, 세션 기반 쿠키, WS 연결도 인증 검증 |
| cloudflared 미설치 상태 | 서버 시작 시 설치 여부 확인, 미설치 시 안내 메시지 출력 (로컬 모드로 fallback) |
