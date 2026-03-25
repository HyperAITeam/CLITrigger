# CLITrigger 테스트 가이드

## 개요

CLITrigger 프로젝트는 **Vitest**를 테스트 프레임워크로 사용합니다.
백엔드(Node.js/Express)와 프론트엔드(React)를 각각 독립적으로 테스트할 수 있도록 구성되어 있습니다.

- **백엔드 테스트**: 73개 중 52개 (DB 쿼리, 서비스 로직, 미들웨어, WebSocket)
- **프론트엔드 테스트**: 73개 중 21개 (API 클라이언트, 컴포넌트 렌더링, 사용자 인터랙션)

---

## 빠른 시작

### 전체 테스트 실행
```bash
npm test
```

### 백엔드 테스트만
```bash
npm run test:server
```

### 프론트엔드 테스트만
```bash
npm run test:client
```

### Watch 모드 (백엔드, 파일 변경 시 자동 재실행)
```bash
npm run test:watch
```

### 커버리지 리포트
```bash
npm run test:coverage
```

---

## 테스트 구조

```
src/
├── server/
│   ├── db/__tests__/
│   │   └── queries.test.ts          # DB CRUD 테스트 (in-memory SQLite)
│   ├── services/__tests__/
│   │   ├── worktree-manager.test.ts  # 브랜치명 생성 로직
│   │   ├── claude-manager.test.ts    # 프로세스 관리 로직
│   │   └── log-streamer.test.ts      # 로그 스트리밍/파싱
│   ├── middleware/__tests__/
│   │   └── auth.test.ts              # 인증 미들웨어
│   └── websocket/__tests__/
│       └── broadcaster.test.ts       # WebSocket 브로드캐스트
│
└── client/src/__tests__/
    ├── setup.ts                      # 테스트 환경 설정
    ├── api/
    │   └── client.test.ts            # HTTP 클라이언트 (fetch mock)
    └── components/
        ├── StatusBadge.test.tsx       # 상태 뱃지 렌더링
        └── LoginPage.test.tsx         # 로그인 폼 인터랙션
```

---

## 설정 파일

### 백엔드: `vitest.config.ts` (프로젝트 루트)
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/server/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/server/**/*.ts'],
      exclude: ['src/server/**/*.test.ts', 'src/server/types/**'],
    },
  },
});
```

### 프론트엔드: `src/client/vitest.config.ts`
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/__tests__/**', 'src/main.tsx'],
    },
  },
});
```

---

## 상세 구현 설명

### 1. 백엔드 DB 테스트 (`queries.test.ts`)

**핵심 전략: In-Memory SQLite**

실제 파일 기반 DB 대신 `better-sqlite3`의 `:memory:` 모드를 사용하여 테스트합니다.
`vi.mock`으로 `connection.js` 모듈을 가로채서, `getDatabase()`가 메모리 DB를 반환하도록 합니다.

```typescript
let testDb: Database.Database;

vi.mock('../connection.js', () => ({
  getDatabase: () => testDb,
}));

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  initDatabase(testDb);  // 스키마 생성
});

afterEach(() => {
  testDb.close();
});
```

각 테스트마다 새 DB를 생성하므로 테스트 간 격리가 완벽합니다.

**테스트 범위:**
- Projects: 생성, 전체조회, ID조회, 업데이트, 삭제, 유니크 제약조건
- Todos: 생성, 조회, 상태변경, 우선순위, 캐스케이드 삭제
- Task Logs: 생성, 조회, 오래된 로그 정리

### 2. WorktreeManager 테스트 (`worktree-manager.test.ts`)

`sanitizeBranchName()` 메서드의 순수 로직을 테스트합니다.
외부 의존성(git) 없이 브랜치명 변환 규칙을 검증합니다.

**테스트 케이스:**
- 영문 제목 -> `feature/fix-login-bug`
- 특수문자 제거
- 한글 -> 해시 기반 변환
- 50자 제한
- 빈 결과 시 `task-{timestamp}` 폴백

### 3. ClaudeManager 테스트 (`claude-manager.test.ts`)

실제 Claude CLI를 실행하지 않고, 프로세스가 없는 상태에서의 경계 조건을 테스트합니다.
- 알 수 없는 PID에 대한 `isRunning` -> false
- 존재하지 않는 프로세스 `stopClaude` -> 정상 resolve
- 프로세스 없을 때 `killAll` -> 정상 resolve

### 4. LogStreamer 테스트 (`log-streamer.test.ts`)

**핵심 전략: EventEmitter Mock**

Node.js의 `EventEmitter`를 사용하여 stdout/stderr 스트림을 모킹합니다.
`queries`와 `broadcaster` 모듈을 `vi.mock`으로 가로챕니다.

