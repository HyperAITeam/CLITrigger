<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="src/client/public/logo.svg">
  <source media="(prefers-color-scheme: light)" srcset="src/client/public/logo.svg">
  <img alt="CLITrigger" src="src/client/public/logo.svg" width="360">
</picture>

**AI-Powered Parallel Worktree Automation**

*Write tasks. Let AI execute them in parallel. Review and merge.*

<p align="center">
  <a href="README.md">한국어</a> ·
  <a href="README_EN.md">English</a>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/clitrigger.svg)](https://www.npmjs.com/package/clitrigger)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev)

</div>

---

> AI가 코드를 짜는 시대, 개발자의 역할이 바뀌고 있다.  
> 하지만 **이해 없는 바이브 코딩**은 결국 한계에 부딪힌다.  
> CLITrigger는 AI를 병렬로 돌리면서도, 개발자가 맥락을 잃지 않도록 설계되었다.

<div align="center">
  <img src="docs/images/screenshot-tasks.png" alt="Tasks — 병렬 워크트리 실행" width="800">
  <p><em>병렬 워크트리에서 AI CLI가 동시에 작업을 처리하는 모습</em></p>
</div>

---

## 왜 CLITrigger인가?

Claude Code 제작자 Boris Cherny는 **병렬 실행(Parallelism)** 을 강조한다. 터미널 하나에서 하나씩 기다리는 건 AI 시대의 병목이다.

동시에 많은 AI 서비스는 **시간당 토큰 한도**를 가지고 있다. 낮에 한도를 다 쓰면 밤에 아무것도 못 한다.

CLITrigger는 이 두 문제를 동시에 해결한다:

- **지금 당장** — 여러 작업을 격리된 worktree에서 Claude / Gemini / Codex가 병렬로 처리
- **한도 걱정 없이** — 새벽, 특정 시각에 예약 실행으로 토큰을 최대한 활용
- **더 나은 결과** — 여러 AI 에이전트가 서로 토론한 뒤 구현, 혼자 짠 코드보다 품질이 높아진다

---

## 어떻게 동작하나?

```
[브라우저에서 TODO 작성]
         ↓
┌────────────────────────────────────────────────────┐
│  TODO 1: 로그인 기능 구현   → worktree/feature-login     → Claude CLI → 자동 커밋  │
│  TODO 2: 회원가입 페이지    → worktree/feature-signup    → Gemini CLI → 자동 커밋  │
│  TODO 3: 대시보드 레이아웃  → worktree/feature-dashboard → Claude CLI → 자동 커밋  │
└────────────────────────────────────────────────────┘
         ↓
[실시간 로그 확인 → Diff 보기 → Main에 Merge]
```

각 TODO는 **독립된 git worktree**에서 실행된다. 서로 충돌하지 않고, 각자의 브랜치에서 커밋이 쌓인다. 개발자는 결과를 검토하고 머지 여부를 결정한다.

---

## 주요 기능

### 병렬 Worktree 실행
TODO를 작성하면 각 작업마다 격리된 git worktree가 자동 생성된다. Claude / Gemini / Codex CLI가 동시에 병렬로 실행되며, 의존성 체인을 설정하면 선행 작업 완료 후 자동으로 후속 작업이 실행되고 브랜치 병합까지 처리된다.

### 다중 AI 토론 (Discussion)
아키텍트, 개발자, 리뷰어 등 역할이 다른 AI 에이전트들이 라운드 방식으로 토론한 뒤, 합의된 내용을 바탕으로 자동 구현까지 이어진다. 단일 AI의 판단보다 훨씬 검증된 설계 결과물이 나온다.

<div align="center">
  <img src="docs/images/screenshot-discussions.png" alt="Discussions — 다중 AI 토론" width="800">
  <p><em>여러 AI 에이전트가 역할별로 토론하는 Discussion 화면</em></p>
</div>

### 예약 실행 (Scheduler)
토큰 한도를 피해 새벽이나 특정 시각에 작업을 예약 실행할 수 있다. cron 기반 반복 스케줄과 일회성 예약 모두 지원한다.

<div align="center">
  <img src="docs/images/screenshot-schedules.png" alt="Schedules — 예약 실행" width="800">
  <p><em>cron 기반 반복·일회성 예약 실행 설정 화면</em></p>
</div>

### 파이프라인 (Pipeline)
여러 작업을 순차 또는 병렬로 묶어 다단계 실행 흐름을 구성한다. 복잡한 릴리스 절차도 자동화할 수 있다.

### 실시간 로그 & 내장 Git 클라이언트
WebSocket으로 실행 로그를 실시간 스트리밍하고, 웹 UI에서 직접 커밋·푸시·머지 등 Git 작업을 처리한다. 개발자는 항상 맥락을 파악할 수 있다.

### 멀티 CLI & 샌드박스
Claude / Gemini / Codex CLI를 프로젝트·TODO별로 선택한다. 엄격(strict) 샌드박스 모드에서는 CLI의 파일 접근을 워크트리 디렉토리로 제한해 안전하게 실행한다.

### 플러그인 시스템
Jira, GitHub, Notion 연동과 gstack 스킬 주입 등 외부 서비스 통합을 플러그인 단위로 추가할 수 있다.

### 외부 접속
Cloudflare Tunnel로 어디서든 폰·노트북으로 제어한다.

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| Backend | Node.js · Express · TypeScript · SQLite · WebSocket |
| Frontend | React 18 · Vite · Tailwind CSS |
| AI CLI | Claude · Gemini · Codex (Adapter Pattern) |
| Git | simple-git (worktree 관리) |
| 스케줄링 | node-cron |
| 터미널 | node-pty (TTY 지원) |
| 외부 접속 | Cloudflare Tunnel (선택) |

---

## 빠른 시작

```bash
npm i -g clitrigger
clitrigger
```

첫 실행 시 비밀번호 설정 여부를 물어보고, 바로 서버가 시작된다.  
브라우저에서 `http://localhost:3000` 접속 → 프로젝트 등록 → TODO 작성 → Start.

```bash
# 설정 변경
clitrigger config port 8080    # 포트 변경
clitrigger config password     # 비밀번호 변경
```

> **사전 요구사항**: Node.js 20+, Git, 사용할 AI CLI (Claude / Gemini / Codex 중 하나 이상)

### 소스에서 직접 실행 (개발용)

<details>
<summary>클릭하여 펼치기</summary>

```bash
# 1. 클론 & 설치
git clone https://github.com/OSgoodYZ/CLITrigger.git
cd CLITrigger
npm install
cd src/client && npm install && cd ../..

# 2. 환경 설정
cp .env.example .env
# .env 열어서 AUTH_PASSWORD 설정

# 3. 실행
npm run dev
```

브라우저에서 `http://localhost:5173` 접속.

#### Windows 원클릭 실행

`scripts/` 폴더의 bat 파일을 더블클릭하면 명령어 입력 없이 바로 실행된다.

| 파일 | 기능 |
|------|------|
| `install.bat` | 의존성 설치 (처음 한 번) |
| `dev.bat` | 개발 모드 실행 |
| `build.bat` | 빌드 |
| `start.bat` | 프로덕션 서버 실행 |
| `start-tunnel.bat` | 터널 모드 실행 |
| `test.bat` | 전체 테스트 |

</details>

### 외부 접속 (Cloudflare Tunnel)

```bash
# cloudflared 설치
winget install cloudflare.cloudflared    # Windows
brew install cloudflared                  # macOS

# .env에서 TUNNEL_ENABLED=true 설정 후
npm run start:tunnel
# → 콘솔에 https://xxxx.trycloudflare.com 출력
```

---

## 문서

| 문서 | 내용 |
|------|------|
| [SETUP.md](docs/SETUP.md) | 상세 설치 및 사용 가이드 |
| [CHANGELOG.md](docs/CHANGELOG.md) | 버전별 변경 이력 |
| [CICD.md](docs/CICD.md) | GitHub Actions CI/CD 설정 |
| [TESTING.md](docs/TESTING.md) | 테스트 가이드 |

---

## 라이선스

[MIT](LICENSE) — 자유롭게 사용, 수정, 배포하세요.
