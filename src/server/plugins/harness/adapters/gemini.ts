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

interface GeminiSettingsRaw {
  model?: { name?: string;[k: string]: unknown };
  general?: { defaultApprovalMode?: string;[k: string]: unknown };
  tools?: { sandbox?: string | boolean;[k: string]: unknown };
  mcpServers?: Record<string, GeminiMcpEntry>;
  [k: string]: unknown;
}

interface GeminiMcpEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  httpUrl?: string;
  url?: string;
  headers?: Record<string, string>;
  trust?: boolean;
  enabled?: boolean;
}

function settingsPath(projectPath: string): string {
  return safeJoin(projectPath, '.gemini', 'settings.json');
}

function memoryPath(projectPath: string): string {
  return safeJoin(projectPath, 'GEMINI.md');
}

function fromMcpEntry(alias: string, entry: GeminiMcpEntry): McpServer {
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

function toMcpEntry(server: McpServer): GeminiMcpEntry {
  if (server.transport === 'stdio') {
    return pruneUndefined({
      command: server.command,
      args: server.args,
      env: server.env,
      enabled: server.enabled,
    } as Record<string, unknown>) as GeminiMcpEntry;
  }
  if (server.transport === 'http') {
    return pruneUndefined({
      httpUrl: server.url,
      headers: server.headers,
      enabled: server.enabled,
    } as Record<string, unknown>) as GeminiMcpEntry;
  }
  // sse
  return pruneUndefined({
    url: server.url,
    headers: server.headers,
    enabled: server.enabled,
  } as Record<string, unknown>) as GeminiMcpEntry;
}

function settingsToView(raw: GeminiSettingsRaw): HarnessSettings {
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

export const geminiHarnessAdapter: HarnessAdapter = {
  cli: 'gemini',

  async read(projectPath) {
    const sp = settingsPath(projectPath);
    const memp = memoryPath(projectPath);
    const raw = await readJsonOrEmpty<GeminiSettingsRaw>(sp);
    const memory = await readTextOrEmpty(memp);
    const settingsExists = await exists(sp);
    const memoryExists = await exists(memp);

    const mcp: McpServer[] = Object.entries(raw.mcpServers ?? {}).map(([alias, entry]) =>
      fromMcpEntry(alias, entry),
    );

    return {
      cli: 'gemini',
      exists: settingsExists || memoryExists,
      filePaths: { settings: sp, memory: memp },
      settings: settingsToView(raw),
      memory,
      mcp,
      warnings: [],
    };
  },

  async writeSettings(projectPath, patch) {
    const sp = settingsPath(projectPath);
    const existing = await readJsonOrEmpty<GeminiSettingsRaw>(sp);

    const update: Partial<GeminiSettingsRaw> = {};
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
    const sp = settingsPath(projectPath);
    const existing = await readJsonOrEmpty<GeminiSettingsRaw>(sp);
    const servers = { ...(existing.mcpServers ?? {}) };
    servers[server.alias] = toMcpEntry(server);
    const next = { ...existing, mcpServers: servers };
    await atomicWriteJson(sp, next);
  },

  async removeMcp(projectPath, alias) {
    const sp = settingsPath(projectPath);
    const existing = await readJsonOrEmpty<GeminiSettingsRaw>(sp);
    if (!existing.mcpServers?.[alias]) return;
    const servers = { ...existing.mcpServers };
    delete servers[alias];
    const next = { ...existing, mcpServers: servers };
    await atomicWriteJson(sp, next);
  },
};
