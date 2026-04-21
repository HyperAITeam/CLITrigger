<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/src/client/public/logo.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/src/client/public/logo.svg">
  <img alt="CLITrigger" src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/src/client/public/logo.svg" width="360">
</picture>

**AI-Powered Parallel Worktree Automation**

*Write tasks. Let AI execute them in parallel. Review and merge.*

<p align="center">
  <a href="https://github.com/OSgoodYZ/CLITrigger/blob/main/README.md">English</a> ·
  <a href="https://github.com/OSgoodYZ/CLITrigger/blob/main/README_KR.md">한국어</a>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/clitrigger.svg)](https://www.npmjs.com/package/clitrigger)
[![npm downloads](https://img.shields.io/npm/dm/clitrigger.svg)](https://www.npmjs.com/package/clitrigger)
[![npm total downloads](https://img.shields.io/npm/dt/clitrigger.svg)](https://www.npmjs.com/package/clitrigger)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev)
[![GitHub stars](https://img.shields.io/github/stars/HyperAITeam/CLITrigger.svg?style=social)](https://github.com/HyperAITeam/CLITrigger/stargazers)

</div>

---

> AI가 코드를 짜는 시대, 개발자의 역할이 바뀌고 있다.
> 하지만 **이해 없는 바이브 코딩**은 결국 한계에 부딪힌다.
> CLITrigger는 AI를 병렬로 돌리면서도, 개발자가 맥락을 잃지 않도록 설계되었다.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-tasks.png" alt="Tasks — 병렬 워크트리 실행" width="800">
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
TODO를 작성하면 각 작업마다 격리된 git worktree가 자동 생성된다. Claude / Gemini / Codex CLI가 동시에 병렬로 실행되며, 의존성 체인을 설정하면 선행 작업 완료 후 자동으로 후속 작업이 실행되고 브랜치 병합까지 처리된다. 프로젝트별 워크트리 토글에 더해 TODO별 3단계 오버라이드(상속 / 강제 워크트리 / 강제 메인)로 세밀한 제어가 가능하고, 메인 브랜치 작업은 자동 직렬화되어 충돌을 막는다. 드래그 앤 드롭으로 순서를 바꾸고, iOS 스타일 스택 모드로 긴 목록도 깔끔하게 관리할 수 있다.

### 다중 AI 토론 (Discussion)
아키텍트, 개발자, 리뷰어 등 역할이 다른 AI 에이전트들이 라운드 방식으로 토론한 뒤, 합의된 내용을 바탕으로 자동 구현까지 이어진다. 단일 AI의 판단보다 훨씬 검증된 설계 결과물이 나온다. **구현자(Implementer, `can_implement`)** 로 표시된 에이전트는 일반 턴에서도 코드를 커밋할 수 있고, 마지막 구현 라운드가 남은 작업을 정리해 마무리한다. 자동 구현(Auto-implement) 옵션을 켜면 토론 완료 즉시 코드 작성 라운드가 자동 실행된다.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-discussions.png" alt="Discussions — 다중 AI 토론" width="800">
  <p><em>여러 AI 에이전트가 역할별로 토론하는 Discussion 화면</em></p>
</div>

### 예약 실행 (Scheduler)
토큰 한도를 피해 새벽이나 특정 시각에 작업을 예약 실행할 수 있다. cron 기반 반복 스케줄, 일회성 예약, 그리고 **한도 초과 자동 복구 예약**까지 지원한다 — CLI가 토큰 한도에 걸리면 CLITrigger가 리셋 시각을 파싱해 자동으로 재시도를 예약한다.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-schedules.png" alt="Schedules — 예약 실행" width="800">
  <p><em>cron 기반 반복·일회성 예약 실행 설정 화면</em></p>
</div>

### Planner (플래너)
TODO와는 별개인 경량 작업 플래너 — 아이디어를 빠르게 적고, 이미지를 첨부하고, 색상 태그로 분류하고, 열 단위로 정렬할 수 있다. 플래너 항목을 한 번의 클릭으로 TODO나 예약 스케줄로 변환할 수 있다. JSON Export / Import로 다른 머신에 옮기거나 팀원과 공유할 수 있다.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-planer.png" alt="Planner — 경량 작업 관리" width="800">
  <p><em>인라인 편집, 컬러 태그, 이미지 첨부, 원클릭 TODO/스케줄 변환</em></p>
</div>

### Analytics (분석)
프로젝트별 비용·실행 통계를 Recharts 기반 차트로 시각화 — CLI 도구별 누적 막대, 상태별 도넛, 시간에 따른 비용/토큰 라인 차트를 제공한다. DB에 비정규화된 비용 컬럼을 두어 긴 실행 이력에서도 집계가 빠르다.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-analytics.png" alt="Analytics — 실행 통계" width="800">
  <p><em>CLI·상태·시간 축으로 나눠 보는 비용과 토큰 사용량</em></p>
</div>

### 내장 Git 클라이언트
웹 UI 안에 풀 Git 클라이언트가 내장되어 있다 — 커밋 그래프, 액션 툴바, 파일 상태 사이드바, 워크트리 목록, 브랜치 컨텍스트 메뉴(체크아웃 / 머지 / 리베이스 / 페치 / 풀 / 푸시 / 이름 변경 / 삭제), 파일 단위 diff 뷰어가 붙은 커밋 상세 패널까지. 한글·CJK·이모지 등 비-ASCII 파일명도 diff / status 출력에 제대로 표시된다.

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-git.png" alt="Git — 내장 클라이언트" width="800">
  <p><em>커밋 그래프, 브랜치 작업, 파일 diff까지 브라우저 안에서</em></p>
</div>

### 인터랙티브 세션 (Sessions)
긴 생애주기의 인터랙티브 CLI 세션을 1급 엔티티로 관리 — Claude / Gemini / Codex 세션을 내장 터미널로 띄우고, 세션별로 워크트리 격리 여부를 선택할 수 있다. PTY 출력에서 스피너 노이즈를 걸러내고 assistant / tool-use 블록으로 분류해, Chat 모드 로그 뷰어에서도 깔끔하게 읽힌다.

### 실시간 로그 (Chat & Raw)
WebSocket으로 실행 로그를 실시간 스트리밍하며 두 가지 뷰를 지원한다 — Chat 모드는 assistant 메시지를 마크다운으로 렌더링하고 tool-use 행을 접을 수 있으며, Raw 모드는 플랫 터미널 뷰다. 다중 라운드 Continue는 CLI의 네이티브 `--continue` 플래그를 사용해 동일 워크트리를 재사용한다.

### 멀티 CLI & 샌드박스
Claude / Gemini / Codex CLI를 프로젝트·TODO·토론 에이전트별로 선택한다. 엄격(strict) 샌드박스 모드에서는 각 CLI의 네이티브 샌드박싱(Claude `settings.json`, Codex `--full-auto`, Gemini 프롬프트 단 제한)을 사용해 파일 접근을 워크트리 디렉토리로 제한한다.

### 플러그인 시스템
Jira, GitHub, Notion 연동과 gstack 스킬 주입이 자가 완결형 플러그인으로 제공된다. `external-service`(REST 프록시 + 패널 탭)와 `execution-hook`(오케스트레이터 사전 실행 훅) 두 카테고리를 지원한다. 새 통합을 추가하려면 매니페스트와 `registerPlugin()` 호출만 있으면 되고, 코어 코드를 건드릴 필요가 없다.

### 외부 접속
Cloudflare Tunnel로 어디서든 폰·노트북으로 제어한다. 작업이나 토론이 완료되면 브라우저 알림이 울리므로, 자리를 비워도 상태를 놓치지 않는다.

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| Backend | Node.js · Express · TypeScript · SQLite · WebSocket |
| Frontend | React 18 · Vite · Tailwind CSS · Recharts |
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
>
> **지원 플랫폼**: Windows · macOS · Linux — 모든 핵심 코드가 크로스 플랫폼 대응되어 있다.
> macOS에서는 네이티브 모듈 빌드를 위해 `xcode-select --install`이 필요할 수 있다.

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

#### macOS / Linux

`npm run` 명령어가 모든 플랫폼에서 동일하게 동작한다. `.bat` 스크립트 대신 터미널에서 직접 실행하면 된다.

```bash
npm run dev        # 개발 모드
npm run build      # 빌드
npm run start      # 프로덕션 실행
npm test           # 테스트
```

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

## 기여자 (Contributors)

CLITrigger에 기여해 주신 모든 분들께 감사드립니다!

<a href="https://github.com/HyperAITeam/CLITrigger/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=HyperAITeam/CLITrigger" alt="Contributors" />
</a>

---

## Star History

<a href="https://star-history.com/#HyperAITeam/CLITrigger&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=HyperAITeam/CLITrigger&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=HyperAITeam/CLITrigger&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=HyperAITeam/CLITrigger&type=Date" />
  </picture>
</a>

---

## 라이선스

[MIT](LICENSE) — 자유롭게 사용, 수정, 배포하세요.
