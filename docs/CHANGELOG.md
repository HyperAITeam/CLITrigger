# Changelog

## 2026-04-30 — 세션 실시간 터미널 UI + 위키 인제스트 + 즐겨찾기 런처

### 배경

세션 탭의 CLI 출력을 스크래핑 후 라인별로 정제하는 방식에서 pixel-perfect xterm.js 렌더링으로 전환. Claude Code의 TUI 스타일이 정확하게 표시되고 ANSI 색상/커서 제어도 그대로 표시되어 실제 터미널과 동일한 경험을 제공. 동시에 PTY가 정확한 viewport 크기로 초기화되도록 floating window에서 크기를 측정 후 시작. 위키 그래프는 엣지 렌더 버그 + 드래그 동기화 지연 + 신경쓰지 않던 styled relation_type 시각화 + 낮은 edge density를 일괄 개선. 인제스트 프롬프트를 강화해서 LLM이 노드 간 연결과 wikilinks를 더 적극적으로 생성. 원본 raw 파일을 OS 기본 앱으로 열거나 탐색기로 reveal하는 기능. 마지막으로 자주 쓰는 외부 도구/명령/URL을 클릭 한 번에 실행하는 Global Favorites 런처를 사이드바에 추가. UI 라벨은 "장기기억" → "위키"로 통일.

### 주요 변경

#### 1. Sessions: 실시간 xterm.js 터미널 + Floating Window + 사이즈 피팅 (`3507c2d`, `7a61500`, `35c276c`)

- **세션 터미널 UI 재설계**:
  - `SessionWindow.tsx` (new) — macOS-style titlebar drag, bottom-right resize handle, min 320×200. createPortal로 document.body에 렌더. Drag/resize는 gesture 중엔 style.transform 직접 쓰고 mouseup에 React state 커밋 (xterm canvas 안정성). 모바일 (<768px)은 fullscreen 모드, 데스크톱은 auto-offset cascading. 위치/크기는 per-session localStorage 저장
  - `SessionWindowsHost.tsx` (new) — ProjectDetail 스코프 context provider. open window 추적, z-index 포커스 관리, 세션 삭제 시 auto-close, tab 전환 후에도 window 생존
  - `useMediaQuery` hook (new) — viewport 미디어쿼리 subscription
  - tailwind z-index 신규 slot: `floating: 110` (modal과 toast 사이)
- **xterm.js 실시간 렌더링**:
  - `SessionTerminal.tsx` — @xterm/xterm + FitAddon. 키스트로크/리사이즈를 WebSocket session:terminal-input / session:resize로 전달. 바이너리 프레임 수신 시 xterm에 write
  - **DB**: 신규 `session_raw_chunks(session_id, seq, bytes)` 테이블. 255KB ring buffer per-PID. 세션마다 ~2MB rolling cap. FK CASCADE. 재시작 후에도 히스토리 재생
  - **서버**: claude-manager에 per-pid raw subscriber Map + 256KB ring buffer. stripAnsi 전 fan-out (기존 stripped 경로는 untouched). writeStdinRaw — \n → submitSeq 변환 skip, 바이너리 키스트로크 그대로 전달
  - **WebSocket**: broadcaster에 per-client subscription set 신규. sendBinaryToSubscribers (4MB backpressure auto-unsubscribe). 네 개 신규 메시지: session:subscribe (persisted 청크 replay → ring tail → session:replay-end), session:unsubscribe, session:terminal-input, session:resize
  - **클라이언트**: useWebSocket이 바이너리 프레임 수신 시 per-sessionId 콜백 Map으로 dispatch (React state 우회, 성능 최적화). SessionTerminal은 FitAddon으로 viewport에 피팅
- **Two-Phase PTY 시작** (크기 정확성):
  - 기존: PTY spawn at 200×50, ~150ms 후 resize (box borders 오정렬)
  - 개선: SessionWindow open → xterm fit → POST /api/sessions/:id/start with measured {cols, rows}
  - `claudeManager.startClaude(...)` — optional `ptyCols`, `ptyRows` positional args end (기본 200×50, Todo/Discussion/Codex headless 호출 무변경)
  - `sessionManager.startSession(id, opts?)` — opts.ptyCols/ptyRows 전달, fallback 100×30
  - POST body: `{cols, rows}` 검증 (20-500 cols, 10-200 rows)
- **세션 Window 생명주기 개선**:
  - SessionWindow phase machine: `pendingFit` → `starting` → `subscribed` | `replay-only` (읽기-전용 열기) → `stopping` → error
  - SessionWindowsHost.`openOrFocus(sessionId, intent='open'|'start')` — intent + intentNonce. replay-only 윈도우를 'start' intent로 re-focus 시 auto-start (예: 사용자가 조회 용도로 열었다가 ▶ 누른 경우)
  - X 버튼: running+subscribed이면 확인 모달 → sessionsApi.stopSession → `stopping` phase → auto-close (session:status-changed listener). 아니면 그냥 close
  - SessionList: row click → `openOrFocus(id, 'open')`, ▶ button → `openOrFocus(id, 'start')`
  - i18n: session.startInWindow / starting / stopping / startFailed / confirmStop (ko/en)
- **Deps**: `@xterm/xterm` + `@xterm/addon-fit` (client)

#### 2. Wiki: 그래프 렌더링 + 드래그 동기화 + 엣지 스타일 통일 + 인제스트 강화 (`ec498d3`, `a423c4b`, `07a967c`)

- **그래프 핸들 + 엣지 렌더링 fix** (`ec498d3`):
  - `MemoryNetworkGraph.tsx` — MemoryDot 노드에 target(Top) + source(Bottom) Handle 추가 (투명 8×8, hoover 시 25% 흰 테두리). ReactFlow v12는 Handle 없으면 엣지 anchor 불가
  - drag-to-connect 동작도 함께 복구
