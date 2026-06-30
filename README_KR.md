<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/src/client/public/logo.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/src/client/public/logo.svg">
  <img alt="CLITrigger" src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/src/client/public/logo.svg" width="360">
</picture>

**AI 개발 커맨드 센터**

*AI 에이전트가 밤새 병렬 git worktree에서 코딩하고 — 당신은 아침에 커피 마시며 diff만 리뷰한다.*

<p align="center">
  <a href="https://github.com/HyperAITeam/CLITrigger/blob/main/README.md">English</a> ·
  <a href="https://github.com/HyperAITeam/CLITrigger/blob/main/README_KR.md">한국어</a>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/clitrigger.svg)](https://www.npmjs.com/package/clitrigger)
[![npm downloads](https://img.shields.io/npm/dm/clitrigger.svg)](https://www.npmjs.com/package/clitrigger)
[![npm total downloads](https://img.shields.io/npm/dt/clitrigger.svg)](https://www.npmjs.com/package/clitrigger)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev)
[![GitHub stars](https://img.shields.io/github/stars/HyperAITeam/CLITrigger.svg?style=social)](https://github.com/HyperAITeam/CLITrigger/stargazers)

<br>

<img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/demo.gif" alt="CLITrigger 데모 — 격리된 worktree에서 병렬로 실행되는 AI 에이전트, 그리고 아침 diff 리뷰" width="800">

<br><br>

```bash
npm i -g clitrigger && clitrigger
```

**또는 데스크톱 앱 다운로드** — Node.js 불필요: **[Windows `.exe` · macOS `.dmg` · Linux `.AppImage`](https://github.com/HyperAITeam/CLITrigger/releases/latest)**

**60초 안에 시작** — `http://localhost:3000` 접속 → 비밀번호 설정 → 프로젝트 추가 → TODO 작성 → Start 클릭.

</div>

---

> ### 계획하고. 위임하고. 리뷰한다.
>
> CLITrigger는 당신의 하루치 작업과 AI 에이전트를 한곳에 모은다. 해야 할 일을 개인 캘린더·플래너·프로젝트 위키에 캡처하고 — 그걸 여러 AI 코딩 에이전트(**Claude Code · Codex · Gemini CLI**)에 넘기면, 각자의 격리된 git worktree에서 병렬로 처리한다.
>
> 당신이 자는 동안(혹은 다른 일에 집중하는 동안) AI는 토큰 한도를 끝까지 써가며 일한다. 다음 날 아침 책상에 앉아 쌓인 diff를 보고 **accept / reject / merge**만 하면 된다.
>
> **AI를 병렬로 돌리되, 개발자는 맥락을 잃지 않는다.**

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-tasks.png" alt="Tasks — 병렬 워크트리 실행" width="800">
  <p><em>병렬 워크트리에서 AI CLI가 동시에 작업을 처리하는 모습</em></p>
</div>

---

## 왜 CLITrigger인가?

**터미널에서 Claude Code를 직접 쓰면 에이전트 하나를 옆에 붙어 지켜봐야 한다.** CLITrigger는 그걸 펼친다 — 각자의 격리된 worktree에서 여러 에이전트가 당신이 자리를 비운 동안 동시에 돌고, 일을 계획하고 끝난 뒤 모든 diff를 리뷰하는 곳은 한 군데뿐이다.

Claude Code 제작자 Boris Cherny는 **병렬 실행(Parallelism)** 을 강조한다. 터미널 하나에서 하나씩 기다리는 건 AI 시대의 병목이다.

동시에 많은 AI 서비스는 **시간당 토큰 한도**를 가지고 있다. 낮에 한도를 다 쓰면 밤에 아무것도 못 한다.

그리고 AI가 코드를 더 많이 짤수록 개발자의 진짜 역할은 **의도를 캡처하고 결과를 리뷰하는 것**이 된다 — 그런데 그 맥락이 포스트잇·터미널·열두 개의 브라우저 탭에 흩어지는 순간 모든 게 무너진다.

CLITrigger는 이 세 가지를 한 번에 해결한다:

- **지금 당장** — 여러 작업을 격리된 worktree에서 Claude / Gemini / Codex가 병렬로 처리
- **한도 걱정 없이** — 새벽, 특정 시각에 예약 실행으로 토큰을 최대한 활용
- **맥락을 잃지 않고** — 한곳(캘린더·플래너·위키)에 캡처하고, 위임하고, 모든 diff를 통합적으로 리뷰
- **더 나은 결과** — 여러 AI 에이전트가 서로 토론한 뒤 구현, 혼자 짠 코드보다 품질이 높아진다

---

## 주요 기능

CLITrigger는 네 개의 계층으로 이루어진다 — 할 일을 **계획·정리**하고, AI에 **위임**하고, 결과를 **리뷰·머지**하고, **어디서나 접속**한다. 각 기능의 자세한 가이드는 **[Wiki](https://github.com/HyperAITeam/CLITrigger/wiki/Home-KR)** (↗)에 있다.

### 🗂 계획 · 정리

#### 내 일정 (My Schedule)
내 메모·전 프로젝트 스케줄·플래너 마감일·할당된 Jira 이슈를 한 캘린더에 겹쳐 보는 개인 허브. [↗](https://github.com/HyperAITeam/CLITrigger/wiki/Plan-&-Organize-KR#내-일정)

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-agenda.png" alt="내 일정 — 개인 메모·스케줄·플래너·Jira를 한 캘린더에" width="800">
  <p><em>개인 메모, 전 프로젝트 스케줄, 플래너 마감일, 내게 할당된 Jira 이슈를 하나의 캘린더에 겹쳐 보기</em></p>
</div>

#### Planner (플래너)
경량 작업 플래너 — 아이디어를 적고 한 번의 클릭으로 TODO·스케줄·세션으로 변환, Markdown 입출력 지원. [↗](https://github.com/HyperAITeam/CLITrigger/wiki/Plan-&-Organize-KR#플래너)

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-planer.png" alt="Planner — 경량 작업 관리" width="800">
  <p><em>인라인 편집, 컬러 태그, 이미지 첨부, 원클릭 TODO/스케줄 변환</em></p>
</div>

#### 볼트 (파일 기반 지식)
`[[wikilink]]` 그래프를 갖춘 프로젝트별 Obsidian 스타일 지식 저장소 — 파일을 CLI 불문으로 프롬프트에 주입. [↗](https://github.com/HyperAITeam/CLITrigger/wiki/Plan-&-Organize-KR#볼트)

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-vault.png" alt="볼트 — Obsidian 스타일 파일 기반 지식 + 링크 그래프" width="800">
  <p><em>Vault 탭 — 프로젝트 마크다운을 인라인 미리보기와 wikilink force-directed 그래프로 탐색하고, 파일을 골라 프롬프트에 주입</em></p>
</div>

#### 즐겨찾기 런처 (Favorites)
자주 쓰는 외부 도구(실행파일, 명령어, URL)를 사이드바에서 원클릭으로 실행. [↗](https://github.com/HyperAITeam/CLITrigger/wiki/Plan-&-Organize-KR#즐겨찾기-런처)

### 🤖 AI에 위임

#### 병렬 Worktree 실행 (자동 작업)
TODO마다 격리된 git worktree에서 Claude / Gemini / Codex가 병렬 실행 + 의존성 체인·머지 제어. [↗](https://github.com/HyperAITeam/CLITrigger/wiki/Delegate-to-AI-KR#병렬-워크트리-실행)

#### 인터랙티브 세션 (Sessions)
VS Code 스타일 도킹·별도 창 분리·실제 xterm.js 터미널을 갖춘 장시간 CLI 세션. [↗](https://github.com/HyperAITeam/CLITrigger/wiki/Delegate-to-AI-KR#인터랙티브-세션)

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-sessions.png" alt="Sessions — VS Code 스타일로 도킹된 멀티 CLI floating windows" width="800">
  <p><em>VS Code 스타일 그룹화로 도킹된 Claude · Gemini · Codex 세션 — 각각 독립된 worktree 브랜치에서 동시 실행</em></p>
</div>

#### 다중 AI 토론 (Discussion)
아키텍트·개발자·리뷰어 에이전트가 구현 전에 토론하고, 코드 커밋이나 플래너 전송까지 이어진다. [↗](https://github.com/HyperAITeam/CLITrigger/wiki/Delegate-to-AI-KR#멀티-에이전트-토론)

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-discussions.png" alt="Discussions — 다중 AI 토론" width="800">
  <p><em>여러 AI 에이전트가 역할별로 토론하는 Discussion 화면</em></p>
</div>

#### 예약 실행 (Scheduler)
cron·일회성 스케줄로 작업을 예약하고, 토큰 한도 리셋 시각에 자동 재시도. [↗](https://github.com/HyperAITeam/CLITrigger/wiki/Delegate-to-AI-KR#스케줄-실행)

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-schedules.png" alt="Schedules — 예약 실행" width="800">
  <p><em>cron 기반 반복·일회성 예약 실행 설정 화면</em></p>
</div>

#### 멀티 CLI & 샌드박스
Claude / Gemini / Codex를 프로젝트·TODO·에이전트별로 선택, strict 샌드박스로 파일 접근을 워크트리로 제한. [↗](https://github.com/HyperAITeam/CLITrigger/wiki/Delegate-to-AI-KR#멀티-cli--샌드박스-모드)

### 🔍 리뷰 · 머지

#### Morning Review Queue (아침 리뷰 큐)
밤새 실행된 전 프로젝트 TODO를 키보드 한 번으로 이동·머지·discard하는 단일 트리아주 카드 스택. [↗](https://github.com/HyperAITeam/CLITrigger/wiki/Review-&-Ship-KR#모닝-리뷰-큐)

#### 내장 Git 클라이언트
브라우저 안의 Fork/SourceTree 스타일 Git 클라이언트 — 스테이지·커밋·푸시·브랜치/diff 관리. [↗](https://github.com/HyperAITeam/CLITrigger/wiki/Review-&-Ship-KR#내장-git-클라이언트)

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-git.png" alt="Git — 내장 클라이언트" width="800">
  <p><em>커밋 그래프, 브랜치 작업, 파일 diff까지 브라우저 안에서</em></p>
</div>

#### Analytics (통계)
프로젝트별 비용·실행 통계 — CLI별, 상태별, 시간 축으로. [↗](https://github.com/HyperAITeam/CLITrigger/wiki/Review-&-Ship-KR#분석)

<div align="center">
  <img src="https://raw.githubusercontent.com/HyperAITeam/CLITrigger/main/docs/images/screenshot-analytics.png" alt="Analytics — 실행 통계" width="800">
  <p><em>CLI·상태·시간 축으로 나눠 보는 비용과 토큰 사용량</em></p>
</div>

#### 실시간 로그 (Chat & Raw)
WebSocket 실시간 로그 스트리밍 — Chat(마크다운) 또는 Raw(터미널) 모드. [↗](https://github.com/HyperAITeam/CLITrigger/wiki/Review-&-Ship-KR#실시간-로그)

### 🌐 어디서나 접속

#### 외부 접속
Cloudflare Tunnel로 어디서든 접속 — 완료 알림과 커스텀 도메인 라우팅 지원. [↗](https://github.com/HyperAITeam/CLITrigger/wiki/Remote-Access-KR)

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| Backend | Node.js · Express · TypeScript · SQLite · WebSocket |
| Frontend | React 18 · Vite · Tailwind CSS · Recharts |
| AI CLI | Claude · Gemini · Codex (Adapter Pattern) |
| Git | simple-git (worktree 관리) |
| 스케줄링 | node-cron |
| 터미널 | node-pty (TTY 지원) · xterm.js (pixel-perfect 렌더링) |
| 외부 접속 | Cloudflare Tunnel (선택) |

---

## 빠른 시작

### 옵션 A — 데스크톱 앱 (일반 사용자 권장)

[GitHub Releases 최신 페이지](https://github.com/HyperAITeam/CLITrigger/releases/latest)에서 플랫폼별 설치 파일을 다운로드:

- **Windows** — `CLITrigger-Setup-<version>.exe` (NSIS 설치 마법사) 또는 portable `.exe`
- **macOS** — `CLITrigger-<version>.dmg` (Apple Silicon · Intel)
- **Linux** — `CLITrigger-<version>.AppImage`

데스크톱 앱은 Node.js와 네이티브 모듈(`better-sqlite3`, `node-pty`, `cloudflared`)을 모두 번들하므로 별도 런타임 설치가 필요 없다. 첫 실행 시 내장 브라우저에 셋업 화면이 떠서 거기서 비밀번호를 정하면 끝. 외부 공유(Cloudflare 터널)는 셋업이 완료될 때까지 자동 시작이 잠겨 있어서 첫 사용자는 항상 본인.

### 옵션 B — npm (개발자 권장)

```bash
# 설치
npm i -g clitrigger
clitrigger

# 최신 버전으로 업그레이드
npm i -g clitrigger@latest
# 현재 버전 확인: clitrigger --version
```

첫 실행 시 서버가 바로 시작된다. 브라우저에서 `http://localhost:3000` 접속 → 셋업 화면에서 비밀번호 설정 → 프로젝트 등록 → TODO 작성 → Start. 비밀번호는 이후 웹 UI의 설정 → 계정 탭에서 변경 가능.

CLITrigger는 부팅 시 npm에 새 버전이 올라와 있으면 `Update available: <new> -> npm i -g clitrigger@latest` 한 줄을 출력한다 — 자동 업데이트는 안 하니까 본인이 시점 잡아서 업그레이드하면 됨.

```bash
# 설정 변경
clitrigger config port 8080    # 포트 변경
clitrigger config tunnel on    # 외부 공유용 Cloudflare 터널 활성화
```

> **사전 요구사항**: Node.js 22+ (**LTS** 버전 권장), Git, 사용할 AI CLI (Claude / Gemini / Codex 중 하나 이상)
>
> **지원 플랫폼**: Windows · macOS · Linux — 모든 핵심 코드가 크로스 플랫폼 대응되어 있다.
> Node.js는 **LTS(짝수 버전)** 를 권장한다. 갓 출시된 최신 메이저(홀수/방금 나온 버전)는 네이티브 모듈의 prebuilt 바이너리가 아직 없어, 소스 빌드를 강제하며 C++ 빌드 도구(Windows는 Visual Studio Build Tools, macOS는 `xcode-select --install`)가 필요할 수 있다.

### 소스에서 직접 실행 (개발용)

<details>
<summary>클릭하여 펼치기</summary>

```bash
# 1. 클론 & 설치
git clone https://github.com/HyperAITeam/CLITrigger.git
cd CLITrigger
npm install
cd src/client && npm install && cd ../..

# 2. 환경 설정
cp .env.example .env
# AUTH_PASSWORD는 이제 선택사항 — 비워두면 첫 브라우저 접속 시 셋업 화면이 뜬다.
# 셋업을 건너뛰고 싶을 때만 미리 값을 박아두면 된다.

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

#### 본인 도메인으로 Named Tunnel 라우팅 (선택)

`*.trycloudflare.com` / `*.cfargotunnel.com`에 뜨는 브라우저 "위험한 사이트" 경고를 회피하려면 본인 도메인으로 라우팅한다. 사이드바 ⚙ → Tunnel 설정 모달에서 Tunnel Name + Custom Hostname 입력, 또는 CLI:

```bash
clitrigger config tunnel hostname app.your-domain.com
cloudflared tunnel route dns <tunnel-name> app.your-domain.com   # 한 번만 실행
```

표시 URL이 `https://app.your-domain.com`으로 바뀌고 도메인 평판이 본인 도메인으로 옮겨간다.

---

## 문서

📖 **전체 매뉴얼은 [Wiki](https://github.com/HyperAITeam/CLITrigger/wiki/Home-KR)에 있습니다** — 설치, 기능별 가이드, 원격 접속까지.

| 문서 | 내용 |
|------|------|
| [Wiki (한국어)](https://github.com/HyperAITeam/CLITrigger/wiki/Home-KR) | 기능별 상세 가이드와 사용법 |
| [SETUP.md](docs/SETUP.md) | 상세 설치 및 사용 가이드 |
| [changelog/](docs/changelog/README.md) | 변경 이력 (월별 폴더 + 날짜별 파일) |
| [CICD.md](docs/CICD.md) | GitHub Actions CI/CD 설정 |
| [TESTING.md](docs/TESTING.md) | 테스트 가이드 |

---

## Star & 함께 만들기

CLITrigger가 시간을 아껴 줬다면 [**Star 한 번 눌러주세요**](https://github.com/HyperAITeam/CLITrigger) — 더 많은 개발자에게 닿는 데 정말 큰 도움이 됩니다.

다음 모습을 함께 그려갈 분들을 기다리고 있어요:

- **이슈 등록** — 버그 제보, 기능 제안, 거친 아이디어 모두 환영합니다 → [Issues](https://github.com/HyperAITeam/CLITrigger/issues)
- **PR 보내기** — [`good first issue`](https://github.com/HyperAITeam/CLITrigger/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) 라벨부터 시작하거나, 직접 거슬리는 부분을 고쳐도 좋아요
- **사용기 공유** — 워크트리 활용법, 커스텀 플러그인, 생산성 팁을 [Discussions](https://github.com/HyperAITeam/CLITrigger/discussions)에 풀어주세요

Star 하나, 이슈 하나, PR 하나가 프로젝트 속도를 바꿉니다. 감사합니다 🙏

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
