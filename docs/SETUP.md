# CLITrigger 설치 및 실행 가이드

## 사전 요구사항

| 항목 | 최소 버전 | 확인 명령어 |
|------|----------|------------|
| Node.js | v18+ | `node --version` |
| npm | v9+ | `npm --version` |
| Git | v2.20+ | `git --version` |
| Claude CLI | 최신 | `claude --version` |
| cloudflared (선택) | 최신 | `cloudflared --version` |

### Claude CLI 설치

```bash
npm install -g @anthropic-ai/claude-code
```

### cloudflared 설치 (외부 접속이 필요한 경우만)

```bash
# Windows
winget install cloudflare.cloudflared

# macOS
brew install cloudflared

# Linux
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/
```

---

## 1단계: 프로젝트 설치

```bash
git clone https://github.com/OSgoodYZ/CLITrigger.git
cd CLITrigger

# 서버 의존성 설치
npm install

# 클라이언트 의존성 설치
cd src/client && npm install && cd ../..
```

---

## 2단계: 환경 설정

```bash
# .env 파일 생성
cp .env.example .env
```

`.env` 파일을 열어서 수정:

```env
PORT=3000                    # 서버 포트
AUTH_PASSWORD=your-password  # 로그인 비밀번호 (반드시 변경!)
TUNNEL_ENABLED=false         # Cloudflare Tunnel 사용 여부
TUNNEL_NAME=                 # Named Tunnel 이름 (선택)
LOG_RETENTION_DAYS=30        # 로그 보관 일수
```

---

## 3단계: 실행

### 방법 A: 원클릭 실행 (Windows)

`scripts/` 폴더의 bat 파일을 더블클릭하면 터미널 명령어 입력 없이 바로 실행할 수 있습니다.

| 파일 | 기능 |
|------|------|
| `scripts/install.bat` | 서버+클라이언트 의존성 한번에 설치 |
| `scripts/dev.bat` | 개발 모드 실행 (서버+클라이언트 동시) |
| `scripts/build.bat` | 프로젝트 전체 빌드 |
| `scripts/start.bat` | 프로덕션 서버 실행 |
| `scripts/start-tunnel.bat` | 터널 모드로 프로덕션 실행 |
| `scripts/build-and-start.bat` | 빌드 후 바로 프로덕션 실행 |

> 처음 설치할 때: `install.bat` → `dev.bat` 순서로 더블클릭하면 끝!

### 방법 B: 터미널에서 직접 실행

#### 개발 모드 (로컬에서 사용)

```bash
npm run dev
```

이 명령어 하나로:
- **Backend** → `http://localhost:3000` 에서 실행 (자동 재시작)
- **Frontend** → `http://localhost:5173` 에서 실행 (HMR)

브라우저에서 `http://localhost:5173` 접속 → 비밀번호 입력 → 사용 시작.

#### 프로덕션 모드

```bash
# 빌드
npm run build

# 실행
npm run start
```

빌드 후에는 `http://localhost:3000` 하나로 프론트엔드+백엔드 모두 서빙.

#### 외부 접속 모드 (Cloudflare Tunnel)

```bash
# .env에서 TUNNEL_ENABLED=true 설정 후
npm run start:tunnel
```

서버 시작 시 콘솔에 외부 접속 URL이 출력됨:
```
CLITrigger server running on http://localhost:3000
Cloudflare Tunnel URL: https://xxxx-xxxx.trycloudflare.com
```

이 URL로 폰, 노트북 등 어디서든 접속 가능.

---

## 사용법

### 1. 프로젝트 등록

1. 메인 페이지에서 **"New Project"** 클릭
2. 프로젝트 이름 입력 (예: `my-web-app`)
3. 로컬 프로젝트 폴더 경로 입력 (예: `C:\Users\me\projects\my-web-app`)
   - 이 폴더는 **git 저장소**여야 함
4. 저장

### 2. TODO 작성

1. 프로젝트 카드 클릭하여 상세 페이지 진입
2. **"Add Task"** 클릭
3. **제목**: 피쳐 이름 (예: `로그인 페이지 구현`)
   - 이 이름이 git 브랜치명이 됨
4. **설명**: Claude에게 전달할 상세 작업 내용
   ```
   React로 로그인 페이지를 만들어주세요.
   - 이메일/비밀번호 입력 폼
   - 유효성 검증
   - /api/auth/login으로 POST 요청
   - 로그인 성공 시 /dashboard로 리다이렉트
   ```
5. 여러 개의 TODO를 추가 가능 (각각 독립적인 브랜치에서 작업됨)

### 3. 실행

- **START ALL**: 모든 pending TODO를 동시에 실행 (동시실행 수 제한 적용)
- **개별 ▶ 버튼**: 특정 TODO만 실행
- 실행되면:
  1. git worktree 자동 생성 (`프로젝트경로/../worktrees/feature/...`)
  2. Claude CLI가 해당 worktree에서 작업 시작
  3. 실시간 로그가 화면에 표시
  4. 작업 완료 시 자동 커밋

### 4. 중지

- **STOP ALL**: 모든 실행 중인 작업 중지
- **개별 ■ 버튼**: 특정 작업만 중지
- 중지해도 worktree와 커밋은 보존됨

### 5. 결과 확인

- **View Diff**: 완료된 TODO의 변경사항 확인
- **Merge to Main**: 완료된 브랜치를 main에 머지

### 6. 프로젝트 설정