- **엣지 스타일 통일 + 드래그 동기화 fix** (`a423c4b`):
  - 5종 relation_type 컬러 실선 + wikilink 점선 혼재 → 모두 점선 회색 (#6B7280, dashed 4 3, opacity 0.6). type='straight' 명시로 default bezier 차단 (handle 방향 무시)
  - relation_type 정보는 Connections 섹션에서 텍스트로 여전히 노출
  - 핸들 중심 배치: Position.Top × 2 → translate(-50%,-50%) at 노드 center. 원형 fill이 line 안쪽 덮으므로 floating-edge 시각
  - 드래그 위치 즉시 반영: initialPositions useMemo를 `[length, length, length]` deps only에서 (단일 노드 position_x/y 변경 무시) → `layoutFallback` (force, length deps) + `displayPositions` (rawNodes deps, DB 좌표 우선)로 2단계 분리
- **Wiki Graph 인제스트 강화** (`07a967c`):
  - INGEST_PROMPT_HEADER: edge rules "only when clearly implied" → "generate aggressively". 노드마다 최소 1개 연결 권장
  - 본문 wikilinks 신규 규칙 — 다른 노드 언급 시 [[Exact Title]]로 감싸도록 강제, 1-3개 권장
  - 5개 relation_type 각각 1줄 가이드: related/precedes/example_of/counter_example/refines
  - "연결 0인 노드는 코드 스멜" self-check 라인
  - DEFAULT_WIKI_SCHEMA Conventions: wikilink 'liberally' 사용, 연결 없는 노드 무용성 명시
- **Raw 파일 열기/reveal** (`07a967c`):
  - POST /api/projects/:id/memory/raw-files/open — `mode: 'open'|'reveal'` (Windows: start/explorer-select, macOS: open/open-R, Linux: xdg-open). Path traversal guard (project root + .clitrigger/raw/)
  - `RawFileViewer` 헤더에 ExternalLink/FolderOpen 두 버튼
  - i18n: wiki.rawFile.{openExternal,revealInFolder}

#### 3. Wiki UI 라벨 통일 (`34c6b89`)

- i18n 사전: `memory.*` → `wiki.*`, `memoryInject.*` → `wikiInject.*`, `tabs.memory` → `tabs.wiki`. "메모리"/"노드" → "항목", "Memory"/"node" → "entry/wiki"
- 8개 컴포넌트 t() 호출 치환 (MemoryForm, MemoryGraph, MemoryList, MemoryNetworkGraph, MemoryNodeDetail, MemoryInjectControl, ProjectHeader, ProjectDetail)
- ProjectDetail 탭 key: `memory` → `wiki`
- 의도적으로 유지: DB 테이블/컬럼 (`memory_nodes`, `memory_edges`), API 라우트 (`/api/projects/:id/memory/*`), 파일명/타입명 (내부 식별자), XML 태그 `<long_term_memory>` (LLM 시맨틱)

#### 4. Global Favorites Launcher (`cd81fea`)

- **DB**: 신규 `favorites` 테이블 (id, name, type, target, args, cwd, icon, sort_order). type CHECK: 'executable' | 'command' | 'url'
- **서버 라우트**: `/api/favorites` (CRUD) + `POST :id/launch`. Per-type dispatch — URL은 explorer.exe/open/xdg-open, .exe는 spawn(shell:false) (.bat/.cmd는 shell:true on Windows), shell 명령은 exec. 모두 detached + unref (fire-and-forget)
- **클라이언트**: api/favorites.ts wrapper, Favorite/FavoriteType 타입
- **UI**: Sidebar에 FAVORITES 섹션 (Projects와 bottom controls 사이). 각 row: icon + name, hover-revealed Edit/Delete. FavoriteForm 모달 — type toggle이 target/args/cwd 입력 전환. Per-type icons (FileCode/Terminal/Link)
- **검증**: name + target 필수, URL은 http(s)://, target ≤4096 chars, args ≤64 항목, cwd 존재 확인 on launch. "비밀번호 알면 이들 도구 실행 가능" 보안 공지
- **i18n**: ko/en 전체 (favorites.*, sidebar.favorites)

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/client/src/components/SessionWindow.tsx` | NEW — draggable/resizable floating window, macOS titlebar, corner resize |
| `src/client/src/components/SessionWindowsHost.tsx` | NEW — context provider for window lifecycle + z-index + localStorage |
| `src/client/src/components/SessionTerminal.tsx` | xterm.js 인스턴스 + FitAddon, binary frame subscription |
| `src/client/src/hooks/useMediaQuery.ts` | NEW — viewport media query subscription |
| `src/client/src/components/MemoryNetworkGraph.tsx` | Handle 추가 (ReactFlow v12 엣지 앵커링) |
| `src/server/services/claude-manager.ts` | Raw byte ring buffer, writeStdinRaw, ptyCols/ptyRows args |
| `src/server/services/session-manager.ts` | Raw chunk batching + DB flush, startSession(id, opts?) |
| `src/server/websocket/broadcaster.ts` | Binary frame support, per-client subscriptions |
| `src/server/db/schema.ts` | NEW `session_raw_chunks`, `favorites` 테이블 |
| `src/server/db/queries.ts` | session_raw_chunks CRUD, favorites CRUD + launch |
| `src/server/routes/sessions.ts` | POST :id/start body {cols, rows}, raw subscription endpoints |
| `src/server/routes/memory.ts` | POST .../raw-files/open endpoint |
| `src/client/src/i18n.tsx` | wiki.*, wikiInject.* 키 + favorites.* |
| `src/client/src/api/sessions.ts` | startSession(id, dims?) |
| `src/client/src/api/favorites.ts` | NEW — favorites CRUD + launch |

### 아키텍처 결정

1. **xterm.js 렌더링 경로**: Todo/Discussion의 chat-mode LogViewer는 유지 (structured Claude JSON), Session만 raw xterm로 pixel-perfect 표시. 두 경로 독립적
2. **Raw channel ring buffer**: 재시작 후 히스토리 재생을 위해 DB 저장하되, 세션당 ~2MB rolling cap으로 메모리/DB 폭증 방지
3. **Floating window portal**: 위키/Todos 탭 전환 후에도 window 생존해야 하므로 ProjectDetail body wrap이 아니라 document.body portal로 (tab switch 시 DOM이 destroy되지 않음)
4. **Wiki 라벨 변경 + 내부 naming 유지**: 사용자에겐 메타포(Wiki)를 명확히, 시스템은 DB/API/파일명을 안정적으로 (migration 리스크 제거, LLM 시맨틱 신호 보존)
5. **Favorites launcher**: Project-agnostic하므로 sidebar 글로벌 섹션 (project context 불필요). Fire-and-forget은 orphan process 회피

---

## 2026-04-28 — Long-term Memory 그래프 + Discussion → Planner 변환 + Harness CLI 설정 플러그인 + Review Queue 인라인 diff

### 배경

"동일 프로젝트에서 같은 컨텍스트를 매번 붙여 넣는다"는 불만이 누적되어 프로젝트 단위로 재사용 가능한 메모리(노드+엣지)를 만들고 todo/discussion 프롬프트에 골라 주입할 수 있는 그래프 기반 시스템 도입. Discussion이 끝나도 결론을 다시 손으로 옮겨 적어 Planner에 등록해야 했던 동선을 LLM 추출로 자동화. Claude/Gemini/Codex의 settings/memory/MCP 파일을 IDE 전환 없이 GUI에서 편집할 수 있는 Harness 플러그인을 도입. Review Queue는 카드에서 바로 변경 파일과 diff를 펼쳐볼 수 있도록 인라인 확장 + 워크트리가 정리된 후에도 브랜치 ref로 폴백해서 diff 표시. Gemini의 quota 초과는 exit code가 안 떨어져 fallback chain이 동작하지 않던 문제, Windows에서 discussion-to-planner 추출이 cmd.exe 인자 길이 한계에 걸리던 문제, headless Gemini/Codex 출력에 xterm.js / conpty 다중행 노이즈가 새던 문제 등 누적 fix들을 일괄 정리.

### 주요 변경

#### 1. Long-term Memory 그래프 + LLM 주입 (`0494e07`)

- **DB**: 신규 테이블 `memory_nodes`(title/body/tags/position/pinned), `memory_edges`(from/to/relation_type: related/precedes/example_of/counter_example/refines, UNIQUE(from,to,relation)). FK CASCADE + 4개 인덱스. 마이그레이션으로 `todos.memory_inject_mode`/`memory_node_ids`, `discussions.memory_inject_mode`/`memory_node_ids`, `projects.memory_default_mode` 컬럼 추가
- **서버 서비스**: `memory-injector.ts` — 노드 본문 + arrow-notation 관계(예: `A —(precedes)→ B`)를 `<long_term_memory>` 블록으로 빌드. `memory-inject-hook.ts` — 오케스트레이터 사이드의 wrapper(주입 카운트/모드 로깅)
- **오케스트레이터**: todo와 discussion 프롬프트 앞에 메모리 블록 prepend. 기존 plugin hook 루프와 별도로 todo/discussion 로그에 "injected N nodes (mode=...)" 라인 기록. CLI-agnostic이라 Claude/Gemini/Codex 동일하게 동작
- **라우트**: 신규 `routes/memory.ts` — `GET /api/projects/:id/memory/graph` (전체 그래프), `GET/POST /api/projects/:id/memory/nodes`, `PUT/DELETE /api/memory/nodes/:nodeId`, `PUT /api/memory/nodes/:nodeId/position`, `POST /api/projects/:id/memory/edges`, `PUT/DELETE /api/memory/edges/:edgeId`, `POST /api/projects/:id/memory/preview` (모드+노드 ID로 프롬프트 미리보기). 관계 타입 검증 + stale-ID-safe 동작. todos/discussions 라우터도 `memory_inject_mode`/`memory_node_ids` 수락/저장
- **클라이언트**: 새 Memory 탭 — List/Graph 토글. `MemoryList` (노드 카드 + 검색/태그 필터), `MemoryGraph` (`@xyflow/react` + dagre auto-layout, drag-to-connect, 엣지 타입 인라인 편집, precedes/refines에 cycle guard), `MemoryNodeDetail` (Markdown body + 인접 엣지 패널), `MemoryForm` (title/body/tags/pin)
- **클라이언트**: 재사용 컴포넌트 `MemoryInjectControl` — None / All / Selected 3 모드 + 선택된 노드 칩 + 프롬프트 미리보기 모달. `TodoForm`, `DiscussionForm`에 통합
- **i18n**: ko/en 대규모 키 추가 — 탭/리스트/그래프/폼/엣지 관계명/주입 컨트롤

#### 2. Discussion → Planner 변환 (`3d5ffd7`, `e327de3`, `7ddd8f4`)

- **서버 서비스**: `discussion-extractor.ts` — discussion 트랜스크립트를 한방 `claude --print` 호출(또는 프로젝트의 `cli_tool`에 따라 `gemini --yolo --prompt=`/`codex exec`)에 stdin으로 전달해 `{title, description, priority}` JSON 배열을 추출. 관대한 파서(코드펜스/주변 텍스트 무시). 120초 timeout. Windows에서는 `cmd.exe /c` 래핑
- **서버 라우트**: `POST /api/discussions/:id/extract-planner-items` (preview, 비저장) + `POST /api/discussions/:id/convert-to-planner` (저장)
- **DB**: `planner_items.source_discussion_id` 컬럼 추가. `createPlannerItem`에 `sourceDiscussionId` 옵션, `getPlannerItemsByDiscussionId` 헬퍼
- **클라이언트**: 완료된 discussion에서 "Send to Planner" 버튼 → 추출 모달(체크박스 per-item, 인라인 title/description 편집, priority 셀렉터). `PlannerItem`에 "From Discussion" 배지 — 클릭 시 원 discussion으로 이동
- **모달 UX 보강** (`e327de3`): 추출이 최대 2분까지 걸리는 동안 Loader2 스피너 + "추출 끝까지 기다려달라" 힌트 표시. backdrop 클릭 / Esc 닫기를 `extractLoading=true` 동안 차단(이전엔 saving만 차단해서 진행 중 결과가 폐기되던 버그). Cancel 버튼도 disabled + 흐림 처리
- **Windows 인자 한계 해소** (`7ddd8f4`): 기존 `runClaudePrint`(트랜스크립트를 `-p <prompt>` 인자로 전달)이 cmd.exe ~32KB 한계에 걸려 비-trivial discussion에서 "The command line is too long" 실패. `runHeadless(cliTool, prompt)`로 교체 — stdin pipe 전달, CLI별 최소 invocation, project.cli_tool 존중
- **i18n**: Discussion 탭/모달 키 13개 추가

#### 3. Harness CLI 설정 플러그인 (`e540f76`)

CLI 도구의 사용자 설정 파일(settings/memory/MCP)을 IDE를 열지 않고 GUI에서 직접 편집하는 신규 플러그인.

- **서버 플러그인**: `src/server/plugins/harness/` — `/api/harness/:projectId` 엔드포인트 그룹. CLI별 어댑터(`adapters/claude.ts`, `gemini.ts`, `codex.ts`)가 settings/memory/MCP 읽기·쓰기를 담당. `io.ts` — atomic write(임시 파일 + rename), deep-merge로 untouched 필드 보존, path-traversal guard
- **Codex adapter**: `@iarna/toml`로 `~/.codex/config.toml` 파싱. 프로젝트가 trusted 목록에 없으면 응답에 `trustLevelMissing` 경고 surface
- **클라이언트 플러그인**: `src/client/src/plugins/harness/` — Claude/Gemini/Codex 탭 UI(`HarnessPanel`, `CliTab`). `SettingsForm` (모델/시스템 프롬프트 등), `MemoryEditor` (CLI별 메모리 파일 raw editor), `McpServerList` + `McpServerForm` (MCP 서버 CRUD, secret 마스킹)
- **워크트리 격리 경고 배너**: 편집은 워크트리가 아닌 프로젝트 루트(`~/.claude/`, `~/.codex/`, `~/.gemini/`)에 적용되므로 상단에 "워크트리 격리 효과 없음" 배너 노출
- **테스트**: `adapters.test.ts` — 3개 어댑터의 read/write/병합/path-traversal 거부 케이스 213줄 커버

#### 4. Review Queue 인라인 diff + 브랜치 ref 폴백 (`d559c53`, `dd9c120`, `f21ccbf`, `30accf1`, `9a6312d`, `84b1e04`)

- **서버**: `routes/review.ts` — `GET /api/review/diff/:todoId` (변경 파일 + 통계) + `GET /api/review/diff/:todoId/file?path=...` (파일별 diff). numstat + name-status 파싱, 경로 화이트리스트로 path-traversal 차단
- **서버**: `resolveDiffContext()` 재설계 — 워크트리가 정리된 후에도 prj repo + branch_name으로 폴백, 그조차 없으면 `default_branch`가 `master/main`인지 확인하는 2차 폴백 (`resolveLocalBaseBranch`). 응답에 `debug` 페이로드(worktree_path/exists, branch_name, project_path, default_branch, resolved_base) + 사유 코드(`no-branch`, `branch-missing`, `base-branch-missing`)
- **공통 헬퍼 추출** (`08137a6`): `src/server/lib/git.ts`에 `resolveLocalBaseBranch(git, configured)` 헬퍼 추가. `routes/review.ts`의 로컬 헬퍼 제거 + `routes/logs.ts` (`/todos/:id/diff`, `/todos/:id/result`) + `routes/discussions.ts` (`/discussions/:id/merge`, `/discussions/:id/diff`)에서 동일 폴백 적용. base 브랜치를 못 찾으면 400 응답
- **클라이언트**: `GitStatusPanel`에서 `CommitFileList`/`CommitDiffViewer`를 추출해 공용 `DiffViewer` 컴포넌트로 이동. `ReviewCard`에서 인라인으로 file-list + diff-viewer 펼침 — Space/ArrowRight로 토글, Esc로 접기. 정리된 워크트리에 대해 사유별 i18n 메시지 + debug 정보 noopener 패널
- **CSS 픽스** (`9a6312d`): `CommitDiffViewer`가 `text-warm-100`(=배경 토큰)을 사용해 다크 모드 diff 라인이 거의 안 보이던 문제. `WorkingDiffViewer`와 동일한 고정 다크 팔레트(`bg-[#1A1A1A]`, `text-gray-100/200`, `border-gray-700`)로 통일
- **CSS 픽스** (`84b1e04`): `ReviewCard`의 프로젝트/브랜치 메타 라벨에 적용된 `uppercase`가 `feature/2-md` 같은 영문 브랜치명을 `FEATURE/2-MD`로 강제 + CJK 자간을 불필요하게 벌리던 문제. `uppercase` 제거 + `tracking-wider` → `tracking-wide`

#### 5. Gemini quota 소진 시 CLI fallback (`fad2374`)

- **문제**: Gemini의 `exhausted your capacity` / `quota will reset` 에러는 기존 context-window 정규식과 다르고, CLI가 내부에서 무한 재시도하면서 exit code가 떨어지지 않음. orchestrator의 exit-code-driven fallback이 동작하지 않아 quota-blocked todo가 wedge 상태로 남음
- **해결**: `log-streamer.ts`에 `QUOTA_EXHAUSTION_PATTERN` + per-todo 타임스탬프 ring buffer. **60초 내 3회** 임계값 초과 시 force-kill 트리거. stdout/stderr/Claude JSON event 모든 경로에서 hit 카운트
- **재사용**: `LogStreamer.setQuotaKillCallback`을 `claudeManager.stopClaude`에 wire — 기존 kill 경로 그대로 사용해 별도 fallback 머시너리 없이 `getNextFallbackCli`가 다음 CLI로 스위치
- **UX**: 임계값 트립 시 "switching CLI" 가시 로그 라인 emit
- **테스트**: log-streamer 케이스 3개 (threshold, stdout 검출, single-hit non-trigger)

#### 6. PTY 노이즈 필터: xterm.js / conpty 블록 (`5027474`)

- **문제**: Windows headless Gemini/Codex 실행 시 두 종류의 multi-line 노이즈가 task log UI에 leak — (1) xterm.js parser-state 덤프(occurrence당 30+줄, nested params/Int32Array 행), (2) node-pty conpty 스택 트레이스(Gemini의 `run_shell` 툴이 서브쉘을 spawn할 때마다 `AttachConsole failed` 출력). 기존 PTY 노이즈 필터는 Claude TUI chrome 전용이라 headless plain-text 스트림에선 동작 안 함 + 단일 행 패턴이라 multi-line 블록 흡수 불가
- **해결**: `pty-output-filter.ts`에 stateful 블록 필터 추가 — `PtyFilterState`에 `activeBlock` + `blockLineCount` 필드. xterm.js 덤프(outer `}` 컬럼 0까지) / conpty 스택(`Node.js vX.X.X` 줄까지) 추적, 200줄 runaway guard. `isNoiseLine`이 AttachConsole/conpty/xterm.js 라인을 `/^Error/` 보존 예외 *전에* 드랍. 12개 단일행 fallback 패턴(Node.js banner, conpty 스택프레임, caret pointer, Int32Array/Uint16Array 헤더, `s3 {`, field-name 덤프 행, 외톨이 `],`) 추가
- **headless 경로 통합**: `log-streamer.ts`에서 `noiseFilterMap` per-todoId 보관 (stdout/stderr가 conpty start/end 마커를 분할해도 블록 상태 공유). `streamToDb`의 stdout/stderr/end fallback이 모든 라인을 `isPlainTextNoise`로 게이트. `getTokenUsage`가 noiseFilterMap도 unconditional cleanup (Gemini 경로는 tokenUsageMap을 init하지 않으므로 일찍 정리해야 함)
- **테스트**: pty-output-filter 케이스 7개 추가 — 전체 xterm.js 덤프, stdout/stderr 분할된 conpty, runaway guard, 진짜 Error/ENOENT 보존, Int32Array fallback 행

#### 7. 기타 fix들

- **프로젝트 git 상태 자동 감지** (`a5a5582`): `git init` 전에 추가된 프로젝트가 `is_git_repo=0`으로 묶여 사용자가 설정 패널의 "Re-check Git Status" 버튼을 찾아야 했음. `GET /api/projects/:id`를 async로 만들고 `is_git_repo`가 falsy면 `isGitRepository(path)` 재실행 + 성공 시 영속화. detection 에러는 swallow해서 inaccessible 경로에서도 GET이 robust하게 유지
- **모델 레지스트리 확장: Gemini** (`e7f76b7`): Gemini 드롭다운이 `gemini-2.5-pro` 하나만 보여주던 문제 — `gemini --help`가 모델 ID를 반환 안 하고 fallback registry에 1개뿐이었음. 6개 추가(gemini-3-pro-preview, gemini-3-flash-preview, gemini-3.1-pro-preview, gemini-3.1-flash-lite-preview, gemini-2.5-flash, gemini-2.5-flash-lite). `SYNC_ALGORITHM_VERSION` `'3'` → `'4'`로 bump해 기존 DB 자동 re-sync
- **모델 레지스트리 확장: Codex** (`69cdbdd`): Codex도 동일한 `--help` 블라인드스팟 — gpt-5*-codex 변종이 모두 누락. 5개 추가(gpt-5.1-codex, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5-codex, gpt-5-codex-mini). `SYNC_ALGORITHM_VERSION` `'4'` → `'5'`로 다시 bump해 Gemini 동기화 직후 저장된 행도 재조정

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/db/schema.ts` | `memory_nodes`/`memory_edges` 테이블 + 4개 인덱스 + 5개 마이그레이션 컬럼 |
| `src/server/db/queries.ts` | memory CRUD 쿼리, `getPlannerItemsByDiscussionId`, `createPlannerItem` 시그니처 확장 |
| `src/server/services/memory-injector.ts` | (신규) `<long_term_memory>` 블록 빌더 + arrow-notation 관계 |
| `src/server/services/memory-inject-hook.ts` | (신규) injector wrapper + 로깅 |
| `src/server/services/discussion-extractor.ts` | (신규) headless CLI 호출 + JSON 배열 파서 |
| `src/server/services/orchestrator.ts` | todo 프롬프트에 memory 블록 prepend |
| `src/server/services/discussion-orchestrator.ts` | discussion 프롬프트에 memory 블록 prepend |
| `src/server/services/log-streamer.ts` | `QUOTA_EXHAUSTION_PATTERN` + per-todo timestamp ring + plain-text noise filter wire |
| `src/server/services/pty-output-filter.ts` | block-level filter + 12개 fallback 패턴 + `isPlainTextNoise` export |
| `src/server/lib/git.ts` | (확장) `resolveLocalBaseBranch` 헬퍼 |
| `src/server/routes/memory.ts` | (신규) `/api/projects/:id/memory/{graph,nodes,edges,preview}` + 노드/엣지 CRUD |
| `src/server/routes/discussions.ts` | extract-planner-items / convert-to-planner 엔드포인트 + base 브랜치 폴백 |
| `src/server/routes/review.ts` | 인라인 diff 엔드포인트 (`/diff/:todoId`, `/diff/:todoId/file`) + debug 페이로드 + 사유 코드 |
| `src/server/routes/logs.ts` | `/todos/:id/diff`/`result`에 base 브랜치 폴백 |
| `src/server/routes/projects.ts` | `GET /:id`에 lazy git 감지 |
| `src/server/data/cli-models-registry.json` | Gemini 1→7, Codex 5→10, `SYNC_ALGORITHM_VERSION` `3`→`5` |
| `src/server/plugins/harness/` | (신규) Claude/Gemini/Codex settings/memory/MCP CRUD 플러그인 |
| `src/server/index.ts` | memory 라우터 마운트 + harness 플러그인 등록 |
| `src/client/src/components/MemoryList.tsx` | (신규) 노드 카드 리스트 |
| `src/client/src/components/MemoryGraph.tsx` | (신규) ReactFlow + dagre 그래프 뷰 |
| `src/client/src/components/MemoryNodeDetail.tsx` | (신규) 노드 상세 + 인접 엣지 |
| `src/client/src/components/MemoryForm.tsx` | (신규) 노드 폼 |
| `src/client/src/components/MemoryInjectControl.tsx` | (신규) None/All/Selected 모드 + 프롬프트 미리보기 |
| `src/client/src/components/DiffViewer.tsx` | (신규, GitStatusPanel에서 추출) 공용 file list + diff viewer |
| `src/client/src/components/ReviewCard.tsx` | 인라인 diff 펼침 + 사유 메시지 + uppercase 제거 |
| `src/client/src/components/DiscussionDetail.tsx` | "Send to Planner" 버튼 + 추출 모달 + 스피너/락 |
| `src/client/src/components/PlannerItem.tsx` | "From Discussion" 배지 |
| `src/client/src/components/TodoForm.tsx` / `DiscussionForm.tsx` | `MemoryInjectControl` 통합 |
| `src/client/src/components/ProjectDetail.tsx` | Memory 탭 추가 |
| `src/client/src/api/memory.ts` | (신규) memory API 래퍼 |
| `src/client/src/api/harness.ts` | (신규) harness API 래퍼 |
| `src/client/src/api/discussions.ts` | extract/convert API |
| `src/client/src/api/review.ts` | inline diff API |
| `src/client/src/plugins/harness/` | (신규) Claude/Gemini/Codex 탭 + 설정 폼 + 메모리 에디터 + MCP CRUD |
| `src/client/src/i18n.tsx` | memory / harness / discussion-extract / review.diff 키 일괄 |

### 아키텍처 결정

1. **메모리 주입은 CLI-agnostic 프롬프트 prefix**: 어댑터 변경이나 CLI별 분기 없이 `<long_term_memory>` 블록을 프롬프트 앞에 prepend. Claude/Gemini/Codex 어디서나 동일한 효과를 얻고, 어댑터는 그대로 dumb pipe 유지. 로깅은 오케스트레이터의 plugin hook 루프와 별도 라인이라 plugin 시스템과 결합도 없음
2. **그래프 구조 + cycle guard**: 메모리는 단순 리스트가 아니라 노드+typed edges 그래프 — `precedes`/`refines`처럼 방향성이 의미 있는 관계는 cycle을 만들면 inject 시 무한 루프 위험이 있어 클라이언트에서 추가 시 cycle 차단. `related`/`example_of`/`counter_example`은 무방향 관계로 허용
3. **Discussion → Planner는 별도 LLM 호출**: 토론 트랜스크립트에서 액션 아이템을 뽑는 작업은 토론과 다른 prompt/모드라서, discussion-orchestrator를 재사용하지 않고 한방 headless 호출 (`discussion-extractor`)로 분리. 추출 결과는 사용자 편집 단계를 거쳐 영속 — 자동 저장하지 않음
4. **Harness는 격리되지 않는다**: Claude/Gemini/Codex 설정은 `~/.claude/`, `~/.codex/`, `~/.gemini/`에 저장되므로 워크트리 격리 효과가 없음. 사용자가 혼동하지 않게 패널 상단에 명시적 경고 배너. 플러그인은 atomic write + deep-merge로 untouched 필드 보존하지만, 프로젝트 간 충돌은 사용자 책임
5. **Review diff는 워크트리 의존을 끊음**: 워크트리가 정리되면 cross-project review가 끊기던 문제 — 우선순위를 (1) 프로젝트 repo + branch ref → (2) 워크트리 HEAD → (3) `master/main` 폴백 순으로 재배치. 모든 사유는 디버그 페이로드에 노출해 무엇이 빠졌는지 추적 가능
6. **base 브랜치 폴백 헬퍼는 공용화**: `routes/review.ts`/`logs.ts`/`discussions.ts`에 같은 폴백 로직이 흩어져 있던 것을 `src/server/lib/git.ts`의 `resolveLocalBaseBranch(git, configured)`로 통일. 한 곳만 손대면 모든 diff 엔드포인트가 일관 처리. 못 찾으면 명시적 400 응답으로 사일런트 실패 차단
7. **Gemini quota는 sliding-window detection**: 단일 매치로 즉시 kill하면 일시적 retry 메시지에 false positive. 60s 내 3회로 임계값 설정 — orchestrator는 별도 fallback 머시너리 없이 기존 exit-code 경로(`stopClaude` → exit code → `getNextFallbackCli`) 재사용. detection은 `LogStreamer`에 callback 주입 형태라 다른 CLI에 동일 패턴 추가 가능
8. **PTY 노이즈 필터는 stateful + headless 통합**: 단일 행 정규식으로 부족한 multi-line 블록은 state machine(activeBlock + blockLineCount)으로 진입/종료 추적. 200줄 runaway guard로 패턴 누락 시 무한 흡수 방지. headless 경로 (`log-streamer.streamToDb`) 통합으로 Claude TUI 전용이던 cleanup이 Gemini/Codex headless에도 적용

---

## 2026-04-27 — Morning Review Queue + Git 탭 워크스페이스 재설계 + Planner Markdown 포맷

### 배경

"밤새 위임하고 아침에 리뷰" 워크플로우가 늘어나면서 프로젝트 탭을 일일이 클릭해 결과물을 훑어보는 동선이 비효율적이었다. 한 화면에서 모든 프로젝트의 최근 todo를 비용/diff/요약과 함께 모아 보고 키 입력만으로 승인·discard 할 수 있어야 했다. Git 탭은 좁은 사이드바에 욱여넣은 파일 상태 영역이 스테이징/커밋에 답답해, Fork/SourceTree 식으로 워크스페이스 뷰를 분리. 4개 분할 영역도 고정 비율을 사용자 조절형으로 바꿔 GUI 클라이언트 수준의 조작성을 확보. Planner의 JSON Export/Import는 GitHub/Obsidian에서 그대로 못 읽는다는 불만을 받아 Markdown 포맷으로 교체.

### 주요 변경

#### 1. 크로스-프로젝트 Morning Review Queue (`ce1efba`, `3e3d5a3`)

- **클라이언트**: 새 `/review` 페이지(`ReviewQueue.tsx`, `ReviewCard.tsx`) — 모든 프로젝트의 최근 todo를 단일 카드 스택으로 집계. 카드마다 프로젝트 라벨, 마지막 어시스턴트 한 줄 요약, 토큰, diff 통계, risk 배지(low/medium/high), status 배지 노출
- **클라이언트**: 키보드 네비게이션 — `j`/`k`/화살표로 포커스 이동, `Enter`로 우측 슬라이드인 상세 패널, `m` merge, `d` discard, `Esc`로 닫기. N개 todo가 O(N) 키 입력으로 처리되도록 설계. 시간 윈도우 셀렉터(12h/24h/7d) + 필터 칩(All/Risky/Quick wins/Failed) + 상단 sticky token 리본 (총 토큰 + CLI별 K/M 표기 분해)
- **클라이언트**: `Sidebar`에 Review Queue 링크 + 24시간 pending 카운트 배지 추가. 우측 상세 패널은 임베드 모드 `LogViewer`를 그대로 재사용
- **서버**: `routes/review.ts` — `GET /api/review/queue`, `GET /api/review/summary` 두 엔드포인트. since(절대 시각) 또는 hours(상대, 기본 24h, 30일 캡)로 윈도우 지정, statuses 쉼표 필터(default `completed,failed,stopped`). 서버 사이드 risk 분류기(failed 또는 diff_lines>300 → high, ≥50 → medium)
- **서버**: `services/review-capture.ts` — `pickSummaryFromLogs(todoId)`으로 가장 최근 라운드의 마지막 어시스턴트 라인을 240자 트리밍해 `todos.summary`에 저장. `computeDiffStats(worktreePath, defaultBranch)`로 `git diff <main>...HEAD --shortstat`을 파싱해 files/lines를 `todos.diff_files`/`diff_lines`에 저장. 오케스트레이터의 `runTodo` 성공/실패 두 경로 모두에서 `captureReviewMetadata(todoId).catch(...)` 형태로 호출(베스트 에포트, 실패해도 무시)
- **DB**: `todos.summary TEXT`, `todos.diff_lines INTEGER`, `todos.diff_files INTEGER` 3개 컬럼을 기존 additive-migration 패턴으로 추가
- **재사용**: 카드 액션은 기존 `mergeTodo` / `continueTodo` / `cleanupTodo` API 그대로 사용 — 새 mutating 엔드포인트 추가 없음
- **UI 디테일** (`3e3d5a3` 후속): Summary 카드/CLI별 분해 모두 비용(USD) 대신 토큰 합계로 표기. `formatCost` → `formatTokens`(K/M 단위)로 교체, i18n 키 `review.cost.*` → `review.tokens.*` 리네임. 비용은 보통 0에 수렴해서 의미가 작고, 모델 다양성을 고려할 때 토큰량이 더 직관적
- **i18n**: ko/en 39개 키 추가

#### 2. Git 탭 워크스페이스 뷰 재설계 (`67f2941`)

- **클라이언트**: `GitStatusPanel`에 `WorkspaceMenu`(좌측 사이드바) — File Status / History 두 모드 전환, 선택 상태는 프로젝트별 localStorage(`git-workspace:{projectId}`) 영속화
- **클라이언트**: `WorkingChangesView` — 좌측에 staged + unstaged 파일 리스트 세로 스플릿, 우측에 working tree diff 뷰어, 하단에 커밋 메시지 textarea + "커밋 후 origin/<branch>로 push" 체크박스. Cmd/Ctrl+Enter 커밋 단축키
- **클라이언트**: `ChangedFileRow` / `WorkingDiffViewer` — untracked 파일을 가짜 new-file diff로 처리, binary/empty diff fallback 추가
- **클라이언트**: History 뷰는 좌측 file-status 블록을 제거하고 커밋 그래프 + 컬럼이 메인 패널 전체 폭을 차지하도록 단순화. 사용하지 않게 된 `FileStatusSection`/`fileStatusLabel` 헬퍼 제거
- **i18n**: 워크스페이스 메뉴, 파일 패널, 커밋 옵션, diff empty state 등 ko/en 22개 키

#### 3. Git 탭 다크 모드 팔레트 정정 (`1ecc04c`)

- **클라이언트**: 새 워크스페이스 뷰의 일부 요소가 `dark:text-warm-100..300`처럼 배경 토큰(warm-100..300)을 텍스트 색에 매핑하던 탓에 다크 모드에서 텍스트가 거의 안 보이던 문제. warm 팔레트는 이미 CSS 변수로 라이트/다크 자동 전환되므로 `dark:` 오버라이드 자체가 불필요 + 잘못된 매핑이었음
- **클라이언트**: unstaged 헤더, 커밋 바(textarea/divider/체크박스 라벨), 커밋 히스토리 헤더의 `dark:` 텍스트/border/배경 오버라이드 제거. `WorkspaceMenu` inactive 항목/뱃지도 자동 스왑 토큰만 사용하도록 단순화. `WorkingDiffViewer`만 터미널 느낌을 위해 고정 다크 배경(`bg-[#1A1A1A]`) + gray-* 텍스트 유지

#### 4. Git 탭 분할 영역 사용자 조절 (`a7c46e8`)

- **클라이언트**: 4개 고정 비율 분할 영역(좌측 워크스페이스 사이드바 ↔ 메인, 커밋 히스토리 ↔ 커밋 상세 패널, 커밋 상세의 파일 리스트 ↔ diff 뷰어, working view의 파일 패널 ↔ diff)에 드래그 핸들 추가. 새 `Resizer` 컴포넌트(axis x/y, hover 시 accent 색)
- **클라이언트**: localStorage 영속화 키 4개(`sidebar-w`, `detail-h-pct`, `detail-fl-w`, `working-pct`). min/max 클램프로 패널 0px 축소 방지. 기존 고정 클래스(`w-56`, `w-60`, `w-[55%]`)와 인라인 50% 스타일을 동적 flex/style 로 교체

#### 5. Planner 포맷: JSON → Markdown (`1a1b61c`)

- **서버**: `routes/planner.ts` — `serializePlannerMarkdown` / `parsePlannerMarkdown` 추가. status별 섹션(`## Pending` / `## In Progress` / `## Done`)에 GFM 체크박스(`- [x]` / `- [ ]`)로 아이템 직렬화, description은 들여쓴 본문 블록, tags/priority/due는 HTML 주석 메타(`<!-- tags:a,b priority:high due:2026-04-30 -->`)로 round-trip 보장
- **서버**: `GET /export`는 이제 `text/markdown` 컨텐트 타입과 `.md` 파일명으로 응답. `POST /import`는 라우트 레벨 `express.text({ type: ['text/markdown', ...] })` 본문 파서로 raw 텍스트를 받고, 파싱 결과 검증 후 atomic 트랜잭션 import
- **클라이언트**: `api/planner.ts` — `PlannerExportPayload`/`PlannerExportItem` 타입 제거, `importPlanner(file)`이 raw markdown 문자열을 받아 `Content-Type: text/markdown`으로 POST. fallback 파일명 확장자 `.json` → `.md`
- **클라이언트**: `ProjectDetail`은 더 이상 `JSON.parse`하지 않고 파일 텍스트 본문을 그대로 전송. `PlannerList` 파일 input의 `accept`가 `.md,.markdown,text/markdown`로 변경
- **i18n**: 툴팁/에러 문구를 "Markdown"으로 통일. `planner.importInvalidJson` → `planner.importInvalidMarkdown`
- **호환성**: 이전 `.json` Export 파일은 더 이상 import되지 않음 — dual-format 호환층은 두지 않은 클린 교체

#### 6. Planner 카드에 Markdown 드래그-드롭 import (`e27b954`)

- **클라이언트**: `PlannerList`에 카드 영역 한정 드래그-드롭 임포트 — `.md`/`.markdown` 확장자 또는 `text/markdown` MIME만 허용, 그 외는 alert 후 무시. counter 기반 `isDragOver` 상태로 nested `dragenter`/`dragleave` 처리. Upload 아이콘 + 힌트 오버레이는 `pointer-events-none`이라 underlying 카드까지 드래그 이벤트가 도달
- **클라이언트**: 기존 import 핸들러를 그대로 재사용해 서버 변경 없음. `ioBusy` 락은 파일 피커 import 경로와 공유
- **i18n**: ko/en `planner.dropHint`, `planner.dropHintSub`, `planner.dropInvalidFile`

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/routes/review.ts` | (신규) `/queue`, `/summary` 엔드포인트 + risk 분류기 |
| `src/server/services/review-capture.ts` | (신규) 마지막 어시스턴트 요약 + diff stats 캡처 (best-effort) |
| `src/server/services/orchestrator.ts` | success/failure 두 경로에서 `captureReviewMetadata` 호출 |
| `src/server/db/schema.ts` | `todos.summary` / `diff_lines` / `diff_files` 컬럼 |
| `src/server/db/queries.ts` | `getReviewQueue` / `getReviewSummary` cross-project 조인 |
| `src/server/index.ts` | `/api/review` 라우터 마운트 |
| `src/server/routes/planner.ts` | Markdown 직렬화/파싱, `text/markdown` 응답 + 본문 파서 |
| `src/client/src/components/ReviewQueue.tsx` / `ReviewCard.tsx` | (신규) Review Queue 페이지 + 카드 |
| `src/client/src/components/Sidebar.tsx` | Review Queue 링크 + 24h pending 배지 |
| `src/client/src/components/GitStatusPanel.tsx` | 워크스페이스 메뉴, WorkingChangesView, 4개 Resizer, 다크 팔레트 정정 |
| `src/client/src/components/PlannerList.tsx` | `.md`/`.markdown` accept + 드래그-드롭 오버레이 |
| `src/client/src/components/ProjectDetail.tsx` | Planner import에 raw text 전송 |
| `src/client/src/api/planner.ts` | Markdown 임포트로 시그니처 변경 |
| `src/client/src/api/review.ts` | (신규) review API 클라이언트 |
| `src/client/src/App.tsx` | `/review` 라우트 |
| `src/client/src/i18n.tsx` | review/Markdown/워크스페이스 메뉴 키 일괄 |

### 아키텍처 결정

1. **Review Queue는 새 mutating 엔드포인트 없음**: 카드의 3개 액션(merge/discard/continue)은 기존 todo API로 충분히 표현 가능. 신규 엔드포인트는 read-only(`/queue`, `/summary`)에 한정해 표면적을 최소화
2. **요약/diff stats는 캡처 시점에 비정규화**: `task_logs`/`git diff` 매번 재계산하는 대신 종료 직후 한 번 캡처해 `todos`에 저장. 24시간 윈도우 쿼리는 N개 todo에 대해 N번의 git 셸 호출이 아니라 단일 SQL 조인으로 처리. 오케스트레이터는 best-effort `.catch(() => {})`로 호출해 캡처 실패가 todo 자체 실패를 유발하지 않게 격리
3. **risk 분류는 서버 사이드**: 클라이언트가 동일 임계값을 다시 구현하지 않도록 `low/medium/high` 라벨을 응답에 포함. 변경 시 한 곳만 손대면 됨
4. **Planner Markdown 클린 교체**: `.json`/`.md` 듀얼 포맷 호환층은 의도적으로 두지 않음 — DB 스키마는 동일하므로 변경 비용은 파일 형식뿐이고, 호환층은 파서/프론트 양쪽에 부담만 늘림. v1 마커는 `> Version 1` 인용구로 본문에 표기
5. **Git 탭은 사용자 비율 + localStorage**: GUI 클라이언트(SourceTree/Fork) 사용자 멘탈 모델에 맞춰 4개 분할 모두 조절 가능하게 풀고, 각 프로젝트 단위가 아닌 글로벌 키로 영속화 — 화면 해상도 기반 선호는 프로젝트 간 일관되는 게 자연스러움

---

## 2026-04-21 — v0.1.7 릴리스: npm install opt-in + Git UI 폴리시 + 기동 배너/업데이트 체크 재설계

### 배경

v0.1.6/v0.1.7 릴리스 라인에 맞춰 누적된 사용자 불만 지점들을 정리. 언어 불문 오케스트레이터인데 워크트리 생성마다 `npm install`이 돌아 Python/Go/Rust 프로젝트에도 불필요한 `node_modules/`가 생겼고, Git 탭에서 브랜치에 워크트리가 붙어 있으면 Delete가 실패해 두 번 조작해야 했고, 기동 배너의 "Local/Remote" 라벨과 diff 뷰어의 원색 텍스트/컨텍스트 메뉴 라벨 가독성처럼 손봐야 할 표면 이슈들을 일괄 해소. 24시간 쿨다운 기반 자동 재설치 업데이트 로직은 v0.1.7 직후 "재시작했는데도 새 배너가 안 뜬다"는 피드백을 받아 "매 기동 시 체크 + 원라인 힌트만 표시"로 재설계.

### 주요 변경

#### 1. 워크트리 `npm install` opt-in (`dd2b374`)

- **DB**: `projects.npm_auto_install INTEGER DEFAULT 0` 컬럼 추가 (기본 OFF — 생태계 중립 유지)
- **서버**: `WorktreeManager.createWorktree(..., autoInstall)` 파라미터 추가. `autoInstall=true`일 때만 루트/`src/client` `npm install` 실행. Todo/Discussion/Session 오케스트레이터가 모두 `!!project.npm_auto_install`을 전달
- **서버**: `Project` 타입에 `npm_auto_install` 필드, `updateProject()` accept 목록 확장
- **클라이언트**: `ProjectHeader` 설정 — 워크트리 패널 하위 체크박스 추가. 워크트리 격리 자체가 꺼져 있으면 disabled. `npm install`이라는 명시적 표현으로 생태계 종속성 가시화
- **i18n**: `project.npmAutoInstall`, `project.npmAutoInstallHelp` (ko/en)

#### 2. 브랜치 + 워크트리 동시 삭제 (`9105239`)

- **클라이언트**: `GitStatusPanel` 브랜치 컨텍스트 메뉴 — 워크트리가 붙은 브랜치에서 일반 Delete는 git `cannot delete branch X used by worktree at ...` 에러로 실패하던 문제 해결. `worktrees.find`로 붙은 워크트리를 감지해 "Delete branch + worktree" 단일 항목으로 렌더, 기존 `cleanupWorktree(projectId, wt.path, branch)` 엔드포인트로 한 번의 왕복에 워크트리 제거 + 브랜치 강제 삭제. 워크트리가 없는 브랜치는 기존 plain Delete 유지
- **i18n**: `git.deleteWorktreeAndBranch`, `git.confirmDeleteWorktreeAndBranch` (ko/en)

#### 3. Diff 배경 tint 스타일 (`61ca6d6`)

- **클라이언트**: 3개 diff 뷰어(`GitStatusPanel` CommitDiffViewer, `TaskNodeDetail`, `TodoItem`) — 추가/삭제 라인을 원색 green/red 텍스트로 찍던 방식을 GitHub 스타일로 변경. 텍스트는 앱 기본 색상 유지, 배경만 `bg-green-500/20` / `bg-red-500/20` (또는 `bg-status-success/15` / `bg-status-error/15`) 반투명 tint. `@@` hunk 헤더와 `diff` 파일 헤더의 blue/amber 강조색은 유지

#### 4. 브랜치 컨텍스트 메뉴 테마 토큰 (`67f4381`)

- **클라이언트**: `GitStatusPanel` MenuItem — 다크 모드에서 `text-warm-300`이 실제로는 `border-strong` CSS 변수로 resolve 되던 탓에 Checkout/Merge/Rebase 등 메뉴 라벨이 거의 안 보이던 문제 수정. `text-warm-700 dark:text-warm-300` → `text-theme-text`, `hover:bg-warm-100 dark:hover:bg-warm-800` → `hover:bg-theme-hover`로 교체. danger 변형(delete)의 `text-status-error`는 유지

#### 5. 기동 배너 재설계 (`c0d3b96`)

- **서버**: `tryListen` 배너 재구성 — "Local / Remote"라는 불투명한 라벨 대신 "Open on this computer" / "Share with others" 의도 기반 카피. `TUNNEL_ENABLED=true`일 때만 "(tunnel starting…)" placeholder, 이후 터널 URL 도착 시 "비밀번호가 유일한 보안 수단"이라는 보안 고지 추가. 로그인 리마인더 + Ctrl+C 종료 힌트 포함
- **서버**: 터널 에러/EADDRINUSE 재시도 메시지는 ✖/⚠ 접두사로 친숙화
- **서버**: 운영상 의미 없는 내부 dev 로그 2개 제거 — `WebSocket server initialized on /ws` (`src/server/websocket/index.ts`), `Rate limit info fetched: …` (`log-streamer.ts`). DB 저장/WebSocket 브로드캐스트는 변경 없음

#### 6. 업데이트 체크 재설계 — fire-and-forget + 힌트만 (`26aa4f2`)

- **CLI**: `bin/clitrigger.js` — 기존 24시간 쿨다운 + `execSync('npm i -g clitrigger@latest')` + `spawn` 재시작 체인을 제거하고, 매 기동마다 npm 레지스트리에 5초 타임아웃 비동기 조회만 수행 (`checkForUpdateAsync()`). 새 버전이 있으면 `Update available: <v>  ->  npm i -g clitrigger@latest` 한 줄 배너만 출력하고 업그레이드 시점은 사용자에게 위임
- **CLI**: `lastUpdateCheck` 쿨다운 필드는 read 호환만 유지(무시). `CLITRIGGER_UPDATED` 재시작 루프 가드 환경변수 제거. 서버 부팅 경로가 더 이상 업데이트 체크를 await 하지 않음
- **배경**: v0.1.7 출시 직후 24시간 이내 재시작한 사용자는 업데이트를 영영 못 봤고, 장시간 세션 중 `execSync` 설치 + 프로세스 재시작이 예기치 못한 중단을 유발

#### 7. Planner 툴바 overflow 방지 (`0d2cade`, `47b29a8`)

- **클라이언트**: `PlannerList` 툴바 — 좁은 화면에서 필터 select가 너비 밀어내기로 Export/Import/New 버튼을 오버플로우 시키던 문제. 컨테이너에 `min-w-0`, select에 `w-auto max-w-[10rem] shrink`, 버튼들에 `shrink-0` 적용으로 select가 먼저 줄어들고 버튼은 한 줄을 유지

#### 8. CI 안정화 (`04f29bd`)

- **클라이언트 typecheck**: recharts v3 범프 후 `TooltipProps<number, string>` 루트에서 `payload`/`label`이 노출되지 않아 `AnalyticsPanel`에 로컬 `ChartTooltipProps` 정의. `GitStatusPanel` `RefsSidebar`에서 스코프 밖 `setActionError` 대신 `onError` prop 사용. `PlannerItem`은 `<select>` 문자열을 `typeof item.status`로 캐스팅. `ProjectDetail.handleCleanupTodo`에서 `deleteBranch`를 optional로 변경해 `TodoList`/`ScheduleList`의 `(id) => Promise<void>` prop 시그니처 충족
- **서버**: `model-sync.ts` — `BUILTIN_REGISTRY` 상수 추가. 러너 작업 디렉토리에서 `cli-models-registry.json`을 읽지 못할 때 폴백. 파일이 있으면 여전히 선호(런타임 업데이트 유지)
- **클라이언트 테스트**: `StatusBadge`는 `animate-spin`(Loader2)만 사용하고 `animate-pulse`는 사용 안 함 — assertion/테스트명 정정

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `bin/clitrigger.js` | 자동 재설치 제거, fire-and-forget 업데이트 힌트 |
| `src/server/index.ts` | 기동 배너 의도 기반 재구성 + 터널 URL 도착 시 보안 고지 |
| `src/server/services/worktree-manager.ts` | `createWorktree(..., autoInstall)` 파라미터, 기본 OFF |
| `src/server/services/orchestrator.ts` / `discussion-orchestrator.ts` / `session-manager.ts` | `project.npm_auto_install` 전달 |
| `src/server/services/model-sync.ts` | `BUILTIN_REGISTRY` 폴백 |
| `src/server/services/log-streamer.ts` / `src/server/websocket/index.ts` | 운영 무의미 로그 제거 |
| `src/server/db/schema.ts` / `queries.ts` | `projects.npm_auto_install` 컬럼 |
| `src/client/src/components/GitStatusPanel.tsx` | 브랜치+워크트리 동시 삭제, 메뉴 테마 토큰, diff tint |
| `src/client/src/components/ProjectHeader.tsx` | npm install 하위 체크박스 |
| `src/client/src/components/TaskNodeDetail.tsx` / `TodoItem.tsx` | diff tint 배경 |
| `src/client/src/components/PlannerList.tsx` | 툴바 shrink/min-w 조정 |
| `src/client/src/components/AnalyticsPanel.tsx` | recharts v3 로컬 tooltip 타입 |
| `src/client/src/__tests__/components/StatusBadge.test.tsx` | animate-spin 기준 assertion |

### 아키텍처 결정

1. **npm install 기본 OFF**: CLITrigger는 언어 불문 오케스트레이터이므로 `package.json` 존재만으로 자동 설치를 트리거하던 기존 동작은 pnpm/yarn/bun 프로젝트와 비-JS 프로젝트에 부적절. 옵트인 토글로 전환하되 명칭을 `npm_auto_install`로 명시해 "생태계에 종속적인 선택"임을 UI/API 양쪽에서 가시화
2. **업데이트는 힌트만, 설치는 사용자 결정**: 장시간 워크플로우 중에 `execSync` + 프로세스 재시작이 개입하는 것은 오케스트레이터 특성상 너무 비싼 대가. 쿨다운 기반 24시간 게이트 역시 빠른 릴리스 루프에서 역효과. "매 기동 시 1라인 힌트"가 재시작 빈도가 낮은 서버에도 충분히 전달됨
3. **브랜치 + 워크트리 복합 삭제는 기존 엔드포인트 재사용**: `cleanupWorktree`가 이미 워크트리 제거 + 브랜치 강제 삭제를 수행하므로 새 엔드포인트 없이 UI에서 분기만 추가. API 표면 확장을 피함
4. **Diff 색상은 배경 tint**: 원색 텍스트가 app default text color/다크 모드 카드 배경과 싸우는 문제는 GitHub 관례(텍스트 그대로 + 배경 tint)로 해결. 라이트/다크 일관된 가독성 확보

---

## 2026-04-20 — 할일별 워크트리 오버라이드 + DnD 순서 변경 + 에이전트 구현 권한 + Planner Export/Import + Todo 스택/필터 UI

### 배경

프로젝트 기본값 외에 할일/에이전트 단위로 격리·권한을 세밀하게 조정할 수 있도록 오버라이드를 도입(짧은 패치는 메인 브랜치에서, 토론 중에 개발자 에이전트가 직접 커밋 등). Planner를 프로젝트·설치 간 이동하려는 요구에 JSON Export/Import를 추가. TODO 탭은 스택 모드/상태 필터/갭 드랍 기반 순서 변경으로 리스트 관리 UX 개선. Git 명령 출력의 한글 파일명 깨짐, 워크트리 없는 프로젝트의 Claude strict 샌드박스 미동작, 사이드바에서 프로젝트 CRUD 불가 같은 쌓인 불편도 일괄 해소.

### 주요 변경

#### 1. 할일별 워크트리 오버라이드 + 메인 브랜치 동시성 게이트 (`45eb87d`)

- **DB**: `todos.use_worktree` nullable INTEGER 컬럼 추가 (null=상속, 0=메인 강제, 1=워크트리 강제)
- **서버**: `orchestrator.ts` — `resolveUseWorktree(project, todo)` 헬퍼로 todo 오버라이드 > `project.use_worktree` 우선순위 일원화. `continueTodo`/`startSingleTodo` 두 지점에서 공통 사용
- **서버**: `canStartNow` 게이트 — effective useWorktree=false인 todo는 다른 todo 실행 중이면 시작 거부하고 "deferred" 로그 남김. `startDependentChildren`에 형제 재시도 로직을 추가해 부모 완료 시 pending 형제들이 자동 재시도
- **API**: `POST /api/projects/:id/todos`, `PUT /api/todos/:id` body에 `use_worktree` 수신 + 도메인 검증 (null|0|1)
- **클라이언트**: `TodoForm` — 3-옵션 라디오(inherit / 워크트리 / 메인), 상속 선택 시 프로젝트 기본값 힌트 표시, 메인 브랜치 실행 시 "다른 작업 동시 실행 차단" 경고. `TodoList`/`TaskGraph`/`TodoItem`/`TaskNodeDetail` 시그니처 체인에 `projectIsGitRepo`, `projectUseWorktree`, `useWorktree` 전파
- **i18n**: ko/en `todoForm.worktree*` 키 7개

#### 2. 토론 에이전트별 `can_implement` 플래그 (`b2a1681`)

- **DB**: `discussion_agents.can_implement` (INTEGER DEFAULT 0) 컬럼 추가
- **서버**: `discussion-orchestrator.ts` — `runAgentTurn`/`buildTurnPrompt`에 플래그 전달. `can_implement=true` 에이전트에는 "지금은 토론 중이지만 최소 조각(prototype)은 구현/커밋해도 된다"는 변형 프롬프트 제공(최종 구현 라운드의 "전부 구현하고 끝내라" 프롬프트와 구분). `project.default_max_turns` 전액 부여로 10턴 캡 해제
- **서버**: 워크트리 라이프사이클/최종 구현 라운드/커밋 감지·브로드캐스트 경로는 유지 — 공유 워크트리/브랜치에 커밋이 자연스럽게 체인됨
- **API**: POST/PUT discussion-agents에서 `can_implement` 수신
- **클라이언트**: `AgentManager` — 생성/수정 폼에 "Implement during discussion" 체크박스 + 설명, 리스트 행에 망치 아이콘 "Implementer" 뱃지
- **i18n**: `agents.canImplement`, `agents.canImplementHelp`, `agents.canImplementBadge` (ko/en)

#### 3. Planner JSON Export/Import (`9b9c1ba`)

- **서버**: `routes/planner.ts` —
  - `GET /api/projects/:id/planner/export`: 버전이 박힌 JSON 다운로드(items + tag metadata). `Content-Disposition` 파일명 `planner-{projectSlug}-{yyyymmdd}.json`. `status='moved'` 아이템은 제외(converted_id 참조가 다른 DB에서 무의미)
  - `POST /api/projects/:id/planner/import`: 버전·아이템 검증 후 `db.transaction()`로 원자적 롤백. 상태 정규화(pending/in_progress/done만 허용), 기존 태그 색상 보존
- **클라이언트**: `PlannerList.tsx` — "New Item" 옆 Export/Import 버튼, 숨은 파일 입력, `ioBusy` 가드. `ProjectDetail`에서 object URL 다운로드 + 두 컬렉션(items, tags) 동시 refresh, 이미지 포함 아이템 경고 표시
- **i18n**: Export/Import 라벨·툴팁·성공/에러 메시지·이미지 고지 등 키 9개 (ko/en)

#### 4. TODO 드래그앤드랍 순서 변경 (`f630bc6`, `d68369b`, `f994a6e`, `269f700`)

- **클라이언트**: `TodoList` — 아이템 사이(+맨 위/맨 아래)에 gap drop zone을 항상 렌더(높이 16px + ±8px 마이너스 마진으로 `space-y-3` 12px 갭 영역에 겹쳐 실제 레이아웃 변화 0). 드래그 중일 때만 accent 가로선 표시
- **클라이언트**: `handleGapDragOver/Leave/Drop` + `dragOverGapIndex` 상태. 새 prop `onReorderTodos`로 순서 ID 배열 전달. `TodoItem.dataTransfer.effectAllowed='link'`로 의존성 DnD와 공존
- **클라이언트**: `ProjectDetail.handleReorderTodos` — 전달받은 순서대로 priority `0..N-1`을 재할당하고 기존 `updateTodo` API로 batch 업데이트
- **주의**: 드래그 중 DOM 구조가 바뀌면 Chromium이 "소스가 이동했다"고 판단해 dragstart를 중단함. gap 드롭존을 조건부 렌더링에서 상시 렌더링으로 전환, 소스 카드의 `scale-[0.98]` 변환 제거로 해결

#### 5. TODO 스택 모드 + 상태 필터 탭 (`5985faa`, `56005db`, `a0f8db7`, `0e59d0b`, `f0b888e`)

- **클라이언트**: `TodoList` — Layers 아이콘 토글로 iOS 알림 스택 스타일 접기. 모든 카드가 `position: absolute`로 6px 간격으로 겹치고 전면 카드만 노출, 클릭 시 펼침. `stackModeEnabled`/`stackCollapsed`를 localStorage에 영속화. 접힌 상태에서는 계층 평탄화, chain 헤더 숨김
- **클라이언트**: `TodoList` — All/Active/Completed/Cancelled 필터 탭 + 카운트. 선택 필터 localStorage 저장. 'all' 외 필터에서는 계층 평탄화
- **i18n**: 스택/필터 관련 번역 키 (ko/en)

#### 6. 사이드바에서 프로젝트 생성/삭제 (`1e042f0`)

- **클라이언트**: `Sidebar` — 워크스페이스 헤더 옆 `+` 버튼으로 기존 `ProjectForm` 모달 오픈. 각 행 hover 시 `X` 버튼 + confirm 다이얼로그로 삭제
- **클라이언트**: `projects:changed` 이벤트로 `ProjectList`와 동기화. 활성 프로젝트 삭제 시 `/`로 이동

#### 7. 결과 패널 변경 파일 헤더에 인라인 Diff 토글 (`5b2ffa0`)

- **클라이언트**: `TodoItem` — 더 보기(⋮) 메뉴에만 있던 "View Diff"를 결과 패널의 변경 파일 헤더로 승격. 클릭 시 기존 diff 뷰어 확장/축소

#### 8. Git 출력 한글 파일명 디코딩 (`fe0969e`)

- **서버**: `src/server/lib/git.ts` **신규** — `createGit(baseDir)` 팩토리가 `core.quotePath=false`를 per-invocation config으로 설정해 한글·CJK·이모지 파일명이 `\xxx` escape로 깨지는 현상 제거
- **서버**: `worktree-manager.ts`, `routes/execution.ts`, `routes/logs.ts`, `routes/discussions.ts`의 모든 `simpleGit(...)` 호출을 팩토리 경유로 이관

#### 9. Claude strict 샌드박스의 워크트리 없는 프로젝트 적용 (`1f20d68`)

- **서버**: `orchestrator.ts` — `.claude/settings.json` 생성 조건에서 `useWorktree && workDir !== projectPath` 게이트 제거. 비-git 프로젝트와 `use_worktree=false` 모두에서 workDir 스코프 허용 패턴이 주입되어 Read/Edit/Write이 거부되던 버그 수정

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/services/orchestrator.ts` | `resolveUseWorktree` 헬퍼, 메인 브랜치 동시성 게이트, 형제 재시도, Claude strict 샌드박스 조건 완화 |
| `src/server/services/discussion-orchestrator.ts` | `can_implement` 에이전트 분기 + 전용 프롬프트 |
| `src/server/services/worktree-manager.ts` | 모든 `simpleGit` 호출을 `createGit` 팩토리로 이관 |
| `src/server/lib/git.ts` | **신규** — `core.quotePath=false` 적용 `createGit` 팩토리 |
| `src/server/routes/planner.ts` | Export/Import 엔드포인트 추가 |
| `src/server/routes/todos.ts` | `use_worktree` 필드 수신·검증 |
| `src/server/routes/discussions.ts` | agent `can_implement` 필드 수신 |
| `src/server/db/schema.ts` | `todos.use_worktree`, `discussion_agents.can_implement` 컬럼 |
| `src/client/src/components/TodoList.tsx` | 스택 모드, 상태 필터 탭, gap drop zone 순서 변경 |
| `src/client/src/components/TodoForm.tsx` | 워크트리 tri-state 라디오 |
| `src/client/src/components/TodoItem.tsx` | 결과 패널 인라인 diff 토글, dragEffect `link` |
| `src/client/src/components/AgentManager.tsx` | `can_implement` 체크박스 + Implementer 뱃지 |
| `src/client/src/components/PlannerList.tsx` | Export/Import 버튼 + 파일 입력 |
| `src/client/src/components/ProjectDetail.tsx` | reorder 핸들러, Export/Import 다운로드·업로드 핸들러 |
| `src/client/src/components/Sidebar.tsx` | 프로젝트 생성/삭제 컨트롤 |

### 아키텍처 결정

1. **Worktree 설정 3-계층 tri-state**: `project.use_worktree`(레거시) 단일 계층을 확장할 때 "null=inherit / 0=force-main / 1=force-worktree" tri-state로 설계. 'inherit'을 null로 표현해 DB는 단일 컬럼으로 유지, 서버·UI에서 "설정 없음"을 명시적으로 판별 가능
2. **메인 브랜치 todo의 동시성 격리**: `.git` 동시 조작 충돌을 피하기 위해 단독 실행이 필수. 서버가 강제 직렬화를 거는 대신 `canStartNow` 게이트 수준에서 시작을 deferred로 잡고, 다른 todo 완료 시 `startDependentChildren` 흐름에서 재시도하도록 해 기존 큐 로직을 재사용
3. **can_implement는 최종 라운드와 공존**: 토론 중 커밋을 허용해도 최종 구현 라운드는 그대로 유지(`max_rounds+1`). 공유 워크트리/브랜치에 커밋이 자연스럽게 체인되므로 최종 라운드는 "남은 부분을 채워 넣고 끝내는" 역할로 재정의. 프롬프트 변형으로 "지금은 프로토타입만, 완성하려 하지 말라" 명시
4. **Gap drop zone 상시 렌더링**: dragstart 직후 DOM 구조가 바뀌면 Chromium이 드래그 소스의 위치 이동으로 오인해 드래그를 중단. 드롭존 높이(16px) + ±8px 마이너스 마진으로 `space-y-3` 갭 영역과 정확히 겹치게 만들어 레이아웃 변화를 0으로 두고, 시각 표시는 내부 선 show/hide로만 처리
5. **core.quotePath 전역 비활성화**: 한글/CJK/이모지 파일명을 git 호출 지점마다 수정하지 않고 `createGit` 팩토리에서 `config: ['core.quotePath=false']`로 일괄 적용. 모든 `simpleGit(...)` 호출을 팩토리 경유로 이관해 회귀 방지

---

## 2026-04-18 — PTY 어댑터화(Gemini/Codex 대화 수정) + Todo UI 롤백

### 배경

Gemini TUI는 `\r\n`을 Enter로 인식하고, Claude/Codex는 `\r`만으로 입력이 제출됨. 기존 하드코딩 `\r` 치환으로 인해 Gemini 인터랙티브 모드에서 사용자 메시지가 제출되지 않고 입력창에 누적되던 버그를 어댑터별 PTY submit sequence 분리로 해결. 또한 4/16에 적용한 TodoItem CMD/터미널 스타일이 앱 전반과 이질적이라는 피드백에 따라 일반 카드 UI로 복구(터미널 스타일은 실제 CLI 스트림이 있는 영역에만 유지).

### 주요 변경

#### 1. PTY submit sequence를 어댑터별로 분리 (`69395e1`)

- **서버**: `cli-adapters.ts` — `CliAdapter.stdinSubmitSequence` 필드 추가 (기본 `\r`, Gemini만 `\r\n` 오버라이드)
- **서버**: `claude-manager.ts` — 모든 PTY write 경로(초기 프롬프트 즉시/지연 전달, WebSocket stdin relay, 5s delayStdin fallback)에서 어댑터의 submit sequence 사용

#### 2. CLI trust/update 프롬프트 자동 응답을 어댑터 레벨로 일반화 (`bfe3d29`)

- **서버**: `cli-adapters.ts` — `delayStdinUntilReady`, `readyIndicatorPattern`, `AutoRespondRule[]` (blocking/non-blocking) 추가
  - Claude: 기존 trust-Enter 규칙을 새 형식으로 포팅
  - Gemini: welcome-screen ready 패턴, "Trust folder" 자동 확인(`1\r` 전송), 업데이트 프롬프트 거부 규칙 추가. 첫 실행 시 trust 다이얼로그가 사용자 초기 프롬프트를 삼키던 문제 해결
  - Codex: TUI 커서 ready 패턴 기반 delayStdin 활성화 (rule 목록은 placeholder)
- **서버**: `claude-manager.ts` — Claude 전용 trust regex 블록을 `adapter.autoRespondRules` 순회로 치환, trust clear 시 `stdinDelivered` 리셋(Gemini의 trust 승인 후 in-process restart 대응)

#### 3. Codex/Gemini 세션 재개 + Interactive 모드 복구 (`13979fb`)

- **서버**: `cli-adapters.ts` — Codex 어댑터가 `continueSession` 시 `exec resume --last` 발행, interactive 모드에서는 `exec` 서브커맨드 생략하고 top-level `codex` TUI 기동
- **서버**: `cli-adapters.ts` — Gemini 어댑터가 `continueSession` 시 `--resume latest` 발행
- **서버**: `claude-manager.ts` — PTY 분기 조건을 Claude 전용에서 interactive 모드 전체로 확대 (Codex/Gemini interactive 세션이 pipe 대신 진짜 TTY 획득)
- **테스트**: Codex resume, Gemini resume, Codex interactive args에서 `exec` 제외 케이스 커버리지 추가

#### 4. TodoItem 확장 섹션 UI 롤백 — 터미널 스타일 → 일반 카드 UI (`cc0f502`)

- **클라이언트**: `TodoItem.tsx` — 4/16의 CMD/터미널 래퍼(트래픽 라이트, `$ cat task.md` 등)를 제거하고 설명/브랜치/결과/diff 섹션을 Tailwind 카드/라벨/리스트로 재작성
- **클라이언트**: 터미널 스타일은 실제 CLI 스트림이 있는 영역에만 유지 — `$ tail -f task.log` LogViewer 래퍼, FAILED 에러 블록
- **클라이언트**: 결과 섹션에 stats chips(duration/commits/files/tokens) + 커밋 리스트 + 변경 파일 리스트(상태별 컬러 뱃지)
- **클라이언트**: 액션 에러 메시지를 CMD inline 문자열에서 status-error chip 카드로 변경
- **i18n**: `todo.worktree`, `todo.result` 키 추가

#### 5. 더 보기 메뉴에서 Diff 클릭 시 자동 확장 (`0114bfe`)

- **클라이언트**: `TodoItem.tsx` — `handleViewDiff`가 성공/실패 모두에서 `setExpanded(true)` 호출 (접힌 상태에서 더 보기 메뉴로 Diff 트리거 시 결과가 보이지 않던 버그 수정)

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/services/cli-adapters.ts` | `stdinSubmitSequence`, `delayStdinUntilReady`, `readyIndicatorPattern`, `autoRespondRules` 추가; Codex/Gemini resume 및 interactive args 분기 |
| `src/server/services/claude-manager.ts` | 어댑터 기반 PTY submit/autoRespond 루프, interactive 모드 PTY 확장 |
| `src/client/src/components/TodoItem.tsx` | 확장 섹션 카드형 UI 복원, Diff 클릭 자동 확장 |
| `src/server/services/__tests__/cli-adapters.test.ts` | Codex/Gemini resume·interactive 테스트 추가 |

### 아키텍처 결정

1. **PTY 입력 시퀀스 어댑터화**: 기존 Claude 기준 하드코딩을 제거하고 어댑터가 "CLI의 TUI가 기대하는 Enter 문자"를 선언하도록 변경. Gemini(`\r\n`), Claude/Codex(`\r`) 등 CLI별 차이를 adapter.ts 하나에 격리
2. **Auto-respond 규칙 일반화**: trust/update 프롬프트 자동 응답을 Claude 전용 분기에서 `AutoRespondRule[]` 배열로 일반화하여 신규 CLI 추가 시 규칙만 선언하면 되는 구조. blocking 규칙은 초기 프롬프트를 gating, non-blocking 규칙은 중간에 삽입되는 다이얼로그에 응답
3. **Todo 확장 UI 카드 복귀**: 전체 앱 톤과 이질적인 터미널 래퍼를 제거하되 실제 로그 스트림이 있는 영역에만 CMD 스타일 유지. "정보 패널"과 "터미널 스트림"을 시각적으로 구분

---

## 2026-04-17 — CLI 모델 레지스트리 + Gemini/Codex Interactive + 대화형 로그 뷰어 + 세션 Cleanup

### 배경

프로젝트/TODO 설정에서 하드코딩된 모델 목록을 CLI 자체에서 동기화 받아 deprecated 모델을 표시하고, Gemini/Codex도 세션 탭에서 인터랙티브로 사용 가능하도록 확장. 기존 LogViewer는 모든 출력을 평면 `[OUT]` 라인으로만 표시하여 대화 흐름을 따라가기 어려웠던 문제를 Chat/Raw 모드 토글로 해결. 세션에도 워크트리 cleanup 버튼 추가.

### 주요 변경

#### 1. CLI 모델 레지스트리 + deprecated 자동 감지 (`813797f`, `ebe4a8f`, `8b461bc`, `5ba031e`, `da1cf55`, `d232d46`, `8d719e2`)

- **서버**: `model-sync.ts` 신규 — CLI `--help` 파싱 + `src/server/data/cli-models-registry.json` 레지스트리 fallback을 병합(probe 결과 없으면 레지스트리 사용, 있으면 probe 결과로 보강)
- **DB**: `cli_versions` 테이블 + `cli_models.deprecated`, `cli_models.source` 컬럼 추가
- **서버**: `cli-status.ts` — 버전 체크 시 fire-and-forget으로 모델 동기화 트리거
- **클라이언트**: `ModelSettings`, `ProjectHeader`에 deprecated 뱃지 + 포털 기반 tooltip으로 fix guidance 표시
- **빌드**: `build:server`에서 `src/server/data/`를 `dist/server/data/`로 복사(레지스트리 패키징)
- **.gitignore**: `data/` → `/data/`로 좁혀 서버 데이터 디렉토리 추적

#### 2. Gemini/Codex Interactive 모드 활성화 (`8ad5ad5`)

- **서버**: `cli-adapters.ts` — Gemini/Codex 어댑터에 `supportsInteractive: true` 추가
- **클라이언트**: `cli-tools.ts` 동기화 (세션 폼 드롭다운에서 Claude 외에도 선택 가능)

#### 3. 대화형 로그 뷰어 — Chat/Raw 모드 토글 (`a3f5554`)

- **서버**: `log-streamer.ts` — Claude stream-json 이벤트를 평면 `output`이 아닌 `assistant`/`tool_use`/`tool_result` 타입으로 분류, 전체 텍스트 블록을 개행 분리 없이 단일 엔트리로 저장
- **서버**: `session-manager.ts` — 인터랙티브 PTY 출력에 휴리스틱 분류 적용 (● 프리픽스를 assistant 텍스트로, `[Tool:]`/⏺ 패턴을 tool_use로 감지, 연속된 assistant 라인을 하나의 블록으로 누적)
- **클라이언트**: `LogViewer.tsx` 재작성 — Chat 모드(마크다운 assistant 블록 + `▸`/`▾` 접이식 tool_use) / Raw 모드(기존 평면 터미널 뷰). 로그 타입에 따라 자동 모드 감지
- **클라이언트**: `.markdown-content-dark` CSS 추가 (다크 터미널 배경용 마크다운 스타일)
- **PTY 필터**: `pty-output-filter.ts` — 번호 프롬프트 에코(`3> ...`), CLI 상태 바, thinking 애니메이션, block char + 사이드바 텍스트 조합, 워크트리 경로, TUI 메뉴/모드 지시자(☰ ○) 등 노이즈 패턴 확장
- **타입**: `TaskLog.log_type`, `SessionLog.log_type` 유니온 확장
- **i18n**: Chat/Raw 토글 번역 키 추가

#### 4. PTY 스피너/TUI 노이즈 필터 강화 (`77a4fdb`, `6063ad9`, `23849ce`, `2b55f15`)

- **서버**: `pty-output-filter.ts` — 연속 스피너 프레임 접합, 베어 `\r` 애니메이션 라인, 단일 스피너 프리픽스 단편 redraw 필터링
- **서버**: 커서 시퀀스를 제거할 때 공백으로 치환하여 단어 간격 보존 (기존에는 공백이 전부 사라져 단어 경계가 붙던 문제)

#### 5. 세션 워크트리 Cleanup 버튼 + 브랜치 삭제 확인 (`56dc48d`, `fa723aa`, `b2fb1e0`, `ac80db4`)

- **서버**: `POST /api/sessions/:id/cleanup` 엔드포인트 추가
- **서버**: `worktreeManager.cleanupWorktree()`에 `deleteBranch` 파라미터 추가 (기본 true, false면 브랜치 보존)
- **서버**: todo/session cleanup 엔드포인트가 body의 `delete_branch` 수용, false면 DB에 `branch_name` 보존
- **클라이언트**: `SessionList.tsx` — 워크트리 존재 + 실행 중이 아닐 때 Archive 아이콘 버튼 표시
- **클라이언트**: `TodoItem`/`SessionList` — 브랜치 삭제 전 `confirm()` 다이얼로그 (기본 체크), 워크트리 없는 세션에는 cleanup 버튼 숨김
- **i18n**: `session.cleanup`, `cleanup.confirmDeleteBranch` 추가

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/services/model-sync.ts` | **신규** — CLI --help 파싱 + 레지스트리 fallback/병합 |
| `src/server/data/cli-models-registry.json` | **신규** — Claude/Gemini/Codex 기본 모델 목록 |
| `src/server/services/cli-status.ts` | 버전 체크 시 model sync fire-and-forget 트리거 |
| `src/server/services/cli-adapters.ts` | Gemini/Codex `supportsInteractive: true` |
| `src/server/services/log-streamer.ts` | stream-json 이벤트 타입 분류 (assistant/tool_use/tool_result) |
| `src/server/services/session-manager.ts` | 인터랙티브 PTY 출력 휴리스틱 분류 + `/cleanup` 지원 |
| `src/server/services/pty-output-filter.ts` | 스피너/TUI 노이즈 패턴 대거 추가 |
| `src/server/services/worktree-manager.ts` | `cleanupWorktree(path, deleteBranch?)` |
| `src/server/routes/sessions.ts` | `POST /:id/cleanup` 라우트 |
| `src/server/db/schema.ts` | `cli_versions` 테이블, `cli_models.deprecated/source` 컬럼 |
| `src/client/src/components/LogViewer.tsx` | Chat/Raw 이중 모드 렌더링 |
| `src/client/src/components/ModelSettings.tsx` | deprecated 뱃지 + tooltip |
| `src/client/src/components/ProjectHeader.tsx` | deprecated 모델 경고 tooltip (포털) |
| `src/client/src/components/SessionList.tsx` | cleanup 버튼 추가 |

### 아키텍처 결정

1. **모델 레지스트리 + probe 병합**: probe만 사용하면 CLI가 `--help` 포맷을 바꿀 때 빈 리스트가 되고, 레지스트리만 사용하면 신규 모델이 누락됨. 둘을 병합(union)하여 안정성과 최신성을 동시에 확보
2. **대화 로그 분류**: 로그를 DB에 저장할 때부터 의미 있는 타입(assistant/tool_use/tool_result)으로 분류해두어 클라이언트 렌더링 비용 최소화. 기존 flat `output`만 있는 레거시 로그는 Raw 모드로 fallback
3. **PTY 필터 패턴 누적**: 스피너/TUI는 CLI 업데이트마다 새 패턴이 추가되므로 `pty-output-filter.ts`에 패턴을 누적 등록하는 방식 유지 (개별 라인 차단 vs 라인 정규화 방식 혼용)
4. **Cleanup 브랜치 보존 옵션**: 워크트리 정리가 항상 브랜치를 삭제하는 기존 동작이 과도했음. confirm 다이얼로그로 "브랜치도 삭제" 여부를 명시적으로 받아 git 이력 보존 가능

---

## 2026-04-16 — 세션(Session) 탭 승격 + Planner 신규 + Git 워크트리 UI + 디자인 시스템 재정비

### 배경

인터랙티브 모드는 기존엔 TODO의 실행 옵션 중 하나였지만, "자동 실행(TODO)"과 "수동 대화(세션)"의 개념을 명확히 구분하기 위해 세션을 독립 엔티티로 승격(토론과 동일한 패턴). 피쳐/태그 중심의 경량 작업 관리를 위해 Planner 탭을 신규 추가. Git 패널 사이드바에 활성 워크트리 섹션을 추가해 todo/discussion 워크트리를 Git UI에서 직접 정리할 수 있게 함. 동시에 인라인 SVG 115개를 lucide-react로 전환하고 Modal/EmptyState/Toast/Skeleton 공용 컴포넌트를 도입, AnalyticsPanel의 차트를 Recharts로 교체.

### 주요 변경

#### 1. 세션(Session) 탭 신규 — 인터랙티브 모드의 독립 엔티티화 (`798682d`, `0cd78b4`)

- **DB**: `sessions`, `session_logs` 테이블 + CRUD 쿼리 12개 함수 (`use_worktree` 포함)
- **서버**: `session-manager.ts` 신규 — `claudeManager`/`logStreamer` 래퍼 + 워크트리 생성/재사용/실패 정리
- **서버**: `routes/sessions.ts` 신규 — 8개 REST 엔드포인트 (CRUD + start/stop/cleanup)
- **WebSocket**: `session:stdin` 핸들러 + `session:status-changed`/`session:log` 이벤트
- **서버**: 서버 시작 시 stale 세션 복구 + `session_logs` 자동 정리
- **클라이언트**: `SessionList.tsx`(목록 + 인라인 터미널), `SessionForm.tsx`(생성 폼 + Git 저장소일 때만 워크트리 체크박스)
- **클라이언트**: `ProjectDetail`에 세션 탭/상태/핸들러/WebSocket 이벤트 통합
- **i18n**: 기존 "작업" → "자동 작업" 탭 이름 변경, 세션 관련 번역 키 추가

#### 2. Planner 신규 기능 — CRUD + 태그 + TODO/스케줄로 변환 (`02a08d6`, 및 20여개 WIP 커밋)

- **DB**: `planner_items`, `planner_tags` 테이블 추가
- **서버**: `routes/planner.ts` 신규 — 아이템 CRUD + 태그 관리 + convert-to-todo/convert-to-schedule 엔드포인트
- **클라이언트**: `PlannerList.tsx`, `PlannerItem.tsx`, `PlannerForm.tsx`, `PlannerConvertDialog.tsx` 신규
- **클라이언트**: `ProjectDetail`에 Planner 탭 추가 (탭 바 첫 위치)
- **기능**: 인라인 편집(클릭 시 편집 모드), 컬럼 정렬(제목/우선순위/태그), 우선순위 컬럼, 태그 자동 색상 할당(10색 순환), 태그 인라인 색상 피커, 태그 rename/삭제, 쉼표 delimiter, Enter 동작, 이미지 첨부, 삭제 시 디스크 정리, 포털 기반 액션 메뉴
- **변환**: 플래너 아이템을 CLI 도구/모델 선택하여 TODO 또는 스케줄로 변환
- **i18n**: 한/영 번역 104개 키

#### 3. Git 사이드바 워크트리 섹션 + 브랜치 컨텍스트 메뉴 (`b12755b`, `35d4512`)

- **서버**: `GET /api/projects/:id/worktrees` (메인 워크트리 제외), `POST /api/projects/:id/worktree-cleanup`
- **클라이언트**: `GitStatusPanel.RefsSidebar` — Worktrees 접이식 섹션(폴더 아이콘, 브랜치명, hover 시 삭제 버튼, confirm 다이얼로그)
- **클라이언트**: 사이드바 로컬 에러를 상위 패널의 전체 너비 배너로 이동(truncate 문제 해결)

#### 4. UI 일관성 전면 개선 — Modal/EmptyState/Toast/Skeleton 공용 컴포넌트 + Recharts (`cf1a41e`)

- **신규 컴포넌트**: `Modal`(createPortal, sm/md/lg/xl, ESC 닫기, 애니메이션), `EmptyState`(아이콘+제목+설명+CTA), `Toast` + `useToast`(progress bar, slide-in, 4가지 타입), `Skeleton`
- **신규 유틸**: `lib/cn.ts` (조건부 클래스 조합)
- **AnalyticsPanel**: 직접 구현한 div 차트를 Recharts로 교체 (BarChart 스택드, 도넛 PieChart, cost/tokens 탭 LineChart)
- **마이그레이션**: 7개 모달 → Modal 컴포넌트, 7개 빈 상태 → EmptyState 컴포넌트, 전체 `text-[10px]`→`text-2xs`, `z-[9999]`→`z-tooltip`, `z-[60]`→`z-sticky`
- **tailwind.config.js**: z-index 시맨틱 스케일(dropdown/modal/toast/tooltip), `z-overlay:30`
- **index.css**: `text-2xs` 유틸, `btn-md` 사이즈, `btn-primary` 리플 이펙트, `toastProgress` 키프레임, stagger 애니메이션(30ms 간격)

#### 5. lucide-react 아이콘 전환 + MoreMenu 포털 수정 (`378425b`, `c313760`, `125e217`, `24d34ba`, `a649eb4`)

- **의존성**: `lucide-react` 추가
- **마이그레이션**: 24개 컴포넌트의 인라인 SVG 115개를 Lucide 아이콘으로 교체 (Sidebar/Layout/StatusBadge/ProjectList/TodoItem/DiscussionList 등 대부분 컴포넌트)
- **MoreMenu 수정**: `createPortal` + `offsetWidth` 기반 뷰포트 clamp + `positioned` state로 opacity 0→1 전환 (카드 영역 overflow-hidden 클리핑, 뷰포트 이탈, 위치 점프 버그 일괄 해결)
- **i18n**: 6개 메뉴 키의 긴 설명을 라벨 + Desc 키로 분리하고 tooltip으로 이동

#### 6. UI 디자인 리프레시 (대량 커밋들)

- **홈페이지 파티클**: 파티클 배경을 홈에서 `Layout`으로 이동하여 전체 페이지에 적용 (`fbbaf4b`)
- **버튼 위계**: btn-primary를 차분한 outlined 스타일로, Run All/Stop All을 ghost 스타일로, 그라디언트 제거 플랫 복원 (`728bf64`, `64acecf`, `57ae179`)
- **색상 통일**: 뱃지/그래프 노드 중성톤 통일, 중성톤 CLI tool 뱃지, dark/light 모드 시각적 계층 강화 (`a5804f0`, `638d812`, `b8be2da`, `5330fc8`)
- **Select 다크 모드**: 모든 `<select>`에 `color-scheme` 적용 + 옵션 다크 배경/텍스트 직접 지정 (`a0b3d5d`, `230a88b`, `8942860`)
- **Hero header + segmented tabs**: 프로젝트 헤더 리디자인 + 사이드바 레이아웃 + 액션 정리 (`f20142b`, `0866c0a`)
- **Dependency rail + 사이드바 압축**: TodoItem 헤더 최소화, 확장 영역 패널화, 의존성 rail 추가 (`474bc11`, `12dace9`)
- **CMD/터미널 스타일 Todo** (`d5609e4`, `2bef9ee`): 이후 4/18에 롤백됨(롤백 기록은 4/18 엔트리 참조)

#### 7. Planner 이미지 첨부 + 태그 관리 (`8b859ae`, `caabb7a`, `a2b5835`)

- 플래너 아이템에 이미지 첨부 지원 + 삭제 시 디스크 정리
- 태그 색상 관리(색상 피커, 색상 사이클, 저장 시점에 인라인 적용), rename, 삭제 기능
- 태그 제안 개선 (색상 코딩, 항상 표시)

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/db/schema.ts` | `sessions`, `session_logs`, `planner_items`, `planner_tags` 테이블 추가 |
| `src/server/services/session-manager.ts` | **신규** — 인터랙티브 세션 매니저 |
| `src/server/routes/sessions.ts` | **신규** — 세션 REST API (CRUD + start/stop/cleanup) |
| `src/server/routes/planner.ts` | **신규** — Planner REST API (CRUD + tags + convert) |
| `src/server/routes/projects.ts` | 워크트리 listing/cleanup 엔드포인트 추가 |
| `src/server/index.ts` | sessions/planner 라우터 마운트, stale 세션 복구 |
| `src/server/websocket/index.ts` | `session:stdin`/`session:log`/`session:status-changed` |
| `src/client/src/components/SessionList.tsx` | **신규** — 세션 목록 + 인라인 터미널 |
| `src/client/src/components/SessionForm.tsx` | **신규** — 세션 생성 폼 |
| `src/client/src/components/PlannerList.tsx` | **신규** — Planner 목록 |
| `src/client/src/components/PlannerItem.tsx` | **신규** — Planner 아이템 (인라인 편집) |
| `src/client/src/components/PlannerForm.tsx` | **신규** — Planner 생성 폼 |
| `src/client/src/components/PlannerConvertDialog.tsx` | **신규** — TODO/스케줄 변환 |
| `src/client/src/components/Modal.tsx` | **신규** — 공용 모달 (포털) |
| `src/client/src/components/EmptyState.tsx` | **신규** — 공용 빈 상태 |
| `src/client/src/components/Toast.tsx` | **신규** — 공용 토스트 |
| `src/client/src/components/Skeleton.tsx` | **신규** — 스켈레톤 로딩 |
| `src/client/src/components/AnalyticsPanel.tsx` | Recharts 기반 재작성 |
| `src/client/src/components/GitStatusPanel.tsx` | Worktrees 사이드바 섹션, 브랜치 컨텍스트 메뉴 연동 |
| `src/client/src/hooks/useToast.ts` | **신규** — 토스트 dispatcher |
| `src/client/src/lib/cn.ts` | **신규** — 조건부 클래스 유틸 |
| `src/client/tailwind.config.js` | z-index 시맨틱 스케일 (dropdown/modal/toast/tooltip) |
| `src/client/package.json` | `lucide-react`, `recharts` 추가 |

### 아키텍처 결정

1. **세션 = 토론 패턴 복제**: 기존 토론(Discussion)이 라운드/에이전트 기반 서비스를 독립 테이블+라우트+매니저로 구성한 것과 동일하게 세션도 `sessions` 테이블 + `session-manager.ts` + `routes/sessions.ts`로 분리. TODO의 실행 모드 옵션에서 빼내어 "자동/수동" 구분을 UX 레벨에서 명확히 함
2. **Planner 경량화**: Planner는 tsup-like CRUD만 제공하고, 실제 실행은 기존 TODO/스케줄로 변환하여 위임. 별도 실행 엔진 도입 없이 기존 인프라 재활용
3. **공용 UI 컴포넌트 도입**: Modal/EmptyState/Toast/Skeleton을 컴포넌트 테이블에 등록. 각 화면에서 reinvent 되던 패턴을 일원화하여 "floating elements must render via portal" 규칙 준수도 구조적으로 강제
4. **Recharts 채택**: AnalyticsPanel은 pure CSS div 차트로 시작했지만 인터랙션(툴팁, legend toggle)과 시맨틱 축을 제공하기 어려워 Recharts 도입. 번들 사이즈는 lazy-loaded panel에 한정
5. **Git 사이드바 워크트리 = todo cleanup 재활용**: 별도 UI 패턴 만들지 않고 기존 todo cleanup의 hover 삭제 버튼 + confirm 패턴을 그대로 사용

---

## 2026-04-15 — Glassmorphism + Skeleton + 인라인 프로젝트명 수정 + Rate Limit 자동 재스케줄

### 배경

Apple 스타일 디자인 시스템(4/7) 후속으로 glassmorphism, micro-interactions, 다층 그림자, 순차 등장 애니메이션을 도입하여 시각적 만족감 강화. 프로젝트 이름은 생성 시 고정되어 수정이 불가능하던 제약 해결. Claude CLI의 rate limit 소진 시 창구 리셋 시점에 자동으로 태스크를 재시도하는 스케줄링 추가.

### 주요 변경

#### 1. UI 디자인 업그레이드 — glassmorphism + skeleton + 애니메이션 (`b35d89d`, `3637bb1`, `b2c9c3f`, `51e10f5`, `4cf739f`)

- **클라이언트**: `index.css` 다층 그림자 변수(elevated, card hover용), 카드 상단 하이라이트 + 호버 부상 애니메이션
- **클라이언트**: `tailwind.config.js` — slide-up/slide-down/scale-in/shimmer 등 cubic-bezier 기반 애니메이션 키프레임
- **클라이언트**: `index.css` 전역 전환 효과 — 모든 버튼/링크/입력에 0.3s cubic-bezier 적용
- **클라이언트**: 프로젝트 목록/토론 목록 stagger 애니메이션 (50ms 간격으로 카드 slide-up)
- **클라이언트**: `ProjectForm` 모달에 backdrop-blur + scale-up 애니메이션
- **클라이언트**: `Skeleton.tsx` 신규 + `App`/`ProjectList`/`ProjectDetail`/`DiscussionDetail`/`NotionPanel`/`AnalyticsPanel`에 스켈레톤 로딩 상태 적용
- **클라이언트**: glass/glass-card CSS — `@apply` 호환성 버그 수정(opacity 클래스 분리), 다크 모드 배경색 수정

#### 2. 프로젝트 이름 인라인 수정 (`d2ce584`)

- **클라이언트**: `ProjectHeader.tsx` — h1 클릭 시 인라인 input 전환 (Enter 저장, Escape 취소, blur 자동 저장, hover 시 연필 아이콘 힌트)
- **i18n**: `header.editName` 추가

#### 3. Rate Limit 리셋 시점 자동 재스케줄 (`e2a1ecf`, `74fe7f9`, `4b3ae98`, `a219c59`)

- **서버**: `log-streamer.ts` — Claude stream-json의 `rate_limit_event` 파싱, WebSocket으로 브로드캐스트
- **서버**: 서버 시작 시 rate limit reset 시각 fetch하여 복구
- **서버**: `GET /api/rate-limit` (현재 reset 시각 조회), `POST /api/todos/:id/schedule-on-reset` (리셋 시점 1회성 스케줄 생성)
- **클라이언트**: `TodoItem.tsx` — rate-limit 상태일 때 "리셋 시점에 실행 예약" UI 표시. pending/failed/stopped 등 startable 상태 모두에 제공
- **i18n**: 한/영 번역 키 추가

#### 4. JSON 에러 응답 파싱 + 기타 버그 수정 (`9f8d5ad`, `40ed6fa`)

- **클라이언트**: `api/client.ts` — 응답 body의 JSON 에러를 파싱하여 가독성 있는 메시지로 표시
- **클라이언트**: 브랜치 컨텍스트 메뉴 클릭이 액션 트리거되지 않던 버그 수정

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/client/src/index.css` | 다층 그림자, 글래스모피즘, stagger 애니메이션, 글로벌 전환 |
| `src/client/tailwind.config.js` | slide-up/scale-in/shimmer 애니메이션 키프레임 |
| `src/client/src/components/Skeleton.tsx` | **신규** — 스켈레톤 로딩 컴포넌트 |
| `src/client/src/components/ProjectHeader.tsx` | 이름 인라인 편집 모드 |
| `src/server/services/log-streamer.ts` | rate_limit_event 파싱 + WebSocket 브로드캐스트 |
| `src/server/routes/schedules.ts` | `/rate-limit`, `/todos/:id/schedule-on-reset` 엔드포인트 |
| `src/server/index.ts` | 서버 시작 시 rate limit reset 시각 fetch |
| `src/client/src/components/TodoItem.tsx` | rate-limit 재스케줄 UI |

### 아키텍처 결정

1. **Rate limit 1회성 스케줄 위임**: rate limit 복구 로직을 별도 서비스가 아닌 기존 `schedule_runs` 인프라 위에 1회성 스케줄로 구현. scheduler는 이미 실행/만료 처리를 담당하므로 재사용
2. **Stagger 애니메이션 CSS 기반**: JS 기반 staggered reveal 대신 CSS `animation-delay`로 처리하여 리액트 리렌더링 비용 0

---

## 2026-04-14 — 파이프라인 제거 + 커밋 상세 패널 + 실행 분석 대시보드 + CLI 설치 체크 + 브라우저 알림 + Git 브랜치 컨텍스트 메뉴

### 배경

사용하지 않는 파이프라인(다단계 순차/병렬 실행) 기능을 전면 제거하여 코드베이스를 경량화. Git 패널에서 커밋을 클릭하면 변경 파일 목록과 diff를 볼 수 있는 커밋 상세 패널 추가. 프로젝트별 실행 통계와 비용 추적을 위한 분석 대시보드 추가. CLI 도구 미설치 시 cryptic spawn 오류 대신 설정 패널에서 설치 상태를 사전 감지. 긴 태스크/토론 완료를 OS 레벨 알림으로 수신. Git 사이드바 브랜치에 VS Code 스타일 컨텍스트 메뉴 추가.

### 주요 변경

#### 1. 파이프라인 기능 전면 제거 (`28a9e9d`)

파이프라인(다단계 순차/병렬 실행) 관련 코드를 서버·클라이언트·DB에서 완전히 삭제. 2,278줄 감소.

- **서버**: `pipeline-orchestrator.ts`, `routes/pipelines.ts` 삭제
- **서버**: `index.ts`에서 파이프라인 라우터 마운트 및 stale recovery 로직 제거
- **서버**: `discussion-orchestrator.ts` — 동시 실행 카운트에서 파이프라인 제외 (todos + discussions만 계산)
- **DB**: `pipelines`, `pipeline_phases`, `pipeline_logs` 3개 테이블 제거 (14 → 11 테이블)
- **클라이언트**: `PipelineDetail`, `PipelineForm`, `PipelineItem`, `PipelineList`, `PhaseTimeline` 5개 컴포넌트 삭제
- **클라이언트**: `App.tsx` 파이프라인 라우트 제거, `ProjectDetail.tsx` 파이프라인 탭 제거
- **클라이언트**: `api/pipelines.ts` 삭제, `types.ts` 파이프라인 타입 제거
- **i18n**: 파이프라인 관련 번역 키 94개 제거
- **WebSocket**: 파이프라인 이벤트 타입 제거

#### 1-2. 실행 분석 대시보드 — 비용/토큰 비정규화 추적 (`7bd9126`)

프로젝트별 태스크 실행 통계(성공률, CLI별 비용 분해, 일별 활동 차트)를 표시하는 Analytics 탭 추가. `todos.total_cost_usd`/`total_tokens` 비정규화 컬럼으로 JSON 파싱 없이 순수 SQL 집계.

- **DB**: `todos`에 `total_cost_usd` (REAL), `total_tokens` (INTEGER) 컬럼 추가
- **서버**: `orchestrator.ts` — 성공/실패 양쪽 경로에서 비정규화 cost/token 값 저장
- **서버**: `GET /api/projects/:id/analytics` — 기간 필터(7d/30d/90d/all), summary/CLI별 분해/일별 집계/상태 분포
- **클라이언트**: `AnalyticsPanel.tsx` 신규 — summary 카드 + 바 차트 + 툴팁 (이후 4/16에 Recharts로 교체)
- **클라이언트**: `ProjectDetail`에 Analytics 탭 추가
- **i18n**: 한/영 번역 22개 키

#### 1-3. CLI 설치 상태 체크 (`dc2f0cc`)

프로젝트 설정 열릴 때 `--version`으로 CLI 가용성 확인 후 설치 가이드 표시. 태스크 실행 전 사전 감지.

- **서버**: `cli-status.ts` 신규 — 병렬 version 체크 + 60초 캐싱
- **서버**: `GET /api/cli/status`, `POST /api/cli/status/refresh`
- **클라이언트**: `ProjectHeader`에 CLI 상태 인디케이터(녹색/빨강 + 버전) + 미설치 시 npm install 명령 배너 + refresh 버튼

#### 1-4. 브라우저 알림 — 태스크/토론 완료 (`34ef7ec`)

긴 작업 완료를 OS 레벨 알림으로 수신. 사이드바 토글 + localStorage 영속.

- **클라이언트**: `useNotification` 훅 신규 — Context + Provider (useTheme 패턴), permission 요청 플로우, stable `sendNotification` ref
- **클라이언트**: `Sidebar`에 bell 아이콘 토글 (on일 때 accent fill, 차단 시 tooltip)
- **클라이언트**: `ProjectDetail`(todo + discussion), `DiscussionDetail` — completed/failed 이벤트에 알림 디스패치
- **i18n**: 알림 메시지/토글 라벨

#### 1-5. Git 브랜치 컨텍스트 메뉴 (`eb2fd88`)

Git 사이드바 브랜치에 우클릭 VS Code 스타일 컨텍스트 메뉴 추가.

- **클라이언트**: 로컬 브랜치 메뉴 — checkout, merge into current, rebase onto, fetch, pull, push, rename, delete
- **클라이언트**: 원격 브랜치 메뉴 — local tracking으로 checkout, merge, fetch
- **클라이언트**: 브랜치 rename 모달 (Enter 지원, 현재 이름 prefill)
- **서버**: `worktree-manager.ts` — `gitRenameBranch`, `gitRebase` 메서드
- **서버**: `POST /api/projects/:id/git-branch-rename`, `/git-rebase`
- **클라이언트**: 뷰포트 인식 메뉴 포지셔닝 (화면 가장자리 자동 조정)

#### 1-6. 프로젝트 open-folder 버튼 (`7acc782`)

- **서버**: `POST /api/projects/open-folder` — OS별 파일 탐색기 열기 (Windows/macOS/Linux)
- **클라이언트**: `ProjectHeader` 경로를 텍스트에서 폴더 아이콘 + 클릭 가능 버튼으로 교체

#### 1-7. Gemini headless 모드 Windows 수정 (`81fcce7`, `dc70fcf`)

Windows에서 Gemini CLI가 `-p ""` 형식 인자를 해석하지 못해 headless 모드가 실패하던 문제 해결.

- **서버**: `cli-adapters.ts` — Gemini가 `--prompt=`(equals 형식)으로 prompt를 전달하도록 변경
- **서버**: headless mode에서 `-p` flag에 빈 문자열 전달

#### 2. 커밋 상세 패널 — 파일 목록 + Diff 뷰어 (`1828a7b`)

Git 패널의 커밋 로그에서 커밋을 클릭하면 변경 파일 목록과 파일별 diff를 표시하는 분할 뷰 추가.

- **서버**: `GET /api/projects/:id/git-commit-files` — 커밋의 변경 파일 목록 (status, additions, deletions)
- **서버**: `GET /api/projects/:id/git-commit-diff` — 커밋의 파일별 diff 조회
- **서버**: `worktree-manager.ts` — `getCommitFiles()`, `getCommitDiff()` 메서드 추가. `git diff-tree` 기반, root 커밋/merge 커밋 자동 감지 처리
- **클라이언트**: `GitStatusPanel.tsx` — `CommitFileList` (파일 사이드바) + `CommitDiffViewer` (diff 메인 영역) 내부 컴포넌트 추가. 커밋 클릭 시 토글, 파일 선택 시 diff 표시, 첫 파일 자동 선택
- **클라이언트**: `api/projects.ts` — `getCommitFiles()`, `getCommitDiff()` API 함수 + `CommitFile` 인터페이스 추가
- **i18n**: 커밋 상세 관련 번역 키 추가 (changedFiles, loadingFiles, noFilesChanged, selectFileToViewDiff, loadingDiff 등)

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/services/pipeline-orchestrator.ts` | **삭제** — 파이프라인 오케스트레이터 |
| `src/server/routes/pipelines.ts` | **삭제** — 파이프라인 REST 라우트 |
| `src/server/index.ts` | 파이프라인 라우터/recovery 제거 |
| `src/server/db/schema.ts` | pipelines, pipeline_phases, pipeline_logs 테이블 제거 |
| `src/server/db/queries.ts` | 파이프라인 쿼리 함수 제거 |
| `src/server/services/discussion-orchestrator.ts` | 동시 실행 카운트에서 파이프라인 제외 |
| `src/server/routes/projects.ts` | `git-commit-files`, `git-commit-diff` 엔드포인트 추가 |
| `src/server/services/worktree-manager.ts` | `getCommitFiles()`, `getCommitDiff()` 메서드 추가 |
| `src/client/src/components/GitStatusPanel.tsx` | 커밋 상세 패널 (CommitFileList + CommitDiffViewer) 추가 |
| `src/client/src/api/projects.ts` | 커밋 상세 API 함수 + CommitFile 타입 추가 |
| `src/client/src/i18n.tsx` | 파이프라인 키 제거, 커밋 상세 키 추가 |

### 아키텍처 결정

1. **파이프라인 완전 제거**: 파이프라인은 TODO의 의존성 체인 기능과 역할이 중복되어 활용도가 낮았으므로 전면 제거. DB 테이블 3개, 서비스 1개, 라우트 1개, 컴포넌트 5개가 삭제되어 유지보수 부담 감소
2. **커밋 diff-tree 기반 조회**: `git show` 대신 `git diff-tree`를 사용하여 name-status와 numstat를 별도 파싱. root 커밋(부모 없음)은 `--root` 플래그, merge 커밋은 first-parent 대비 diff로 처리
3. **내부 컴포넌트 패턴**: CommitFileList/CommitDiffViewer를 별도 파일이 아닌 `GitStatusPanel.tsx` 내부 컴포넌트로 구현. Git 패널에서만 사용되므로 파일 분리 불필요

---

## 2026-04-13 — v0.1.3: 후속 프롬프트(Continue) + 네이티브 폴더 피커 + Cloudflared 번들 + 자동 업데이트 + DX 개선

### 배경

완료된 태스크에 추가 지시를 보내는 "Continue" 기능 추가로 다회차 작업이 가능해짐. 프로젝트 생성 시 폴더 경로를 OS 네이티브 대화상자로 선택할 수 있도록 개선. npm 패키지에 cloudflared를 번들하여 별도 설치 없이 터널 사용 가능. CLI 시작 시 자동 업데이트 체크와 포트 충돌 자동 회피 기능 추가. Git 패널 버그 8건 수정 및 전체 CLI 메시지 영어 번역.

### 주요 변경

#### 1. 태스크 후속 프롬프트 — Continue in Worktree (`e4e316e`, `6629e33`, `aaf4fca`)

완료된 TODO에 후속 프롬프트를 보내 동일 워크트리에서 추가 작업을 수행하는 멀티 라운드 실행 기능.

- **서버**: `POST /api/todos/:id/continue` 라우트 추가 — 완료 상태 검증 후 `orchestrator.continueTodo()` 호출
- **서버**: `orchestrator.ts` — `continueTodo()` 메서드 추가. 기존 워크트리 재사용, Claude CLI `--continue` 플래그로 세션 이어받기
- **서버**: `log-streamer.ts` — `setRound()` 메서드로 라운드별 로그 태깅
- **DB**: `todos.round_count` + `task_logs.round_number` 컬럼 추가
- **클라이언트**: `TodoItem.tsx`, `TaskNodeDetail.tsx` — Continue 버튼 + 인라인 프롬프트 입력 UI
- **서버**: 태스크 의도 검증(task-intent) 비활성화 — 모든 입력 허용으로 변경
- **i18n**: 한/영 Continue 관련 번역 키 추가

#### 2. 네이티브 OS 폴더 피커 (`c2c9a0c` → `858421b`)

프로젝트 생성 시 경로 입력란에 폴더 찾아보기 버튼 추가. OS 네이티브 대화상자(Windows: FolderBrowserDialog, macOS: osascript, Linux: zenity) 호출.

- **서버**: `POST /api/projects/browse` — 플랫폼별 네이티브 폴더 선택 대화상자 호출. `execFileSync` + 임시 `.ps1` 스크립트로 셸 인젝션 방지. Windows에서 숨겨진 TopMost Form을 owner로 전달해 다이얼로그 포그라운드 표시
- **클라이언트**: `ProjectForm.tsx` — Browse 버튼 + 로딩 스피너 + `browseNativeFolder()` API 호출

#### 3. Cloudflared npm 번들 + 터널 기본 활성화 (`3c3f82e`)

cloudflared를 npm 의존성으로 번들하여 별도 설치 없이 터널 사용 가능. 신규 설치 시 터널이 기본 활성화.

- **서버**: `tunnel-manager.ts` — npm 패키지 바이너리 경로 우선 사용, 시스템 PATH/Windows 경로 폴백
- **CLI**: `bin/clitrigger.js` — 신규 config에 `tunnel: true` 기본값, 기존 config에서 tunnel 키 없으면 활성화로 취급
- **패키지**: `cloudflared` (^0.7.1) 프로덕션 의존성 추가

#### 4. CLI 자동 업데이트 체크 (`e655dfc`)

`clitrigger` 실행 시 npm registry에서 최신 버전 확인 후 자동 업데이트 및 재시작. 24시간 쿨다운, 5초 타임아웃, 네트워크 오류 시 무시.

- **CLI**: `bin/clitrigger.js` — semver 비교 + `npm i -g clitrigger@latest` 자동 실행 + `CLITRIGGER_UPDATED` env로 무한루프 방지
- **config**: `lastUpdateCheck` 타임스탬프 저장

#### 5. 서버 포트 자동 재시도 (`8feeb36`)

설정 포트가 점유 중이면 자동으로 다음 포트를 시도 (최대 10회). 원래 포트와 다른 포트로 시작 시 안내 메시지 출력.

- **서버**: `index.ts` — `EADDRINUSE` 에러 핸들러로 포트+1 재시도

#### 6. Git 패널 버그 8건 수정 (`6ae3a85`)

- `.worktrees`와 `.debug-logs`를 프로젝트 `.gitignore`에 자동 추가
- WebSocket으로 태스크 완료/머지/실패 시 Git 패널 자동 새로고침
- `gitUnstage` 복수 파일 인자 오류 수정 (flat → spread)
- `gitPull`/`gitPush` 배열 대신 개별 인자 전달
- Pull 결과 summary null-safety 추가
- `squashMergeBranch` 충돌 시 자동 `merge --abort`
- 워크트리 경로 검증 path traversal 수정 (`startsWith` → `sep` 체크)
- `FileStatusSection` 에러 피드백 표시 (기존 silent catch)

#### 7. CLI 메시지 영어 번역 + 시작 배너 리디자인 (`f94ea99`)

- 서버 시작 출력을 Local/Remote URL 라벨 레이아웃으로 리디자인
- 폴백 포트 사용 시 "(port N was in use)" 맥락 메시지 추가
- `bin/clitrigger.js`의 모든 사용자 메시지 (비밀번호 설정, config, 업데이트, 도움말, 오류) 영어 번역
- `src/server/index.ts`의 `AUTH_PASSWORD` 오류, 포트 재시도 로그, 종료 메시지 영어 번역

#### 8. npm uninstall 정리 + config clear 명령 (`eaedd80`)

- `postuninstall` 스크립트로 `~/.clitrigger/` 잔여 데이터 안내
- `clitrigger config clear` 명령 추가 (확인 후 설정/DB 삭제)

#### 9. 기타 개선

- **v0.1.3 릴리스** (`f0ee80d`)
- **크로스 플랫폼 문서 추가** (`e2e901d`): README/SETUP에 macOS/Linux 지원 테이블, 플랫폼별 요구사항, 트러블슈팅 섹션 추가
- **`.gitignore` 워크트리 디버그 로그 추가** (`b9658e7`)
- **Vite dev proxy 포트 수정** (`184e879`): 하드코딩된 3001 → `process.env.PORT || 3000`

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `bin/clitrigger.js` | 자동 업데이트, config clear, 전체 영어 번역, 터널 기본 활성화, 시작 배너 리디자인 |
| `bin/postuninstall.js` | **신규** — uninstall 잔여 데이터 안내 스크립트 |
| `src/server/index.ts` | 포트 자동 재시도 (EADDRINUSE), 영어 번역 |
| `src/server/routes/execution.ts` | `POST /api/todos/:id/continue` 라우트, 의도 검증 제거 |
| `src/server/routes/projects.ts` | `POST /api/projects/browse` 네이티브 폴더 피커 |
| `src/server/services/orchestrator.ts` | `continueTodo()` 메서드, 라운드 관리, 의도 검증 제거 |
| `src/server/services/log-streamer.ts` | `setRound()` 라운드별 로그 태깅 |
| `src/server/services/worktree-manager.ts` | `.gitignore` 자동 추가, unstage/pull/push 인자 수정, squash merge 충돌 방어 |
| `src/server/services/debug-logger.ts` | `.debug-logs` `.gitignore` 자동 추가 |
| `src/server/services/tunnel-manager.ts` | npm 패키지 바이너리 경로 우선 탐색 |
| `src/server/services/task-intent.ts` | 의도 검증 무력화 (항상 valid) |
| `src/server/db/schema.ts` | `round_count`, `round_number` 컬럼 추가 |
| `src/client/src/components/TodoItem.tsx` | Continue 버튼 + 프롬프트 입력 UI |
| `src/client/src/components/TaskNodeDetail.tsx` | Continue 버튼 + 프롬프트 입력 UI |
| `src/client/src/components/ProjectForm.tsx` | 네이티브 폴더 Browse 버튼 |
| `src/client/src/components/GitStatusPanel.tsx` | 에러 피드백 표시, WebSocket 자동 새로고침 |
| `src/client/vite.config.ts` | 프록시 타겟 `process.env.PORT` 동적 적용 |

### 아키텍처 결정

1. **라운드 기반 Continue**: 새 워크트리/브랜치를 만들지 않고 기존 워크트리를 재사용. Claude CLI `--continue`로 세션 컨텍스트 유지. `round_count`/`round_number`로 로그 구분
2. **네이티브 대화상자 선택**: 커스텀 FolderBrowser 컴포넌트 대신 OS 네이티브 대화상자를 채택. `execFileSync` + 임시 스크립트 파일로 셸 인젝션 방지
3. **Cloudflared 번들**: npm 패키지의 `cloudflared`가 설치 시 바이너리를 자동 다운로드하므로 사용자 수동 설치 불필요. 기존 시스템 설치와의 호환을 위해 폴백 경로 유지
4. **의도 검증 비활성화**: Continue 프롬프트 등 다양한 입력 형태를 수용하기 위해 task-intent 검증을 전면 비활성화. 함수 인터페이스는 유지하되 항상 `{ valid: true }` 반환

---

## 2026-04-10 — npm CLI 패키징 + Interactive PTY + 워크트리 격리 토글 + 스케줄 액션 + CI 자동화

### 배경

CLITrigger를 `npm i -g clitrigger`로 설치하여 어디서든 바로 사용할 수 있도록 CLI 패키징을 추가. Interactive 모드에서 Claude CLI가 stdin 입력을 받지 못하는 근본 원인(pipe vs TTY)을 PTY 전환으로 해결. 워크트리 오버헤드가 불필요한 단순 작업을 위해 프로젝트별 워크트리 격리 on/off 설정 추가. 스케줄 실행 이력에서 바로 머지/정리할 수 있는 액션 버튼, npm publish CI 자동화도 추가.

### 주요 변경

#### 1. npm 글로벌 설치용 CLI 엔트리포인트 (`05737b2`)

`npm i -g clitrigger` 또는 `npx clitrigger`로 설치/실행할 수 있도록 CLI 진입점과 npm 패키징 설정 추가.

- **CLI**: `bin/clitrigger.js` 신규 — 첫 실행 시 비밀번호 설정 안내, `config` 서브커맨드 (port/password 변경), `--help`
- **패키징**: `package.json`에 `bin`, `files`, `engines`, `prepublishOnly` 필드 추가
- **빌드**: `build` 스크립트에 클라이언트 빌드를 `dist/client/`로 복사하는 단계 추가
- **서버**: 정적 파일 경로를 `dist/client/` 우선 탐색 + `src/client/dist/` 폴백으로 변경
- **데이터**: 글로벌 설치 시 설정/DB가 `~/.clitrigger/`에 저장

#### 2. Interactive 모드 PTY 전환 및 stdin relay (`f6d13f3`, `d0e187c`, `953c1fe`, `2311bd3`)

Claude CLI가 pipe stdin에서 후속 입력을 읽지 않는 문제를 PTY(node-pty)로 전환하여 해결. 기존 streaming 모드(headless와 동일 동작)도 정리.

- **서버**: `claude-manager.ts` — interactive 모드에서 child_process 대신 node-pty 사용, PTY write()를 Writable로 감싸 stdinStreams에 등록
- **서버**: `cli-adapters.ts` — interactive 모드에서 `--print` 플래그 제외 (one-shot 방지)
- **클라이언트**: `ProjectDetail.tsx` — WebSocket sendMessage 연결, interactiveTodos 상태 추적, optimistic Set 업데이트로 입력창 즉시 표시
- **클라이언트**: `CliMode`에서 `streaming` 리터럴 제거 및 관련 UI/i18n 정리 (10개 파일)

#### 3. 스케줄 실행 기록에 머지/Cleanup 액션 버튼 추가 (`d9ff6ef`)

스케줄(cron) 실행 이력에서 완료된 태스크를 바로 머지하거나 워크트리를 정리할 수 있도록 개선.

- **서버**: `schedule_runs` 쿼리에 todos LEFT JOIN 추가 (branch_name, worktree_path, status 반환)
- **클라이언트**: `ScheduleItem.tsx` — 머지 버튼 (completed + branch 존재 시) / Cleanup 버튼 (워크트리 존재 시) 렌더링
- **클라이언트**: `ScheduleList.tsx` → `ScheduleItem`으로 onMergeRun/onCleanupRun prop 전달

#### 4. 프로젝트별 워크트리 격리 on/off 설정 (`d204542`)

Git 저장소 프로젝트에서 워크트리 없이 메인 브랜치에서 직접 작업할 수 있는 옵션 추가.

- **DB**: `projects` 테이블에 `use_worktree` 컬럼 추가 (기본값 1, 하위호환)
- **서버**: 오케스트레이터 3개(todo/discussion/pipeline)에서 `useWorktree` 플래그로 워크트리 생성 여부 결정
- **서버**: `use_worktree=0`일 때 동시 실행을 서버에서 강제로 1로 제한 (충돌 방지)
- **서버**: 직접 실행 모드용 프롬프트 분기 (커밋 지시 포함)
- **클라이언트**: `ProjectHeader.tsx`에 워크트리 토글 UI + "워크트리 없음" 뱃지 추가
- **클라이언트**: `TodoItem.tsx` 머지 버튼에 `branch_name` 존재 여부 가드 추가
- **i18n**: 한/영 번역 7개 키 추가

#### 5. Interactive 모드 trust 프롬프트 및 출력 안정화 (`852fa99`, `a708d6d`, `581aec0`)

PTY interactive 모드에서 workspace trust 프롬프트 처리 및 출력 파싱 문제를 연속 수정.

- **trust 프롬프트 가드** (`852fa99`): trust 선택 화면의 `>` 문자가 CLI ready regex에 매칭되어 초기 프롬프트가 전달되는 문제 수정. `trustConfirmed` 조건 가드 추가
- **trust pending 로직** (`a708d6d`): `trustConfirmed` → `trustPending` 반전 로직으로 변경. trust 프롬프트가 나타나지 않는 경우(이미 신뢰된 workspace) stdin 전달이 즉시 가능하도록 개선
- **출력 파싱 수정** (`581aec0`): interactive 모드에서 JSON 파서 대신 plain text 파서 사용, `--output-format stream-json`과 `TASK_COMPLETION_SUFFIX`를 headless/verbose 전용으로 이동

#### 6. npm publish CI 자동화 (`946ec44`)

- `.github/workflows/release.yml`에 npm publish 스텝 추가

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `bin/clitrigger.js` | **신규** — CLI 엔트리포인트 (첫 실행 설정, config 서브커맨드) |
| `package.json` | `bin`, `files`, `engines`, `prepublishOnly`, `build` 스크립트 수정 |
| `src/server/index.ts` | 정적 파일 경로 `dist/client/` 우선 탐색 + 폴백 |
| `src/server/services/orchestrator.ts` | `useWorktree` 플래그로 워크트리 생성 분기 + 직접 실행 프롬프트 |
| `src/server/services/discussion-orchestrator.ts` | `useWorktree` 조건부 워크트리 생성 |
| `src/server/services/pipeline-orchestrator.ts` | `useWorktree` 조건부 워크트리 생성 |
| `src/server/services/claude-manager.ts` | interactive PTY 전환 + trust pending 로직 + stdin Writable 래핑 |
| `src/server/services/cli-adapters.ts` | interactive 모드 `--print` 제외 + 출력 플래그 분리 |
| `src/server/db/schema.ts` | `use_worktree` 컬럼 추가 |
| `src/server/db/queries.ts` | schedule_runs에 todos JOIN 추가 + use_worktree 처리 |
| `src/client/src/components/ProjectHeader.tsx` | 워크트리 토글 UI 추가 |
| `src/client/src/components/ProjectDetail.tsx` | sendMessage 연결 + interactiveTodos 추적 |
| `src/client/src/components/TodoItem.tsx` | 머지 버튼 branch_name 가드 |
| `src/client/src/components/ScheduleItem.tsx` | 머지/Cleanup 액션 버튼 추가 |
| `src/client/src/types.ts` | `Project.use_worktree` + `ScheduleRun` todo 필드 추가 |
| `.github/workflows/release.yml` | npm publish 스텝 추가 |

### 아키텍처 결정

1. **CLI 데이터 격리**: 글로벌 설치 시 `~/.clitrigger/`에 config.json과 DB를 저장하여 node_modules 내부 오염 방지. `DB_PATH` env로 주입하므로 서버 코드 변경 최소화
2. **Interactive PTY 통합**: interactive 모드와 기존 requiresTty(Codex) 모드가 동일한 PTY 경로를 사용하여 코드 중복 최소화. PTY write()를 Writable로 감싸 기존 stdinStreams 인프라 재활용
3. **streaming 모드 제거**: headless와 동작이 완전히 동일했으므로 dead code 정리. CliMode = `headless | verbose | interactive`로 단순화
4. **워크트리 토글 안전 장치**: `use_worktree=0`일 때 서버가 `max_concurrent`를 강제로 1로 제한. 같은 디렉토리에서 여러 CLI가 동시에 실행되는 충돌을 구조적으로 방지
5. **trust pending 반전 로직**: trust 프롬프트가 나타나지 않는 환경(이미 신뢰된 workspace)에서 stdin이 영구 차단되는 문제를 해결하기 위해 `trustConfirmed`(true 대기) → `trustPending`(false 기본) 반전

---

## 2026-04-08 — 샌드박스 절대 경로 수정 + 병합 안정성 + 유효하지 않은 경로 UX + LogViewer 재디자인

### 배경

엄격 모드 샌드박스의 파일 권한 패턴이 상대 경로로 되어 있어 Claude가 워크트리 파일을 전혀 읽지 못하는 치명적 버그를 수정. 병합 시 브랜치 미존재로 인한 오류도 방어 처리하고, 유효하지 않은 경로를 가진 프로젝트의 감지·삭제 UX를 추가. LogViewer는 다크 모드 가시성 문제를 근본적으로 해결하기 위해 VS Code Dark Modern 팔레트로 전면 재작성.

### 주요 변경

#### 1. 샌드박스 엄격 모드 권한 패턴 절대 경로 수정 (`f1ad827`)

Claude CLI의 `--permission-mode dontAsk`에서 `Read(./)` 같은 상대 경로 패턴은 절대 경로로 접근하는 파일을 매칭하지 못해 모든 파일 접근이 거부되는 문제 수정.

- **서버**: `orchestrator.ts` — `Read/Edit/Write` 권한 패턴을 `Read(${workDir}/**)` 절대 경로 형식으로 변경
- **서버**: `pipeline-orchestrator.ts` — `pipeline.worktree_path` 절대 경로 기반으로 수정
- **서버**: `discussion-orchestrator.ts` — `discussion.worktree_path` 절대 경로 기반으로 수정

#### 2. 병합 시 브랜치 미존재 오류 방어 처리 (`e006678`)

`default_branch`가 `main`이지만 실제 레포가 `master`를 쓸 때 checkout 실패, 이미 삭제된 브랜치 병합 시 모호한 git 오류가 발생하던 문제 수정.

- **서버**: `merge`, `merge-chain` 엔드포인트 모두에서 checkout 전 `branchLocal()`로 실제 존재 브랜치 목록 조회
- **서버**: 설정된 브랜치 없으면 `master` → `main` 순으로 fallback
- **서버**: 대상 브랜치 미존재 시 git 오류 대신 즉시 400 반환

#### 3. 프로젝트 목록 유효하지 않은 경로 UX 개선 (`c0f10a5`)

로컬에서 삭제된 폴더를 가진 프로젝트가 목록에 남아 사용자가 인지하지 못하는 문제 해결.

- **서버**: `GET /api/projects` 응답에 `path_exists` 필드 추가 (`fs.statSync`로 폴더 존재 확인)
- **클라이언트**: 경로 없는 프로젝트에 빨간색 "경로 없음" 배지 + 반투명 처리
- **클라이언트**: 경로 없는 프로젝트 클릭 시 삭제 확인 다이얼로그 (네비게이션 차단)
- **클라이언트**: 모든 프로젝트 삭제(X 버튼)에 confirm 다이얼로그 추가
- **i18n**: `deleteConfirm`, `pathMissing`, `pathMissingConfirm` 한/영 번역 키 추가

#### 4. LogViewer VS Code Dark Modern 팔레트 전환 (`6323eb1`)

다크 모드에서 배경색이 `#F5F5F7`(거의 흰색)이 되어 연한 텍스트가 보이지 않는 문제를 근본 해결. 로그 뷰어는 앱 테마와 무관하게 항상 고정된 어두운 터미널 배경을 유지하도록 재작성.

- **클라이언트**: 배경 `#1e1e1e`, 테두리 `#3c3c3c`로 테마 독립 고정
- **클라이언트**: `[OUT]` `#9cdcfe`/`#d4d4d4`, `[ERR]` `#f44747`, `[INF]` `#569cd6`, `[GIT]` `#4ec9b0`, `[WRN]` `#dcdcaa`
- **클라이언트**: `[>>>]`/`[PRM]` `#c586c0`(보라), inline bold `#d7ba7d`(골드), `` `code` `` `#ce9178`(오렌지)
- **클라이언트**: 타임스탬프 `#6a9955`(VS Code 주석 녹색), 복사 버튼 다크 스타일 통일

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/services/orchestrator.ts` | 엄격 모드 권한 패턴 절대 경로 수정 |
| `src/server/services/pipeline-orchestrator.ts` | 엄격 모드 권한 패턴 절대 경로 수정 |
| `src/server/services/discussion-orchestrator.ts` | 엄격 모드 권한 패턴 절대 경로 수정 |
| `src/server/routes/execution.ts` | 병합 브랜치 fallback + 미존재 브랜치 400 반환 |
| `src/server/routes/projects.ts` | `path_exists` 필드 추가 |
| `src/client/src/components/ProjectList.tsx` | 유효하지 않은 경로 배지 + 삭제 확인 다이얼로그 |
| `src/client/src/components/LogViewer.tsx` | VS Code Dark Modern 팔레트 전면 재작성 |
| `src/client/src/types.ts` | `Project`에 `path_exists` 필드 추가 |
| `src/client/src/i18n.tsx` | `deleteConfirm`/`pathMissing`/`pathMissingConfirm` 번역 키 추가 |

### 아키텍처 결정

1. **절대 경로 권한 패턴**: Claude CLI는 파일 경로를 내부적으로 절대 경로로 처리하므로, `.claude/settings.json`의 Read/Edit/Write 패턴은 반드시 워크트리 절대 경로 기반(`${workDir}/**`)으로 지정해야 함
2. **브랜치 존재 확인 우선**: git merge/checkout 전 `branchLocal()`로 실제 브랜치 목록을 먼저 확인하여 모호한 git 오류 대신 명확한 HTTP 오류 반환
3. **LogViewer 테마 독립**: 로그 뷰어는 앱 테마 CSS 변수에 의존하지 않고 고정 hex 값을 사용 — 터미널은 항상 어두운 배경이 적합

---

## 2026-04-07 — Apple 디자인 시스템 + 의존성 체인 병합 + 토론 마크다운 렌더링

### 배경

UI 디자인을 웜 골드 톤에서 Apple HIG 기반 쿨 뉴트럴 팔레트로 전면 전환하고, 의존성 체인 태스크의 일괄 병합 기능을 추가. 토론 메시지의 마크다운 렌더링 지원과 에러 핸들링도 강화.

### 주요 변경

#### 1. Apple 스타일 디자인 시스템 전환 (`e1a9c74`)

CSS 변수 팔레트를 웜 골드에서 Apple HIG 기반 쿨 뉴트럴로 전면 교체.

- **클라이언트**: 라이트 모드 — `#FBF8F3` 크림 → `#FFFFFF`/`#F5F5F7`, 액센트 `#D4A843` 금색 → `#0071E3` 블루
- **클라이언트**: 다크 모드 — `#17171F` 블루-블랙 → `#000000` 순수 블랙 (OLED 최적화), 액센트 `#0A84FF`
- **클라이언트**: 상태색을 Material 팔레트에서 iOS 시스템 컬러로 전환 (`#34C759`, `#007AFF`, `#FF3B30`, `#AF52DE`)
- **클라이언트**: 그림자 색조 제거, opacity 낮춤 (Apple식 중성 그림자)
- **클라이언트**: 버튼 `active:scale-[0.98]` 제거, `shadow-gold` → `shadow-accent`
- **클라이언트**: 카드 `rounded-2xl` → `rounded-xl` (절제된 radius)
- **클라이언트**: Tailwind 토큰 리네이밍 — `accent-gold`/`goldDark`/`goldLight` → `accent`/`dark`/`light`

#### 2. 의존성 체인 일괄 병합 (`2fbda02`, `d34d01d`)

의존성 관계로 연결된 태스크 체인을 한 번에 main 브랜치로 병합하는 기능.

- **서버**: `POST /api/todos/:id/merge-chain` 엔드포인트 — 루트→리프 체인 수집 후 리프 브랜치를 main에 병합, 전체 멤버 상태/워크트리 정리
- **서버**: leaf 태스크 탐색 로직을 branch/worktree 존재 여부 대신 의존성 그래프 기반으로 변경
- **클라이언트**: 완료된 체인 감지 시 헤더 배너 + 체인 병합 버튼 표시
- **클라이언트**: 체인 멤버의 개별 merge/cleanup 버튼 비활성화 (`isChainMember` prop)
- **i18n**: `mergeChain`, `chainComplete`, `chainTasks` 등 번역 키 추가

#### 3. 토론 마크다운 렌더링 (`03cc257`)

토론 에이전트 응답의 마크다운(헤더/테이블/코드블록 등)이 raw text로 표시되던 문제 해결.

- **클라이언트**: `react-markdown` + `remark-gfm` 의존성 추가
- **클라이언트**: `MarkdownContent` 래퍼 컴포넌트 신규 생성 — GFM 테이블/체크리스트 지원
- **클라이언트**: `DiscussionDetail` 메시지 영역에 마크다운 렌더링 적용
- **클라이언트**: `index.css`에 `.markdown-content` 스타일 추가 (다크/라이트 테마 대응)

#### 4. 토론 실패 시 에러 로그 패널 (`2670a1e`)

- **클라이언트**: `DiscussionDetail`에 `failed` 상태 시 에러 로그 fetch + 실패 패널 표시
- **클라이언트**: 실패한 에이전트명, 라운드 번호, 재시도 버튼 포함
- **i18n**: `retry`, `failureTitle`, `noErrorLogs` 번역 키 추가

#### 5. 로그 뷰어 가독성 개선 (`47e2b48`)

- **클라이언트**: `TaskLog` 타입에 `prompt`, `warning` 로그 타입 추가
- **클라이언트**: `LogViewer`에 prompt(보라색 `[PRM]`), warning(주황색 `[WRN]`) 색상/프리픽스 추가
- **클라이언트**: 로그 메시지에 인라인 마크다운 렌더링 (`**bold**`, `` `code` ``, `*italic*`)

#### 6. 토론 발언 순서 UI 개선 (`2b0eb91`)

- **클라이언트**: `DiscussionForm`에서 에이전트 발언 순서를 직관적으로 조정할 수 있는 UI 개선

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/client/src/index.css` | Apple HIG 기반 CSS 변수 팔레트 전면 교체 + `.markdown-content` 스타일 |
| `src/client/tailwind.config.js` | 토큰 리네이밍 (`accent-gold` → `accent`), iOS 상태색 적용 |
| `src/client/src/components/MarkdownContent.tsx` | `react-markdown` + `remark-gfm` 래퍼 컴포넌트 신규 |
| `src/client/src/components/DiscussionDetail.tsx` | 마크다운 렌더링 적용 + 에러 로그 실패 패널 |
| `src/client/src/components/DiscussionForm.tsx` | 발언 순서 UI 개선 |
| `src/client/src/components/LogViewer.tsx` | prompt/warning 로그 타입 + 인라인 마크다운 |
| `src/client/src/components/TodoList.tsx` | 체인 병합 UI (배너 + 버튼) |
| `src/server/routes/execution.ts` | `merge-chain` 엔드포인트 + leaf 탐색 로직 변경 |
| `src/client/src/types.ts` | `TaskLog` 타입에 `prompt`/`warning` 추가 |

### 아키텍처 결정

1. **Apple HIG 팔레트**: 웜 골드 톤 대비 가독성과 접근성이 높은 쿨 뉴트럴 팔레트 선택. OLED 다크 모드(`#000000`)로 전력 효율 향상
2. **체인 병합 전략**: 리프 브랜치만 main에 병합 (의존성 체인에서 squash cascade가 이미 완료되어 리프에 전체 변경이 집약됨)
3. **마크다운 렌더링 격리**: `MarkdownContent` 래퍼 컴포넌트로 분리하여 `react-markdown` 의존성을 한 곳에서 관리

---

## 2026-04-06 — 다크 모드 + 토론 UX 강화 + 워크트리 안정성

### 배경

토론 기능이 안정화되면서 사용성 개선 요구가 집중됨. 에이전트별 CLI 도구/모델 선택, 토론 완료 후 자동 구현, 메시지 접기/펼치기 등 토론 워크플로우 전반을 강화. 또한 다크 모드 테마 시스템을 도입하고, 워크트리 생성 시 npm 의존성 자동 설치 및 백그라운드 실행으로 안정성과 응답 속도를 개선.

### 주요 변경

#### 1. 다크 모드 테마 시스템 (`3aea8ff`, `0f527f2`, `68a5a64`)

CSS 변수 기반 테마 시스템을 도입하여 라이트/다크 모드를 지원.

- **클라이언트**: `useTheme` 훅 + `ThemeContext` 추가 — `localStorage` 저장, OS 기본값 감지, `data-theme` 어트리뷰트 방식
- **클라이언트**: Tailwind 컬러 팔레트를 하드코딩 HEX에서 CSS 변수(`--color-*`)로 전면 전환
- **클라이언트**: `index.css`에 `[data-theme="light"]` / `[data-theme="dark"]` 변수 셋 정의
- **클라이언트**: `index.html`에 인라인 스크립트로 FOUC(Flash of Unstyled Content) 방지 — 페이지 로드 전 테마 적용
- **클라이언트**: `ProjectList`에 테마 토글 버튼 추가
- **클라이언트**: 다크 모드 누락 스타일 수정 (ScheduleItem, TaskGraph, TaskNode 등)

#### 2. 토론 자동 구현 (`2a3f039`)

토론 완료 후 수동으로 구현 에이전트를 지정하는 대신, 토론 생성 시 자동 구현 옵션을 설정하면 토론 종료 즉시 자동으로 구현 라운드가 시작됨.

- **DB**: `discussions` 테이블에 `auto_implement` (INTEGER), `implement_agent_id` (TEXT) 컬럼 추가
- **서버**: `DiscussionOrchestrator`에 자동 구현 트리거 로직 — 전체 라운드 완료 시 지정 에이전트로 즉시 구현 시작
- **서버**: 구현 에이전트 삭제 시 fallback (정상 완료 처리)
- **서버**: `createDiscussion` API에 `auto_implement`, `implement_agent_id` 파라미터 + 유효성 검증
- **클라이언트**: 토론 생성 폼에 자동 구현 토글 + 구현 에이전트 선택 UI

#### 3. 토론 메시지 접기/펼치기 (`a19cf5b`)

긴 토론에서 이전 메시지를 접어 최신 대화에 집중할 수 있는 기능.

- **클라이언트**: `DiscussionDetail`에 메시지별 접기/펼치기 토글 + 접힌 상태에서 요약 미리보기 (첫 200자)
- **i18n**: 접기/펼치기 관련 번역 키 추가

#### 4. 에이전트별 CLI 도구/모델 선택 (`65af70b`)

에이전트마다 다른 CLI 도구(Claude/Gemini/Codex)와 모델을 지정 가능. 프로젝트 기본값을 사용하거나 에이전트별로 오버라이드.

- **클라이언트**: `AgentManager` 폼에 CLI 도구 드롭다운 + 모델 드롭다운 추가 (프로젝트 기본값 옵션 포함)
- **클라이언트**: 에이전트 목록에 CLI 도구/모델 표시

#### 5. 토론 메타데이터 편집 (`2d095d4`)

토론 생성 후에도 제목, 설명, 참여 에이전트, 최대 라운드를 수정 가능.

- **서버**: `DiscussionDetail` 컴포넌트에 편집 모드 추가
- **서버**: `discussions.ts` 라우트 리팩토링 + `DiscussionForm` 컴포넌트 분리
- **클라이언트**: `DiscussionForm` 신규 — 토론 생성/편집 공용 폼 컴포넌트

#### 6. 워크트리 안정성 개선 (`1b37862`, `58936f1`, `17640d0`)

- **서버**: 워크트리 생성 시 `package.json` 존재하면 자동 `npm install` 실행 (`1b37862`)
- **서버**: npm install을 백그라운드(fire-and-forget)로 실행하여 API 응답 지연 해소 (`58936f1`)
- **서버**: 워크트리 브랜치 이름 생성 시 중복 방지 로직 강화 — 기존 브랜치 존재 시 `-2`, `-3` 접미사 추가 (`17640d0`)

#### 7. 토론 버그 수정 (`72769c4`, `b0bc271`, `ea59400`, `162b902`, `c03a04f`, `fd62b73`)

- 토론 목록 링크가 작업 탭 대신 토론 탭으로 이동하도록 수정 (`72769c4`)
- 토론 mutation 응답에 `agents` 필드 누락 수정 (`b0bc271`, `ea59400`)
- `exitPromise` 미처리 rejection 방어 + 하드코딩 문자열 i18n 적용 (`162b902`)
- 잘못된 i18n 키 참조 수정 (`c03a04f`)
- 토론 생성 폼 UI를 프로젝트 패턴에 맞게 개선 (`fd62b73`)
- 토론 화이트 스크린 수정 (`17640d0`)

#### 8. 기타 수정

- **탭 URL 동기화**: 탭 변경 시 URL 쿼리 파라미터를 함께 업데이트하여 새로고침 시 올바른 탭 유지 (`70b3c9d`)
- **터널 빌드 자동화**: `start:tunnel` 실행 전 자동 빌드 추가 (`911c847`)

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/client/src/hooks/useTheme.ts` | 테마 컨텍스트 + 훅 신규 |
| `src/client/tailwind.config.js` | 컬러 팔레트 CSS 변수 전환 |
| `src/client/src/index.css` | 라이트/다크 모드 CSS 변수 정의 |
| `src/client/src/main.tsx` | ThemeContext.Provider 래핑 |
| `src/client/src/components/DiscussionForm.tsx` | 토론 생성/편집 공용 폼 컴포넌트 신규 |
| `src/client/src/components/DiscussionDetail.tsx` | 메시지 접기/펼치기, 메타데이터 편집 |
| `src/client/src/components/DiscussionList.tsx` | 자동 구현 옵션 UI, 폼 분리 |
| `src/client/src/components/AgentManager.tsx` | CLI 도구/모델 선택 UI |
| `src/server/services/discussion-orchestrator.ts` | 자동 구현 트리거 로직 |
| `src/server/services/worktree-manager.ts` | npm 자동 설치, 백그라운드 실행, 브랜치 중복 방지 |
| `src/server/db/schema.ts` | `auto_implement`, `implement_agent_id` 컬럼 마이그레이션 |
| `src/server/routes/discussions.ts` | 메타데이터 편집 + 자동 구현 파라미터 |
| `src/client/src/components/ProjectDetail.tsx` | 탭 URL 쿼리 파라미터 동기화 |

### 아키텍처 결정

1. **CSS 변수 기반 테마**: Tailwind 컬러를 CSS 변수로 간접 참조하여, 테마 전환 시 변수값만 교체. 기존 `warm-*`, `accent-*` 클래스명은 그대로 유지하면서 다크 모드 지원
2. **FOUC 방지 인라인 스크립트**: React hydration 전에 `data-theme` 어트리뷰트를 설정하여 초기 렌더링에서 올바른 테마 적용
3. **자동 구현의 실패 허용**: 구현 에이전트가 삭제된 경우 경고 로그만 남기고 정상 완료 처리 (기존 실패 허용 패턴 일관 적용)
4. **npm install 백그라운드 실행**: 워크트리 생성 API 응답은 즉시 반환하고, npm install은 비동기 실행하여 UX 지연 방지

---

## 2026-04-05/06 — 에이전트 토론 + 디버그 로깅 + 인증 개선

### 배경

단일 에이전트(Todo)나 고정 단계(Pipeline)만으로는 복잡한 기능의 설계 품질을 보장하기 어려웠음. 다수의 AI 에이전트가 역할별로 토론하고 합의 후 구현하는 Discussion 시스템을 도입. 또한 CLI 도구의 실제 입출력을 확인할 방법이 없어 디버깅이 어려운 문제를 해결하기 위해 디버그 로깅 기능을 추가.

### 주요 변경

#### 1. 에이전트 토론 기능 (`f1a1dce`, `7de78df`, `354c924`, `fd62b73`, `c03a04f`, `4222743`)

다수의 AI 에이전트(아키텍트, 개발자, 리뷰어 등)가 라운드 기반으로 피쳐를 토론하고, 합의 후 지정 에이전트가 구현까지 수행하는 협업 시스템.

- **DB**: `discussion_agents`, `discussions`, `discussion_messages`, `discussion_logs` 4개 테이블 + CRUD 쿼리 함수 ~20개 추가
- **서버**: `DiscussionOrchestrator` 서비스 — 라운드 턴제 실행, 프롬프트 빌드 (이전 발언 누적), 자동 라운드 진행, 유저 메시지 주입, 구현 라운드 트리거
- **서버**: `routes/discussions.ts` — 18개 REST 엔드포인트 (에이전트 CRUD, 토론 CRUD, 시작/정지/주입/스킵/구현/머지/diff/cleanup)
- **WebSocket**: `discussion:status-changed`, `discussion:message-changed`, `discussion:log`, `discussion:commit` 4개 이벤트
- **클라이언트**: `DiscussionDetail` 채팅 UI (라운드별 메시지 그룹, 스트리밍 로그, 사용자 개입 입력), `DiscussionList` (토론 목록 + 생성 폼), `AgentManager` (에이전트 페르소나 CRUD)
- **클라이언트**: `ProjectDetail`에 토론 탭 추가, 라우트 `/projects/:id/discussions/:discussionId`
- **i18n**: 한/영 토론 관련 35개 + 버그 수정 6개 번역 키 추가
- **복구**: 서버 재시작 시 running 토론을 paused로 자동 복구
- **버그 수정**: `exitPromise`에 `.catch()` 핸들러 추가 (unhandled rejection 방지), 하드코딩 문자열 i18n 적용

#### 2. CLI 디버그 로깅 (`ba6c8c1`, `a3c219a`)

프로젝트 설정에서 디버그 모드를 켜면 CLI 실행 시 전체 stdin/stdout/stderr를 `.debug-logs/` 디렉토리에 저장.

- **서버**: `debug-logger.ts` 서비스 — PassThrough 스트림으로 기존 logStreamer에 영향 없이 raw 입출력을 파일에 tee 방식 기록
- **서버**: `orchestrator.ts`에 디버그 세션 통합 — `project.debug_logging` 활성화 시 stdout/stderr tee + 종료 시 exit code/소요시간 기록
- **서버**: `debug-logs.ts` API 라우트 — 목록 조회/파일 읽기/삭제 엔드포인트 4개
- **서버**: `claude-manager.ts` 반환값에 `command`/`args` 추가 (로그 헤더용)
- **DB**: `projects` 테이블에 `debug_logging` 컬럼 (INTEGER DEFAULT 0)
- **클라이언트**: 프로젝트 설정에 디버그 로깅 토글 + Debug Logs 배지
- **클라이언트**: `TodoItem`/`TaskNodeDetail`에 Debug Log 버튼 (새 탭에서 로그 파일 열기)
- 서버 시작 시 `LOG_RETENTION_DAYS` 기준 오래된 디버그 로그 자동 정리

#### 3. AUTH_PASSWORD 미설정 시 인증 건너뛰기 (`fd6b80a`)

비밀번호가 설정되지 않은 로컬 환경에서 로그인 화면 없이 바로 사용 가능.

- **서버**: `AUTH_PASSWORD` 미설정 시 auth 미들웨어 통과 + `/api/auth/status`에서 `authenticated=true`, `authRequired=false` 반환
- **클라이언트**: `authRequired` 플래그로 로그인 페이지 스킵 + 로그아웃 버튼 숨김

#### 4. 샌드박스 모드 개선 (`6e9251a`, `276d138`, `4b27e66`, `bbe2378`)

기존 샌드박스 설정의 안정성 및 파이프라인 지원 확대.

- **서버**: `settings.json` 덮어쓰기 → 병합 방식으로 변경 (기존 설정 보존)
- **서버**: `pipeline-orchestrator.ts`에도 샌드박스 모드 적용
- **서버**: strict 모드에서 `--permission-mode dontAsk` 플래그 추가 (Write/Edit 도구 차단 방지)
- **클라이언트**: 샌드박스 배지 텍스트 i18n 적용
- **API**: `updateProject`에 `sandbox_mode` 필드 추가

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/services/discussion-orchestrator.ts` | 토론 오케스트레이터 신규 (라운드 턴제, 프롬프트 빌드, 자동 진행) |
| `src/server/routes/discussions.ts` | 토론 REST 엔드포인트 18개 |
| `src/server/db/queries.ts` | 토론 관련 CRUD 함수 ~20개 + 디버그 로깅 쿼리 |
| `src/server/db/schema.ts` | discussion 4개 테이블 + `debug_logging` 컬럼 마이그레이션 |
| `src/server/services/debug-logger.ts` | 디버그 로깅 서비스 신규 |
| `src/server/routes/debug-logs.ts` | 디버그 로그 API 라우트 신규 |
| `src/server/services/orchestrator.ts` | 디버그 세션 통합 + 샌드박스 settings.json 병합 |
| `src/server/services/pipeline-orchestrator.ts` | 파이프라인 샌드박스 지원 |
| `src/server/services/cli-adapters.ts` | strict 모드 `--permission-mode dontAsk` 추가 |
| `src/server/middleware/auth.ts` | AUTH_PASSWORD 미설정 시 통과 로직 |
| `src/client/src/components/DiscussionDetail.tsx` | 토론 채팅 UI (라운드 메시지, 스트리밍, 구현 모달) |
| `src/client/src/components/DiscussionList.tsx` | 토론 목록 + 생성 폼 |
| `src/client/src/components/AgentManager.tsx` | 에이전트 페르소나 관리 UI |
| `src/client/src/components/ProjectDetail.tsx` | 토론 탭 추가 |
| `src/client/src/i18n.tsx` | 토론·디버그·샌드박스 번역 키 추가 |
| `src/client/src/types.ts` | Discussion 관련 인터페이스 5개 추가 |

### 아키텍처 결정

1. **턴 기반 순차 실행**: 에이전트가 순서대로 CLI를 spawn하고, 이전 발언을 다음 프롬프트에 누적 포함. 동시 쓰기 충돌 방지 + 컨텍스트 연속성 보장
2. **구현 라운드 분리**: 토론 라운드(코드 작성 금지)와 구현 라운드(max_rounds+1)를 명확히 분리하여 토론 중 의도치 않은 코드 변경 방지
3. **프롬프트 인젝션 방어**: `<user_task>` 태그로 사용자 입력 격리 + untrusted input 경고 명시
4. **디버그 로깅의 tee 방식**: 기존 logStreamer 파이프라인에 영향 없이 PassThrough 스트림으로 파일 기록을 분기
5. **인증 선택적 적용**: `AUTH_PASSWORD` 미설정 시 서버·클라이언트 양쪽에서 인증 흐름 완전 스킵 (Hecaton 사이드카 등 로컬 환경 대응)

---

## 2026-04-04 — Git 클라이언트 + 워크트리 샌드박싱

### 배경

Git 탭이 커밋 히스토리 그래프만 표시하는 읽기 전용 뷰였으나, 웹 UI에서 직접 Git 작업을 수행할 수 있는 완전한 클라이언트로 확장. 또한 CLI 도구가 `--dangerously-skip-permissions` 등 전체 파일시스템 접근 플래그를 사용하고 있어, 보안 강화를 위해 워크트리 디렉토리 내로 접근을 제한하는 샌드박스 모드를 도입.

### 주요 변경

#### 1. Git 액션 툴바 + 파일 상태 뷰 (`7891eac`)

Git 탭을 커밋 그래프 뷰어에서 완전한 Git 클라이언트로 확장.

- **서버**: `worktree-manager.ts`에 16개 Git 작업 메서드 추가 (stage, unstage, commit, pull, push, fetch, branch, checkout, merge, stash, discard, tag, diff 등)
- **서버**: `routes/projects.ts`에 대응하는 16개 REST 엔드포인트 추가
- **클라이언트 API**: `api/projects.ts`에 16개 Git 작업 함수 추가
- **클라이언트 UI**: 액션 툴바 (커밋/Pull/Push/패치/브랜치/병합/스태시/폐기/태그)
  - 각 작업별 모달 다이얼로그 (커밋 메시지 입력, 브랜치 생성/삭제, 태그 생성 등)
- **클라이언트 UI**: 좌측 사이드바에 파일 상태 패널 추가
  - Staged/Unstaged/Untracked 파일 분류 표시
  - 파일별 stage/unstage/discard 인라인 액션
- **i18n**: 한/영 35개 번역 키 추가
- **버그 수정**: 커밋 그래프 연결선 y2 좌표 클램핑 오류 수정

#### 2. CLI 도구 워크트리 디렉토리 샌드박싱 (`1537f56`)

프로젝트별 `sandbox_mode` 설정으로 CLI 도구의 파일 접근 범위를 제어.

- **Claude CLI**: strict 모드에서 워크트리에 `.claude/settings.json` 자동 생성 (dontAsk + 디렉토리 스코프 권한), `--dangerously-skip-permissions` 플래그 제거
- **Codex CLI**: strict 모드에서 `--full-auto` + `--add-dir .git`으로 워크스페이스 샌드박스 활성화 (git 메타데이터 접근은 허용)
- **Gemini CLI**: 네이티브 샌드박싱 미지원으로 프롬프트 수준 경로 제한만 적용
- **DB**: `projects` 테이블에 `sandbox_mode` 컬럼 추가 (`strict`/`permissive`, 기본값 `strict`)
- **UI**: 프로젝트 설정에 샌드박스 모드 토글 + 경고 다이얼로그 + 뱃지 표시

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/services/worktree-manager.ts` | 16개 Git 작업 메서드 추가 |
| `src/server/routes/projects.ts` | 16개 Git 작업 REST 엔드포인트 추가 |
| `src/server/services/cli-adapters.ts` | `SandboxMode` 타입 + CLI별 샌드박스 분기 로직 |
| `src/server/services/orchestrator.ts` | strict 모드 시 `.claude/settings.json` 생성 + 프롬프트 경로 제한 |
| `src/server/services/claude-manager.ts` | `projectPath`, `sandboxMode` 파라미터 전달 |
| `src/server/services/pipeline-orchestrator.ts` | 파이프라인에도 샌드박스 모드 적용 |
| `src/server/db/schema.ts` | `sandbox_mode` 컬럼 마이그레이션 |
| `src/server/db/queries.ts` | `Project` 인터페이스에 `sandbox_mode` 추가 |
| `src/client/src/components/GitStatusPanel.tsx` | 액션 툴바 + 파일 상태 사이드바 UI |
| `src/client/src/components/ProjectHeader.tsx` | 샌드박스 모드 토글 + 경고 다이얼로그 UI |
| `src/client/src/api/projects.ts` | Git 작업 API 함수 + `sandbox_mode` 필드 |
| `src/client/src/i18n.tsx` | 샌드박스 + Git 작업 번역 키 추가 |
| `src/client/src/types.ts` | `Project`에 `sandbox_mode` 필드 추가 |

### 아키텍처 결정

1. **기본값 strict**: 새 프로젝트는 기본적으로 strict 모드로 생성되어 보안 우선
2. **CLI별 네이티브 샌드박싱 활용**: 각 CLI의 자체 샌드박스 메커니즘을 활용하되, Gemini는 미지원이므로 프롬프트 수준 제한
3. **Git 메타데이터 허용**: Codex strict 모드에서 `--add-dir .git`으로 워크트리 외부의 git 메타데이터 접근 허용 (커밋/푸시에 필요)
4. **실패 허용**: settings.json 생성 실패 시 로그만 남기고 실행 계속

---

## 2026-04-03 — 플러그인 아키텍처 추출

### 배경

Jira, GitHub, Notion, gstack 통합이 코어 코드에 하드코딩되어 있어, 새 통합 추가 시 index.ts, ProjectDetail.tsx, ProjectHeader.tsx, schema.ts, queries.ts 등 다수의 파일을 수정해야 했음. 이를 자기완결적인 플러그인 모듈로 추출하여 확장성을 확보.

### 주요 변경

#### 1. 서버 플러그인 시스템

- **`src/server/plugins/types.ts`**: `PluginManifest`, `PluginHelpers`, `ExecutionContext` 인터페이스 정의
- **`src/server/plugins/registry.ts`**: `registerPlugin()`, `mountPluginRoutes()`, `getExecutionHookPlugins()` 레지스트리
- **플러그인 모듈**: `src/server/plugins/{jira,github,notion,gstack}/` — 각 플러그인이 자체 manifest + router 보유
- **2가지 카테고리**: `external-service` (REST 프록시 + 패널 탭) / `execution-hook` (오케스트레이터 실행 전 훅)
- **`src/server/routes/plugins.ts`**: 플러그인 설정 CRUD API (`GET/PUT /api/plugins/:id/config/:projectId`)

#### 2. DB 스키마

- **`plugin_configs` 테이블 추가**: 프로젝트×플러그인×키 단위 제네릭 key-value 저장소
- **자동 마이그레이션**: 서버 시작 시 기존 `projects` 테이블의 레거시 컬럼 → `plugin_configs`로 idempotent 복사
- **하위 호환**: 레거시 컬럼 유지, 저장 시 양쪽 동기화

#### 3. 오케스트레이터 제네릭 훅

- **기존**: `if (cliTool === 'claude' && project.gstack_enabled)` 하드코딩
- **변경**: `getExecutionHookPlugins()` 루프로 모든 execution-hook 플러그인의 `onBeforeExecution()` 호출
- 실패 시 로그만 남기고 실행 계속 (failure tolerance 유지)

#### 4. 클라이언트 플러그인 시스템

- **`src/client/src/plugins/`**: `ClientPluginManifest` 기반 레지스트리
- **동적 탭 렌더링**: `ProjectDetail.tsx`에서 하드코딩 3개 탭 → `getPluginsWithTabs(project).map(...)` 루프
- **동적 설정 UI**: `ProjectHeader.tsx`에서 하드코딩 ~23개 useState → `pluginConfigs` 단일 상태 + 플러그인 SettingsComponent 루프
- **i18n**: 각 플러그인이 자체 번역 키 보유

### 파일 구조

```
src/server/plugins/
├── types.ts, registry.ts
├── jira/    (index.ts, router.ts)
├── github/  (index.ts, router.ts)
├── notion/  (index.ts, router.ts)
└── gstack/  (index.ts — with onBeforeExecution hook)

src/client/src/plugins/
├── types.ts, registry.ts, init.ts
├── jira/    (index.ts, JiraSettings.tsx)
├── github/  (index.ts, GitHubSettings.tsx)
├── notion/  (index.ts, NotionSettings.tsx)
└── gstack/  (index.ts, GstackSettings.tsx)
```

### 검증

- 서버 TypeScript 컴파일: 통과
- 서버 빌드: 통과
- 서버 테스트 69개: 전체 통과
- 기존 API 경로 유지 (`/api/jira`, `/api/github`, `/api/notion`, `/api/gstack` — `routePrefix` 사용)

---

## 2026-04-01 — GitHub Issues 연동 + 모델 관리 + 실행 안정성 강화

### 배경

외부 플러그인 생태계를 확장하고 (GitHub Issues 연동), CLI 모델을 유연하게 관리하며, 태스크 실행의 안정성과 효율성을 전반적으로 강화하는 대규모 업데이트.

### 주요 기능 추가

#### 1. GitHub Issues 플러그인 연동 (`471e5b2`)

GitHub 레포지토리의 이슈를 CLITrigger에서 직접 조회하고 AI 태스크로 Import하는 기능.

- **8개 API 엔드포인트**: 연결 테스트, 이슈 CRUD, 코멘트, Import, 라벨 조회
- **프론트엔드 UI** (`GitHubPanel.tsx`): 이슈 브라우징, 검색, 라벨 필터, 상세 보기, Import
- **프로젝트 설정**: GitHub 토글 + Token/Owner/Repo 입력 + Test Connection
- **DB**: `github_enabled`, `github_token`, `github_owner`, `github_repo` 컬럼 추가

#### 2. 모델 수동 관리 시스템 (`760fee2`)

CLI 도구별 모델 목록을 DB에서 관리하는 시스템.

- **`cli_models` 테이블**: 새 테이블 추가 (cli_tool, model_value, model_label, sort_order, is_default)
- **자동 시딩**: 서버 시작 시 기본 모델 목록 자동 생성 (Claude Sonnet/Opus/Haiku, GPT-4.1 계열, Gemini)
- **REST API**: `GET /api/models`, `POST /api/models`, `DELETE /api/models/:id`
- **프론트엔드 UI** (`ModelSettings.tsx`): 모델 추가/삭제/기본값 설정
- **실행 시 모델 변경 핫픽스** (`0f229c6`): 작업 도중 모델이 변경되어도 에러 없이 처리

#### 3. CLI Fallback Chain (`a1992fb`)

컨텍스트 윈도우 소진 시 자동으로 다음 CLI/모델로 재시도하는 폴백 메커니즘.

- **프로젝트 설정**: `cli_fallback_chain` (JSON 배열) 설정 UI
- **자동 감지**: `log-streamer.ts`에서 컨텍스트 소진 패턴 감지
- **자동 재시도**: orchestrator가 다음 fallback CLI로 동일 태스크 자동 재실행
- **컨텍스트 스위치 카운트**: `context_switch_count` 컬럼으로 재시도 횟수 추적

#### 4. Verbose 실행 모드 (`4c7a03c`, `31d79e7`)

Claude CLI의 모든 로그를 필터 없이 스트리밍하는 디버그 모드.

- TODO 실행 시 **Verbose** 토글 추가
- `--verbose` 플래그로 stream-json 출력 활성화
- `log-streamer.ts`에서 verbose 모드일 때 모든 이벤트 기록

#### 5. 토큰 사용량 최적화 (`ff6b637`)

- **기본 턴 제한** (`default_max_turns`): 프로젝트별 Claude CLI 최대 턴 수 설정
- **효율성 지침**: CLAUDE.md에 태스크 실행 가이드라인 추가

#### 6. 프롬프트 인젝션 방어 (`4630c92`)

외부 입력(Notion/GitHub/Jira)에서 프롬프트 인젝션 공격을 방어하는 보안 레이어.

- **`prompt-guard.ts`** 서비스: 구조적 분리, 입력 검증, 위험 패턴 감지
- **감사 로그**: 의심스러운 입력 감지 시 로그 기록
- Notion/GitHub/Jira 라우트에 가드 적용

### 실행 엔진 개선

#### 의존성 시스템 강화
- **자식 태스크 실행 시 부모 의존성 자동 실행** (`1f91eee`): 미완료 부모가 있으면 자동으로 먼저 시작
- **의존성 기반 자동 체이닝** (`c2fa679`): `startNextPending` → `startDependentChildren`으로 교체하여 정밀 제어
- **디펜던시 완료 시 스퀴시 머지** (`c6c1d5b`): 의존성 브랜치 완료 시 자동 squash merge + 부모 워크트리 정리

#### 프로세스 관리
- **tree-kill** (`b78922d`): 프로세스 트리 전체를 안전하게 종료 (단일 PID kill → tree-kill)
- **컨텍스트 스위치 제한**: 무한 재시도 방지
- **Worktree 유효성 검증**: 실행 전 worktree 경로 존재 확인

#### Codex CLI 개선
- `--full-auto` → `--dangerously-bypass-approvals-and-sandbox` (`fd8c254`)
- Windows cmd.exe 셸 이스케이핑 수정 (`fd80f98`)
- 프롬프트 전달 안정화 (`6c3576f`)

### UI 개선

- **그래프 뷰 엣지 드래그로 의존성 제거/변경** (`efb18d6`)
- **리스트 뷰 드래그&드롭으로 의존성 제거** (`8a180e1`)
- **리스트 뷰 의존성 들여쓰기** (`6c3576f`)
- **모바일 UI 반응형 개선** (`6533fe5`): 패딩, 탭, 모달, 배지 레이아웃 수정
- **실패 작업 → 스케줄 변환 UI** (`c8fb658`): 실패한 작업을 스케줄 작업으로 전환하는 UI + 로직
- **로그인 화면 법적 면책 고지** (`a967f88`)

### 새로 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/server/routes/github.ts` | GitHub API 프록시 라우트 (8개 엔드포인트) |
| `src/server/routes/models.ts` | CLI 모델 관리 REST API |
| `src/server/services/prompt-guard.ts` | 프롬프트 인젝션 방어 서비스 |
| `src/server/services/__tests__/prompt-guard.test.ts` | 프롬프트 가드 테스트 |
| `src/client/src/api/github.ts` | 프론트엔드 GitHub API 클라이언트 |
| `src/client/src/api/models.ts` | 프론트엔드 모델 API 클라이언트 |
| `src/client/src/components/GitHubPanel.tsx` | GitHub Issues 브라우저 패널 UI |
| `src/client/src/components/ModelSettings.tsx` | 모델 관리 설정 UI |
| `src/client/src/hooks/useModels.ts` | 모델 데이터 훅 |

### 수정된 주요 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/services/orchestrator.ts` | fallback chain, 의존성 자동 체이닝, squash merge, 컨텍스트 스위치 제한 |
| `src/server/services/log-streamer.ts` | verbose 모드, 컨텍스트 소진 감지, stderr 분류 |
| `src/server/services/claude-manager.ts` | tree-kill, Windows cmd.exe 이스케이핑, Codex 프롬프트 안정화 |
| `src/server/services/cli-adapters.ts` | 모델 변경 핫픽스, verbose 플래그, Codex 플래그 업데이트 |
| `src/server/services/worktree-manager.ts` | worktree 유효성 검증, squash merge 지원 |
| `src/server/db/schema.ts` | `cli_models` 테이블, github/fallback/context_switch 컬럼 |
| `src/client/src/components/ProjectHeader.tsx` | GitHub 설정, fallback chain, max turns, 모델 관리 UI |
| `src/client/src/components/TodoItem.tsx` | verbose 토글, 스케줄 변환, squash merge 버튼 |
| `src/client/src/components/TaskGraph.tsx` | 엣지 드래그 의존성 변경 |
| `src/client/src/components/TodoList.tsx` | 드래그&드롭 의존성 제거, 들여쓰기 |

---

## 2026-04-01 — Notion 데이터베이스 연동

### 배경

피쳐 개발 문서나 버그 리포트를 Notion에 한곳에 모아 관리하면서, CLITrigger에서 바로 Import하여 AI 태스크로 자동 실행하고 싶은 요구가 있었다. Notion API를 통해 프로젝트별 데이터베이스를 연결하고, 페이지 브라우징/검색/Import/생성 기능을 제공한다.

### 구현 내용

#### Notion API 연동 서버 라우트 (`notion.ts`)
- **연결 테스트**: Notion API 키 유효성 + 사용자 정보 확인
- **페이지 조회**: 데이터베이스 쿼리 (페이지네이션, 검색, 필터링, 정렬)
- **페이지 상세**: 메타데이터 + 블록 콘텐츠 조회 (최대 100블록)
- **페이지 수정**: 상태 등 속성 업데이트
- **페이지 생성**: Notion 데이터베이스에 새 페이지 추가
- **Import**: 페이지 제목/본문 추출 → CLITrigger 태스크로 변환
- **스키마 조회**: 데이터베이스 속성 구조 반환

#### 블록 콘텐츠 파싱
- `extractPageTitle()` — title 속성에서 제목 추출
- `extractRichText()` — Notion rich text → plain text 변환
- `extractBlocksText()` — 블록 → 마크다운 변환 (heading, list, code, divider, checkbox 지원)

#### 프론트엔드 UI (`NotionPanel.tsx`, 414줄)
- **페이지 목록**: 검색, 페이지네이션, 상태별 필터링
- **페이지 상세**: 블록 콘텐츠 렌더링 (heading, list, code, divider, to-do)
- **Import 기능**: 페이지를 CLITrigger 태스크로 변환 (제목 + 본문 자동 추출)
- **페이지 생성**: Notion DB에 새 페이지 추가 폼

#### 프로젝트 설정 UI (`ProjectHeader.tsx`)
- Notion 활성화/비활성화 토글
- API Key 입력 (password 필드)
- Database ID 입력
- Test Connection 버튼 + 연결 상태 피드백
- 도움말: "notion.so/my-integrations에서 Integration 생성 후 DB 공유"

#### REST API 엔드포인트 (8개)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | /api/notion/:projectId/test | 연결 테스트 |
| POST | /api/notion/:projectId/pages | 페이지 목록 (검색/필터/페이지네이션) |
| GET | /api/notion/:projectId/page/:pageId | 페이지 상세 |
| GET | /api/notion/:projectId/page/:pageId/blocks | 페이지 블록 콘텐츠 |
| POST | /api/notion/:projectId/page/:pageId/update | 페이지 속성 수정 |
| POST | /api/notion/:projectId/create | 페이지 생성 |
| POST | /api/notion/:projectId/import/:pageId | 태스크로 Import |
| GET | /api/notion/:projectId/schema | DB 스키마 조회 |

#### 새로 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/server/routes/notion.ts` | Notion API 프록시 라우트 (8개 엔드포인트) |
| `src/client/src/api/notion.ts` | 프론트엔드 Notion API 클라이언트 |
| `src/client/src/components/NotionPanel.tsx` | Notion 브라우저 패널 UI |

#### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/index.ts` | `notionRouter`를 `/api/notion`에 마운트 |
| `src/server/routes/projects.ts` | PUT 업데이트에 notion 필드 처리 (`notion_enabled`, `notion_api_key`, `notion_database_id`) |
| `src/server/db/schema.ts` | `notion_enabled`, `notion_api_key`, `notion_database_id` 컬럼 마이그레이션 추가 |
| `src/server/db/queries.ts` | `Project` 인터페이스 및 `updateProject`에 notion 필드 추가 |
| `src/client/src/types.ts` | `Project`에 notion 필드 + `NotionPage`, `NotionQueryResult` 인터페이스 추가 |
| `src/client/src/components/ProjectHeader.tsx` | 설정 패널에 Notion 설정 UI 추가 |
| `src/client/src/components/ProjectDetail.tsx` | Notion 탭 버튼 + NotionPanel 렌더링 추가 |
| `src/client/src/i18n.tsx` | 한/영 Notion 관련 번역 키 추가 |

#### 아키텍처 결정

1. **프로젝트별 설정**: Notion API 키와 DB ID를 프로젝트 단위로 저장 (Jira 연동과 동일 패턴)
2. **서버 프록시**: 클라이언트가 Notion API를 직접 호출하지 않고 서버를 경유 (API 키 노출 방지)
3. **블록 → 마크다운 변환**: Import 시 Notion 블록을 마크다운으로 변환하여 AI 프롬프트로 활용
4. **DB 저장**: `notion_enabled` (INTEGER 0/1) + `notion_api_key` (TEXT) + `notion_database_id` (TEXT)

#### 검증

- TypeScript 서버 컴파일: 통과
- 기존 테스트 53개: 전체 통과

---

## 2026-03-29 — Cron 스케줄 기반 자동 실행

### 배경

TODO를 수동으로 Start하는 것 외에, 정해진 시간에 자동으로 반복 실행하는 스케줄링 기능이 필요했다. cron 표현식을 사용하여 프로젝트별 반복 작업을 설정할 수 있도록 구현한다.

### 구현 내용

#### Scheduler 서비스 (`scheduler.ts`)
- **cron 기반 반복 실행**: `node-cron` 라이브러리로 cron 표현식에 따라 TODO 자동 생성 + 실행
- **중복 실행 방지**: `skip_if_running` 옵션으로 이전 실행이 진행 중이면 건너뜀
- **수동 트리거**: 스케줄 외에 즉시 실행 가능
- **활성화/비활성화**: 스케줄별 ON/OFF 토글
- **실행 이력**: `schedule_runs` 테이블에 실행 기록 저장

#### REST API 엔드포인트 (9개)
- `POST /api/projects/:id/schedules` — 스케줄 생성 (cron 표현식 검증)
- `GET /api/projects/:id/schedules` — 프로젝트 스케줄 목록
- `GET /api/schedules/:id` — 스케줄 상세
- `PUT /api/schedules/:id` — 스케줄 수정
- `DELETE /api/schedules/:id` — 스케줄 삭제
- `POST /api/schedules/:id/activate` — 활성화
- `POST /api/schedules/:id/pause` — 비활성화
- `GET /api/schedules/:id/runs` — 실행 이력 조회
- `POST /api/schedules/:id/trigger` — 수동 트리거

#### 프론트엔드 UI
- `ScheduleForm.tsx` — 스케줄 생성/수정 폼 (cron 표현식 입력 + 검증)
- `ScheduleItem.tsx` — 스케줄 항목 (상태, 다음 실행 시각, 실행 이력)
- `ScheduleList.tsx` — 스케줄 목록

#### DB 변경
- `schedules` 테이블: id, project_id, title, cron_expression, is_active, skip_if_running, last_run_at 등
- `schedule_runs` 테이블: id, schedule_id, todo_id, status (triggered/skipped/failed)
- `todos` 테이블: `schedule_id` 컬럼 추가 (스케줄에서 생성된 TODO 추적)

#### WebSocket 이벤트 (3개)
- `schedule:run-triggered` — 스케줄 실행 시작
- `schedule:run-skipped` — 중복 실행 건너뜀
- `schedule:status-changed` — 스케줄 상태 변경 (활성화/비활성화)

#### 새로 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/server/services/scheduler.ts` | Scheduler 서비스 (cron 등록/해제/실행) |
| `src/server/routes/schedules.ts` | 스케줄 REST API 라우트 (9개 엔드포인트) |
| `src/client/src/api/schedules.ts` | 프론트엔드 스케줄 API 클라이언트 |
| `src/client/src/components/ScheduleForm.tsx` | 스케줄 생성/수정 폼 |
| `src/client/src/components/ScheduleItem.tsx` | 스케줄 항목 UI |
| `src/client/src/components/ScheduleList.tsx` | 스케줄 목록 UI |

#### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `package.json` | `node-cron`, `@types/node-cron` 의존성 추가 |
| `src/server/db/schema.ts` | `schedules`, `schedule_runs` 테이블 + `todos.schedule_id` 컬럼 추가 |
| `src/server/db/queries.ts` | 스케줄 CRUD 쿼리 함수 추가 |
| `src/server/index.ts` | `schedulesRouter` 마운트 + Scheduler 초기화 |
| `src/client/src/i18n.tsx` | 스케줄 관련 번역 키 30개 추가 (한/영) |

---

## 2026-03-29 — TODO별 CLI 도구 & 모델 선택

### 배경

프로젝트 단위로만 CLI 도구(Claude/Gemini/Codex)와 모델을 설정할 수 있었으나, 개별 TODO마다 다른 CLI/모델을 사용하고 싶은 요구가 있었다.

### 구현 내용

- TODO 생성/수정 시 `cli_tool`과 `cli_model` 필드 추가
- 프로젝트 기본값을 상속하되, TODO 레벨에서 오버라이드 가능
- UI에서 TODO별 CLI 도구 및 모델 선택 드롭다운 제공

#### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/db/schema.ts` | `todos` 테이블에 `cli_tool`, `cli_model` 컬럼 추가 |
| `src/server/db/queries.ts` | TODO CRUD에 cli_tool, cli_model 필드 반영 |
| `src/server/services/orchestrator.ts` | TODO 실행 시 개별 cli_tool/cli_model 우선 적용 |
| `src/client/src/components/TodoForm.tsx` | CLI 도구/모델 선택 UI 추가 |
| `src/client/src/types.ts` | Todo 타입에 cli_tool, cli_model 필드 추가 |

---

## 2026-03-29 — Claude Issue Worker (Self-hosted Runner)

### 배경

로컬 PC 없이 GitHub 이슈만으로 코드 작업을 자동화하려는 요구가 있었다. Anthropic API 종량제 대신 Claude Max 구독을 활용하기 위해 Self-hosted Runner 기반으로 구현한다.

### 구현 내용

#### Claude Issue Worker 워크플로우 (`claude-issue.yml`)
- **트리거**: 이슈에 `claude-fix` 라벨 추가 시
- **실행 환경**: Self-hosted Runner (Claude Max 구독 인증된 로컬 PC)
- **동작**: Claude Code CLI가 이슈 내용을 읽고 코드 구현 → `claude/issue-{N}` 브랜치에 커밋 → PR 자동 생성
- **실패 처리**: 변경사항이 없으면 이슈에 코멘트로 알림

#### 새로 생성된 파일

| 파일 | 설명 |
|------|------|
| `.github/workflows/claude-issue.yml` | Claude Issue Worker 워크플로우 |

#### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `docs/CICD.md` | Claude Issue Worker 섹션 추가 (동작 흐름, Runner 등록 가이드, 트러블슈팅) |
| `docs/SETUP.md` | CI/CD 섹션에 Issue 자동 처리 안내 추가 |
| `docs/CHANGELOG.md` | 이 항목 추가 |

---

## 2026-03-26 — CI/CD 파이프라인 구축

### 배경

프로젝트에 자동화된 품질 검증 체계가 없어, PR 머지 시 타입 오류나 테스트 실패가 감지되지 않을 수 있었다. GitHub Actions 기반 CI/CD를 도입하여 코드 품질 게이트를 자동화한다.

### 구현 내용

#### CI 워크플로우 (`ci.yml`)
- **트리거**: `main` 브랜치 push 및 PR
- **병렬 파이프라인**: typecheck → test-server → test-client (병렬) → build (게이트)
- **동시성 제어**: 같은 브랜치의 중복 실행 자동 취소
- **아티팩트**: 빌드 결과물 7일간 보관

#### Release 워크플로우 (`release.yml`)
- **트리거**: `v*` 태그 push
- **산출물**: typecheck → test → build → tar.gz 패키징 → GitHub Release 자동 생성
- release notes 자동 생성 포함

#### npm 스크립트 추가
- `typecheck` — 서버 + 클라이언트 TypeScript 타입 체크 (`--noEmit`)
- `typecheck:server` / `typecheck:client` — 개별 타입 체크

#### 새로 생성된 파일

| 파일 | 설명 |
|------|------|
| `.github/workflows/ci.yml` | CI 워크플로우 |
| `.github/workflows/release.yml` | Release 워크플로우 |
| `docs/CICD.md` | CI/CD 가이드 문서 |

#### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `package.json` | `typecheck`, `typecheck:server`, `typecheck:client` 스크립트 추가 |
| `docs/SETUP.md` | CI/CD 관련 참조 추가 |
| `docs/CHANGELOG.md` | 이 항목 추가 |

---

## 2026-03-26 — gstack 스킬 통합

### 배경

[gstack](https://github.com/garrytan/gstack) (MIT License, Garry Tan)은 Claude Code용 28개 AI 스킬을 제공하는 오픈소스 프로젝트이다. CLITrigger가 TODO를 실행할 때 이 스킬들을 worktree에 자동 주입하면, Claude CLI의 작업 품질을 높일 수 있다.

### 구현 내용

gstack의 28개 스킬 중 자동화 실행에 적합한 **7개 스킬**을 선별하여 CLITrigger에 번들링하고, 프로젝트 설정에서 ON/OFF + 개별 선택이 가능하도록 구현했다.

#### 선별 스킬

- `review` — 코드 리뷰 & 자동 수정 (9/10)
- `qa` — 브라우저 기반 QA 테스트 (9/10)
- `qa-only` — QA 리포트만 (10/10)
- `cso` — OWASP/STRIDE 보안 감사 (9/10)
- `investigate` — 체계적 디버깅 (8/10)
- `benchmark` — 성능 회귀 감지 (10/10)
- `careful` — 위험 명령어 경고 (10/10)

#### 새로 생성된 파일

| 파일 | 설명 |
|------|------|
| `src/server/resources/gstack-skills/` | 7개 스킬 SKILL.md 파일 + LICENSE + 매니페스트 |
| `src/server/services/skill-injector.ts` | 스킬 파싱, 조회, worktree 주입 서비스 |
| `src/client/src/api/gstack.ts` | 프론트엔드 gstack API 클라이언트 |
| `THIRD_PARTY_LICENSES.md` | 서드파티 라이선스 고지 |
| `docs/CHANGELOG.md` | 이 파일 |

#### 수정된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/server/db/schema.ts` | `gstack_enabled`, `gstack_skills` 컬럼 마이그레이션 추가 |
| `src/server/db/queries.ts` | `Project` 인터페이스 및 `updateProject`에 gstack 필드 추가 |
| `src/server/services/orchestrator.ts` | `startSingleTodo()`에서 worktree 생성 후 CLI spawn 전에 스킬 주입 호출 |
| `src/server/routes/projects.ts` | PUT 업데이트에 gstack 필드 처리 + `gstackRouter` 분리 (`GET /api/gstack/skills`) |
| `src/server/index.ts` | `gstackRouter`를 `/api/gstack`에 마운트 |
| `src/client/src/types.ts` | `Project`에 gstack 필드 + `GstackSkill` 인터페이스 추가 |
| `src/client/src/api/projects.ts` | `updateProject` 파라미터에 gstack 필드 추가 |
| `src/client/src/components/ProjectHeader.tsx` | 설정 패널에 gstack 토글 + 스킬 체크박스 UI 추가 |
| `src/client/src/i18n.tsx` | 한/영 gstack 관련 번역 키 추가 |
| `package.json` | `build:server`에 리소스 복사 (`cp -r`) 추가 |
| `docs/SETUP.md` | gstack 스킬 사용법 섹션 + API 테이블에 엔드포인트 추가 |

#### 아키텍처 결정

1. **스킬 격리**: gstack 스킬은 worktree의 `.claude/skills/gstack-{id}/SKILL.md`에 배치되어 기존 스킬과 충돌하지 않음
2. **Claude CLI 전용**: `cliTool === 'claude'`일 때만 주입 (Gemini/Codex는 gstack 스킬 미지원)
3. **실패 허용**: 스킬 주입 실패 시 로그만 남기고 CLI 실행은 계속 진행
4. **DB 저장**: `gstack_enabled` (INTEGER 0/1) + `gstack_skills` (JSON 배열 문자열)로 프로젝트별 설정 저장

#### 검증

- TypeScript 서버 컴파일: 통과
- 기존 테스트 52개: 전체 통과
- MIT 라이선스 고지: `THIRD_PARTY_LICENSES.md` + UI 크레딧 + 리소스 내 LICENSE 파일
