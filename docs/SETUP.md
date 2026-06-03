# CLITrigger 설치 및 실행 가이드

## 지원 플랫폼

| 플랫폼 | 지원 | 비고 |
|--------|------|------|
| **Windows** 10/11 | ✅ | `scripts/*.bat` 원클릭 실행 지원 |
| **macOS** (Intel / Apple Silicon) | ✅ | Xcode CLI tools 필요 (`xcode-select --install`) |
| **Linux** (x64) | ✅ | build-essential 필요 (`apt install build-essential`) |

모든 핵심 코드(프로세스 생성, 경로 처리, 파일 다이얼로그, 터널 등)가 플랫폼별 분기 처리되어 있어 추가 설정 없이 동작합니다.

## 사전 요구사항

| 항목 | 최소 버전 | 확인 명령어 |
|------|----------|------------|
| Node.js | v18+ | `node --version` |
| npm | v9+ | `npm --version` |
| Git | v2.20+ | `git --version` |
| Claude CLI | 최신 | `claude --version` |
| cloudflared (선택) | 최신 | `cloudflared --version` (npm 패키지 번들로 별도 설치 불필요) |

#### macOS 추가 요구사항

네이티브 모듈(`better-sqlite3`, `node-pty`) 컴파일을 위해 Xcode Command Line Tools가 필요합니다:

```bash
xcode-select --install
```

#### Linux 추가 요구사항

```bash
sudo apt install build-essential python3   # Debian/Ubuntu
sudo dnf groupinstall "Development Tools"  # Fedora/RHEL
```

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

## 설치 및 실행

### 방법 A: npm 글로벌 설치 (추천)

가장 간단한 방법입니다. git clone이나 환경 설정 없이 바로 사용할 수 있습니다.

```bash
npm i -g clitrigger
```

#### 첫 실행

```bash
clitrigger
```

서버가 바로 시작됩니다:
```
Welcome to CLITrigger!
Config created at C:\Users\<user>\.clitrigger\config.json
Open the web UI to set your password on first launch.
🚀 CLITrigger running at http://localhost:3000
```

브라우저에서 `http://localhost:3000` 접속 → 셋업 화면에서 비밀번호를 설정합니다. 외부 공유(Cloudflare 터널)는 셋업이 끝날 때까지 자동 시작되지 않아 첫 사용자가 본인임이 보장됩니다. 이후 비밀번호 변경은 웹 UI의 **설정 → 계정** 탭에서 합니다.

#### 이후 실행

```bash
clitrigger
```

#### 설정 변경

```bash
clitrigger config                  # 현재 설정 보기
clitrigger config port 8080        # 포트 변경
clitrigger config tunnel on        # Cloudflare 터널 활성화
clitrigger config tunnel hostname app.example.com  # 커스텀 도메인 라우팅
clitrigger config path             # 설정 디렉토리 경로 확인
clitrigger config clear            # 설정/DB 전체 삭제 (~/.clitrigger/)
clitrigger --help                  # 도움말

# 비밀번호는 이제 웹 UI에서만 관리합니다 (설정 → 계정 탭).
```

#### 데이터 저장 위치

| 파일 | 경로 |
|------|------|
| 설정 | `~/.clitrigger/config.json` |
| DB | `~/.clitrigger/clitrigger.db` |
| 워크트리 | 각 프로젝트 폴더 안 `.worktrees/` |
| 디버그 로그 | 각 프로젝트 폴더 안 `.debug-logs/` |

---

### 방법 B: 소스에서 직접 설치 (개발용)

#### 1단계: 프로젝트 설치

```bash
git clone https://github.com/OSgoodYZ/CLITrigger.git
cd CLITrigger

# 서버 의존성 설치
npm install

# 클라이언트 의존성 설치
cd src/client && npm install && cd ../..
```

#### 2단계: 환경 설정

```bash
# .env 파일 생성
cp .env.example .env
```

`.env` 파일을 열어서 수정:

```env
PORT=3000                    # 서버 포트
AUTH_PASSWORD=                # 선택 — 비우면 첫 접속 시 웹 셋업 화면이 뜬다.
                              #        값이 있으면 1회만 사용 후 hash로 변환·저장됨.
TUNNEL_ENABLED=false         # Cloudflare Tunnel 사용 여부 (셋업 전엔 자동 시작 안 됨)
TUNNEL_NAME=                 # Named Tunnel 이름 (선택)
TUNNEL_HOSTNAME=             # Named Tunnel 커스텀 도메인 (선택, TUNNEL_NAME 필수)
LOG_RETENTION_DAYS=30        # 로그 보관 일수
HEADLESS=false               # true면 정적 파일 서빙 비활성화 (API 전용, 플러그인용)
DISABLE_AUTH=false           # true면 인증 비활성화 (로컬 플러그인 전용)
```

#### 3단계: 실행

##### 원클릭 실행 (Windows 전용)

`scripts/` 폴더의 bat 파일을 더블클릭하면 터미널 명령어 입력 없이 바로 실행할 수 있습니다.

| 파일 | 기능 |
|------|------|
| `scripts/install.bat` | 서버+클라이언트 의존성 한번에 설치 |
| `scripts/dev.bat` | 개발 모드 실행 (서버+클라이언트 동시) |
| `scripts/build.bat` | 프로젝트 전체 빌드 |
| `scripts/start.bat` | 프로덕션 서버 실행 |
| `scripts/start-tunnel.bat` | 터널 모드로 프로덕션 실행 |
| `scripts/build-and-start.bat` | 빌드 후 바로 프로덕션 실행 |
| `scripts/test.bat` | 전체 테스트 실행 |
| `scripts/typecheck.bat` | TypeScript 타입 체크 |
| `scripts/build-plugin.bat` | Hecaton 플러그인 빌드 (ZIP 생성) |

> 처음 설치할 때: `install.bat` → `dev.bat` 순서로 더블클릭하면 끝!

##### macOS / Linux

`.bat` 스크립트는 Windows 전용입니다. macOS/Linux에서는 아래 `npm run` 명령어를 사용하세요. 모든 `package.json` 스크립트는 크로스 플랫폼 호환됩니다.

##### 터미널에서 직접 실행 (모든 플랫폼)

###### 개발 모드 (로컬에서 사용)

```bash
npm run dev
```

이 명령어 하나로:
- **Backend** → `http://localhost:3000` 에서 실행 (자동 재시작)
- **Frontend** → `http://localhost:5173` 에서 실행 (HMR)

브라우저에서 `http://localhost:5173` 접속 → 비밀번호 입력 → 사용 시작.

###### 프로덕션 모드

```bash
# 빌드
npm run build

# 실행
npm run start
```

빌드 후에는 `http://localhost:3000` 하나로 프론트엔드+백엔드 모두 서빙.

###### 외부 접속 모드 (Cloudflare Tunnel)

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
3. 로컬 프로젝트 폴더 경로 입력 (예: Windows `C:\Users\me\projects\my-web-app`, macOS `/Users/me/projects/my-web-app`)
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

### 4. 후속 작업 (Continue)

완료된 TODO에 추가 지시를 보내 동일 워크트리에서 후속 작업을 수행할 수 있습니다.

1. 완료된 TODO의 **Continue** 버튼 클릭
2. 후속 프롬프트 입력 (예: "테스트 코드도 추가해주세요")
3. 동일 워크트리에서 새 라운드로 실행 (Claude CLI `--continue`로 세션 이어받기)

- 여러 번 Continue 가능 (라운드별 로그 구분)
- 워크트리가 삭제된 경우 Retry로 처음부터 재시작

### 5. 중지

- **STOP ALL**: 모든 실행 중인 작업 중지
- **개별 ■ 버튼**: 특정 작업만 중지
- 중지해도 worktree와 커밋은 보존됨

### 6. 결과 확인

- **View Diff**: 완료된 TODO의 변경사항 확인
- **Merge to Main**: 완료된 브랜치를 main에 머지

### 7. 프로젝트 설정

프로젝트 상세 페이지에서 설정 가능:
- **동시 실행 수**: 한번에 몇 개의 Claude를 돌릴지 (1~10, 기본 3)
- **Claude 모델**: 사용할 모델 선택
- **추가 CLI 옵션**: Claude CLI에 전달할 추가 플래그
- **워크트리 격리**: 워크트리 사용 여부 토글 (아래 참조)
- **gstack 스킬**: AI 스킬 주입 설정 (아래 참조)

#### 워크트리 격리 on/off

기본적으로 모든 TODO는 독립된 git worktree에서 실행됩니다. 단순 작업이나 워크트리 오버헤드가 불필요한 경우, 프로젝트 설정에서 **워크트리 격리**를 끌 수 있습니다.

| 모드 | 설명 |
|------|------|
| **워크트리 사용** (기본) | TODO마다 독립 worktree 생성. 병렬 실행, 브랜치 머지 지원 |
| **직접 실행** | 메인 브랜치에서 직접 작업. 동시 실행이 자동으로 1로 제한됨 |

> **⚠ 주의**: 직접 실행 모드에서는 충돌 방지를 위해 서버가 동시 실행 수를 **강제로 1**로 제한합니다. 머지 버튼은 표시되지 않으며, CLI가 직접 커밋합니다.

#### 워크트리 생성 시 `npm install` 자동 실행 (opt-in)

워크트리 격리 하위 옵션으로 **npm install 자동 실행** 체크박스가 있습니다. 기본값은 **OFF** — CLITrigger는 언어 불문 오케스트레이터이므로 `package.json`이 있다는 이유만으로 설치를 돌리지 않습니다.

| 설정 | 동작 |
|------|------|
| **OFF** (기본) | 워크트리 생성 후 의존성 설치를 건너뜀. pnpm/yarn/bun 프로젝트나 비-JS 프로젝트에서 불필요한 `node_modules/` 생성 방지 |
| **ON** | 워크트리 루트와 `src/client/`에 `package.json`이 있으면 백그라운드에서 `npm install` 실행. 에이전트가 곧바로 테스트/빌드를 돌려야 하는 npm 프로젝트에 권장 |

> 이 옵션은 워크트리 격리가 켜져 있을 때만 활성화됩니다.

#### TODO별 워크트리 오버라이드

git 저장소 프로젝트에서는 TODO 추가/수정 시 **워크트리 설정**을 TODO 단위로 오버라이드할 수 있습니다.

| 옵션 | 동작 |
|------|------|
| **프로젝트 설정 따름** (기본) | 프로젝트의 워크트리 격리 설정을 그대로 사용 |
| **워크트리 사용** | 이 TODO는 항상 독립 worktree에서 실행 |
| **메인 브랜치에서 실행** | 이 TODO만 메인 브랜치에서 직접 실행. 서버가 다른 todo와 동시 실행을 차단(deferred)하고, 다른 작업이 끝나면 자동으로 재시도 |

> 짧은 패치/문서 수정 같은 작업을 메인 브랜치에서 바로 실행하거나, 프로젝트 기본이 OFF여도 특정 작업만 격리하고 싶을 때 활용합니다. 메인 브랜치 실행 todo는 `.git` 동시 조작을 피하기 위해 단독 실행이 강제됩니다.

### 8. 스케줄 (Cron 반복 실행)

프로젝트별로 cron 스케줄을 설정하면, 정해진 시간에 자동으로 TODO가 생성되어 실행됩니다.

#### 설정 방법

1. 프로젝트 상세 페이지에서 **스케줄** 탭 진입
2. **"Add Schedule"** 클릭
3. 제목, 설명, cron 표현식 입력
4. 필요 시 **Skip if running** 옵션 활성화 (이전 실행이 진행 중이면 건너뜀)
5. 저장 → 자동으로 활성화

#### cron 표현식 예시

| 표현식 | 의미 |
|--------|------|
| `0 9 * * *` | 매일 오전 9시 |
| `0 */2 * * *` | 2시간마다 |
| `30 18 * * 1-5` | 평일 오후 6시 30분 |
| `0 0 * * 0` | 매주 일요일 자정 |

#### 관리 기능

- **활성화/비활성화**: 토글로 ON/OFF (cron 등록/해제)
- **수동 트리거**: 스케줄 시간과 무관하게 즉시 실행
- **실행 이력**: 최근 실행 결과 (triggered/skipped/failed) 조회
- **삭제**: 스케줄 삭제 시 cron 자동 해제

