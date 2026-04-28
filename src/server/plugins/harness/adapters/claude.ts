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

interface ClaudeSettingsRaw {
  model?: string;
  permissions?: { defaultMode?: string;[k: string]: unknown };
  [k: string]: unknown;
}

interface ClaudeMcpEntry {
  type?: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface ClaudeMcpFile {
  mcpServers?: Record<string, ClaudeMcpEntry>;
  [k: string]: unknown;
}

function settingsPath(projectPath: string): string {
  return safeJoin(projectPath, '.claude', 'settings.json');
}

function mcpPath(projectPath: string): string {
  return safeJoin(projectPath, '.mcp.json');
}

function memoryPath(projectPath: string): string {
  return safeJoin(projectPath, 'CLAUDE.md');
}

function fromMcpEntry(alias: string, entry: ClaudeMcpEntry): McpServer {
  const transport = entry.type ?? (entry.url ? 'http' : 'stdio');
  return {
    alias,
    transport: transport === 'sse' ? 'sse' : transport === 'http' ? 'http' : 'stdio',
    command: entry.command,
    args: entry.args,
    env: entry.env,
    url: entry.url,
    headers: entry.headers,
  };
}

function toMcpEntry(server: McpServer): ClaudeMcpEntry {
  if (server.transport === 'stdio') {
    return pruneUndefined({
      type: 'stdio',
      command: server.command,
      args: server.args,
      env: server.env,
    } as Record<string, unknown>) as ClaudeMcpEntry;
  }
  return pruneUndefined({
    type: server.transport,
    url: server.url,
    headers: server.headers,
  } as Record<string, unknown>) as ClaudeMcpEntry;
}

export const claudeHarnessAdapter: HarnessAdapter = {
  cli: 'claude',

  async read(projectPath) {
    const sp = settingsPath(projectPath);
    const mp = mcpPath(projectPath);
    const memp = memoryPath(projectPath);

    const settingsRaw = await readJsonOrEmpty<ClaudeSettingsRaw>(sp);
    const mcpFile = await readJsonOrEmpty<ClaudeMcpFile>(mp);
    const memory = await readTextOrEmpty(memp);

    const settings: HarnessSettings = {
      model: settingsRaw.model,
      approvalMode: settingsRaw.permissions?.defaultMode,
    };

    const mcp: McpServer[] = Object.entries(mcpFile.mcpServers ?? {}).map(([alias, entry]) =>
      fromMcpEntry(alias, entry),
    );

    const settingsExists = await exists(sp);
    const memoryExists = await exists(memp);
    const mcpExists = await exists(mp);

    const snapshot: HarnessSnapshot = {
      cli: 'claude',
      exists: settingsExists || memoryExists || mcpExists,
      filePaths: { settings: sp, memory: memp, mcp: mp },
      settings,
      memory,
      mcp,
      warnings: [],
    };
    return snapshot;
  },

  async writeSettings(projectPath, patch) {
    const sp = settingsPath(projectPath);
    const existing = await readJsonOrEmpty<ClaudeSettingsRaw>(sp);

    const update: Partial<ClaudeSettingsRaw> = {};
    if (patch.model !== undefined) update.model = patch.model;
    if (patch.approvalMode !== undefined) {
      update.permissions = { ...(existing.permissions ?? {}), defaultMode: patch.approvalMode };
    }

    const merged = deepMerge(existing as Record<string, unknown>, update as Record<string, unknown>);
    await atomicWriteJson(sp, merged);
  },

  async writeMemory(projectPath, content) {
    await atomicWriteText(memoryPath(projectPath), content);
  },

  async upsertMcp(projectPath, server) {
    const mp = mcpPath(projectPath);
    const file = await readJsonOrEmpty<ClaudeMcpFile>(mp);
    const servers = { ...(file.mcpServers ?? {}) };
    servers[server.alias] = toMcpEntry(server);
    await atomicWriteJson(mp, { ...file, mcpServers: servers });
  },

  async removeMcp(projectPath, alias) {
    const mp = mcpPath(projectPath);
    const file = await readJsonOrEmpty<ClaudeMcpFile>(mp);
    if (!file.mcpServers?.[alias]) return;
    const servers = { ...file.mcpServers };
    delete servers[alias];
    await atomicWriteJson(mp, { ...file, mcpServers: servers });
  },
};
