import {
  safeJoin,
  exists,
  readJsonOrEmpty,
  readTextOrEmpty,
  atomicWriteJson,
  atomicWriteText,
  deepMerge,
  pruneUndefined,
} from '../io.js';
import type { HarnessAdapter, HarnessSettings, HarnessSnapshot, McpServer } from '../types.js';

interface AntigravitySettingsRaw {
  model?: { name?: string;[k: string]: unknown };
  general?: { defaultApprovalMode?: string;[k: string]: unknown };
  tools?: { sandbox?: string | boolean;[k: string]: unknown };
  [k: string]: unknown;
}

// Antigravity CLI keeps MCP servers in a dedicated mcp_config.json file rather
// than inline in settings.json (a change from the older Gemini CLI).
interface AntigravityMcpConfigRaw {
  mcpServers?: Record<string, AntigravityMcpEntry>;
  [k: string]: unknown;
}

interface AntigravityMcpEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  httpUrl?: string;
  url?: string;
  headers?: Record<string, string>;
  trust?: boolean;
  enabled?: boolean;
}

// PROVISIONAL project-level layout (agy not yet installed for verification):
// Antigravity reads `.agents/` at the workspace root plus an AGENTS.md context
// file. Confirm exact filenames via `agy inspect` and adjust if needed.
function settingsPath(projectPath: string): string {
  return safeJoin(projectPath, '.agents', 'settings.json');
}

function mcpConfigPath(projectPath: string): string {
  return safeJoin(projectPath, '.agents', 'mcp_config.json');
}

function memoryPath(projectPath: string): string {
  return safeJoin(projectPath, 'AGENTS.md');
}

function fromMcpEntry(alias: string, entry: AntigravityMcpEntry): McpServer {
  const transport: McpServer['transport'] = entry.httpUrl
    ? 'http'
    : entry.url
      ? 'sse'
      : 'stdio';
  return {
    alias,
    transport,
    command: entry.command,
    args: entry.args,
    env: entry.env,
    url: entry.httpUrl ?? entry.url,
    headers: entry.headers,
    enabled: entry.enabled,
  };
}

function toMcpEntry(server: McpServer): AntigravityMcpEntry {
  if (server.transport === 'stdio') {
    return pruneUndefined({
      command: server.command,
      args: server.args,
      env: server.env,
      enabled: server.enabled,
    } as Record<string, unknown>) as AntigravityMcpEntry;
  }
  if (server.transport === 'http') {
    return pruneUndefined({
      httpUrl: server.url,
      headers: server.headers,
      enabled: server.enabled,
    } as Record<string, unknown>) as AntigravityMcpEntry;
  }
  // sse
  return pruneUndefined({
    url: server.url,
    headers: server.headers,
    enabled: server.enabled,
  } as Record<string, unknown>) as AntigravityMcpEntry;
}

function settingsToView(raw: AntigravitySettingsRaw): HarnessSettings {
  let sandbox: string | undefined;
  const s = raw.tools?.sandbox;
  if (typeof s === 'string') sandbox = s;
  else if (typeof s === 'boolean') sandbox = s ? 'true' : 'false';
  return {
    model: raw.model?.name,
    approvalMode: raw.general?.defaultApprovalMode,
    sandbox,
  };
}

export const antigravityHarnessAdapter: HarnessAdapter = {
  cli: 'antigravity',

  async read(projectPath) {
    const sp = settingsPath(projectPath);
    const mcpp = mcpConfigPath(projectPath);
    const memp = memoryPath(projectPath);
    const raw = await readJsonOrEmpty<AntigravitySettingsRaw>(sp);
    const mcpRaw = await readJsonOrEmpty<AntigravityMcpConfigRaw>(mcpp);
    const memory = await readTextOrEmpty(memp);
    const settingsExists = await exists(sp);
    const mcpExists = await exists(mcpp);
    const memoryExists = await exists(memp);

    const mcp: McpServer[] = Object.entries(mcpRaw.mcpServers ?? {}).map(([alias, entry]) =>
      fromMcpEntry(alias, entry),
    );

    return {
      cli: 'antigravity',
      exists: settingsExists || mcpExists || memoryExists,
      filePaths: { settings: sp, memory: memp, mcp: mcpp },
      settings: settingsToView(raw),
      memory,
      mcp,
      warnings: [],
    };
  },

  async writeSettings(projectPath, patch) {
    const sp = settingsPath(projectPath);
    const existing = await readJsonOrEmpty<AntigravitySettingsRaw>(sp);

    const update: Partial<AntigravitySettingsRaw> = {};
    if (patch.model !== undefined) update.model = { ...(existing.model ?? {}), name: patch.model };
    if (patch.approvalMode !== undefined) {
      update.general = { ...(existing.general ?? {}), defaultApprovalMode: patch.approvalMode };
    }
    if (patch.sandbox !== undefined) {
      update.tools = { ...(existing.tools ?? {}), sandbox: patch.sandbox };
    }

    const merged = deepMerge(existing as Record<string, unknown>, update as Record<string, unknown>);
    await atomicWriteJson(sp, merged);
  },

  async writeMemory(projectPath, content) {
    await atomicWriteText(memoryPath(projectPath), content);
  },

  async upsertMcp(projectPath, server) {
    const mcpp = mcpConfigPath(projectPath);
    const existing = await readJsonOrEmpty<AntigravityMcpConfigRaw>(mcpp);
    const servers = { ...(existing.mcpServers ?? {}) };
    servers[server.alias] = toMcpEntry(server);
    const next = { ...existing, mcpServers: servers };
    await atomicWriteJson(mcpp, next);
  },

  async removeMcp(projectPath, alias) {
    const mcpp = mcpConfigPath(projectPath);
    const existing = await readJsonOrEmpty<AntigravityMcpConfigRaw>(mcpp);
    if (!existing.mcpServers?.[alias]) return;
    const servers = { ...existing.mcpServers };
    delete servers[alias];
    const next = { ...existing, mcpServers: servers };
    await atomicWriteJson(mcpp, next);
  },
};
