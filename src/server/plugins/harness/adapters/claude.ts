import { promises as fs } from 'fs';
import {
  safeJoin,
  exists,
  listSubdirectories,
  readJsonOrEmpty,
  readTextOrEmpty,
  atomicWriteJson,
  atomicWriteText,
  deepMerge,
  pruneUndefined,
} from '../io.js';
import type { HarnessAdapter, HarnessSettings, HarnessSkill, HarnessSnapshot, McpServer } from '../types.js';

interface ClaudeSettingsRaw {
  model?: string;
  permissions?: { defaultMode?: string;[k: string]: unknown };
  hooks?: Record<string, unknown>;
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

function localMemoryPath(projectPath: string): string {
  return safeJoin(projectPath, 'CLAUDE.local.md');
}

function skillsDir(projectPath: string): string {
  return safeJoin(projectPath, '.claude', 'skills');
}

function skillPath(projectPath: string, name: string): string {
  // safeJoin rejects names that escape the skills directory ("../" etc.).
  return safeJoin(projectPath, '.claude', 'skills', name, 'SKILL.md');
}

// Disabled hooks are parked here (same shape as the settings.json hooks
// block). Kept outside settings.json so Claude never sees them and the
// settings schema stays untouched.
function disabledHooksPath(projectPath: string): string {
  return safeJoin(projectPath, '.claude', 'hooks.disabled.json');
}

// Pull `description:` out of the SKILL.md frontmatter for list rendering.
// Best-effort: a missing/garbled frontmatter just yields no description.
function parseSkillDescription(content: string): string | undefined {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return undefined;
  const desc = fm[1].match(/^description:\s*(.+)$/m);
  return desc ? desc[1].trim() : undefined;
}

async function readSkills(projectPath: string): Promise<HarnessSkill[]> {
  const dir = skillsDir(projectPath);
  const names = await listSubdirectories(dir);
  const skills: HarnessSkill[] = [];
  for (const name of names) {
    // A disabled skill is SKILL.md renamed to SKILL.md.disabled — Claude only
    // discovers the exact filename, so the rename hides it.
    const active = skillPath(projectPath, name);
    let filePath = active;
    let content = await readTextOrEmpty(active);
    if (!content) {
      filePath = `${active}.disabled`;
      content = await readTextOrEmpty(filePath);
    }
    if (!content) continue;
    skills.push({
      name,
      description: parseSkillDescription(content),
      path: filePath,
      content,
      enabled: filePath === active,
    });
  }
  return skills;
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
    const skills = await readSkills(projectPath);
    const disabledHooks = await readJsonOrEmpty<Record<string, unknown>>(disabledHooksPath(projectPath));

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
      filePaths: { settings: sp, memory: memp, mcp: mp, localMemory: localMemp },
      settings,
      memory,
      mcp,
      warnings: [],
      localMemory,
      localMemoryExists,
      hooks: settingsRaw.hooks,
      disabledHooks,
      skills,
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
    const sp = settingsPath(projectPath);
    const existing = await readJsonOrEmpty<ClaudeSettingsRaw>(sp);
    // Replace the hooks block wholesale (a merge can't express deletions);
    // null removes the key entirely. The rest of settings.json is preserved.
    const next: ClaudeSettingsRaw = { ...existing };
    if (hooks === null) {
      delete next.hooks;
    } else {
      next.hooks = hooks;
    }
    await atomicWriteJson(sp, next);
  },

  async writeSkill(projectPath, name, content) {
    const active = skillPath(projectPath, name);
    // Editing a disabled skill must not silently re-enable it.
    const parked = `${active}.disabled`;
    const target = !(await exists(active)) && (await exists(parked)) ? parked : active;
    await atomicWriteText(target, content);
  },

  async toggleHook(projectPath, event, index, enabled) {
    const sp = settingsPath(projectPath);
    const dp = disabledHooksPath(projectPath);
    const settings = await readJsonOrEmpty<ClaudeSettingsRaw>(sp);
    const hooks: Record<string, unknown> = { ...(settings.hooks ?? {}) };
    const disabled = await readJsonOrEmpty<Record<string, unknown>>(dp);

    const [from, to] = enabled ? [disabled, hooks] : [hooks, disabled];
    const source = Array.isArray(from[event]) ? [...(from[event] as unknown[])] : [];
    const [entry] = source.splice(index, 1);
    // Stale index (UI out of date): no-op; the caller re-reads the snapshot.
    if (entry === undefined) return;
    if (source.length > 0) from[event] = source;
    else delete from[event];
    to[event] = [...(Array.isArray(to[event]) ? (to[event] as unknown[]) : []), entry];

    const next: ClaudeSettingsRaw = { ...settings };
    if (Object.keys(hooks).length > 0) next.hooks = hooks;
    else delete next.hooks;
    await atomicWriteJson(sp, next);
    if (Object.keys(disabled).length > 0) await atomicWriteJson(dp, disabled);
    else await fs.rm(dp, { force: true });
  },

  async toggleSkill(projectPath, name, enabled) {
    const active = skillPath(projectPath, name);
    const parked = `${active}.disabled`;
    const [from, to] = enabled ? [parked, active] : [active, parked];
    if (await exists(from)) await fs.rename(from, to);
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
