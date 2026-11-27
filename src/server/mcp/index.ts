import type { Express, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { McpServer, InMemoryTransport, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { Client } from '@modelcontextprotocol/client';
import { getSetting } from '../db/app-settings.js';
import { matchesMcpToken } from '../middleware/auth.js';
import { TASKS_EXTENSION, clientSupportsTasks, registerTaskHandlers, startTask } from './tasks.js';

// CLITrigger's MCP server. Tools are thin wrappers over the app's own REST API,
// called back over loopback — so they reuse the stable HTTP contract (and its
// validation) rather than coupling to internal service signatures.

interface ApiResult {
  ok: boolean;
  status: number;
  data: unknown;
}

async function callApi(
  baseUrl: string,
  token: string,
  method: string,
  apiPath: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<ApiResult> {
  const res = await fetch(`${baseUrl}${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

function toTextResult(r: ApiResult) {
  const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2);
  return { content: [{ type: 'text' as const, text }], isError: !r.ok };
}

async function run(fn: () => Promise<ApiResult>) {
  try {
    return toTextResult(await fn());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text' as const, text: `CLITrigger 서버에 연결할 수 없습니다: ${message}` }],
      isError: true,
    };
  }
}

function buildServer(baseUrl: string): McpServer {
  const token = getSetting('mcp.token') || '';
  // Version of the MCP tool interface, independent of the app version.
  const server = new McpServer(
    { name: 'clitrigger', version: '1.0.0' },
    { capabilities: { extensions: { [TASKS_EXTENSION]: {} } } },
  );
  registerTaskHandlers(server);

  server.registerTool(
    'list_projects',
    { description: 'CLITrigger에 등록된 모든 프로젝트 목록을 반환합니다.' },
    () => run(() => callApi(baseUrl, token, 'GET', '/api/projects')),
  );

  server.registerTool(
    'create_project',
    {
      description: '새 프로젝트를 등록합니다. path는 로컬 절대 경로여야 합니다.',
      inputSchema: z.object({
        name: z.string(),
        path: z.string(),
        default_branch: z.string().optional(),
      }),
    },
    (args) => run(() => callApi(baseUrl, token, 'POST', '/api/projects', args)),
  );

  server.registerTool(
    'create_todo',
    {
      description:
        "자동 작업(Auto Task)을 생성합니다. 시작하면 격리된 git worktree에서 CLI(Claude/Antigravity/Codex)가 자율 실행됩니다. 사용자가 '작업/할일 추가', '이거 실행해줘'라고 하면 대개 이 툴입니다. 단순히 계획만 적어두려면 create_planner_item을 쓰세요. loop를 주면 done_phrase가 출력되거나 변경이 없을 때까지 최대 max_rounds회 자동 반복합니다(검증 명령 check는 셸로 실행되므로 사용자가 UI에서만 설정합니다). memory_inject_mode='auto'면 실행할 때 작업 내용과 관련된 프로젝트 문서(Vault)를 골라 프롬프트에 넣습니다(기본 none). use_worktree=false면 worktree 없이 프로젝트 작업본에서 실행해 커밋하지 않은 변경을 그대로 봅니다. 이런 작업은 다른 작업과 동시에 돌지 않고 하나씩 실행됩니다(생략 시 프로젝트 설정). cli_tool을 생략하면 프로젝트 기본 CLI로 실행합니다. model은 그 CLI의 --model에 그대로 넘어가며(예: claude는 opus·sonnet·haiku 또는 전체 모델 ID), 모델 이름은 CLI마다 다르므로 model을 주면 cli_tool도 함께 주세요. 생략하면 CLI 기본 모델이고, 없는 모델이면 실행할 때 CLI가 오류를 냅니다.",
      inputSchema: z.object({
        project_id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        priority: z.number().optional(),
        cli_tool: z.enum(['claude', 'codex', 'antigravity']).optional(),
        model: z.string().optional(),
        memory_inject_mode: z.enum(['none', 'all', 'auto']).optional(),
        use_worktree: z.boolean().optional(),
        loop: z.object({
          max_rounds: z.number().int().min(1).max(50),
          done_phrase: z.string().optional(),
          rules: z.string().optional(),
          max_cost_usd: z.number().positive().optional(),
          stop_when_no_changes: z.boolean().optional(),
          resume: z.boolean().optional(),
        }).optional(),
      }),
    },
    ({ project_id, loop, use_worktree, model, ...body }) =>
      run(() => callApi(baseUrl, token, 'POST', `/api/projects/${project_id}/todos`, {
        ...body,
        ...(model ? { cli_model: model } : {}),
        // The REST route takes 0/1 (null = inherit the project setting).
        ...(use_worktree !== undefined ? { use_worktree: use_worktree ? 1 : 0 } : {}),
        ...(loop ? {
          loop_config: {
            maxRounds: loop.max_rounds,
            donePhrase: loop.done_phrase,
            rules: loop.rules,
            maxCostUsd: loop.max_cost_usd,
            stopWhenNoChanges: loop.stop_when_no_changes,
            resume: loop.resume,
          },
        } : {}),
      })),
  );

  server.registerTool(
    'start_todo',
    {
      description: '자동 작업(TODO) 실행을 시작합니다. mode 기본값은 headless(자율 실행).',
      inputSchema: z.object({
        todo_id: z.string(),
        mode: z.enum(['headless', 'interactive', 'verbose']).optional(),
      }),
    },
    ({ todo_id, mode }) =>
      run(() => callApi(baseUrl, token, 'POST', `/api/todos/${todo_id}/start`, { mode: mode ?? 'headless' })),
  );

  server.registerTool(
    'stop_todo',
    {
      description: '실행 중인 할일을 중지합니다.',
      inputSchema: z.object({ todo_id: z.string() }),
    },
    ({ todo_id }) => run(() => callApi(baseUrl, token, 'POST', `/api/todos/${todo_id}/stop`)),
  );

  server.registerTool(
    'list_todos',
    {
      description: '프로젝트의 자동 작업(TODO) 목록을 반환합니다. status는 pending/running/completed/failed/stopped/merged입니다.',
      inputSchema: z.object({ project_id: z.string() }),
    },
    ({ project_id }) => run(() => callApi(baseUrl, token, 'GET', `/api/projects/${project_id}/todos`)),
  );

  server.registerTool(
    'get_project_status',
    {
      description: '프로젝트의 실행 상태 요약을 반환합니다.',
      inputSchema: z.object({ project_id: z.string() }),
    },
    ({ project_id }) => run(() => callApi(baseUrl, token, 'GET', `/api/projects/${project_id}/status`)),
  );

  // ponytail: sandbox modes and claude_options are left out so an agent can't widen its own permissions.
  server.registerTool(
    'update_project_settings',
    {
      description:
        "프로젝트 실행 설정을 바꿉니다. 준 항목만 바뀌고 나머지는 그대로입니다. 현재 값은 list_projects 결과에 있습니다. default_max_turns는 자동 작업 한 번 실행(루프면 한 라운드)에서 Claude가 쓸 수 있는 최대 턴 수(--max-turns)입니다. loop_defaults는 UI에서 새 작업의 루프를 켤 때 미리 채워지는 기본 루프 규칙으로, 준 필드만 기존 규칙에 합칩니다(max_rounds = 최대 반복 횟수). 문자열 필드는 빈 문자열, max_cost_usd는 0이면 해제되고, loop_defaults=null이면 기본 루프 규칙을 끕니다. 이미 만든 작업과 create_todo의 loop에는 적용되지 않습니다.",
      inputSchema: z.object({
        project_id: z.string(),
        default_max_turns: z.number().int().min(5).max(200).optional(),
        max_concurrent: z.number().int().min(1).max(10).optional(),
        cli_tool: z.enum(['claude', 'codex', 'antigravity']).optional(),
        use_worktree: z.boolean().optional(),
        auto_commit: z.boolean().optional(),
        npm_auto_install: z.boolean().optional(),
        loop_defaults: z.object({
          max_rounds: z.number().int().min(1).max(50).optional(),
          done_phrase: z.string().optional(),
          rules: z.string().optional(),
          max_cost_usd: z.number().min(0).optional(),
          stop_when_no_changes: z.boolean().optional(),
          resume: z.boolean().optional(),
        }).nullable().optional(),
      }),
    },
    ({ project_id, loop_defaults, use_worktree, auto_commit, npm_auto_install, ...body }) =>
      run(async () => {
        // The REST route takes 0/1 flags and loop_defaults as a JSON string.
        const flags = Object.entries({ use_worktree, auto_commit, npm_auto_install })
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, value ? 1 : 0]);
        let loopDefaults: string | null | undefined = loop_defaults === null ? null : undefined;
        if (loop_defaults) {
          const current = await callApi(baseUrl, token, 'GET', `/api/projects/${project_id}`);
          if (!current.ok) return current;
          const stored = (current.data as { loop_defaults: string | null }).loop_defaults;
          const patch = Object.entries({
            maxRounds: loop_defaults.max_rounds,
            donePhrase: loop_defaults.done_phrase,
            rules: loop_defaults.rules,
            maxCostUsd: loop_defaults.max_cost_usd,
            stopWhenNoChanges: loop_defaults.stop_when_no_changes,
            resume: loop_defaults.resume,
          }).filter(([, value]) => value !== undefined);
          loopDefaults = JSON.stringify({ ...(stored ? JSON.parse(stored) : {}), ...Object.fromEntries(patch) });
        }
        return callApi(baseUrl, token, 'PUT', `/api/projects/${project_id}`, {
          ...body,
          ...Object.fromEntries(flags),
          ...(loopDefaults !== undefined ? { loop_defaults: loopDefaults } : {}),
        });
      }),
  );

  server.registerTool(
    'get_todo_logs',
    {
      description: '할일의 실행 로그를 반환합니다.',
      inputSchema: z.object({ todo_id: z.string() }),
    },
    ({ todo_id }) => run(() => callApi(baseUrl, token, 'GET', `/api/todos/${todo_id}/logs`)),
  );

  // ── Planner ──────────────────────────────────────────────────────────────
  server.registerTool(
    'create_planner_item',
    {
      description:
        "플래너(계획 보드)에 항목을 추가합니다. 실행되지 않는 계획·메모용이며, 나중에 작업·루틴·터미널로 변환해서 실행합니다. 사용자가 명시적으로 '플래너/계획에 정리'라고 할 때만 쓰세요. 실제로 실행할 작업이면 create_todo를 쓰세요.",
      inputSchema: z.object({
        project_id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        priority: z.number().optional(),
        due_date: z.string().optional(),
      }),
    },
    ({ project_id, ...body }) =>
      run(() => callApi(baseUrl, token, 'POST', `/api/projects/${project_id}/planner`, body)),
  );

  server.registerTool(
    'delete_planner_item',
    {
      description: '플래너 항목을 삭제합니다.',
      inputSchema: z.object({ item_id: z.string() }),
    },
    ({ item_id }) => run(() => callApi(baseUrl, token, 'DELETE', `/api/planner/${item_id}`)),
  );

  // ── Schedules ────────────────────────────────────────────────────────────
  server.registerTool(
    'create_schedule',
    {
      description:
        '루틴(예약/반복 자동 실행)을 생성합니다. recurring은 cron_expression, once는 run_at(ISO)이 필요합니다. 정해진 시각/주기에 자동 작업을 반복 실행할 때 쓰세요.',
      inputSchema: z.object({
        project_id: z.string(),
        title: z.string(),
        description: z.string().optional(),
        schedule_type: z.enum(['once', 'recurring']).optional(),
        cron_expression: z.string().optional(),
        run_at: z.string().optional(),
        cli_tool: z.enum(['claude', 'codex', 'antigravity']).optional(),
      }),
    },
    ({ project_id, ...body }) =>
      run(() => callApi(baseUrl, token, 'POST', `/api/projects/${project_id}/schedules`, body)),
  );

  server.registerTool(
    'delete_schedule',
    {
      description: '스케줄을 삭제합니다.',
      inputSchema: z.object({ schedule_id: z.string() }),
    },
    ({ schedule_id }) => run(() => callApi(baseUrl, token, 'DELETE', `/api/schedules/${schedule_id}`)),
  );

  // ── Sessions ─────────────────────────────────────────────────────────────
  server.registerTool(
    'create_session',
    {
      description:
        '인터랙티브 터미널 세션(사용자가 직접 CLI와 대화)을 생성합니다. 자동 실행이 아니라 수동 대화용입니다. title 생략 시 자동 생성됩니다. description은 첫 프롬프트로 보류되어 사용자가 UI에서 세션을 시작한 뒤 확인하고 보냅니다(보류 중 send_session_input은 409) — 에이전트가 직접 구동할 세션이면 description 없이 만드세요.',
      inputSchema: z.object({
        project_id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        cli_tool: z.enum(['claude', 'codex', 'antigravity']).optional(),
        use_worktree: z.boolean().optional(),
      }),
    },
    ({ project_id, ...body }) =>
      run(() => callApi(baseUrl, token, 'POST', `/api/projects/${project_id}/sessions`, body)),
  );

  server.registerTool(
    'delete_session',
    {
      description: '세션을 삭제합니다.',
      inputSchema: z.object({ session_id: z.string() }),
    },
    ({ session_id }) => run(() => callApi(baseUrl, token, 'DELETE', `/api/sessions/${session_id}`)),
  );

  // Session orchestration — lets a lead agent drive helper sessions
  // (Herdr `pane run / read / wait` equivalents).
  server.registerTool(
    'start_session',
    {
      description: '세션의 터미널(PTY)을 시작합니다. cols/rows는 둘 다 주거나 둘 다 생략합니다(기본 100x30).',
      inputSchema: z.object({
        session_id: z.string(),
        cols: z.number().int().optional(),
        rows: z.number().int().optional(),
      }),
    },
    ({ session_id, ...body }) =>
      run(() => callApi(baseUrl, token, 'POST', `/api/sessions/${session_id}/start`, body)),
  );

  // Sub-session = create + start in one call, prompt auto-submitted. Composes
  // the two REST routes so a lead agent can't forget the start step or get
  // stuck behind the held-prompt pre-flight meant for humans.
  server.registerTool(
    'spawn_session',
    {
      description:
        "서브세션(별도의 CLITrigger 터미널 세션)을 띄워 prompt를 맡깁니다. 세션을 만들고 바로 시작하며, CLI가 준비되면 prompt를 자동으로 제출합니다. CLITrigger 터미널 안에서 실행 중이면 환경변수 CLITRIGGER_PROJECT_ID를 project_id로, CLITRIGGER_SESSION_ID를 parent_session_id로 주세요. 부모를 주면 UI에서 부모 세션 아래에 묶여 보입니다. cli_tool은 claude/codex/antigravity 중에서 골라 다른 CLI에 맡길 수 있습니다(생략 시 프로젝트 기본값). 서브세션은 이 대화를 모르므로 prompt만 읽고 작업할 수 있게 쓰세요. 결과는 wait_session_state(state='blocked')로 턴이 끝나길 기다린 뒤 read_session_output으로 읽고, 다 쓰면 stop_session으로 끕니다.",
      inputSchema: z.object({
        project_id: z.string(),
        prompt: z.string(),
        parent_session_id: z.string().optional(),
        title: z.string().optional(),
        cli_tool: z.enum(['claude', 'codex', 'antigravity']).optional(),
        use_worktree: z.boolean().optional(),
      }),
    },
    ({ project_id, prompt, ...body }) =>
      run(async () => {
        const created = await callApi(baseUrl, token, 'POST', `/api/projects/${project_id}/sessions`, { ...body, description: prompt });
        if (!created.ok) return created;
        const { id } = created.data as { id: string };
        return callApi(baseUrl, token, 'POST', `/api/sessions/${id}/start`, { autoSubmit: true });
      }),
  );

  server.registerTool(
    'stop_session',
    {
      description: '실행 중인 세션을 중지합니다.',
      inputSchema: z.object({ session_id: z.string() }),
    },
    ({ session_id }) => run(() => callApi(baseUrl, token, 'POST', `/api/sessions/${session_id}/stop`)),
  );

  server.registerTool(
    'send_session_input',
    {
      description:
        '실행 중인 세션의 터미널(PTY)에 키 입력을 그대로 씁니다 — 임의 명령 실행이 가능하므로 주의. submit=true면 Enter를 덧붙여 제출합니다(빈 text + submit=true는 Enter만 보내 다이얼로그 확인에 사용). 초기 프롬프트가 대기 중이면 409.',
      inputSchema: z.object({
        session_id: z.string(),
        text: z.string(),
        submit: z.boolean().optional(),
      }),
    },
    ({ session_id, ...body }) =>
      run(async () => {
        // Typing into a raw OS shell is arbitrary command execution outside any
        // CLI sandbox — agents may only drive AI CLI sessions.
        const sess = await callApi(baseUrl, token, 'GET', `/api/sessions/${session_id}`);
        if (!sess.ok) return sess;
        const { cli_tool, project_id } = sess.data as { cli_tool: string | null; project_id: string };
        let tool = cli_tool;
        if (!tool) {
          const proj = await callApi(baseUrl, token, 'GET', `/api/projects/${project_id}`);
          if (!proj.ok) return proj;
          tool = (proj.data as { cli_tool: string | null }).cli_tool;
        }
        if (tool === 'raw-shell') {
          return { ok: false, status: 403, data: { error: 'send_session_input is not allowed on raw shell sessions' } };
        }
        return callApi(baseUrl, token, 'POST', `/api/sessions/${session_id}/input`, body);
      }),
  );

  server.registerTool(
    'read_session_output',
    {
      description:
        '세션 터미널의 최근 출력을 읽습니다. 기본은 ANSI 이스케이프와 TUI 노이즈를 제거한 텍스트(strip_ansi=false로 원문). tail_bytes 기본 16384, 최대 262144. 종료된 세션의 마지막 화면도 읽을 수 있습니다.',
      inputSchema: z.object({
        session_id: z.string(),
        tail_bytes: z.number().int().optional(),
        strip_ansi: z.boolean().optional(),
      }),
    },
    ({ session_id, tail_bytes, strip_ansi }) => {
      const query = new URLSearchParams();
      if (tail_bytes !== undefined) query.set('tail', String(tail_bytes));
      if (strip_ansi === false) query.set('strip', '0');
      const suffix = query.toString();
      return run(() => callApi(baseUrl, token, 'GET', `/api/sessions/${session_id}/output${suffix ? `?${suffix}` : ''}`));
    },
  );

  server.registerTool(
    'get_session_state',
    {
      description:
        '세션 정보와 에이전트 상태(agent_state: working=작업 중, blocked=사용자 입력 대기, idle=시작 직후 대기, done=종료, unknown=감지 불가)를 반환합니다.',
      inputSchema: z.object({ session_id: z.string() }),
    },
    ({ session_id }) => run(() => callApi(baseUrl, token, 'GET', `/api/sessions/${session_id}`)),
  );

  server.registerTool(
    'wait_session_state',
    {
      description:
        '세션의 agent_state가 지정 상태가 될 때까지(또는 프로세스가 끝날 때까지) 대기합니다. 결과는 { matched, status, agent_state }입니다. MCP tasks를 지원하는 클라이언트에서는 백그라운드 작업으로 실행되어 timeout_ms(기본 30분, 최대 60분) 동안 기다리므로 한 번만 호출하면 됩니다. 그 밖의 클라이언트에서는 timeout_ms 기본 55000, 최대 600000이고, 타임아웃이어도 matched: false로 돌려주므로 matched가 true가 될 때까지 반복 호출하세요.',
      inputSchema: z.object({
        session_id: z.string(),
        state: z.enum(['blocked', 'done', 'idle']),
        timeout_ms: z.number().int().optional(),
      }),
    },
    ({ session_id, state, timeout_ms }, ctx) => {
      // ponytail: 55s (the default, and each task-mode chunk) stays under the usual 60s MCP client per-call timeout
      const waitOnce = (timeout: number, signal?: AbortSignal) =>
        callApi(baseUrl, token, 'GET', `/api/sessions/${session_id}/wait?${new URLSearchParams({ state, timeout: String(timeout) })}`, undefined, signal);
      if (!clientSupportsTasks(ctx.mcpReq.envelope)) return run(() => waitOnce(timeout_ms ?? 55_000));
      const deadline = Date.now() + Math.min(timeout_ms ?? 30 * 60_000, 60 * 60_000);
      const task = startTask((signal) => run(async () => {
        for (;;) {
          const result = await waitOnce(Math.min(55_000, Math.max(0, deadline - Date.now())), signal);
          const data = result.data as { matched?: boolean; status?: string | null } | null;
          if (!result.ok || data?.matched || data?.status !== 'running' || Date.now() >= deadline) return result;
        }
      }));
      // The SDK's ToolCallback type predates the tasks extension; the runtime passes resultType 'task' through.
      return task as unknown as { content: [] };
    },
  );

  // ── Prompts ──────────────────────────────────────────────────────────────
  // User-invoked recipes over the tools above. Each starts by finding the
  // CLITrigger project for the client's working directory.
  const findProject = 'clitrigger의 list_projects로 프로젝트를 찾는다. 현재 작업 디렉터리와 path가 같거나, 현재 디렉터리가 그 path 아래(워크트리는 <path>/.worktrees/ 아래)인 프로젝트를 고른다. 경로 구분자와 대소문자는 무시한다. 못 찾거나 애매하면 사용자에게 묻는다.';
  const userPrompt = (text: string) => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
  });

  // Handoff rides on create_session's held first prompt: no new server state,
  // and the user previews the summary before the new session sees it.
  server.registerPrompt(
    'handoff',
    {
      title: '새 세션으로 넘기기',
      description: '지금 대화의 작업 맥락을 요약해 CLITrigger 새 세션의 첫 프롬프트로 넘깁니다.',
      argsSchema: z.object({ instruction: z.string().optional().describe('새 세션이 이어서 할 일 (생략 시 남은 작업 전체)') }),
    },
    ({ instruction }) => userPrompt(`지금까지 이 대화에서 한 작업을 CLITrigger의 새 세션으로 넘겨줘. 새 세션은 이 대화를 모르므로 아래 요약만 읽고 바로 이어서 작업할 수 있어야 해.

1. ${findProject}
2. 마크다운 요약을 짧고 구체적으로 쓴다:
   - 목표
   - 한 일 (커밋, 바꾼 파일 경로)
   - 남은 일과 바로 다음 단계
   - 내린 결정과 이유
   - 주의점 (실패한 시도, 함정)
   - 현재 디렉터리가 워크트리면 그 절대 경로
   코드 전문은 넣지 말고 파일 경로와 위치만 적는다.
3. create_session(project_id, title=작업 주제, description=요약)을 호출한다. cli_tool은 사용자가 정했을 때만 넣는다.
4. start_session과 send_session_input은 호출하지 않는다. description은 새 세션의 첫 프롬프트로 보류되고, 사용자가 CLITrigger에서 그 세션을 시작한 뒤 미리보기로 확인하고 보낸다. 만든 세션 제목을 알려주고 끝낸다.${instruction ? `\n\n새 세션이 이어서 할 일: ${instruction} — 요약의 '바로 다음 단계'에 이것을 적는다.` : ''}`),
  );

  // Delegate fans the remaining work out as parallel autonomous todos. Like
  // handoff it only creates them; the user reviews and starts them.
  server.registerPrompt(
    'delegate',
    {
      title: '병렬 작업으로 나누기',
      description: '지금 대화에서 남은 작업을 서로 독립된 자동 작업(TODO) 여러 개로 나눠 CLITrigger에 만듭니다.',
      argsSchema: z.object({ scope: z.string().optional().describe('나눌 작업 범위 (생략 시 남은 작업 전체)') }),
    },
    ({ scope }) => userPrompt(`지금 대화에서 남은 작업을 CLITrigger 자동 작업(TODO) 여러 개로 나눠 만들어줘. 각 작업은 이 대화를 모르는 CLI가 따로 실행한다. 보통 프로젝트 path 저장소의 현재 HEAD에서 갈라진 새 git worktree에서 돈다.

1. ${findProject}
2. 남은 작업이 그 HEAD에 없는 변경에 기대는지 확인한다. 커밋하지 않은 변경이나, 현재 디렉터리가 다른 워크트리·브랜치일 때 그 브랜치의 커밋은 새 worktree에서 보이지 않는다.
   - 기대지 않으면 그대로 진행한다.
   - 기대고 현재 디렉터리가 프로젝트 path(작업본) 자체면, 4단계에서 모든 작업에 use_worktree=false를 준다. 이 작업들은 작업본에서 그 변경을 그대로 보면서 한 번에 하나씩 차례로 실행된다.
   - 기대는데 현재 디렉터리가 프로젝트 path가 아니면(다른 워크트리 등) 그 변경이 작업본에 없으므로 사용자에게 상황을 말하고 멈춘다.
3. 남은 작업을 서로 독립적으로 끝낼 수 있는 단위로 나눈다.
   - 같은 파일을 고치는 일은 한 작업으로 묶는다. 따로 돌리면 병합할 때 충돌한다.
   - 다른 작업의 결과가 있어야 시작할 수 있는 일은 만들지 않고 마지막에 따로 알려준다.
   - 하나로 충분하면 억지로 나누지 않는다.
4. 작업마다 create_todo(project_id, title, description, memory_inject_mode="auto")를 호출한다.
   - description은 이것만 읽고 작업할 수 있게 쓴다: 목표, 고칠 파일 경로와 위치, 지켜야 할 결정과 주의점, 완료 조건. 코드 전문은 넣지 않는다.
   - 결과를 확인할 명령(테스트, 타입체크, 빌드)이 프로젝트 파일(package.json 스크립트 등)에 있으면 loop={ max_rounds: 3, stop_when_no_changes: true }를 주고, 그 명령을 description의 완료 조건에 적는다. 검증 명령(check)은 MCP로 설정할 수 없다 — 셸에서 그대로 실행되므로 사용자가 UI에서 직접 넣는다.
5. start_todo는 호출하지 않는다. 사용자가 CLITrigger에서 확인하고 시작한다. 만든 작업 제목 목록과, 나누지 않고 남긴 일을 알려주고 끝낸다. use_worktree=false로 만들었으면 작업본에서 하나씩 실행된다는 점과, 그동안 이 세션에서 같은 파일을 고치면 서로 덮어쓴다는 점도 알려준다.${scope ? `\n\n나눌 범위: ${scope}` : ''}`),
  );

  // Knowledge lives as plain md files in the vault; the CLI writes them with
  // its own file tools, so no write tool is needed here.
  server.registerPrompt(
    'remember',
    {
      title: '문서로 남기기',
      description: '지금 대화에서 얻은 결정·함정·관례를 CLITrigger 프로젝트 문서(.clitrigger/wiki)로 정리합니다.',
      argsSchema: z.object({ topic: z.string().optional().describe('남길 주제 (생략 시 대화에서 고름)') }),
    },
    ({ topic }) => userPrompt(`지금 대화에서 앞으로의 작업에도 쓸모 있는 지식을 CLITrigger 프로젝트 문서로 남겨줘. 프로젝트 문서는 이후 자동 작업에 장기 기억으로 주입될 수 있다.

1. ${findProject}
2. 남길 것을 고른다: 내린 결정과 그 이유, 겪은 함정과 해결법, 이 프로젝트만의 관례. 코드나 git 기록만 봐도 알 수 있는 것, 이번 작업의 진행 상황, 이번에만 해당하는 내용은 뺀다. 남길 게 없으면 그렇다고 말하고 끝낸다.
3. 문서는 그 프로젝트 path 아래 .clitrigger/wiki/ 폴더에 md 파일로 둔다. 현재 디렉터리가 워크트리여도 프로젝트 path 기준 절대 경로를 쓴다. 그 폴더의 기존 문서를 확인해 같은 주제의 문서가 있으면 그 파일에 합친다. 기존 내용은 지우지 말고 틀린 부분만 고친다. 없으면 새 파일을 만든다. 파일 이름은 주제를 나타내는 짧은 명사구로 하고 기존 파일 이름과 겹치지 않게 한다.
4. 파일 맨 앞 frontmatter에 tags: [태그, ...]를 적는다. 첫 태그가 문서 그래프의 대표 태그(노드 색·묶음 기준)다. 기존 문서가 쓰는 태그를 먼저 재사용한다. 본문은 짧은 마크다운으로 쓰고 항목마다 이유를 붙인다. 관련된 기존 문서가 있으면 [[파일 이름]]으로 링크한다.
5. 만들거나 고친 파일 경로를 알려주고 끝낸다.${topic ? `\n\n남길 주제: ${topic}` : ''}`),
  );

  server.registerPrompt(
    'status',
    {
      title: '프로젝트 현황',
      description: '현재 프로젝트의 자동 작업 현황을 정리하고, 실패한 작업은 로그로 원인을 요약합니다.',
    },
    () => userPrompt(`CLITrigger에서 이 프로젝트의 작업 현황을 정리해줘. 읽기만 하고 아무것도 바꾸지 않는다.

1. ${findProject}
2. get_project_status로 실행 중인 작업·세션 수를 보고, list_todos로 작업 목록을 본다.
3. status가 failed인 작업은 get_todo_logs로 로그를 읽고 원인을 한두 줄로 요약한다. 로그가 길면 마지막 오류 부근만 본다. 실패한 작업이 많으면 최근 5개만 본다.
4. 짧게 보고한다: 상태별 개수, 실행 중인 작업, 실패한 작업과 원인, 완료됐지만 아직 병합하지 않은 작업. 재시작·중지 같은 조치는 제안만 하고 실행하지 않는다.`),
  );

  // ── Vault tags (app DB, the files themselves are never edited) ────────────
  server.registerTool(
    'list_vault_tags',
    {
      description:
        '프로젝트 문서(Vault)에 앱이 붙인 태그와 태그 색을 반환합니다: { files: { 경로: [태그...] }, colors: { 태그: "#rrggbb" } }. md 파일 안의 frontmatter tags·#태그는 여기에 없고 파일에서 바로 읽힙니다.',
      inputSchema: z.object({ project_id: z.string() }),
    },
    ({ project_id }) => run(() => callApi(baseUrl, token, 'GET', `/api/projects/${project_id}/vault/tags`)),
  );

  server.registerTool(
    'set_vault_file_tags',
    {
      description:
        '프로젝트 문서(Vault) 파일 하나의 태그를 정합니다. 태그는 CLITrigger DB에 저장되고 파일은 바뀌지 않아 html·pdf에도 붙일 수 있습니다. 그 파일의 기존 앱 태그를 통째로 바꾸므로, 유지하려면 list_vault_tags로 확인해 합쳐서 보내세요(빈 배열이면 모두 지움). 첫 태그가 대표 태그로 문서 그래프의 노드 색과 묶음 기준입니다. path는 프로젝트 path 기준 상대 경로이고 파일이 있어야 합니다. 프로젝트에 연결한 외부 문서 폴더의 파일은 @별칭/상대경로로 적고(list_vault_tags에 보이는 형식), 그 태그는 같은 폴더를 연결한 모든 프로젝트가 함께 씁니다. 폴더 경로를 주면 그 폴더 자체의 태그가 되어 문서 그래프의 폴더 노드 색이 됩니다.',
      inputSchema: z.object({
        project_id: z.string(),
        path: z.string(),
        tags: z.array(z.string()),
      }),
    },
    ({ project_id, path, tags }) =>
      run(() => callApi(baseUrl, token, 'PUT', `/api/projects/${project_id}/vault/tags/file`, {
        path: path.replace(/\\/g, '/').replace(/^\.\//, ''),
        tags,
      })),
  );

  server.registerTool(
    'set_vault_tag_color',
    {
      description: '문서 그래프에서 태그의 색을 정합니다. 프로젝트 전체에서 그 태그 이름에 적용됩니다. 색을 정하지 않은 태그는 이름으로 자동 색이 정해집니다.',
      inputSchema: z.object({
        project_id: z.string(),
        tag: z.string(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      }),
    },
    ({ project_id, ...body }) =>
      run(() => callApi(baseUrl, token, 'PUT', `/api/projects/${project_id}/vault/tags/color`, body)),
  );

  return server;
}

const mcpAuth: RequestHandler = (req, res, next) => {
  if (matchesMcpToken(req)) return next();
  res.status(401).json({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'Unauthorized' },
    id: null,
  });
};

export interface McpCatalog {
  tools: { name: string; description: string }[];
  prompts: {
    name: string;
    title?: string;
    description: string;
    arguments: { name: string; description?: string; required?: boolean }[];
  }[];
}

/**
 * What an MCP client would see, for the settings UI. Asks a real in-process
 * client so the list can never drift from what buildServer registers.
 */
export async function listMcpCatalog(): Promise<McpCatalog> {
  // Listing never invokes a tool, so the loopback base URL is unused.
  const server = buildServer('http://127.0.0.1');
  const client = new Client({ name: 'clitrigger-settings', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    const { prompts } = await client.listPrompts();
    return {
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description ?? '' })),
      prompts: prompts.map((prompt) => ({
        name: prompt.name,
        title: prompt.title,
        description: prompt.description ?? '',
        arguments: (prompt.arguments ?? []).map(({ name, description, required }) => ({ name, description, required })),
      })),
    };
  } finally {
    await client.close();
  }
}

export function mountMcp(app: Express): void {
  app.post('/mcp', mcpAuth, async (req: Request, res: Response) => {
    // Loopback target = the actual bound port (server may have retried past
    // EADDRINUSE), taken from the incoming connection.
    const baseUrl = `http://127.0.0.1:${req.socket.localPort}`;
    // One factory serves both protocol eras: 2026-07-28 clients (Claude Code)
    // and the 2025 initialize handshake (Codex, Antigravity) through the SDK's
    // stateless legacy fallback.
    const handler = createMcpHandler(() => buildServer(baseUrl), { responseMode: 'json' });
    res.on('close', () => { void handler.close(); });
    await toNodeHandler(handler)(req, res, req.body);
  });

  // Stateless server: no SSE stream (GET) or session teardown (DELETE).
  const methodNotAllowed: RequestHandler = (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  };
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);
}
