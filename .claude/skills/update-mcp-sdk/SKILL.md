---
name: update-mcp-sdk
description: MCP SDK(@modelcontextprotocol/server·node·client)를 새 버전으로 올리고 Claude·Codex·Antigravity 호환과 MCP tasks까지 검증한 뒤 커밋합니다. 주기적으로 수동 실행.
argument-hint: "[check]  (check만 주면 버전 확인만 하고 끝냄)"
disable-model-invocation: true
---

# MCP SDK 업데이트

CLITrigger의 MCP 서버(`src/server/mcp/`)가 쓰는 SDK를 올린다. SDK는 이 세 패키지만 쓴다:
`@modelcontextprotocol/server`, `@modelcontextprotocol/node`, `@modelcontextprotocol/client`.
버전 번호는 패키지마다 따로 간다(예: server 2.4.x, node 2.1.x). 셋을 같은 숫자로 맞추지 않는다.

## 현재 상태

- 브랜치: !`git branch --show-current`
- 작업 트리: !`git status --short`
- 설치된 버전: !`node -p "['server','node','client'].map(p=>p+' '+require('./node_modules/@modelcontextprotocol/'+p+'/package.json').version).join(', ')"`

## 1단계: 새 버전 확인

1. 작업 트리가 깨끗하지 않으면 멈추고 알린다.
2. 패키지마다 최신 버전과 배포 시각을 본다:
   `npm view @modelcontextprotocol/<패키지> version time --json`
3. **배포된 지 7일이 안 된 버전은 고르지 않는다.** npm 계정 탈취로 올라온 악성 버전은 보통 며칠 안에 내려간다. 최신이 7일 미만이면 7일 넘은 가장 최근 버전을 고른다.
4. 패키지마다 "설치된 버전 → 고를 버전(배포일)"을 표로 보여 준다. 올릴 게 없으면 그렇게 말하고 끝낸다. 인자가 `check`면 여기서 끝낸다.
5. **메이저 버전이 바뀌면 멈추고 사용자에게 묻는다.** v1→v2처럼 코드 수정이 필요하다. 진행하라고 하면 마이그레이션 가이드(https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2 또는 해당 메이저의 가이드)를 읽고 고친다.
6. 릴리스 노트(https://github.com/modelcontextprotocol/typescript-sdk/releases)에서 고를 버전까지의 변경을 훑어, 프로토콜 협상·HTTP 처리·tasks 관련 변경이 있는지 적어 둔다(3단계를 할지 정하는 근거).

## 2단계: 설치와 자동 검증

1. `npm install @modelcontextprotocol/server@<버전> @modelcontextprotocol/node@<버전> @modelcontextprotocol/client@<버전>`
2. 아래를 모두 통과해야 한다. 하나라도 실패하면 원인을 고치거나, 못 고치면 `git checkout -- package.json package-lock.json && npm ci`로 되돌리고 보고한다.
   - `npm run typecheck`
   - `npx vitest run src/server/mcp/index.test.ts`: 이 파일이 호환성의 핵심이다. 2026-07-28 고정 클라이언트(Claude Code·Antigravity 방식), 2025-06-18 initialize 핸드셰이크(Codex 방식), MCP tasks(task 생성·폴링·취소·-32602·-32021)를 각각 검증한다.
   - `npm run test:server`
   - `npm run build:server`

## 3단계: 실제 클라이언트 확인 (1단계 6에서 프로토콜 관련 변경이 있었을 때)

임시 서버에 실제 CLI를 붙여 본다.

1. 임시 서버: `PORT=4000 DB_PATH=<스크래치>/mcp-e2e.db DISABLE_AUTH=true TUNNEL_ENABLED=false npx tsx src/server/index.ts` (백그라운드). `HEADLESS=true`는 넣지 않는다. stdin이 닫히면 서버가 꺼진다. 포트가 차 있으면 다음 포트로 넘어가니 로그에서 실제 포트를 확인한다.
2. 토큰과 설정: `GET http://127.0.0.1:<포트>/api/mcp/connection`의 `config.mcpServers.clitrigger`를 MCP 설정 파일로 쓴다.
3. Claude Code: `claude -p "<list_projects 호출 지시>" --model haiku --strict-mcp-config --mcp-config <파일> --allowedTools mcp__<이름>__list_projects`로 툴 호출을 확인한다.
   - MCP tasks까지 보려면 단발 `claude -p "..."`로는 안 된다(문서상 tasks를 안 씀). `--input-format stream-json --output-format stream-json --verbose`에 `CLAUDE_AUTO_BACKGROUND_TASKS=1`을 주고 입력을 열어 둔 채(`(echo '<user 메시지 JSON>'; sleep 100) | ...`) `wait_session_state`를 부르게 한다. 대상 세션은 raw-shell 세션을 만들어 시작하고, 몇십 초 뒤 `/api/sessions/:id/stop`으로 끝낸다. 출력의 `task_started` → `task_notification`과 최종 결과를 확인한다.
4. Codex: `codex exec --skip-git-repo-check -c 'mcp_servers.e2e.url="..."' -c 'mcp_servers.e2e.http_headers={ Authorization = "Bearer <토큰>" }' "<지시>" < /dev/null`. 툴 호출은 codex 승인 정책에 막혀도 괜찮다. 연결(initialize)과 tools/list가 되는지만 본다.
5. Antigravity: 실행별 설정 옵션이 없어 전역 설정에 임시 항목을 넣어야 한다. `~/.gemini/config/mcp_config.json`을 먼저 백업하고 `agy mcp add --header "Authorization: Bearer <토큰>" clitrigger_e2e <URL>` → `agy --print "<지시>"` → `agy mcp remove clitrigger_e2e`. 끝나면 백업과 내용이 같은지 꼭 비교한다.
6. 어떤 프로토콜로 붙는지 보려면 요청을 그대로 넘기며 `MCP-Protocol-Version` 헤더와 본문 `method`를 기록하는 작은 프록시를 앞에 둔다.
7. 정리: 임시 서버와 프록시는 포트로 찾아 커맨드라인을 확인한 뒤 끈다(PowerShell `Get-NetTCPConnection -LocalPort <포트>` → `Get-CimInstance Win32_Process`로 `tsx src/server/index.ts`인지 확인 → `Stop-Process`). 백그라운드 작업만 멈추면 node 자식 프로세스가 남는다.

## 4단계: 커밋

- 롤백 단위로 커밋 하나: `chore(mcp): MCP SDK 업데이트 (server a→b, node c→d, client e→f)`. 본문에 1단계 6의 주요 변경과 2·3단계 검증 결과를 적는다.
- 사용자가 푸시를 요청했을 때만 푸시한다.
