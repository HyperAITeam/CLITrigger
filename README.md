# CLITrigger

TODO 리스트를 작성하면, 각 항목마다 독립적인 git worktree에서 Claude CLI가 자동으로 작업하고 커밋하는 시스템.

```
[브라우저에서 TODO 작성 + Start 클릭]
        ↓
[TODO 1] → worktree/feature-login     → Claude CLI → 자동 커밋
[TODO 2] → worktree/feature-signup     → Claude CLI → 자동 커밋
[TODO 3] → worktree/feature-dashboard  → Claude CLI → 자동 커밋
        ↓
[완료 확인 → Diff 보기 → Main에 Merge]
```

## 주요 기능

- **TODO 기반 자동 코딩** — TODO 항목마다 Claude CLI가 독립 브랜치에서 병렬 작업
- **실시간 모니터링** — WebSocket으로 작업 로그, 상태 변화를 실시간 확인
- **Start / Stop 제어** — 전체 또는 개별 TODO 실행/중지
- **Diff 확인 & Merge** — 완료된 작업의 변경사항 확인 후 main에 머지
- **외부 접속** — Cloudflare Tunnel로 어디서든 폰/노트북으로 제어
- **비밀번호 인증** — 외부 노출 시 무단 접근 방지

## 기술 스택

**Backend:** Node.js, Express, TypeScript, SQLite, WebSocket
**Frontend:** React, Vite, Tailwind CSS
**핵심:** simple-git (worktree 관리), child_process (Claude CLI 실행)
**외부 접속:** Cloudflare Tunnel (선택)

## 빠른 시작

```bash
# 1. 클론 & 설치
git clone https://github.com/OSgoodYZ/CLITrigger.git
cd CLITrigger
npm install
cd src/client && npm install && cd ../..

# 2. 환경 설정
cp .env.example .env
# .env 열어서 AUTH_PASSWORD 변경

# 3. 실행
npm run dev
```

브라우저에서 `http://localhost:5173` 접속 → 비밀번호 입력 → 프로젝트 등록 → TODO 작성 → Start.

### 원클릭 실행 (Windows)

`scripts/` 폴더의 bat 파일을 더블클릭하면 명령어 입력 없이 바로 실행:

| 파일 | 기능 |
|------|------|
| `scripts/install.bat` | 의존성 설치 (처음 한 번) |
| `scripts/dev.bat` | 개발 모드 실행 |
| `scripts/build.bat` | 프로젝트 빌드 |
| `scripts/start.bat` | 프로덕션 서버 실행 |
| `scripts/start-tunnel.bat` | 터널 모드 실행 |
| `scripts/build-and-start.bat` | 빌드 후 바로 실행 |

## 외부에서 접속하기 (Cloudflare Tunnel)

```bash
# cloudflared 설치 (한 번만)
winget install cloudflare.cloudflared    # Windows
brew install cloudflared                  # macOS

# .env에서 TUNNEL_ENABLED=true 설정 후
npm run start:tunnel
# → 콘솔에 https://xxxx.trycloudflare.com URL 출력
```

카페, 지하철 등 어디서든 이 URL로 접속하여 Start/Stop 가능.

## 문서

상세 설치/사용 가이드: [docs/SETUP.md](docs/SETUP.md)

## 라이선스

MIT