프로젝트 상세 페이지에서 설정 가능:
- **동시 실행 수**: 한번에 몇 개의 Claude를 돌릴지 (1~10, 기본 3)
- **Claude 모델**: 사용할 모델 선택
- **추가 CLI 옵션**: Claude CLI에 전달할 추가 플래그
- **gstack 스킬**: AI 스킬 주입 설정 (아래 참조)

### 7. gstack 스킬 (선택)

[gstack](https://github.com/garrytan/gstack)의 AI 스킬을 worktree에 자동 주입하여 Claude CLI의 작업 품질을 높일 수 있습니다.

#### 활성화 방법

1. 프로젝트 설정(톱니바퀴) 클릭
2. **gstack Skills** 섹션에서 토글 ON
3. 원하는 스킬 체크
4. 저장

> gstack 스킬은 **Claude CLI에서만** 사용 가능합니다. Gemini/Codex CLI에서는 비활성화됩니다.

#### 제공 스킬

| 스킬 | 설명 | 용도 |
|------|------|------|
| **Review** | 코드 리뷰 & 자동 수정 | 머지 전 품질 검증 |
| **QA** | 브라우저 기반 QA 테스트 | 자동 버그 발견 + 수정 |
| **QA Report** | QA 리포트만 (수정 없음) | 비파괴 테스트 검증 |
| **Security Audit** | OWASP/STRIDE 보안 감사 | 보안 취약점 스캔 |
| **Investigate** | 체계적 근본 원인 분석 | 디버깅 |
| **Benchmark** | Core Web Vitals 성능 측정 | 성능 회귀 감지 |
| **Careful Mode** | 위험 명령어 경고 | 안전 가드레일 |

#### 동작 방식

TODO 실행 시 다음 순서로 동작:
1. git worktree 생성
2. **선택된 gstack 스킬 파일을 worktree의 `.claude/skills/`에 복사**
3. Claude CLI spawn (스킬을 자동 인식)
4. 작업 수행

기존 프로젝트의 `.claude/skills/`가 있어도 충돌하지 않습니다 (gstack 스킬은 `gstack-*` 접두사 디렉토리에 격리).

#### 라이선스

gstack은 MIT 라이선스 (Copyright 2026 Garry Tan)로 제공됩니다. 자세한 내용은 프로젝트 루트의 `THIRD_PARTY_LICENSES.md`를 참조하세요.

---

## 상태 설명

| 상태 | 색상 | 의미 |
|------|------|------|
| pending | 회색 | 대기 중 |
| running | 파랑 (깜빡임) | Claude가 작업 중 |
| completed | 초록 | 작업 완료 |
| failed | 빨강 | 작업 실패 (로그 확인) |
| stopped | 노랑 | 사용자가 중지함 |
| merged | 보라 | main에 머지 완료 |

---

## 폴더 구조 (실행 시)

```
C:\Users\me\projects\
├── my-web-app/              ← 원본 프로젝트 (main 브랜치)
└── worktrees/               ← 자동 생성됨
    ├── feature-login/       ← TODO 1의 작업 공간
    ├── feature-signup/      ← TODO 2의 작업 공간
    └── feature-dashboard/   ← TODO 3의 작업 공간
```

---

## 문제 해결

### "claude: command not found"
Claude CLI가 설치되지 않았거나 PATH에 없음.
```bash
npm install -g @anthropic-ai/claude-code
```

### 서버 비정상 종료 후 TODO가 "running" 상태로 멈춤
서버 재시작 시 자동으로 "failed"로 복구됨. 다시 시작 버튼을 누르면 됨.

### Cloudflare Tunnel URL이 안 나옴
1. `cloudflared --version`으로 설치 확인
2. `.env`에서 `TUNNEL_ENABLED=true` 확인
3. 방화벽이 outbound HTTPS를 차단하고 있지 않은지 확인

### 포트 충돌
`.env`에서 `PORT=3001` 등으로 변경.

### git worktree 오류
이미 같은 브랜치의 worktree가 존재할 경우:
```bash
cd <프로젝트 폴더>
git worktree list    # 현재 worktree 확인
git worktree prune   # 깨진 worktree 정리
```

---

## API 요약

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | /api/auth/login | 로그인 |
| POST | /api/auth/logout | 로그아웃 |
| GET | /api/auth/status | 인증 상태 확인 |
| GET | /api/projects | 프로젝트 목록 |
| POST | /api/projects | 프로젝트 생성 |
| GET | /api/projects/:id | 프로젝트 상세 |
| PUT | /api/projects/:id | 프로젝트 수정 |
| DELETE | /api/projects/:id | 프로젝트 삭제 |
| GET | /api/projects/:id/todos | TODO 목록 |
| POST | /api/projects/:id/todos | TODO 생성 |
| PUT | /api/todos/:id | TODO 수정 |
| DELETE | /api/todos/:id | TODO 삭제 |
| POST | /api/projects/:id/start | 전체 시작 |
| POST | /api/projects/:id/stop | 전체 중지 |
| POST | /api/todos/:id/start | 개별 시작 |
| POST | /api/todos/:id/stop | 개별 중지 |
| POST | /api/todos/:id/merge | 브랜치 머지 |
| GET | /api/todos/:id/logs | 로그 조회 |
| GET | /api/todos/:id/diff | Diff 조회 |
| GET | /api/projects/:id/status | 프로젝트 상태 |
| GET | /api/gstack/skills | gstack 스킬 목록 |
| GET | /api/tunnel/status | 터널 상태 |
| POST | /api/tunnel/start | 터널 시작 |
| POST | /api/tunnel/stop | 터널 중지 |
| WS | /ws | 실시간 이벤트 |
