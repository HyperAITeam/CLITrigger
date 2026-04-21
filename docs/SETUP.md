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

첫 실행 시 비밀번호 설정 여부를 물어봅니다:
```
Welcome to CLITrigger!
비밀번호를 설정해주세요: ********
✅ 설정 완료! (~/.clitrigger/config.json)
🚀 CLITrigger running at http://localhost:3000
```

비밀번호는 필수이며, 설정하지 않으면 서버가 시작되지 않습니다.

#### 이후 실행

```bash
clitrigger
```

#### 설정 변경

```bash
clitrigger config              # 현재 설정 보기
clitrigger config port 8080    # 포트 변경
clitrigger config password     # 비밀번호 변경/설정
clitrigger config path         # 설정 디렉토리 경로 확인
clitrigger config clear        # 설정/DB 전체 삭제 (~/.clitrigger/)
clitrigger --help              # 도움말
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
AUTH_PASSWORD=your-password  # 로그인 비밀번호 (필수)
TUNNEL_ENABLED=false         # Cloudflare Tunnel 사용 여부
TUNNEL_NAME=                 # Named Tunnel 이름 (선택)
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
3. 제목, CLI 도구(Claude/Gemini/Codex), 모델, (Git 저장소라면) 워크트리 사용 여부 선택
4. 저장

#### 사용

- 세션 카드에서 **▶** 버튼으로 시작 → 인라인 터미널이 열림
- 입력창에 메시지 입력 → Enter로 전송 (PTY로 stdin relay)
- **■**로 일시 중지, **Cleanup** 버튼으로 워크트리 정리 (실행 중이 아닐 때만 표시)
- Git 저장소 프로젝트에서는 워크트리에 격리된 브랜치에서 작업 가능
- 로그는 Chat/Raw 모드로 전환 가능 (Chat: 어시스턴트 마크다운 + 접이식 tool_use, Raw: 기존 평면 로그)

> Claude/Gemini/Codex 모두 interactive 모드 지원. Codex는 top-level TUI로, Gemini는 welcome screen의 trust 다이얼로그를 자동으로 처리합니다.

### 15. Planner (경량 작업 관리)

Planner는 CRUD + 태그 + 우선순위 기반의 경량 작업 관리 기능입니다. 아이템을 TODO 또는 스케줄로 변환하여 실제 실행 단계로 넘길 수 있습니다.

#### 기능

- 테이블 뷰 (컬럼: 제목, 우선순위, 태그, 상태, 액션)
- 인라인 편집 (클릭 시 편집 모드, Enter 저장)
- 태그 관리 (자동 색상 할당, 색상 피커, rename, 삭제, 쉼표 delimiter)
- 컬럼 정렬 (제목/우선순위/태그)
- 이미지 첨부
- **TODO로 변환**: CLI 도구/모델 선택하여 즉시 TODO 생성
- **스케줄로 변환**: cron 표현식 설정하여 반복 실행 스케줄 생성
- **JSON Export/Import**: 프로젝트·설치 간 Planner 상태를 JSON으로 내보내고 불러오기. Export는 items + tag 메타데이터를 버전 박힌 JSON으로 다운로드(`planner-{projectSlug}-{yyyymmdd}.json`), Import는 원자적 트랜잭션으로 삽입하며 기존 태그 색상을 보존. 이미지 첨부는 Export에 포함되지 않음(아이템 저장만 보존)

### 16. 실행 분석 대시보드 (Analytics)

프로젝트 상세 페이지의 **분석** 탭에서 실행 통계를 확인할 수 있습니다.

#### 지표

- **기간 필터**: 7일 / 30일 / 90일 / 전체
- **Summary 카드**: 총 실행 수, 성공률, 총 비용(USD), 총 토큰
- **상태 분포**: completed/failed/stopped 도넛 차트
- **CLI 도구별 비용**: 스택드 바 차트
- **일별 활동**: cost/tokens 탭 전환이 가능한 라인 차트

비용/토큰은 `todos.total_cost_usd`/`total_tokens` 컬럼에 비정규화되어 있어 순수 SQL 집계로 빠르게 계산됩니다.

### 17. CLI 설치 상태 체크

프로젝트 설정 패널을 열 때 Claude/Gemini/Codex CLI의 설치 여부를 자동 확인합니다.

- CLI 드롭다운 아래에 **녹색/빨강 인디케이터 + 버전** 표시
- 미설치 시 `npm install -g @anthropic-ai/claude-code` 등 설치 가이드 배너 표시
- **Refresh 버튼**으로 재확인 가능 (60초 캐싱)

### 18. Rate Limit 자동 재스케줄

Claude CLI가 rate limit에 걸리면, 서버가 `rate_limit_event`를 감지하여 리셋 시각을 저장합니다. TODO 항목에서 **"리셋 시점에 실행 예약"** 버튼으로 해당 시각에 1회성 스케줄을 생성할 수 있습니다.

- pending/failed/stopped 등 startable 상태에서 모두 사용 가능
- 리셋 시각은 `GET /api/rate-limit`으로 조회 가능
- 서버 시작 시 현재 rate limit 상태를 복구

### 19. 브라우저 알림

긴 태스크/토론이 완료되거나 실패했을 때 OS 레벨 브라우저 알림을 받을 수 있습니다.

- 사이드바의 **종 아이콘** 토글로 on/off (localStorage에 영속)
- 첫 활성화 시 브라우저 permission 요청
- 브라우저가 permission을 거부하면 toggle에 차단 tooltip 표시

### 20. 샌드박스 모드

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

### 21. Git 클라이언트

Git 탭에서 터미널 전환 없이 주요 Git 작업을 수행할 수 있습니다.

#### 지원 작업

- **커밋**: 파일 스테이징/언스테이징 + 커밋 메시지 입력
- **Pull/Push/Fetch**: 리모트와 동기화
- **브랜치**: 생성, 삭제, 체크아웃
- **병합**: 브랜치 병합
- **스태시**: 변경사항 임시 저장/복원
- **태그**: 태그 생성
- **폐기**: 파일 변경 되돌리기

#### 파일 상태 패널

좌측 사이드바에서 파일 상태를 실시간 확인하고 인라인 액션을 수행할 수 있습니다:
- **Staged**: 커밋 대기 중인 파일 (클릭으로 언스테이지)
- **Unstaged**: 변경됐지만 미스테이징 파일 (클릭으로 스테이지 / 폐기)
- **Untracked**: 새로 추가된 파일

### 22. 에이전트 토론

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
- **자동 구현 (Auto-implement)**: 토론 생성 시 자동 구현 옵션을 켜고 구현 에이전트를 지정하면, 전체 라운드 완료 즉시 해당 에이전트가 자동으로 코드 구현 시작
- **토론 중 구현 (Implement during discussion)**: 에이전트 생성/수정 시 `can_implement` 체크박스를 켜면 해당 에이전트의 일반 턴에서도 코드 변경/커밋이 허용됨(프롬프트가 "최소 프로토타입만"으로 완화). 공유 워크트리/브랜치에 커밋이 쌓이고, 최종 구현 라운드가 남은 부분을 채워 완료. 리스트 행에 망치 아이콘 Implementer 뱃지로 표시
- **메시지 접기/펼치기**: 긴 토론에서 이전 메시지를 접어 최신 대화에 집중 가능. 접힌 상태에서 요약 미리보기(첫 200자) 제공
- **메타데이터 편집**: 토론 생성 후에도 제목, 설명, 참여 에이전트, 최대 라운드 수 수정 가능
- **실시간 스트리밍**: WebSocket으로 에이전트 발언을 실시간 확인
- **워크트리 격리**: 토론별로 독립된 git worktree에서 실행
- **프롬프트 인젝션 방어**: 사용자 입력을 `<user_task>` 태그로 격리
- **다크 모드**: 프로젝트 목록 우측 상단의 테마 토글 버튼으로 라이트/다크 모드 전환. OS 기본 테마 자동 감지

> **참고**: 토론은 프로젝트의 `max_concurrent` 한도를 Todo와 공유합니다.

### 23. 디버그 로깅

프로젝트 설정에서 **디버그 로깅**을 활성화하면 CLI 도구 실행 시 전체 stdin/stdout/stderr를 `.debug-logs/` 디렉토리에 플레인 텍스트 파일로 저장합니다.

- 프로젝트 설정 → "디버그 로깅" 토글 활성화
- 태스크 실행 후 `Debug Log` 버튼으로 로그 파일 확인 (새 탭)
- 서버 시작 시 `LOG_RETENTION_DAYS` 기준으로 오래된 로그 자동 정리

> **참고**: 디버그 로그는 CLI 통신의 raw 내용을 포함하므로 용량이 클 수 있습니다. 디버깅 완료 후 비활성화를 권장합니다.

### 24. Verbose 모드

TODO 실행 시 **Verbose** 옵션을 활성화하면 Claude CLI의 모든 로그를 필터 없이 실시간 스트리밍합니다. 디버깅이나 상세 진행 확인에 유용합니다.

### 25. CLI Fallback Chain

프로젝트 설정에서 **Fallback Chain**을 지정하면, CLI가 컨텍스트 윈도우를 소진했을 때 자동으로 다음 CLI/모델로 재시도합니다. 예: Claude Sonnet → Claude Opus → Gemini 순서로 시도.

---

### 26. Hecaton 플러그인 (선택)

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

### 27. gstack 스킬 (선택)

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
| GET | /api/projects/:id/planner | Planner 아이템 목록 |
| POST | /api/projects/:id/planner | Planner 아이템 생성 |
| PUT | /api/planner/:id | Planner 아이템 수정 |
| DELETE | /api/planner/:id | Planner 아이템 삭제 |
| GET | /api/projects/:id/planner/tags | Planner 태그 목록 |
| GET | /api/projects/:id/planner/export | Planner 상태를 JSON으로 Export |
| POST | /api/projects/:id/planner/import | Planner JSON Import (원자적 삽입) |
| POST | /api/planner/:id/convert-to-todo | TODO로 변환 |
| POST | /api/planner/:id/convert-to-schedule | 스케줄로 변환 |
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
| POST | /api/projects/:id/git-push | Push |
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
| GET | /api/debug-logs/:projectId | 디버그 로그 목록 |
| GET | /api/debug-logs/:projectId/:filename | 디버그 로그 파일 내용 |
| DELETE | /api/debug-logs/:projectId/:filename | 디버그 로그 파일 삭제 |
| DELETE | /api/debug-logs/:projectId | 디버그 로그 전체 삭제 |
| GET | /api/gstack/skills | gstack 스킬 목록 |
| GET | /api/plugins | 등록된 플러그인 목록 |
| GET | /api/plugins/:pluginId/config/:projectId | 플러그인 설정 조회 |
| PUT | /api/plugins/:pluginId/config/:projectId | 플러그인 설정 저장 |
| GET | /api/tunnel/status | 터널 상태 |
| POST | /api/tunnel/start | 터널 시작 |
| POST | /api/tunnel/stop | 터널 중지 |
| WS | /ws | 실시간 이벤트 |
