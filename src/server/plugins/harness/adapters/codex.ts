import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import TOML from '@iarna/toml';
import {
  safeJoin,
  exists,
  listSubdirectories,
  readJsonOrEmpty,
  readTextOrEmpty,
  atomicWriteText,
  deepMerge,
  pruneUndefined,
} from '../io.js';
import { readSkills, writeSkill, toggleSkill, writeHooksBlock, toggleParkedHook } from '../shared.js';
import type { HarnessAdapter, HarnessPlugin, HarnessSettings, HarnessSnapshot, McpServer } from '../types.js';

interface CodexConfigRaw {
  model?: string;
  approval_policy?: unknown;
  sandbox_mode?: string;
  mcp_servers?: Record<string, CodexMcpEntry>;
  plugins?: Record<string, { enabled?: boolean }>;
  [k: string]: unknown;
}

// Codex scans .agents/skills (shared with Antigravity).
const SKILLS_BASE = ['.agents', 'skills'];

// User-level Codex dir; honors CODEX_HOME like Codex does.
function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

// Project hooks: { description?, hooks: { Event: [entries] } } — same block
// shape as Claude's settings.json. Loaded only when the project is trusted.
function hooksPath(projectPath: string): string {
  return safeJoin(projectPath, '.codex', 'hooks.json');
}

function disabledHooksPath(projectPath: string): string {
  return safeJoin(projectPath, '.codex', 'hooks.disabled.json');
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

// Installed plugins are the [plugins."<name>@<marketplace>"] tables in the user
// config; the manifest sits in plugins/cache/<marketplace>/<name>/<version>/.
async function readPlugins(): Promise<HarnessPlugin[]> {
  const home = codexHome();
  const config = await readConfig(path.join(home, 'config.toml'));
  const plugins: HarnessPlugin[] = [];
  for (const [id, entry] of Object.entries(config.plugins ?? {})) {
    const [name, marketplace = ''] = id.split('@');
    const pluginDir = path.join(home, 'plugins', 'cache', marketplace, name);
    const version = (await listSubdirectories(pluginDir)).pop();
    const manifest = version
      ? await readJsonOrEmpty<{ description?: string }>(path.join(pluginDir, version, '.codex-plugin', 'plugin.json'))
      : {};
    plugins.push({ id, scope: 'user', version, description: manifest.description, enabled: entry?.enabled !== false });
  }
  return plugins;
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
    const hp = hooksPath(projectPath);
    const hooksFile = await readJsonOrEmpty<{ hooks?: Record<string, unknown> }>(hp);

    const snapshot: HarnessSnapshot = {
      cli: 'codex',
      exists: configExists || memoryExists,
      filePaths: { settings: cp, memory: memp, hooks: hp },
      settings: settingsToView(raw),
      memory,
      mcp,
      warnings,
      hooks: hooksFile.hooks,
      disabledHooks: await readJsonOrEmpty<Record<string, unknown>>(disabledHooksPath(projectPath)),
      skills: await readSkills(projectPath, SKILLS_BASE),
      plugins: await readPlugins(),
    };
    return snapshot;
  },

  async writeHooks(projectPath, hooks) {
    await writeHooksBlock(hooksPath(projectPath), hooks);
  },

  async toggleHook(projectPath, event, index, enabled) {
    await toggleParkedHook(hooksPath(projectPath), disabledHooksPath(projectPath), event, index, enabled);
  },

  async writeSkill(projectPath, name, content) {
    await writeSkill(projectPath, SKILLS_BASE, name, content);
  },

  async toggleSkill(projectPath, name, enabled) {
    await toggleSkill(projectPath, SKILLS_BASE, name, enabled);
  },

  async togglePlugin(_projectPath, id, enabled) {
    // Codex reads plugin state only from the user config (project layers and
    // -c overrides are ignored), so this is a user-wide switch. Edit the one
    // line in place instead of re-serializing the user's whole config.toml.
    const file = path.join(codexHome(), 'config.toml');
    const text = await readTextOrEmpty(file);
    const header = `[plugins."${id}"]`;
    const start = text.indexOf(header);
    if (start === -1) throw new Error(`${header} not found in ${file}`);
    const bodyStart = start + header.length;
    const nextHeader = text.slice(bodyStart).search(/^[ \t]*\[/m);
    const bodyEnd = nextHeader === -1 ? text.length : bodyStart + nextHeader;
    const body = text.slice(bodyStart, bodyEnd);
    const nextBody = /^[ \t]*enabled[ \t]*=/m.test(body)
      ? body.replace(/^([ \t]*enabled[ \t]*=[ \t]*)\S+/m, `$1${enabled}`)
      : `\nenabled = ${enabled}${body}`;
    await atomicWriteText(file, text.slice(0, bodyStart) + nextBody + text.slice(bodyEnd));
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
