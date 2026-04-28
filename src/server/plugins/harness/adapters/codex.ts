import { promises as fs } from 'fs';
import path from 'path';
import TOML from '@iarna/toml';
import {
  safeJoin,
  exists,
  readTextOrEmpty,
  atomicWriteText,
  deepMerge,
  pruneUndefined,
} from '../io.js';
import type { HarnessAdapter, HarnessSettings, HarnessSnapshot, McpServer } from '../types.js';

interface CodexConfigRaw {
  model?: string;
  approval_policy?: unknown;
  sandbox_mode?: string;
  mcp_servers?: Record<string, CodexMcpEntry>;
  [k: string]: unknown;
}

interface CodexMcpEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  http_headers?: Record<string, string>;
  enabled?: boolean;
}

function configPath(projectPath: string): string {
  return safeJoin(projectPath, '.codex', 'config.toml');
}

function memoryPath(projectPath: string): string {
  return safeJoin(projectPath, 'AGENTS.md');
}

async function readConfig(filePath: string): Promise<CodexConfigRaw> {
  const text = await readTextOrEmpty(filePath);
  if (!text.trim()) return {};
  try {
    return TOML.parse(text) as CodexConfigRaw;
  } catch {
    return {};
  }
}

async function writeConfig(filePath: string, obj: CodexConfigRaw): Promise<void> {
  const cleaned = pruneUndefined(obj as unknown as Record<string, unknown>);
  const text = TOML.stringify(cleaned as TOML.JsonMap);
  await atomicWriteText(filePath, text);
}

function fromMcpEntry(alias: string, entry: CodexMcpEntry): McpServer {
  const transport: McpServer['transport'] = entry.url ? 'http' : 'stdio';
  return {
    alias,
    transport,
    command: entry.command,
    args: entry.args,
    env: entry.env,
    url: entry.url,
    headers: entry.http_headers,
    enabled: entry.enabled,
  };
}

function toMcpEntry(server: McpServer): CodexMcpEntry {
  if (server.transport === 'stdio') {
    return pruneUndefined({
      command: server.command,
      args: server.args,
      env: server.env,
      enabled: server.enabled,
    } as Record<string, unknown>) as CodexMcpEntry;
  }
  return pruneUndefined({
    url: server.url,
    http_headers: server.headers,
    enabled: server.enabled,
  } as Record<string, unknown>) as CodexMcpEntry;
}

function settingsToView(raw: CodexConfigRaw): HarnessSettings {
  const approval =
    typeof raw.approval_policy === 'string' ? raw.approval_policy : undefined;
  return {
    model: raw.model,
    approvalMode: approval,
    sandbox: raw.sandbox_mode,
  };
}

async function trustLevelWarning(projectPath: string): Promise<string[]> {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) return [];
  const userConfig = path.join(home, '.codex', 'config.toml');
  try {
    const text = await fs.readFile(userConfig, 'utf8');
    const parsed = TOML.parse(text) as { projects?: Record<string, { trust_level?: string }> };
    const abs = path.resolve(projectPath);
    const entry = parsed.projects?.[abs];
    if (entry?.trust_level === 'trusted') return [];
  } catch {
    // file missing or unparseable
  }
  return ['codex.trustLevelMissing'];
}

export const codexHarnessAdapter: HarnessAdapter = {
  cli: 'codex',

  async read(projectPath) {
    const cp = configPath(projectPath);
    const memp = memoryPath(projectPath);
    const raw = await readConfig(cp);
    const memory = await readTextOrEmpty(memp);
    const configExists = await exists(cp);
    const memoryExists = await exists(memp);

    const mcp: McpServer[] = Object.entries(raw.mcp_servers ?? {}).map(([alias, entry]) =>
      fromMcpEntry(alias, entry),
    );

    const warnings = await trustLevelWarning(projectPath);

    const snapshot: HarnessSnapshot = {
      cli: 'codex',
      exists: configExists || memoryExists,
      filePaths: { settings: cp, memory: memp },
      settings: settingsToView(raw),
      memory,
      mcp,
      warnings,
    };
    return snapshot;
  },

  async writeSettings(projectPath, patch) {
    const cp = configPath(projectPath);
    const existing = await readConfig(cp);

    const update: Partial<CodexConfigRaw> = {};
    if (patch.model !== undefined) update.model = patch.model;
    if (patch.approvalMode !== undefined) update.approval_policy = patch.approvalMode;
    if (patch.sandbox !== undefined) update.sandbox_mode = patch.sandbox;

    const merged = deepMerge(
      existing as Record<string, unknown>,
      update as Record<string, unknown>,
    ) as CodexConfigRaw;
    await writeConfig(cp, merged);
  },

  async writeMemory(projectPath, content) {
    await atomicWriteText(memoryPath(projectPath), content);
  },

  async upsertMcp(projectPath, server) {
    const cp = configPath(projectPath);
    const existing = await readConfig(cp);
    const servers = { ...(existing.mcp_servers ?? {}) };
    servers[server.alias] = toMcpEntry(server);
    await writeConfig(cp, { ...existing, mcp_servers: servers });
  },

  async removeMcp(projectPath, alias) {
    const cp = configPath(projectPath);
    const existing = await readConfig(cp);
    if (!existing.mcp_servers?.[alias]) return;
    const servers = { ...existing.mcp_servers };
    delete servers[alias];
    await writeConfig(cp, { ...existing, mcp_servers: servers });
  },
};