```typescript
const mockStdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
```

**테스트 범위:**
- stdout 데이터 -> `output` 타입 로그 저장
- git commit 패턴 감지 -> `commit` 타입 로그 + WebSocket 브로드캐스트
- stderr 데이터 -> `error` 타입 로그
- 불완전한 줄 버퍼링 -> 다음 데이터에서 합쳐서 처리
- 스트림 종료 시 버퍼 플러시
- 빈 줄 무시

### 5. Auth 미들웨어 테스트 (`auth.test.ts`)

Express 미들웨어의 핵심 로직을 순수 함수로 추출하여 테스트합니다.
mock Request/Response 객체를 사용합니다.

**테스트 범위:**
- `/api/auth/*` 경로 인증 스킵
- `/health` 헬스체크 스킵
- 인증된 세션 -> `next()` 호출
- 미인증 -> 401 응답

### 6. Broadcaster 테스트 (`broadcaster.test.ts`)

WebSocket 클라이언트 관리 및 브로드캐스트 로직을 테스트합니다.

**테스트 범위:**
- 클라이언트 추가/제거/카운트
- 열린 연결에만 브로드캐스트
- 닫힌 연결은 건너뛰기

### 7. API Client 테스트 (`client.test.ts`)

**핵심 전략: Global Fetch Mock**

```typescript
const mockFetch = vi.fn();
global.fetch = mockFetch;
```

**테스트 범위:**
- GET/POST/PUT/DELETE 요청 메서드
- credentials: 'include' 설정
- 204 No Content 처리
- 에러 응답 시 `ApiError` throw
- 401 시 `auth:unauthorized` 커스텀 이벤트 발생

### 8. StatusBadge 컴포넌트 테스트 (`StatusBadge.test.tsx`)

`@testing-library/react`를 사용한 렌더링 테스트입니다.

**테스트 범위:**
- 각 상태별 올바른 레이블 렌더링 (IDLE, LIVE, DONE, FAIL, STOP, MRGD)
- `running` 상태에서만 ping 애니메이션 표시

### 9. LoginPage 컴포넌트 테스트 (`LoginPage.test.tsx`)

`@testing-library/user-event`를 사용한 사용자 인터랙션 테스트입니다.

**테스트 범위:**
- 로그인 폼 렌더링
- 빈 비밀번호 -> 버튼 비활성화
- 비밀번호 입력 -> 버튼 활성화
- 제출 시 `onLogin` 콜백 호출
- 로그인 실패 시 에러 메시지 표시
- 로딩 중 "AUTHENTICATING..." 표시

---

## 새 테스트 작성 가이드

### 백엔드 테스트 추가

1. 테스트할 모듈의 `__tests__/` 디렉토리에 `*.test.ts` 파일 생성
2. `vi.mock()`으로 외부 의존성 모킹
3. `describe/it` 블록으로 구조화

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('MyModule', () => {
  it('should do something', () => {
    expect(1 + 1).toBe(2);
  });
});
```

### 프론트엔드 컴포넌트 테스트 추가

1. `src/client/src/__tests__/components/` 에 `*.test.tsx` 파일 생성
2. `render()`, `screen`, `userEvent` 사용

```tsx
import { render, screen } from '@testing-library/react';
import MyComponent from '../../components/MyComponent';

it('should render', () => {
  render(<MyComponent />);
  expect(screen.getByText('Hello')).toBeInTheDocument();
});
```

---

## 사용된 테스트 라이브러리

| 패키지 | 용도 | 위치 |
|--------|------|------|
| `vitest` | 테스트 러너 + assertion | 백엔드 + 프론트엔드 |
| `@vitest/coverage-v8` | 코드 커버리지 | 백엔드 + 프론트엔드 |
| `@testing-library/react` | React 컴포넌트 렌더링/쿼리 | 프론트엔드 |
| `@testing-library/jest-dom` | DOM assertion 확장 (toBeInTheDocument 등) | 프론트엔드 |
| `@testing-library/user-event` | 사용자 이벤트 시뮬레이션 | 프론트엔드 |
| `jsdom` | 브라우저 환경 에뮬레이션 | 프론트엔드 |
| `better-sqlite3` | In-Memory DB (테스트용) | 백엔드 |

---

## npm 스크립트 요약

| 스크립트 | 설명 |
|----------|------|
| `npm test` | 백엔드 + 프론트엔드 전체 테스트 |
| `npm run test:server` | 백엔드만 테스트 |
| `npm run test:client` | 프론트엔드만 테스트 |
| `npm run test:watch` | 백엔드 Watch 모드 |
| `npm run test:coverage` | 전체 커버리지 리포트 생성 |