### 9. TODO별 CLI 도구 & 모델 선택

프로젝트 기본 설정 외에, 개별 TODO마다 다른 CLI 도구와 모델을 지정할 수 있습니다.

- TODO 추가/수정 시 **CLI Tool** (Claude / Gemini / Codex)과 **Model** 선택 가능
- 미지정 시 프로젝트 기본값 사용

### 10. 통합 플러그인 시스템

CLITrigger의 외부 서비스 연동(Notion, GitHub, Jira)과 실행 훅(gstack 스킬)은 **플러그인 아키텍처**로 구현되어 있습니다.

#### 플러그인 구조

- **서버**: `src/server/plugins/{plugin-id}/` — `PluginManifest` + Express 라우터
- **클라이언트**: `src/client/src/plugins/{plugin-id}/` — `ClientPluginManifest` + 패널/설정 컴포넌트
- **설정 저장**: `plugin_configs` 테이블 (프로젝트×플러그인×키 단위 key-value)

#### 플러그인 카테고리

| 카테고리 | 설명 | 플러그인 |
|----------|------|---------|
| `external-service` | REST 프록시 + 패널 탭 + 설정 UI | Jira, GitHub, Notion |
| `execution-hook` | 태스크 실행 전 훅 (오케스트레이터) | gstack |

#### 플러그인 설정 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | /api/plugins | 등록된 플러그인 목록 |
| GET | /api/plugins/:pluginId/config/:projectId | 프로젝트별 플러그인 설정 조회 |
| PUT | /api/plugins/:pluginId/config/:projectId | 프로젝트별 플러그인 설정 저장 |

> 기존 프로젝트의 통합 설정(jira_enabled, github_token 등)은 서버 시작 시 자동으로 `plugin_configs` 테이블로 마이그레이션됩니다. 레거시 컬럼도 호환성을 위해 유지됩니다.

---

### 11. Notion 연동 (선택)

Notion 데이터베이스를 CLITrigger 프로젝트에 연결하면, Notion에 작성한 피쳐 기획서나 버그 리포트를 바로 AI 태스크로 Import할 수 있습니다.

#### 사전 준비

