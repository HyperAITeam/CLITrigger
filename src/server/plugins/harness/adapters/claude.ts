import os from 'os';
import path from 'path';
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
import { readSkills, writeSkill, toggleSkill, writeHooksBlock, toggleParkedHook } from '../shared.js';
import type { HarnessAdapter, HarnessPlugin, HarnessSettings, HarnessSnapshot, McpServer } from '../types.js';

interface ClaudeSettingsRaw {
  model?: string;
  permissions?: { defaultMode?: string;[k: string]: unknown };
  hooks?: Record<string, unknown>;
  enabledPlugins?: Record<string, boolean>;
  [k: string]: unknown;
}

// One install record in ~/.claude/plugins/installed_plugins.json (version 2).
interface InstalledPluginEntry {
  scope?: string;
  projectPath?: string;
  installPath?: string;
  version?: string;
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

function localSettingsPath(projectPath: string): string {
  return safeJoin(projectPath, '.claude', 'settings.local.json');
}

// User-level Claude config dir; honors CLAUDE_CONFIG_DIR like Claude Code does.
function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function mcpPath(projectPath: string): string {
  return safeJoin(projectPath, '.mcp.json');
}

function memoryPath(projectPath: string): string {
  return safeJoin(projectPath, 'CLAUDE.md');
}

function localMemoryPath(projectPath: string): string {
  return safeJoin(projectPath, 'CLAUDE.local.md');
}

const SKILLS_BASE = ['.claude', 'skills'];

// Disabled hooks are parked here (same shape as the settings.json hooks
// block). Kept outside settings.json so Claude never sees them and the
// settings schema stays untouched.
function disabledHooksPath(projectPath: string): string {
  return safeJoin(projectPath, '.claude', 'hooks.disabled.json');
}

function samePath(a: string, b: string): boolean {
  const normalize = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return normalize(a) === normalize(b);
}

// Plugins Claude would load in this project: user-scope installs plus
// project/local installs recorded for this exact path. Enabled state follows
// Claude's precedence: settings.local.json > settings.json > user settings.
async function readPlugins(projectPath: string, projectEnabled: Record<string, boolean> | undefined): Promise<HarnessPlugin[]> {
  const configDir = claudeConfigDir();
  const installed = await readJsonOrEmpty<{ plugins?: Record<string, InstalledPluginEntry[]> }>(
    path.join(configDir, 'plugins', 'installed_plugins.json'),
  );
  const userEnabled = (await readJsonOrEmpty<ClaudeSettingsRaw>(path.join(configDir, 'settings.json'))).enabledPlugins ?? {};
  const localEnabled = (await readJsonOrEmpty<ClaudeSettingsRaw>(localSettingsPath(projectPath))).enabledPlugins ?? {};

  const plugins: HarnessPlugin[] = [];
  for (const [id, entries] of Object.entries(installed.plugins ?? {})) {
    if (!Array.isArray(entries)) continue;
    const entry =
      entries.find((e) => e.scope !== 'user' && e.projectPath && samePath(e.projectPath, projectPath)) ??
      entries.find((e) => e.scope === 'user');
    if (!entry) continue;
    const manifest = entry.installPath
      ? await readJsonOrEmpty<{ description?: string }>(path.join(entry.installPath, '.claude-plugin', 'plugin.json'))
      : {};
    plugins.push({
      id,
      scope: entry.scope ?? 'user',
      version: entry.version,
      description: manifest.description,
      enabled: localEnabled[id] ?? projectEnabled?.[id] ?? userEnabled[id] ?? false,
    });
  }
  return plugins;
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
    const localMemp = localMemoryPath(projectPath);

    const settingsRaw = await readJsonOrEmpty<ClaudeSettingsRaw>(sp);
    const mcpFile = await readJsonOrEmpty<ClaudeMcpFile>(mp);
    const memory = await readTextOrEmpty(memp);
    const localMemory = await readTextOrEmpty(localMemp);
    const skills = await readSkills(projectPath, SKILLS_BASE);
    const disabledHooks = await readJsonOrEmpty<Record<string, unknown>>(disabledHooksPath(projectPath));
    const plugins = await readPlugins(projectPath, settingsRaw.enabledPlugins);

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
    const localMemoryExists = await exists(localMemp);

    const snapshot: HarnessSnapshot = {
      cli: 'claude',
      exists: settingsExists || memoryExists || mcpExists,
      filePaths: { settings: sp, memory: memp, mcp: mp, localMemory: localMemp, hooks: sp },
      settings,
      memory,
      mcp,
      warnings: [],
      localMemory,
      localMemoryExists,
      hooks: settingsRaw.hooks,
      disabledHooks,
      skills,
      plugins,
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

  async writeLocalMemory(projectPath, content) {
    await atomicWriteText(localMemoryPath(projectPath), content);
  },

  async writeHooks(projectPath, hooks) {
    await writeHooksBlock(settingsPath(projectPath), hooks);
  },

  async writeSkill(projectPath, name, content) {
    await writeSkill(projectPath, SKILLS_BASE, name, content);
  },

  async toggleHook(projectPath, event, index, enabled) {
    await toggleParkedHook(settingsPath(projectPath), disabledHooksPath(projectPath), event, index, enabled);
  },

  async toggleSkill(projectPath, name, enabled) {
    await toggleSkill(projectPath, SKILLS_BASE, name, enabled);
  },

  async togglePlugin(projectPath, id, enabled) {
    // A settings.local.json entry overrides settings.json, so update it where
    // it already lives; otherwise record the per-project override in settings.json.
    const localPath = localSettingsPath(projectPath);
    const local = await readJsonOrEmpty<ClaudeSettingsRaw>(localPath);
    const target = local.enabledPlugins?.[id] !== undefined ? localPath : settingsPath(projectPath);
    const file = target === localPath ? local : await readJsonOrEmpty<ClaudeSettingsRaw>(target);
    await atomicWriteJson(target, { ...file, enabledPlugins: { ...(file.enabledPlugins ?? {}), [id]: enabled } });
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