1. [notion.so/my-integrations](https://www.notion.so/my-integrations)에서 **Integration 생성** → API 키 복사
2. 사용할 Notion **데이터베이스 페이지** → 우상단 `...` → 연결 → 생성한 Integration 선택
3. 데이터베이스 URL에서 **Database ID** 복사
   - URL 형식: `https://www.notion.so/{workspace}/{database_id}?v=...`
   - `?v=` 앞의 32자리 hex 문자열이 Database ID

#### 활성화 방법

1. 프로젝트 설정(톱니바퀴) 클릭
2. **Notion** 섹션에서 토글 ON
3. **API Key** 입력 (Integration에서 복사한 키)
4. **Database ID** 입력
5. **Test Connection** 클릭하여 연결 확인
6. 저장

#### 사용법

1. 프로젝트 상세 페이지에서 **Notion** 탭 진입
2. Notion 데이터베이스의 페이지 목록이 표시됨
3. **검색**: 페이지 제목으로 검색
4. **상세 보기**: 페이지 클릭 → 블록 콘텐츠 확인
5. **Import**: 페이지의 **Import** 버튼 클릭 → 제목과 본문이 자동 추출되어 CLITrigger 태스크로 생성
6. **생성**: Notion 데이터베이스에 새 페이지 추가도 가능

#### 워크플로우 예시

```
Notion에 피쳐 기획서 작성
  → CLITrigger Notion 탭에서 Import
    → AI(Claude/Gemini)가 기획서 기반으로 자동 구현
      → 결과 확인 후 Merge
```

> Notion 페이지의 제목이 태스크 제목이 되고, 블록 콘텐츠가 마크다운으로 변환되어 AI에게 전달되는 설명이 됩니다.

---

### 12. GitHub Issues 연동 (선택)

GitHub 레포지토리의 이슈를 CLITrigger에서 직접 조회하고, AI 태스크로 Import할 수 있습니다.

#### 사전 준비

1. GitHub **Personal Access Token** 생성 (Settings → Developer settings → Personal access tokens)
   - 권한: `repo` (이슈 읽기/쓰기)
2. 연동할 레포지토리의 **Owner**와 **Repo 이름** 확인

#### 활성화 방법

1. 프로젝트 설정(톱니바퀴) 클릭
2. **GitHub** 섹션에서 토글 ON
3. **Token** 입력 (Personal Access Token)
4. **Owner** 입력 (예: `OSgoodYZ`)
5. **Repo** 입력 (예: `CLITrigger`)
6. **Test Connection** 클릭하여 연결 확인
7. 저장

#### 사용법

1. 프로젝트 상세 페이지에서 **GitHub** 탭 진입
2. 이슈 목록 표시 (open/closed 필터, 라벨 필터, 검색)
3. **상세 보기**: 이슈 클릭 → 본문 + 코멘트 확인
4. **Import**: 이슈의 **Import** 버튼 클릭 → 제목과 본문이 CLITrigger 태스크로 생성
5. **이슈 생성**: GitHub 레포에 새 이슈 추가도 가능
6. **코멘트**: 이슈에 코멘트 작성 가능

### 13. 모델 관리

CLI 도구별 사용 가능한 모델 목록을 커스터마이즈할 수 있습니다. 프로젝트 설정에서 모델 관리 버튼을 클릭하여:

- 새 모델 추가 (CLI 도구, 모델 ID, 표시명)
- 기존 모델 삭제
- 기본 모델 설정

서버 시작 시 기본 모델이 자동 시딩됩니다 (Claude Sonnet/Opus/Haiku, GPT-4.1 계열, Gemini 등).

### 14. 세션 (Interactive Sessions)

세션은 "수동 대화" 전용 엔티티입니다. TODO가 지시를 받아 자동 실행된다면, 세션은 사용자가 CLI와 직접 대화할 수 있는 장시간 상호작용 세션입니다.

#### 생성

1. 프로젝트 상세 페이지에서 **세션** 탭 진입
2. **"Add Session"** 클릭
3. 제목(선택 — 빈 칸이면 서버가 `Session YYYY-MM-DD HH:MM`으로 자동 채움), CLI 도구(Claude/Gemini/Codex), 모델, (Git 저장소라면) 워크트리 사용 여부, 색상 태그(글로벌 설정에서 미리 만들어 두면 dropdown 노출) 선택
4. 저장

> **워크트리 디폴트 상속**: 신규 세션의 워크트리 체크박스 디폴트는 `프로젝트 use_worktree` 설정을 따르고, 그 위에 글로벌 **Settings → Sessions** 탭의 "Default use worktree"가 override 합니다. 편집 모드는 기존 세션 값을 그대로 유지.

#### 색상 태그 + 글로벌 디폴트 (Settings → Sessions)

좌상단 사이드바 톱니로 글로벌 **Settings 모달**(사이드바 하단에 현재 빌드 버전 `v<version>` 표기) → **Sessions** 탭에서:
- **태그 CRUD**: 이름 + 헥스 색(`#RRGGBB`) 페어 등록. 한 번 만든 태그는 모든 프로젝트에서 공유. 태그 삭제 시 그 태그를 참조하던 세션의 `tag_id`는 자동으로 비워짐.
- **워크트리 디폴트**: 신규 세션 생성 시 워크트리 체크박스 초기값을 강제 (프로젝트 정책 위에 한 번 더 override).
- **터미널 기본 폰트 사이즈**: 8-28px 범위 range + number input. 350ms 디바운스 저장, 라이브 broadcast로 per-session 줌이 없는 세션이 즉시 반영. 이미 줌된 세션은 자기 사이즈 유지.

#### 사용

- 세션 카드에서 **▶** 버튼 또는 **행 클릭**으로 세션 열기
  - **▶ 버튼**: 새 floating window에서 세션 시작 (PTY를 실제 viewport 크기로 초기화하여 CLI TUI 정렬 정확)
  - **행 클릭**: 기존 세션을 floating window에서 열기 (재생 모드, Start 버튼 클릭 시 시작)
- **Floating Window UI**:
  - macOS 스타일의 titlebar로 드래그 가능, 8방향 리사이즈 (4 엣지 + 4 코너) 지원 (코너가 z-index 우선)
  - 최소 320×200, 위치와 크기는 per-session 저장
  - 모바일 (<768px)에서는 fullscreen 모드로 자동 전환
  - ❌ 버튼으로 닫을 수 있음 (실행 중이면 확인 요청)
- **VS Code 스타일 윈도우 그룹화 / 도킹**:
  - 탭을 다른 윈도우로 드래그하면 5-zone 다이아몬드 (top/bottom/left/right/center) — 사이드 드롭은 분할 pane, center 드롭은 같은 stack에 탭으로 합침
  - 단일-stack 윈도우는 chrome 자체로 드래그/도킹 (split된 그룹은 chrome drag = move-only)
  - Splitter (4px 바)로 pane 사이즈 조정, 모든 탭 mount 유지로 PTY 출력 끊김 없음
  - 탭을 source 그룹 rect 밖으로 12px 이상 끌면 즉시 floating으로 detach (eager tab tearing)
- **Aero 스타일 스냅 + Dock Tray**:
  - 뷰포트 가장자리 8px 내로 드래그 시 좌/우 절반 또는 4 코너 quarter로 스냅 (preview 표시 후 commit)
  - 윈도우 간 sticky 스냅 (10px threshold) — 인접 윈도우 엣지에 자석처럼
  - 타이틀바 minimize 버튼 → 좌하단 dock tray에 chip으로 보관, 클릭 시 restore (서버 PTY는 그대로 살아있음)
  - dock tray의 칩은 드래그로 **재정렬**할 수 있고(`sessionDockOrder` 영속), 왼쪽 grip 핸들을 드래그해 트레이의 **가로 위치**를 옮길 수 있음(`sessionDockTray:left` 영속, 하단 고정 유지)
  - **멀티 윈도우(별도 창) 상태 표시 + 중앙으로 불러오기**: 윈도우를 별도 OS 창(popout)으로 빼내면 터미널 목록의 해당 행에 **별도 창** 배지가 뜨고, 행 클릭 또는 "중앙으로 불러오기" 버튼으로 메인 창 안 플로팅으로 복귀(re-dock, 세션 유지). 별도 창은 하단 dock tray에도 칩으로 표시되고(클릭 시 복귀), 팝아웃 무응답 시 1.5s 후 강제 회수 폴백
- **per-session 폰트 크기**: 탭바의 A−/A+ 버튼, Ctrl/Cmd `+`/`-` 단축키, 또는 **Ctrl/Cmd + 마우스 휠**로 8-28px 조정. 글로벌 기본값(Settings → Sessions)에서 출발하고 줌 즉시 per-session 영속화. PTY는 cell grid가 실제로 바뀔 때만 resize 브로드캐스트(welcome banner 중복 방지)
- **탭 사이클 (`Ctrl+Tab` / `Ctrl+Shift+Tab`)**: 같은 그룹 안의 다음/이전 탭으로 순환. xterm 터미널 viewport에 focus가 있을 때만 동작하므로 폼 입력에는 영향 없음. 단일 탭 stack에서는 키가 PTY로 fall-through됨 (일부 TUI가 native로 Ctrl+Tab을 쓸 수 있음을 고려)
- **새 raw-shell 탭 (`"+"` 버튼 / `Ctrl+T` / `Cmd+T`)**: 탭바 우측의 "+" 버튼이나 글로벌 단축키로 즉시 raw-shell 세션을 spawn. main-owned 가시 그룹이 있으면 거기에 탭으로 삽입, 없으면 새 floating window를 띄움. AI CLI 세션은 폼 경로(`Add Session`) 그대로 유지 — "+" 단축 경로는 빠른 OS 셸 spawn 전용. xterm은 같은 조합을 swallow해 PTY로 `^T`가 흘러가지 않음
- **활성 윈도우 시각 표시 + 바디 클릭으로 raise**: 여러 floating window를 동시에 띄운 상태에서 topmost(z 최상위) 윈도우의 border가 info 톤으로 바뀌고 outer ring + 부드러운 glow가 적용됨. 어디로 키 입력이 갈지 시각으로 즉시 확인 가능. 터미널 viewport 어디든 클릭하면 그 윈도우가 raise됨 (chrome을 따로 잡지 않아도 됨)
- **per-session 터미널 테마**: 탭바의 팔레트 버튼으로 8개 브랜드 프리셋(Default/Claude/Vercel/Supabase/Stripe/Spotify/Ferrari/NVIDIA) 또는 Custom 5색 native color picker 선택. localStorage 영속화 (DB 마이그레이션 없음)
- **xterm.js 렌더링**: ANSI 컬러, 커서 제어, TUI 박스 그리기 등이 그대로 표시되어 실제 터미널과 동일한 시각
- 입력창에 메시지 입력 → Enter로 전송 (PTY로 stdin relay). 화살표/Ctrl+C 등 특수키도 그대로 전달
- **복사/붙여넣기**: 텍스트 선택은 마우스 드래그, 복사/잘라내기/전체 선택은 **우클릭 컨텍스트 메뉴**로 수행합니다. `Ctrl/Cmd+C`·`Ctrl/Cmd+X`는 더 이상 선택을 가로채지 않고 항상 PTY로 전달(`^C` = SIGINT)되어 터미널 인터럽트와 겹치지 않습니다. 붙여넣기는 `Ctrl/Cmd+V`·`Alt+V`·우클릭 메뉴 모두 가능. macOS는 `Option`을 Meta로 인식해 `Option+B`/`F` 같은 readline/tmux 단축키 정상 동작 (복사/붙여넣기는 보안 컨텍스트 = localhost·HTTPS에서만 동작)
- **이미지 페이스트**: 터미널에 스크린샷/이미지를 붙여넣으면 서버가 호스트 OS 클립보드에 비트맵을 직접 push하고 클라이언트가 PTY에 `ESC+v`(Alt+V)를 보내 Claude/Codex/Gemini가 자체 paste 핸들러로 `[Image #N]`을 렌더합니다. 사용자 프로젝트 트리에 디스크 파일이 만들어지지 않습니다 (Win32: PowerShell `Clipboard.SetImage` 메모리, macOS: `os.tmpdir()` 임시 파일 + osascript + 즉시 unlink, Linux: `wl-copy`/`xclip` stdin)
- **한글 IME 합성 오버레이 (데스크톱)**: 합성 중 텍스트가 터미널 좌하단에 작은 알약 오버레이로 항상 보이며, `pointer-events: none`이라 TUI 입력을 가리지 않습니다. 아울러 xterm 자체의 인라인 합성 미리보기(`.composition-view`)는 CSS로 숨겨, 실행 중인 CLI가 입력창에 직접 그리는 커서 옆에 조합 글자가 분리돼 보이던 어색함을 제거하고 좌하단 오버레이로 일원화했습니다. 모바일은 별도의 `HangulComposer` 경로 유지.
- **워크스페이스 전환 시 자동 최소화**: 다른 프로젝트로 이동하면 main이 소유한 visible 세션 그룹들이 모두 좌하단 dock tray의 칩으로 자동 축소됩니다 (서버 PTY는 그대로 생존). 다시 같은 프로젝트로 돌아오지 않아도 칩 클릭으로 어디서든 복귀 가능. 별도 OS 윈도우로 popout된 그룹은 의도적으로 칩 자동 생성에서 제외됩니다 (이미 OS 윈도우가 핸들 역할).
- **■**로 일시 중지, **Cleanup** 버튼으로 워크트리 정리 (실행 중이 아닐 때만 표시)
- 세션 row의 **Edit2** 버튼으로 인라인 편집 (running 시 disabled): 제목/설명/CLI/모델/워크트리 + 위키 주입 모드/항목 수정 가능
- Git 저장소 프로젝트에서는 워크트리에 격리된 브랜치에서 작업 가능
- 로그 보기: Chat/Raw 모드 (Chat: 어시스턴트 마크다운 + 접이식 tool_use, Raw: 기존 평면 로그)

#### 위키 주입 + Send/Skip pre-flight

세션 생성/편집 시 위키 주입 모드 (None/All/Selected/Auto)와 항목을 지정하면, 세션 시작 시 초기 프롬프트가 자동으로 PTY에 전송되지 않고 **보류**됩니다. 터미널 상단에 "Initial prompt ready · N chars" 배너가 뜨며 **Preview / Send / Skip** 버튼으로 검토 후 명시적으로 처리합니다. 위키 주입 없이 description만 있는 경우에도 동일하게 작동합니다 (둘 다 비어 있으면 배너 없이 빈 입력으로 시작).

#### iOS Safari 모바일 Hangul IME

모바일 오버레이 textarea에서 한글 조합이 분리되어 PTY로 전달되던 iOS Safari 18 버그는 클라이언트 사이드 두벌식 composer로 해결되어 있습니다 (iOS가 compositionevent를 발생시키지 않아도 OS가 splice한 결과를 다시 조립). 이중 모음/복합 종성 일부는 분리 syllable로 commit될 수 있으나 일반 채팅/CLI 입력은 정상 작동.

> Claude/Gemini/Codex 모두 interactive 모드 지원. Codex는 top-level TUI로, Gemini는 welcome screen의 trust 다이얼로그를 자동으로 처리합니다.

### 15. Favorites (즐겨찾기 런처)

자주 사용하는 외부 도구(실행파일, 셸 명령, URL/폴더)를 등록하여 프로젝트 상관없이 사이드바에서 한 번의 클릭으로 실행합니다. OS 셸로 매번 전환할 필요 없이 CLITrigger UI 내에서 환경 설정이나 외부 도구를 바로 띄울 수 있습니다.

#### 등록

1. 사이드바의 **FAVORITES** 섹션에서 **"+"** 버튼 클릭
2. **제목** 입력 (예: `VS Code`, `Figma`)
3. **타입** 선택:
   - **실행파일**: .exe / 셀 스크립트. 목표 경로 + 선택적 인자 입력
   - **셸 명령**: 직접 실행할 명령어 (예: `git status`, `npm start`)
   - **URL**: http(s):// 링크 (예: `https://figma.com/files`)
4. 타입별로 필요한 정보 입력:
   - 실행파일/명령: **Target** (필수, 실행파일은 옆 **"찾아보기"** 버튼으로 OS 파일 탐색기에서 선택 가능 — 웹/앱 공통), **Args** (선택, 64개 항목까지), **CWD** (선택, 작업 디렉터리)
   - URL: **Target** (필수, http(s)://)
5. 저장 → 사이드바의 FAVORITES에 아이콘 + 이름으로 표시

#### 사용

- **행 클릭** → 즉시 실행 (fire-and-forget, 결과 캡처 안 함)
- **호버 시 Edit/Delete 버튼** 표시
- 실행 시 워킹 디렉터리(CWD)는 지정한 경로를 사용하고, 미지정 시 OS 기본값
- 비밀번호를 알면 누구나 이들 도구를 실행할 수 있으므로, 터널 모드 사용 시 주의 필요

### 16. Planner (경량 작업 관리)

Planner는 CRUD + 태그 + 우선순위 기반의 경량 작업 관리 기능입니다. 아이템을 TODO·스케줄·인터랙티브 터미널 세션으로 변환하여 실제 실행 단계로 넘길 수 있습니다.

#### 기능

- 테이블 뷰 (컬럼: 제목, 우선순위, 태그, 상태, 액션)
- 인라인 편집 (클릭 시 편집 모드, Enter 저장)
- 태그 관리 (자동 색상 할당, 색상 피커, rename, 삭제, 쉼표 delimiter)
- 컬럼 정렬 (제목/우선순위/태그)
- 이미지 첨부
- **TODO로 변환**: CLI 도구/모델 선택하여 즉시 TODO 생성
- **스케줄로 변환**: cron 표현식 설정하여 반복 실행 스케줄 생성
- **터미널(세션)으로 변환**: CLI 도구/모델 + 워크트리 토글을 골라 인터랙티브 터미널 세션을 즉시 생성 (`convert-to-session`)
- **Markdown Export/Import**: 프로젝트·설치 간 Planner 상태를 Markdown으로 내보내고 불러오기. Export는 status별 섹션(`## Pending` / `## In Progress` / `## Done`) + GFM 체크박스 + HTML 주석 메타(tags/priority/due)로 직렬화하여 다운로드(`planner-{projectSlug}-{yyyymmdd}.md`). GitHub/Obsidian/Markdown 뷰어에서 그대로 열람·편집 가능. Import는 원자적 트랜잭션으로 삽입하며 기존 태그 색상을 보존. 이미지 첨부는 Export에 포함되지 않음(아이템 저장만 보존)
- **드래그-드롭 Import**: Planner 카드 영역에 `.md`/`.markdown` 파일을 드래그하면 즉시 Import 시작. 다른 확장자/MIME은 alert로 거부
- **Discussion 추출 아이템**: 완료된 Discussion에서 "Send to Planner"로 변환된 항목은 **"From Discussion"** 배지가 표시되며 클릭 시 원 Discussion으로 이동

### 17. 실행 분석 대시보드 (Analytics)

프로젝트 상세 페이지의 **분석** 탭에서 실행 통계를 확인할 수 있습니다.

#### 지표

- **기간 필터**: 7일 / 30일 / 90일 / 전체
- **Summary 카드**: 총 실행 수, 성공률, 총 비용(USD), 총 토큰
- **상태 분포**: completed/failed/stopped 도넛 차트
- **CLI 도구별 비용**: 스택드 바 차트
- **일별 활동**: cost/tokens 탭 전환이 가능한 라인 차트

비용/토큰은 `todos.total_cost_usd`/`total_tokens` 컬럼에 비정규화되어 있어 순수 SQL 집계로 빠르게 계산됩니다.

### 18. CLI 설치 상태 체크

프로젝트 설정 패널을 열 때 Claude/Gemini/Codex CLI의 설치 여부를 자동 확인합니다.

- CLI 드롭다운 아래에 **녹색/빨강 인디케이터 + 버전** 표시
- 미설치 시 `npm install -g @anthropic-ai/claude-code` 등 설치 가이드 배너 표시
- **Refresh 버튼**으로 재확인 가능 (60초 캐싱)

### 19. Rate Limit 자동 재스케줄

Claude CLI가 rate limit에 걸리면, 서버가 `rate_limit_event`를 감지하여 리셋 시각을 저장합니다. TODO 항목에서 **"리셋 시점에 실행 예약"** 버튼으로 해당 시각에 1회성 스케줄을 생성할 수 있습니다.

- pending/failed/stopped 등 startable 상태에서 모두 사용 가능
- 리셋 시각은 `GET /api/rate-limit`으로 조회 가능
- 서버 시작 시 현재 rate limit 상태를 복구

### 20. 브라우저 알림

긴 태스크/토론이 완료되거나 실패했을 때 OS 레벨 브라우저 알림을 받을 수 있습니다.

- 사이드바의 **종 아이콘** 토글로 on/off (localStorage에 영속)
- 첫 활성화 시 브라우저 permission 요청
- 브라우저가 permission을 거부하면 toggle에 차단 tooltip 표시

### 21. 샌드박스 모드

CLI 도구가 워크트리 디렉토리 밖의 파일에 접근하지 못하도록 제한하는 보안 기능입니다.

#### 모드

| 모드 | 설명 |
|------|------|
| **strict** (기본값) | CLI별 네이티브 샌드박싱 활용. 워크트리 디렉토리 내로 파일 접근 제한 |
| **permissive** | 기존 방식 (`--dangerously-skip-permissions` 등). 시스템 전체 파일 접근 가능 |

#### CLI별 동작

| CLI | strict 모드 동작 |
|-----|------------------|
| **Claude** | `.claude/settings.json` 자동 생성 (dontAsk + 디렉토리 스코프 권한) |
| **Codex** | `--full-auto` + `--add-dir .git` (워크스페이스 샌드박스 + git 메타데이터 접근) |
| **Gemini** | 프롬프트 수준 경로 제한 (네이티브 샌드박싱 미지원) |

#### 설정 방법

1. 프로젝트 설정(톱니바퀴) 클릭
2. **Sandbox Mode** 토글로 strict/permissive 전환
3. permissive로 전환 시 경고 다이얼로그가 표시됨

> **⚠ 보안 권장**: 특별한 이유가 없다면 strict 모드를 유지하세요. permissive 모드는 CLI가 시스템 전체 파일에 접근할 수 있어 의도치 않은 파일 수정 위험이 있습니다.

### 22. Git 클라이언트

Git 탭에서 터미널 전환 없이 주요 Git 작업을 수행할 수 있습니다.

#### 지원 작업

- **커밋**: 파일 스테이징/언스테이징 + 커밋 메시지 입력
- **Pull/Push/Fetch**: 리모트와 동기화
- **브랜치**: 생성, 삭제, 체크아웃
- **병합**: 브랜치 병합
- **스태시**: 변경사항 임시 저장/복원
- **태그**: 태그 생성
- **폐기**: 파일 변경 되돌리기
- **브랜치 ahead/behind 배지**: refs 사이드바의 각 로컬 브랜치에 upstream 대비 앞섬(`N↑`)/뒤처짐(`N↓`)을 배지로 표시(`for-each-ref` 기반). behind는 fetch 후 최신화됨

#### 파일 상태 패널

좌측 사이드바에서 파일 상태를 실시간 확인하고 인라인 액션을 수행할 수 있습니다:
- **Staged**: 커밋 대기 중인 파일 (클릭으로 언스테이지)
- **Unstaged**: 변경됐지만 미스테이징 파일 (클릭으로 스테이지 / 폐기)
- **Untracked**: 새로 추가된 파일

#### 멀티 브랜치 Push 다이얼로그 (SourceTree 스타일)

툴바의 **Push** 버튼은 즉시 push가 아니라 다이얼로그를 엽니다. SourceTree와 같은 워크플로:

- **원격 선택**: 드롭다운으로 원격(`origin` 등)을 고르고 URL을 확인.
- **브랜치 테이블**: 4컬럼 — `Push?` 체크박스 / 로컬 브랜치명 / 원격 브랜치 select(직접 입력 fallback) / `Track?` upstream 토글. 헤더 `Select all`로 전체 on/off.
- **태그 동기화**: `Push all tags`를 켜면 같은 호출에 `--tags` 부착.
- **강제 Push**: `Force push` 토글 — 항상 `--force-with-lease`로 동작해서 stale한 로컬 뷰가 원격을 덮을 수 없음. 다른 사람이 같은 브랜치에 push 했으면 거절되며 fetch 후 재시도하라고 안내.
- **새 브랜치 + upstream**: 처음 push 하는 브랜치에 `Track?`를 켜두면 별도의 `git push -u`로 분리 호출되어 upstream이 자동 설정됨.

> 레거시 콜러(post-commit auto-push, 컨텍스트 메뉴 Push 등)는 서버 라우트에서 자동 어댑팅되므로 그대로 동작합니다.

### 23. SVN 작업 사본 패널 (선택)

SVN 워킹 카피로 굴러가는 프로젝트는 SVN 패널을 opt-in으로 활성화할 수 있습니다. `svn_enabled`만으로 판단하므로 git 리포지토리에서도 SVN 패널을 함께 켤 수 있습니다(듀얼 VCS — Git 탭과 SVN 탭 동시 노출).

#### 활성화

1. 프로젝트 설정에서 **Enable SVN** 체크박스 ON.
2. 저장 시 서버가 `.svn/` 디렉터리 / `svn info` exit code로 워킹 카피인지 검출. 검출 성공 시 SVN 탭이 등장.
3. 호스트에 `svn` 바이너리가 없으면 패널 상단에 설치 안내 배너가 뜸 (TortoiseSVN의 command-line client 또는 `apt install subversion` / `brew install subversion`).

#### 지원 작업

- **파일 상태**: status 멀티 셀렉트 + Refresh / Update / Add / Revert / Delete / Resolve.
- **Working diff**: 우측 패널에 파일별 diff (`DiffViewer` 재사용).
- **Commit**: 메시지 textarea + Cmd/Ctrl+Enter 단축키, 선택 파일 또는 전체 변경.
- **Update**: 특정 revision 또는 HEAD로 working copy 동기화.
- **History**: 리비전 목록 + 각 리비전의 변경 파일 + 파일별 diff.
- **Cleanup**: SVN 잠금 해제.

#### 동시 실행 제약

SVN은 git worktree 같은 격리 메커니즘이 없어, SVN 프로젝트는 `max_concurrent`가 자동으로 1로 강제됨 (Todo / Discussion / Session 모두 직렬 실행). 향후 `.worktrees/<wc>/` checkout copy 격리는 phase-2로 분리.

#### 인코딩

`runSvn` 헬퍼가 모든 호출에 `LC_ALL=en_US.UTF-8` + `LANG=en_US.UTF-8` + `--non-interactive`를 강제 적용. 한글/CJK/이모지 파일명도 status/log/diff에서 깨지지 않으며, 자격증명 프롬프트 hang은 차단됨.

### 24. 에이전트 토론

여러 역할의 AI 에이전트(아키텍트, 개발자, 리뷰어 등)가 하나의 피쳐에 대해 라운드 기반으로 토론하고, 합의 후 구현까지 수행하는 협업 기능입니다.

#### 워크플로우

1. **에이전트 생성**: 프로젝트 내에서 에이전트 페르소나를 정의 (이름, 역할, 시스템 프롬프트, CLI 도구/모델)
2. **토론 생성**: 2개 이상의 에이전트를 선택하고, 토론 주제와 최대 라운드 수를 지정
3. **토론 실행**: 각 라운드에서 에이전트가 순서대로 발언 (이전 발언을 참고하여 의견 제시)
4. **사용자 개입**: 토론 중 메시지 주입, 턴 건너뛰기, 일시 중지/재개 가능
5. **구현**: 토론 완료 후 지정된 에이전트가 합의 내용을 바탕으로 코드 구현
6. **머지**: 구현 완료된 브랜치를 기본 브랜치에 병합

#### 주요 기능

- **에이전트별 CLI 도구/모델 설정**: 에이전트마다 다른 CLI 도구(Claude/Gemini/Codex)와 모델을 사용 가능. 미지정 시 프로젝트 기본값 사용
- **Send to Planner**: 완료된 토론에서 **"Send to Planner"** 버튼으로 트랜스크립트로부터 액션 아이템을 LLM 추출. 추출 모달에서 항목별 체크박스 + 인라인 title/description 편집 + priority 선택 후 저장하면 각 항목이 Planner 아이템으로 영속(`source_discussion_id`로 원 토론 역참조). 추출은 프로젝트의 `cli_tool`을 따르며(Claude/Gemini/Codex), 모달은 추출 진행 중(최대 2분) backdrop/Esc 닫기를 차단합니다
- **자동 구현 (Auto-implement)**: 토론 생성 시 자동 구현 옵션을 켜고 구현 에이전트를 지정하면, 전체 라운드 완료 즉시 해당 에이전트가 자동으로 코드 구현 시작
- **토론 중 구현 (Implement during discussion)**: 에이전트 생성/수정 시 `can_implement` 체크박스를 켜면 해당 에이전트의 일반 턴에서도 코드 변경/커밋이 허용됨(프롬프트가 "최소 프로토타입만"으로 완화). 공유 워크트리/브랜치에 커밋이 쌓이고, 최종 구현 라운드가 남은 부분을 채워 완료. 리스트 행에 망치 아이콘 Implementer 뱃지로 표시
- **메시지 접기/펼치기**: 긴 토론에서 이전 메시지를 접어 최신 대화에 집중 가능. 접힌 상태에서 요약 미리보기(첫 200자) 제공
- **메타데이터 편집**: 토론 생성 후에도 제목, 설명, 참여 에이전트, 최대 라운드 수 수정 가능
- **실시간 스트리밍**: WebSocket으로 에이전트 발언을 실시간 확인
- **워크트리 격리**: 토론별로 독립된 git worktree에서 실행
- **프롬프트 인젝션 방어**: 사용자 입력을 `<user_task>` 태그로 격리
- **다크 모드**: 프로젝트 목록 우측 상단의 테마 토글 버튼으로 라이트/다크 모드 전환. OS 기본 테마 자동 감지

> **참고**: 토론은 프로젝트의 `max_concurrent` 한도를 Todo와 공유합니다.

### 25. 디버그 로깅

프로젝트 설정에서 **디버그 로깅**을 활성화하면 CLI 도구 실행 시 전체 stdin/stdout/stderr를 `.debug-logs/` 디렉토리에 플레인 텍스트 파일로 저장합니다.

- 프로젝트 설정 → "디버그 로깅" 토글 활성화
- 태스크 실행 후 `Debug Log` 버튼으로 로그 파일 확인 (새 탭)
- 서버 시작 시 `LOG_RETENTION_DAYS` 기준으로 오래된 로그 자동 정리

> **참고**: 디버그 로그는 CLI 통신의 raw 내용을 포함하므로 용량이 클 수 있습니다. 디버깅 완료 후 비활성화를 권장합니다.

### 26. Verbose 모드

TODO 실행 시 **Verbose** 옵션을 활성화하면 Claude CLI의 모든 로그를 필터 없이 실시간 스트리밍합니다. 디버깅이나 상세 진행 확인에 유용합니다.

### 27. CLI Fallback Chain

프로젝트 설정에서 **Fallback Chain**을 지정하면, CLI가 컨텍스트 윈도우를 소진했거나 Gemini의 quota가 소진되었을 때 자동으로 다음 CLI/모델로 재시도합니다. 예: Claude Sonnet → Claude Opus → Gemini 순서로 시도.

#### 트리거 조건

| 조건 | 검출 방식 |
|------|----------|
| **Context window 소진** | 단일 매치 (정규식) → 즉시 force-kill 후 다음 CLI |
| **Gemini quota 소진** | `exhausted your capacity` / `quota will reset` 메시지가 60초 내 3회 누적 → force-kill 후 다음 CLI (CLI가 내부 무한 retry로 exit code를 떨어뜨리지 않는 문제 해결) |

---

### 28. Hecaton 플러그인 (선택)

[Hecaton](https://github.com/nickthecook/hecaton) 터미널 멀티플렉서에서 CLITrigger를 TUI 대시보드로 사용할 수 있습니다. 웹 브라우저 없이 터미널 안에서 프로젝트/태스크 관리와 실시간 로그 확인이 가능합니다.

#### 아키텍처

플러그인은 **사이드카 모드**로 동작합니다:
1. 별도로 실행 중인 CLITrigger 서버(`npm run start`)에 HTTP로 연결
2. Hecaton 터미널 셀에 ANSI TUI를 렌더링
3. WebSocket 대신 5초 폴링으로 상태 동기화 (Deno 호환)

#### 빌드

```bash
# Windows
scripts\build-plugin.bat
```

빌드 결과물: `clitrigger-plugin.zip`

#### 설치

1. `clitrigger-plugin.zip` 압축 해제
2. 플러그인 디렉토리에 복사:
   - **Windows**: `%LOCALAPPDATA%\.hecaton\plugins\clitrigger\`
   - **macOS**: `~/Library/Application Support/.hecaton/plugins/clitrigger/`
   - **Linux**: `~/.local/share/.hecaton/plugins/clitrigger/`
3. Hecaton 재시작
4. 탭 메뉴에서 CLITrigger 플러그인 열기

#### 사전 조건

- CLITrigger 서버가 **먼저 실행** 중이어야 합니다 (`npm run start`)
- 플러그인은 `http://127.0.0.1:3000`에 연결을 시도합니다

#### 키 바인딩

| 키 | 기능 |
|----|------|
| `j`/`k` 또는 `↑`/`↓` | 커서 이동 |
| `Enter` | 프로젝트 진입 / 태스크 로그 보기 |
| `b` 또는 `Esc` | 뒤로 가기 |
| `s` | 시작 (프로젝트: 전체 시작, 태스크: 개별 시작) |
| `x` | 태스크 중지 |
| `n` | 새 프로젝트 생성 (프로젝트 뷰) |
| `a` | 새 태스크 추가 (태스크 뷰) |
| `o` | 웹 브라우저에서 열기 |
| `r` | 서버 재연결 |
| `f` | 로그 팔로우 (최신으로 스크롤) |
| `q` / `Ctrl+C` | 종료 |

#### 서버 헤드리스 모드

플러그인과 함께 사용할 때 프론트엔드 정적 파일 서빙이 불필요하면:

```env
HEADLESS=true       # 정적 파일 서빙 비활성화 (API 전용)
DISABLE_AUTH=true   # 인증 비활성화 (로컬 전용 환경)
```

> **⚠ 보안 경고**: `DISABLE_AUTH=true`는 로컬 환경에서만 사용하세요. 외부 접속이 가능한 환경에서는 절대 사용하지 마세요.

---

### 29. gstack 스킬 (선택)

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

### 30. Morning Review Queue (크로스-프로젝트)

밤새 위임한 결과물을 다음날 아침에 한 번에 훑어보기 위한 단일 화면입니다. 모든 프로젝트의 최근 todo를 카드 스택으로 모으고 키보드만으로 승인/discard 결정을 내릴 수 있습니다.

#### 진입 방법

좌측 **사이드바의 "Review Queue"** 링크를 클릭. 24시간 이내 미처리(running 외) todo 개수가 배지로 표시됩니다.

#### 카드 구성

각 카드는 한 todo에 해당하며 다음을 노출합니다:
- 프로젝트 라벨, 제목, 상태 배지, risk 배지(low/medium/high)
- 마지막 어시스턴트 메시지의 한 줄 요약(최대 240자)
- 토큰 합계, diff files / lines
- 마지막 갱신 시각

#### 키보드 조작

| 키 | 동작 |
|----|------|
| `j`/`k` 또는 `↑`/`↓` | 카드 포커스 이동 |
| `Enter` | 우측 상세 패널 열기(임베드 LogViewer) |
| `m` | 머지 |
| `d` | discard (워크트리 정리) |
| `Esc` | 상세 패널 닫기 |

#### 필터

- **시간 윈도우**: 12h / 24h / 7d
- **필터 칩**: All / Risky / Quick wins / Failed
- **상단 토큰 리본**: 윈도우 내 총 토큰 + CLI별 K/M 분해 표기 (sticky)

#### Risk 분류 기준

서버에서 다음 규칙으로 자동 분류합니다:
- `failed` 상태 → **high**
- diff_lines > 300 → **high**
- diff_lines ≥ 50 → **medium**
- 그 외 → **low**

> Review Queue는 새 mutating API를 추가하지 않습니다. merge/discard/continue 모두 기존 todo 엔드포인트(`/api/todos/:id/merge`, `/api/projects/:id/worktree-cleanup`, `/api/todos/:id/continue`)를 그대로 사용합니다.

#### 카드 인라인 diff 펼침

카드에서 Space 또는 →로 변경 파일 목록과 diff를 그 자리에서 펼쳐볼 수 있습니다(Esc로 접기). 워크트리가 정리된 후에도 프로젝트 repo + 브랜치 ref로 폴백하여 diff를 표시하며, base 브랜치(`default_branch`)가 누락된 경우 `master`/`main` 자동 폴백 후 사유 코드와 디버그 정보를 노출합니다.

| 사유 코드 | 의미 |
|----------|------|
| `no-branch` | 워크트리도 브랜치 ref도 남아있지 않음 |
| `branch-missing` | 브랜치 이름은 있으나 로컬 repo에 없음 |
| `base-branch-missing` | `default_branch`도 `master`/`main`도 발견되지 않음 |

---

### 31. 위키 (프로젝트별 Karpathy LLM-Wiki)

프로젝트마다 재사용 가능한 컨텍스트(항목+관계)를 위키 형태로 관리하고, todo와 discussion 프롬프트 앞에 선택적으로 주입할 수 있습니다. 매번 같은 컨텍스트를 붙여 넣는 대신 위키 항목을 만들어 두고 골라서 주입. (UI 라벨은 "Wiki" / "위키"이며, DB 테이블/API 라우트/`<long_term_memory>` 프롬프트 태그는 `memory_*` 명칭을 그대로 유지합니다.)

#### 기능

- **List/Graph 뷰 토글**: 항목 카드 리스트와 ReactFlow 기반 그래프를 전환
- **항목**: 제목, Markdown 본문, 태그, pin, 자유 위치 좌표
- **엣지(관계)**: 5종 — `related`, `precedes`, `example_of`, `counter_example`, `refines`. 그래프에서 drag-to-connect로 추가하고 인라인 편집 가능. `precedes`/`refines`는 cycle 차단
- **자동 레이아웃**: dagre 기반 — 항목 위치를 자동으로 정렬

#### 주입 모드

todo / discussion 폼의 **위키 주입 (Wiki Injection)** 섹션에서 선택:

| 모드 | 동작 |
|------|------|
| **None** (기본) | 위키 주입 없음 |
| **All** | 프로젝트의 모든 위키 항목을 주입 (System 노드는 제외) |
| **Selected** | 선택한 항목만 주입 — 칩 형태로 선택 |
| **Auto** | 매 실행 직전 headless LLM 호출로 todo/discussion 텍스트와 매칭되는 항목만 자동 선택 |

선택 후 **프롬프트 미리보기** 모달로 실제로 LLM에 전달되는 `<long_term_memory>` 블록을 char/token 추정치와 함께 확인할 수 있습니다.

#### 원본 md 파일 동시 주입 (Raw markdown injection)

위와 별개로, 인제스트 시 보존된 원본 md 파일(`.clitrigger/raw/*.md`)을 **큐레이트 노드와 병렬로** 함께 주입할 수 있습니다 (todo/discussion/session 폼의 "원본 md 파일" 섹션). 노드 큐레이션이 압축/요약 과정에서 떨어뜨린 디테일이 필요할 때 원본을 그대로 모델에 전달하는 용도. mode가 `None`이어도 raw 파일이 선택되어 있으면 주입이 발동합니다 (모드와 직교). 파일당 50KB cap, `<raw_source_files>` 블록으로 wrap, `.clitrigger/raw/` 외부 경로는 차단.

#### 동작 방식

- 위키 블록은 프롬프트 **맨 앞에 prepend**되며 Claude/Gemini/Codex 모두 동일하게 동작 (CLI-agnostic)
- 항목 본문 + 인접 엣지가 arrow-notation(예: `항목A —(precedes)→ 항목B`)으로 직렬화
- 매 실행 시 task/discussion 로그에 "injected N nodes (mode=...)" 라인 기록 (내부 식별자는 그대로 "node")
- 토큰 안전성: 노드 본문이 너무 길면 라인 수 cap → fallback으로 title-only 리스팅. Lint도 큰 위키를 chunk로 분할해서 silent truncate 회피
- Activity 서브탭: ingest / lint / retrieve / merge 이벤트가 `memory_logs`에 기록되어 시간순/severity로 추적 가능

#### 디스크 익스포트 (Markdown)

위키를 git/Obsidian에 커밋 가능한 형태로 살릴 수 있습니다. **Export** 버튼을 누르면 DB → `.clitrigger/wiki/<entity>/<slug>.md`로 일방향 익스포트 (YAML frontmatter — id, tags, edges, source_path 포함). 외부에서 디스크 변경 시 **Disk diff**로 변경 파일을 surface, **Rebuild**로 DB→디스크 덮어쓰기. (양방향 sync 아님 — truth source는 DB)

#### System 노드

Schema와 자동 maintain되는 Index 노드는 사이드바 "System" 섹션으로 분리되어 있고 사용자가 수정해도 **덮어씌어집니다** (배너로 명시). 일반 entry group / Lint / mode='all' 인제션 / retrieval candidate에서 모두 제외됩니다.

#### 사용 흐름 예시

```
프로젝트의 핵심 컨벤션/도메인 용어/주의사항을 위키 항목으로 캡처
  → 새 todo 생성 시 위키 주입 섹션에서 관련 항목 선택
    → AI가 컨텍스트를 알고 시작 → 같은 설명 반복 불필요
```

---

### 32. Harness CLI 설정 플러그인

Claude / Gemini / Codex CLI의 사용자 설정 파일(settings, 메모리, MCP 서버)을 IDE를 열지 않고 GUI에서 직접 편집할 수 있는 플러그인입니다.

#### 진입 방법

프로젝트 상세 페이지 헤더의 톱니(설정) 아이콘 → **Harness** 섹션. CLI별 탭(Claude / Gemini / Codex)으로 전환. (이전 버전의 top-level **Harness** 탭은 제거되었습니다 — 매일 만지는 작업 영역이 아니라 setup 성격이라 설정 패널 안으로 이동.)

#### 편집 가능 항목

| 항목 | 설명 |
|------|------|
| **Settings** | 모델 기본값, 시스템 프롬프트 등 CLI별 settings 파일 (deep-merge로 untouched 필드 보존) |
| **Memory** | CLI 메모리 파일 raw editor (`CLAUDE.md`, `GEMINI.md`, `AGENTS.md`) |
| **MCP Servers** | MCP 서버 CRUD — alias / command / args / env (secret 마스킹) |

#### 워크트리 격리 안 됨

> ⚠ 편집 결과는 워크트리(`.worktrees/<branch>/`)가 아니라 **프로젝트 루트의 사용자 설정 디렉토리**(`~/.claude/`, `~/.codex/`, `~/.gemini/`)에 저장됩니다. 패널 상단에 경고 배너가 표시됩니다 — 동일 사용자 환경에서 다른 프로젝트의 설정과 공유될 수 있으니 주의하세요.

#### Codex trust 경고

Codex의 경우 프로젝트가 `~/.codex/config.toml`의 trusted 목록에 없으면 응답에 `trustLevelMissing` 경고가 포함되며 패널에 표시됩니다.

### 33. 파일 탐색기 (Files 탭)

프로젝트 폴더 트리를 앱 안에서 탐색하고 텍스트/이미지/PDF/오디오/비디오를 인라인으로 미리보기. **읽기 전용** — 파일 수정/스테이징은 기존 Git 탭이 담당합니다.

#### 진입 방법

프로젝트 상세 페이지 탭 바 맨 앞의 **Files** 탭. 좁은 뷰포트에서도 가로 스크롤 없이 도달하도록 plugin 탭들보다 앞에 배치되어 있습니다.

#### 사용법

| 기능 | 동작 |
|------|------|
| 트리 확장 | 디렉토리 클릭 시 lazy 자식 fetch (`GET /api/projects/:id/files?path=<rel>`) |
| 파일 미리보기 | 파일 클릭 시 우측 패널에 인라인 렌더링 |
| 텍스트 (≤2MB) | `GET /files/content`로 인라인 텍스트 응답 |
| 이미지 / PDF / 오디오 / 비디오 (≤50MB) | `GET /files/binary`를 `<img>` / `<iframe>` / `<audio>` / `<video>`에 직접 바인딩 |
| 알 수 없는 바이너리 | 다운로드 링크 폴백 |
| 숨김 파일 토글 | 좌측 상단 `Show hidden files`로 dot-prefix 파일 노출 |
| 경로 복사 | 우측 상단 `Copy path` |
| 좌/우 분할 너비 | 가운데 드래그 가능한 리사이저 (localStorage 영속화) |
| Vault 그래프 토글 | 우측 패널 상단 GitBranch 아이콘으로 파일 미리보기 ↔ `.md` wikilink 그래프 전환. 그래프 노드 클릭 시 해당 파일을 미리보기에서 열기 |
| 마크다운 상대 링크 | `[label](./sibling.md)` 같은 상대 경로 링크는 인앱에서 해당 파일로 이동. 외부 URL은 새 탭으로 열기 |
| 파일/폴더 핀-투-탑 | 트리에서 우클릭 → `Pin to top`. 핀된 항목은 트리 상단의 별도 섹션에 amber 핀 아이콘과 함께 표시됨. 다시 우클릭 → `Unpin`으로 해제. 프로젝트별 localStorage 영속화 |
| 파일/폴더 이동 | 트리 항목을 다른 폴더 위로 드래그앤드롭하면 그 폴더 안으로 이동(드래그 오버 시 accent 하이라이트). "Vault root" 헤더로 드롭하면 루트로 이동. 폴더는 하위 트리 통째로 이동(`POST /files/move`) |
| 볼트에서 숨기기 / 다시 보이기 | 우클릭 → `Hide from Vault` → `.vaultignore`에 경로 추가. `Show hidden files`로 보면 숨긴 파일이 흐리게 표시되며, 그 위에서 우클릭 → `Show in Vault`로 `.vaultignore`에서 제거(점파일/기본 hide 항목은 대상 아님) |
| 에디터/프리뷰 Ctrl+휠 줌 | 미리보기/CodeMirror 위에서 `Ctrl/Cmd + 마우스 휠`로 폰트 8-28px 조정 (브라우저 페이지 줌은 가로채서 차단). 좌/우 사이드바는 영향 없음. 프로젝트별 localStorage 영속화 |

#### 트리 상태 영속화

확장된 디렉토리, 숨김 파일 토글, 선택 파일, 핀된 파일/폴더 목록, Vault 폰트 줌 레벨이 프로젝트별 localStorage에 저장됩니다. 탭 전환이나 프로젝트 이동 후 돌아와도 마지막 상태가 복원됩니다. 확장된 디렉토리는 depth별로 그룹화해 병렬 fetch로 빠르게 복원됩니다.

#### 기본 hide 항목

`showHidden=1` 없이는 항상 숨김: `.git`, `node_modules`, `.worktrees`, `.DS_Store`.

#### 경로 트래버설 가드

서버의 `resolveSafe()`가 `path.resolve()` 후 프로젝트 root prefix 검사로 traversal 차단 — `../`로 root 밖으로 나가는 모든 경로는 `403`.

### 34. Vault (파일 기반 위키)

프로젝트 루트의 `.md` / `.html` 파일을 자동으로 스캔하고, `[[wikilink]]`를 파싱해 관계 그래프를 구성하는 Obsidian-style 파일 기반 위키입니다. 기존 DB-backed 위키(섹션 31)와 병렬로 동작하며, 파일이 곧 노드가 되므로 별도 인제스트 없이 프로젝트 문서를 LLM에 주입할 수 있습니다.

#### 동작 방식

1. 서버가 프로젝트 루트를 재귀 스캔해 모든 `.md` / `.html` / `.htm` 파일을 발견. HTML은 `<title>` 태그에서 제목을 뽑고 본문은 태그 제거 후 plain text preview로 인덱싱.
2. 각 파일의 YAML frontmatter(`title`, `tags`)와 본문의 `[[wikilink]]`를 파싱
3. wikilink로 연결된 파일 쌍이 그래프 엣지가 됨
4. Files 탭의 그래프 토글(GitBranch 아이콘)로 ReactFlow force-directed 그래프 시각화

#### 그래프 색상 & 파일 필터링

- **태그 기반 노드 색상**: 그래프 노드는 각 파일의 (알파벳순) 첫 번째 태그를 기준으로 결정론적 HSL 해싱해 자동 채색됩니다. 같은 태그는 항상 같은 색이며, 좌하단 범례 패널에 사용 중인 태그→색 매핑이 표시됩니다. 선택/검색 매치 색상은 태그 색보다 우선합니다.
- **`.vaultignore`**: 프로젝트 루트에 `.vaultignore`를 두면 gitignore 문법으로 스캔/그래프/검색에서 파일을 제외할 수 있습니다. 좌측 사이드바 레일의 Settings 액션에서 모달로 편집하며, 저장 시 그래프가 즉시 리로드됩니다. 하드코딩된 기본 제외 목록(`node_modules` 등)과 함께 적용됩니다.

#### 주입 모드 (VaultInjectControl)

task / session / discussion 폼의 **Vault 주입** 섹션에서 선택. (이전 deprecated `MemoryInjectControl`은 제거되었습니다.)

| 모드 | 동작 |
|------|------|
| **None** (기본) | vault 주입 없음 |
| **Auto** | 태스크 텍스트와 매칭되는 파일을 서버가 자동 선택 |
| **All** | 프로젝트의 모든 vault 파일 내용을 주입 |
| **Selected** | 디렉터리별 그룹화된 파일 목록에서 직접 체크. MD/HTML 아이콘이 구분되어 표시 |

`Selected` 모드에서는 **Include linked** 토글을 켜면 체크한 파일이 `[[wikilink]]`로 가리키는 직접(1-hop) 이웃까지 자동 selection에 포함됩니다. 각 행에는 끌려 들어갈 이웃 수가 `+N개 연결` 배지로 미리 표시되어 어떤 파일들이 추가될지 한눈에 확인할 수 있습니다.

직렬화 형식: 외부 래퍼는 `<long_term_memory>` 그대로, 내부 블록은 `<vault_file type="md" | "html">`로 타입 구분 (MD/HTML 둘 다 같은 채널로 전달).

#### 프리뷰 read-time 상호작용

Vault 마크다운 프리뷰는 정적 뷰어가 아니라 가벼운 인터랙션을 지원합니다. 모두 우클릭 컨텍스트 메뉴 또는 헤더 버튼으로 접근:

| 기능 | 단축키 / 진입 | 동작 |
|------|--------------|------|
| Find / Replace | `Ctrl+F`, `Ctrl+H`, `F3` / `Shift+F3` | 프리뷰는 DOM TreeWalker 하이라이트 + scroll-into-view + wrap-around; 편집 모드는 CodeMirror의 search API로 브리지. Case / Whole word / Regex 토글, invalid-regex 인디케이터 |
| 주석(Annotation) | 헤더 펜 토글 / 컨텍스트 메뉴 | 선택(밑 콘텐츠 클릭 통과) / 펜(2px) / 형광펜(14px, opacity 0.4) / 지우개 / Clear all + Undo·Redo(`Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z`). 진입 기본 도구는 선택. SVG 오버레이가 zoom과 동기화. **ephemeral** — 파일 전환 또는 편집 진입 시 자동 클리어, 어디에도 저장되지 않음 |
| 태스크 체크박스 토글 | 박스 클릭 | `- [ ]` / `- [x]`를 디스크에 즉시 round-trip. optimistic write, 409 conflict 시 자동 롤백. `-` / `*` / `+` 및 ordered list 모두 지원 |
| 우클릭 컨텍스트 메뉴 | 마우스 우클릭 | 프리뷰: `Edit / Find / Start drawing`. 편집 모드: `Done / Find / Stop drawing` |

#### 기존 위키와의 관계

- `vaultFilePaths`가 지정된 경우 vault-injector 경로로 파일 내용을 직접 `<long_term_memory>` 블록에 직렬화
- `vaultFilePaths`가 없으면 기존 DB 노드 기반 memory-injector로 폴백
- 두 시스템은 독립적 — 기존 DB 위키 데이터는 그대로 유지됨

### 35. 내 일정 (My Schedule)

프로젝트와 무관한 **전역 개인 캘린더/메모** 페이지입니다. 사이드바의 **내 일정**(달력 아이콘, `/agenda`)에서 열며, 개인 메모·할 일과 함께 전 프로젝트의 스케줄·플래너 마감일, 내게 할당된 Jira 작업을 한 화면에 모아 봅니다. (실행은 하지 않는 순수 정리 공간)

#### 보기 & 항목 추가

- **월 / 주 / 일 / 표** 뷰 토글. ◀▶로 단위별 이동, "오늘" 버튼으로 복귀.
- 날짜 칸에 마우스를 올리면 나타나는 **"+"** 로 그 날짜에 바로 항목 추가(날짜 자동 입력, 수정 가능). 우측 패널의 "추가"나 "메모"로도 추가.
- **메모 에디터**: 제목은 선택사항(비우면 본문 첫 줄을 제목으로). 좌상단 **크게 보기(⤢)** 로 거의 전체화면 페이지 뷰 전환. 날짜를 비우면 "날짜 없음" 백로그 메모로 저장. **이미지**는 붙여넣기/드래그앤드롭/파일 선택으로 첨부하고, 썸네일을 클릭하면 원본 크기 라이트박스로 본다.
- **태그**: 칩 형태로 추가/삭제(색상 자동). 헤더 아래 태그 칩으로 필터.
- **소스 레이어 토글**: 메모 / 스케줄 / 플래너 / Jira 를 켜고 끄기. 프로젝트 스케줄·플래너 항목은 읽기 전용이며 클릭 시 해당 프로젝트로 이동. 캘린더 셀 안의 칩도 클릭하면 동일하게 열림(메모=편집, 스케줄/플래너=딥링크, Jira=새 탭).
- **표 뷰**: 종류·상태를 색상 배지로 표시하고, 컬럼 헤더(날짜/종류/상태)를 클릭해 정렬(asc/desc 토글).
- **플래너로 이동/추가**: 개인 메모나 Jira 이슈 옆의 버튼으로 프로젝트를 골라 플래너로 보냄(메모는 원본 삭제 후 이관, Jira는 이슈를 그대로 두고 복제).
- 캘린더↔우측 패널 경계를 **드래그**해 패널 너비 조절(영속). 월뷰는 그리드 아래 **핸들을 드래그해 셀 높이(달력 크기)** 를 조절하고(영속), 항목이 많아 `+N`으로 접힌 날짜에 잠깐 **마우스를 올리면** 그 날짜가 카드로 확대돼 전체 항목을 보여준다.
- **기간 일괄 삭제**: 헤더 **휴지통** 버튼 → 모달에서 기간을 정해 그 범위의 개인 메모를 한 번에 삭제(완료된 항목만 / 날짜 없는 백로그 포함 옵션, 삭제 대상 개수 미리보기).

#### Jira 연동 (선택)

내게 할당된 Jira 작업을 캘린더에 겹쳐 볼 수 있습니다. 헤더의 **톱니바퀴** → "Jira 연결":

1. **사이트 주소**: Jira를 여는 주소 (예: `https://회사이름.atlassian.net`)
2. **로그인 이메일**: Atlassian 로그인 이메일
3. **API 토큰**: 비밀번호가 아니라 별도 토큰. 모달의 **"API 토큰 발급받기"** 링크(`id.atlassian.com`)에서 만들어 붙여넣기
4. **연결 테스트** → ✓ 계정명이 뜨면 정상 → **저장**

같은 모달의 **가져오기 기준**으로 어떤 이슈를 올릴지 직접 정할 수 있습니다 — '나에게 할당된 이슈만' / '완료된 이슈도 포함' 토글, 프로젝트 키 제한, 고급 JQL. (기본값은 '나에게 할당 + 미완료')

- 기한(due date) 있는 이슈는 캘린더 해당 날짜에, 기한 없는 이슈는 우측 패널의 **"Jira (마감일 없음)"** 목록에 표시됩니다. 칩을 클릭하면 이슈가 새 탭으로 열리고, **"내 일정에 추가"** 로 편집 가능한 개인 메모로 가져올 수 있습니다.
- 데이터는 **읽기 전용 오버레이**(복사·동기화 없음)이며, 토큰은 서버에만 저장되고 API 응답으로 노출되지 않습니다. 새로고침은 현재 보이는 범위만 다시 패치하며(이동/뷰 전환 시 자동), 유휴 시 자동 폴링은 없습니다.

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
# Windows
C:\Users\me\projects\
├── my-web-app/              ← 원본 프로젝트 (main 브랜치)
└── worktrees/               ← 자동 생성됨
    ├── feature-login/       ← TODO 1의 작업 공간
    ├── feature-signup/      ← TODO 2의 작업 공간
    └── feature-dashboard/   ← TODO 3의 작업 공간

# macOS / Linux
/Users/me/projects/          # macOS
/home/me/projects/           # Linux
├── my-web-app/
└── worktrees/
    ├── feature-login/
    ├── feature-signup/
    └── feature-dashboard/
```

---

## CI/CD

이 프로젝트는 GitHub Actions 기반 CI/CD 파이프라인을 사용합니다.

- **PR/push → main**: 타입 체크 + 테스트 + 빌드 자동 실행
- **`v*` 태그 push**: 빌드 + GitHub Release 자동 생성 + npm publish 자동 실행
- **이슈 `claude-fix` 라벨**: Claude Code가 이슈 구현 → PR 자동 생성 (Self-hosted Runner)
- **PR 생성/업데이트**: Claude Code가 자동 코드 리뷰 → 리뷰 코멘트 생성 (Self-hosted Runner)

로컬에서 CI와 동일한 검증:
```bash
npm run typecheck   # 타입 체크
npm test            # 전체 테스트
npm run build       # 빌드
```

자세한 내용은 [CICD.md](./CICD.md)를 참조하세요.

### GitHub Issue 자동 처리 (Claude Code)

GitHub 이슈에 `claude-fix` 라벨을 붙이면, Self-hosted Runner에서 Claude Code CLI가 이슈를 읽고 코드를 구현하여 PR을 자동 생성합니다.

**필요 조건:**
- Self-hosted Runner 등록 (PC에 GitHub Actions Runner 설치)
- Claude Code CLI 설치 + Max 구독 인증 완료
- GitHub CLI (`gh`) 인증 완료

설정 방법은 [CICD.md](./CICD.md)의 "Claude Issue Worker 워크플로우" 섹션을 참조하세요.

### PR 자동 코드 리뷰 (Claude Code)

PR이 생성되거나 업데이트되면 Claude Code가 자동으로 diff를 분석하여 코드 리뷰 코멘트를 생성합니다.

**동작 방식:**
- `pull_request` 이벤트 (`opened`, `synchronize`, `ready_for_review`) 시 트리거
- Draft PR은 자동으로 건너뜀
- Diff가 10,000줄 초과 시 리뷰 스킵 (토큰 절약)
- PR 업데이트(`synchronize`) 시 이전 리뷰 코멘트를 삭제 후 새로 생성

**리뷰 범위:**
- 버그 및 로직 오류
- 보안 취약점 (injection, XSS, secrets 노출)
- 성능 이슈 (N+1 쿼리, 불필요한 리렌더링)
- 타입 안전성
- 동시성 문제

**필요 조건:**
- Self-hosted Runner 등록 (GitHub Issue 자동 처리와 동일)
- Claude Code CLI 설치 + Max 구독 인증 완료
- GitHub CLI (`gh`) 인증 완료

---

## 문제 해결

### macOS: `npm install` 시 네이티브 모듈 빌드 실패
`better-sqlite3`나 `node-pty` 컴파일 오류가 발생하면 Xcode Command Line Tools가 없는 것임.
```bash
xcode-select --install
npm install   # 다시 시도
```

### Linux: `npm install` 시 네이티브 모듈 빌드 실패
빌드 도구가 없는 경우 발생함.
```bash
sudo apt install build-essential python3   # Debian/Ubuntu
npm install   # 다시 시도
```

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

### "위험한 사이트" 브라우저 경고 (`*.trycloudflare.com` / `*.cfargotunnel.com`)
공유 도메인에 대한 도메인 평판 경고입니다 (Safe Browsing/SmartScreen). Named Tunnel을 사용자 본인 도메인으로 라우팅하면 해당 도메인의 평판으로 표시됩니다.

1. 사이드바 ⚙ 아이콘 → Tunnel 설정 모달 열기
2. Tunnel Name + Custom Hostname 입력 후 저장 (또는 `clitrigger config tunnel hostname app.your-domain.com`)
3. 별도 터미널에서 한 번만 실행: `cloudflared tunnel route dns <tunnel-name> <hostname>`
4. 터널 재시작 — 표시 URL이 `https://<hostname>`로 바뀜

### CORS 오류 ("Not allowed by CORS")
개발 모드(`npm run dev`)에서는 모든 origin이 자동 허용되므로 이 오류가 발생하지 않습니다.
프로덕션 모드에서 이 오류가 발생하면 `.env`의 `CORS_ORIGIN`에 접속 주소를 추가하세요:
```env
CORS_ORIGIN=https://my-domain.com,https://other-domain.com
```

> **⚠ 보안 경고**: 개발 모드의 CORS 전체 허용은 로컬 개발 전용입니다. 프로덕션 환경에서는 반드시 `NODE_ENV=production`으로 실행하고, `CORS_ORIGIN`에 허용할 도메인만 명시하세요. 그렇지 않으면 외부에서 API에 무단 접근할 수 있습니다.

### 포트 충돌
서버가 자동으로 다음 포트를 시도합니다 (최대 10회). 특정 포트가 필요하면 `.env`에서 `PORT=3001` 등으로 변경.

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
| POST | /api/todos/:id/continue | 후속 프롬프트 실행 (Continue) |
| POST | /api/todos/:id/merge | 브랜치 머지 |
| POST | /api/todos/:id/merge-chain | 의존성 체인 일괄 병합 |
| GET | /api/todos/:id/logs | 로그 조회 |
| GET | /api/todos/:id/diff | Diff 조회 |
| GET | /api/projects/:id/status | 프로젝트 상태 |
| POST | /api/projects/:id/schedules | 스케줄 생성 |
| GET | /api/projects/:id/schedules | 스케줄 목록 |
| GET | /api/schedules/:id | 스케줄 상세 |
| PUT | /api/schedules/:id | 스케줄 수정 |
| DELETE | /api/schedules/:id | 스케줄 삭제 |
| POST | /api/schedules/:id/activate | 스케줄 활성화 |
| POST | /api/schedules/:id/pause | 스케줄 비활성화 |
| GET | /api/schedules/:id/runs | 스케줄 실행 이력 |
| POST | /api/schedules/:id/trigger | 스케줄 수동 트리거 |
| GET | /api/rate-limit | Claude rate limit 리셋 시각 조회 |
| POST | /api/todos/:id/schedule-on-reset | rate limit 리셋 시점에 1회성 실행 예약 |
| GET | /api/projects/:id/analytics | 프로젝트 실행 통계 (기간 필터) |
| GET | /api/cli/status | CLI 도구 설치 상태 조회 |
| POST | /api/cli/status/refresh | CLI 도구 설치 상태 재확인 |
| GET | /api/projects/:id/sessions | 세션 목록 |
| POST | /api/projects/:id/sessions | 세션 생성 |
| GET | /api/sessions/:id | 세션 상세 |
| PUT | /api/sessions/:id | 세션 수정 |
| DELETE | /api/sessions/:id | 세션 삭제 |
| POST | /api/sessions/:id/start | 세션 시작 |
| POST | /api/sessions/:id/stop | 세션 중지 |
| POST | /api/sessions/:id/cleanup | 세션 워크트리 정리 |
| GET | /api/sessions/:id/logs | 세션 로그 조회 |
| GET | /api/sessions/:id/pending-prompt | 세션 시작 시 보류 중인 초기 프롬프트 미리보기 |
| POST | /api/sessions/:id/submit-initial | 보류된 초기 프롬프트를 PTY로 전송 |
| POST | /api/sessions/:id/skip-initial | 보류된 초기 프롬프트 폐기 |
| POST | /api/sessions/:id/paste-image | 클립보드 이미지를 호스트 OS 클립보드에 push + 같은 트랜잭션에서 PTY로 `ESC+v` 주입 (동시 페이스트 레이스 방지, `hasPendingPrompt` 게이트) |
| GET | /api/projects/:id/files | 디렉토리 lazy 리스팅 (트래버설 가드 + 기본 hide list: `.git`/`node_modules`/`.worktrees`/`.DS_Store`) |
| GET | /api/projects/:id/files/content | 텍스트 파일 인라인 미리보기 (≤2MB, NUL byte heuristic으로 바이너리 폴백) |
| GET | /api/projects/:id/files/binary | 바이너리 파일 스트리밍 (≤50MB, Content-Type 헤더 — `<img>`/`<video>`/`<audio>`/`<iframe>` 인라인용) |
| POST | /api/projects/:id/files/move | 파일/폴더 이동·이름변경 (`from`/`to` 양쪽 트래버설 가드 + `fs.rename`, 자기/하위 이동·도착 충돌 거부) |
| GET | /api/session-tags | 세션 색상 태그 목록 |
| POST | /api/session-tags | 세션 태그 생성 (이름 + `#RRGGBB`) |
| PUT | /api/session-tags/:id | 세션 태그 수정 |
| DELETE | /api/session-tags/:id | 세션 태그 삭제 (참조 세션의 tag_id는 자동 NULL clear) |
| GET | /api/session-settings | 세션 글로벌 디폴트 조회 (`defaultUseWorktree`, `defaultFontSize`) |
| PUT | /api/session-settings | 세션 글로벌 디폴트 수정 |
| GET | /api/favorites | 즐겨찾기 목록 |
| POST | /api/favorites | 즐겨찾기 생성 |
| PUT | /api/favorites/:id | 즐겨찾기 수정 |
| DELETE | /api/favorites/:id | 즐겨찾기 삭제 |
| POST | /api/favorites/:id/launch | 즐겨찾기 실행 |
| POST | /api/favorites/browse-file | 서버 호스트에서 OS 네이티브 "파일 열기" 다이얼로그 → 선택 경로 반환 (웹/앱 공통) |
| GET | /api/projects/:id/memory/graph | Wiki 그래프 조회 |
| GET | /api/projects/:id/memory/nodes | Wiki 항목 목록 |
| POST | /api/projects/:id/memory/nodes | Wiki 항목 생성 |
| PUT | /api/memory/nodes/:nodeId | Wiki 항목 수정 |
| DELETE | /api/memory/nodes/:nodeId | Wiki 항목 삭제 |
| PUT | /api/memory/nodes/:nodeId/position | Wiki 항목 위치 업데이트 |
| POST | /api/projects/:id/memory/edges | Wiki 관계 생성 |
| PUT | /api/memory/edges/:edgeId | Wiki 관계 수정 |
| DELETE | /api/memory/edges/:edgeId | Wiki 관계 삭제 |
| POST | /api/projects/:id/memory/preview | Wiki 주입 프리뷰 |
| POST | /api/projects/:id/memory/raw-files/open | 원본 파일 열기/reveal |
| DELETE | /api/projects/:id/memory/raw-files | 원본 파일 삭제 (derived 노드 source_path만 unlink, 노드 본문 보존) |
| POST | /api/memory/nodes/:keepId/merge | 두 항목 병합 (edge redirect + wikilink rewrite + tag union) |
| POST | /api/projects/:id/memory/assets | 위키 본문 이미지 업로드 (`.clitrigger/wiki-assets/`) |
| GET | /api/projects/:id/memory/assets/:filename | 위키 자산(이미지) serve |
| GET | /api/projects/:id/memory/disk-diff | DB ↔ `.clitrigger/wiki/` 디스크 변경 비교 |
| POST | /api/projects/:id/memory/export | DB → `.clitrigger/wiki/<entity>/<slug>.md` 일방향 익스포트 |
| GET | /api/projects/:id/memory/logs | Activity 로그 조회 (ingest/lint/retrieve/merge 이벤트, 필터 + severity) |
| GET | /api/projects/:id/vault/files | Vault `.md` 파일 스캔 (재귀, frontmatter + wikilink 파싱) |
| GET | /api/projects/:id/vault/graph | Vault wikilink 그래프 (노드 + 엣지) |
| GET | /api/projects/:id/vault/file | Vault 파일 읽기 (`?path=<rel>`, `.md` 제한 + traversal 가드) |
| PUT | /api/projects/:id/vault/file | Vault 파일 수정 (기존 파일 덮어쓰기) |
| POST | /api/projects/:id/vault/file | Vault 파일 생성 |
| DELETE | /api/projects/:id/vault/file | Vault 파일 삭제 |
| POST | /api/projects/:id/vault/rename | Vault 파일 이름 변경 |
| POST | /api/projects/:id/vault/preview | Vault 주입 `<long_term_memory>` 블록 미리보기 |
| GET | /api/projects/:id/vault/search | Vault 텍스트 검색 |
| GET | /api/projects/:id/vault/ignore | 프로젝트 루트 `.vaultignore` 읽기 (없으면 빈 문자열) |
| PUT | /api/projects/:id/vault/ignore | `.vaultignore` 저장 |
| GET | /api/projects/:id/planner | Planner 아이템 목록 |
| POST | /api/projects/:id/planner | Planner 아이템 생성 |
| PUT | /api/planner/:id | Planner 아이템 수정 |
| DELETE | /api/planner/:id | Planner 아이템 삭제 |
| GET | /api/projects/:id/planner/tags | Planner 태그 목록 |
| GET | /api/projects/:id/planner/export | Planner 상태를 Markdown으로 Export |
| POST | /api/projects/:id/planner/import | Planner Markdown Import (원자적 삽입, `text/markdown` 본문) |
| GET | /api/review/queue | 크로스-프로젝트 todo 큐 (since/hours, statuses 필터 + risk 분류) |
| GET | /api/review/summary | 윈도우 내 토큰/CLI별 분해 요약 |
| GET | /api/review/diff/:todoId | todo 변경 파일 목록 + 통계 (워크트리/브랜치 폴백) |
| GET | /api/review/diff/:todoId/file | 특정 파일의 raw diff (path 화이트리스트) |
| GET | /api/personal-items | 내 일정 개인 항목 목록 (전역) |
| POST | /api/personal-items | 개인 항목 생성 (제목/메모/`due_at`/태그) |
| PUT | /api/personal-items/:id | 개인 항목 수정 |
| DELETE | /api/personal-items/:id | 개인 항목 삭제 |
| POST | /api/personal-items/bulk-delete | 기간(`from`/`to`) 일괄 삭제 (`done_only`/`include_backlog` 옵션) |
| POST | /api/personal-items/:id/move-to-planner | 개인 항목을 프로젝트 플래너로 이동(이미지·태그·마감일 이관 후 원본 삭제) |
| POST/DELETE | /api/personal-items/:id/images[/:imageId] | 개인 항목 이미지 업로드/삭제/서빙 |
| GET | /api/agenda | 기간 집계: 개인 항목 + 전 프로젝트 스케줄/플래너 마감일 (읽기 전용) |
| GET | /api/agenda/jira-config | 내 일정 전용 Jira 연결 설정 조회 (토큰 미노출, `hasToken`만) |
| PUT | /api/agenda/jira-config | Jira 연결 설정 저장 (토큰 비우면 기존 유지) |
| GET | /api/agenda/jira-test | Jira 연결 테스트 (`/myself`) |
| GET | /api/agenda/jira | 내게 할당된 열린 이슈 (기한 있는 것 범위 + 기한 없는 것) |
| POST | /api/agenda/jira/import | Jira 이슈를 개인 메모로 가져오기 |
| POST | /api/agenda/jira/import-to-planner | Jira 이슈를 프로젝트 플래너로 가져오기 (이슈는 그대로 유지) |
| POST | /api/planner/:id/convert-to-todo | TODO로 변환 |
| POST | /api/planner/:id/convert-to-schedule | 스케줄로 변환 |
| POST | /api/planner/:id/convert-to-session | 인터랙티브 터미널 세션으로 변환 (CLI/모델 + 워크트리 토글) |
| GET | /api/notion/:projectId/test | Notion 연결 테스트 |
| POST | /api/notion/:projectId/pages | Notion 페이지 목록 |
| GET | /api/notion/:projectId/page/:pageId | Notion 페이지 상세 |
| GET | /api/notion/:projectId/page/:pageId/blocks | Notion 페이지 블록 |
| POST | /api/notion/:projectId/page/:pageId/update | Notion 페이지 수정 |
| POST | /api/notion/:projectId/create | Notion 페이지 생성 |
| POST | /api/notion/:projectId/import/:pageId | Notion 페이지 Import |
| GET | /api/notion/:projectId/schema | Notion DB 스키마 |
| GET | /api/github/:projectId/test | GitHub 연결 테스트 |
| GET | /api/github/:projectId/issues | GitHub 이슈 목록 |
| GET | /api/github/:projectId/issue/:number | GitHub 이슈 상세 |
| GET | /api/github/:projectId/issue/:number/comments | GitHub 이슈 코멘트 |
| POST | /api/github/:projectId/issues | GitHub 이슈 생성 |
| POST | /api/github/:projectId/issue/:number/comment | GitHub 이슈 코멘트 추가 |
| POST | /api/github/:projectId/import/:number | GitHub 이슈 Import |
| GET | /api/github/:projectId/labels | GitHub 라벨 목록 |
| GET | /api/models | CLI 모델 목록 조회 |
| POST | /api/models | CLI 모델 추가 |
| DELETE | /api/models/:id | CLI 모델 삭제 |
| POST | /api/projects/:id/git-stage | 파일 스테이징 |
| POST | /api/projects/:id/git-unstage | 파일 언스테이징 |
| POST | /api/projects/:id/git-commit | 커밋 |
| POST | /api/projects/:id/git-pull | Pull |
| POST | /api/projects/:id/git-push | Push (객체 body: `{remote, branches: [{local, remote, setUpstream}], pushAllTags, force}`. force는 `--force-with-lease`. 레거시 `{branch, setUpstream}` 자동 어댑팅) |
| GET | /api/projects/:id/git-remotes | Push 다이얼로그용 원격 목록 (`[{name, url}]`) |
| POST | /api/projects/:id/git-fetch | Fetch |
| POST | /api/projects/:id/git-branch | 브랜치 생성 |
| POST | /api/projects/:id/git-branch-delete | 브랜치 삭제 |
| POST | /api/projects/:id/git-checkout | 브랜치 체크아웃 |
| POST | /api/projects/:id/git-merge | 브랜치 병합 |
| POST | /api/projects/:id/git-stash | 스태시 저장 |
| POST | /api/projects/:id/git-stash-pop | 스태시 복원 |
| POST | /api/projects/:id/git-discard | 파일 변경 폐기 |
| POST | /api/projects/:id/git-tag | 태그 생성 |
| POST | /api/projects/:id/git-diff-file | 파일 Diff 조회 |
| GET | /api/projects/:id/git-file-status | 파일 상태 조회 |
| GET | /api/projects/:id/git-commit-files | 커밋 변경 파일 목록 |
| GET | /api/projects/:id/git-commit-diff | 커밋 파일별 Diff 조회 |
| POST | /api/projects/:id/git-branch-rename | 브랜치 이름 변경 |
| POST | /api/projects/:id/git-rebase | 브랜치 리베이스 |
| GET | /api/projects/:id/worktrees | 활성 워크트리 목록 |
| POST | /api/projects/:id/worktree-cleanup | 워크트리 정리 (브랜치 삭제 옵션) |
| GET | /api/projects/:id/svn-status | SVN 작업 사본 status (xml 파싱, git porcelain 모양 매핑) |
| GET | /api/projects/:id/svn-info | SVN 작업 사본 info (URL, revision) |
| GET | /api/projects/:id/svn-log | SVN 리비전 로그 (skip/limit 페이징) |
| GET | /api/projects/:id/svn-diff | 워킹 카피 Diff (파일별 또는 전체) |
| GET | /api/projects/:id/svn-commit-files | 특정 리비전의 변경 파일 목록 |
| GET | /api/projects/:id/svn-commit-diff | 특정 리비전의 파일별 Diff |
| POST | /api/projects/:id/svn-add | 파일 add |
| POST | /api/projects/:id/svn-revert | 파일 revert |
| POST | /api/projects/:id/svn-delete | 파일 delete (`keepLocal` 옵션) |
| POST | /api/projects/:id/svn-resolve | 충돌 해결 (`accept`: working/mine-full/theirs-full/base) |
| POST | /api/projects/:id/svn-commit | 커밋 (메시지 + 선택 파일 목록) |
| POST | /api/projects/:id/svn-update | Update (`revision` 옵션) |
| POST | /api/projects/:id/svn-cleanup | SVN cleanup (잠금 해제) |
| POST | /api/projects/browse | 네이티브 폴더 피커 |
| POST | /api/projects/open-folder | OS 파일 탐색기로 폴더 열기 |
| POST | /api/projects/:id/agents | 토론 에이전트 생성 |
| GET | /api/projects/:id/agents | 토론 에이전트 목록 |
| PUT | /api/agents/:id | 토론 에이전트 수정 |
| DELETE | /api/agents/:id | 토론 에이전트 삭제 |
| POST | /api/projects/:id/discussions | 토론 생성 |
| GET | /api/projects/:id/discussions | 토론 목록 |
| GET | /api/discussions/:id | 토론 상세 |
| DELETE | /api/discussions/:id | 토론 삭제 |
| POST | /api/discussions/:id/start | 토론 시작/재개 |
| POST | /api/discussions/:id/stop | 토론 일시정지 |
| POST | /api/discussions/:id/inject | 사용자 메시지 주입 |
| POST | /api/discussions/:id/skip-turn | 현재 턴 건너뛰기 |
| POST | /api/discussions/:id/implement | 구현 라운드 트리거 |
| GET | /api/discussions/:id/messages | 토론 메시지 목록 |
| GET | /api/discussions/:id/logs | 토론 로그 조회 |
| POST | /api/discussions/:id/merge | 토론 브랜치 머지 |
| GET | /api/discussions/:id/diff | 토론 Git diff 조회 |
| POST | /api/discussions/:id/cleanup | 토론 워크트리 정리 |
| POST | /api/discussions/:id/extract-planner-items | 토론 트랜스크립트에서 액션 아이템 LLM 추출 (preview, 비저장) |
| POST | /api/discussions/:id/convert-to-planner | 추출/편집된 액션 아이템을 Planner로 영속 |
| GET | /api/projects/:id/memory/graph | 프로젝트 메모리 그래프(노드+엣지) 조회 |
| GET | /api/projects/:id/memory/nodes | 메모리 노드 목록 |
| POST | /api/projects/:id/memory/nodes | 메모리 노드 생성 |
| PUT | /api/memory/nodes/:nodeId | 메모리 노드 수정 |
| PUT | /api/memory/nodes/:nodeId/position | 메모리 노드 위치 업데이트 (그래프 드래그) |
| DELETE | /api/memory/nodes/:nodeId | 메모리 노드 삭제 |
| POST | /api/projects/:id/memory/edges | 메모리 엣지 생성 |
| PUT | /api/memory/edges/:edgeId | 메모리 엣지 수정 |
| DELETE | /api/memory/edges/:edgeId | 메모리 엣지 삭제 |
| POST | /api/projects/:id/memory/preview | 모드+노드 ID로 `<long_term_memory>` 프롬프트 블록 미리보기 |
| GET | /api/harness/:projectId | 프로젝트의 Claude/Gemini/Codex 설정 요약 |
| GET | /api/harness/:projectId/:cli | CLI별 settings/memory/MCP 통합 조회 |
| PUT | /api/harness/:projectId/:cli/settings | CLI settings 저장 (deep-merge, atomic write) |
| GET | /api/harness/:projectId/:cli/memory | CLI 메모리 파일 raw 내용 |
| PUT | /api/harness/:projectId/:cli/memory | CLI 메모리 파일 저장 |
| GET | /api/harness/:projectId/:cli/mcp | MCP 서버 목록 |
| PUT | /api/harness/:projectId/:cli/mcp/:alias | MCP 서버 추가/수정 |
| DELETE | /api/harness/:projectId/:cli/mcp/:alias | MCP 서버 삭제 |
| GET | /api/debug-logs/:projectId | 디버그 로그 목록 |
| GET | /api/debug-logs/:projectId/:filename | 디버그 로그 파일 내용 |
| DELETE | /api/debug-logs/:projectId/:filename | 디버그 로그 파일 삭제 |
| DELETE | /api/debug-logs/:projectId | 디버그 로그 전체 삭제 |
| GET | /api/gstack/skills | gstack 스킬 목록 |
| GET | /api/plugins | 등록된 플러그인 목록 |
| GET | /api/plugins/:pluginId/config/:projectId | 플러그인 설정 조회 |
| PUT | /api/plugins/:pluginId/config/:projectId | 플러그인 설정 저장 |
| GET | /api/tunnel/status | 터널 상태 |
| GET | /api/tunnel/config | 터널 이름 + 커스텀 hostname 조회 (DB-first, env fallback) |
| PUT | /api/tunnel/config | 터널 이름 + 커스텀 hostname 저장 (hostname 도메인 검증) |
| POST | /api/tunnel/start | 터널 시작 |
| POST | /api/tunnel/stop | 터널 중지 |
| WS | /ws | 실시간 이벤트 |
