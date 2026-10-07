import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import TOML from '@iarna/toml';
import { claudeHarnessAdapter } from '../adapters/claude.js';
import { antigravityHarnessAdapter } from '../adapters/antigravity.js';
import { codexHarnessAdapter } from '../adapters/codex.js';
import { safeJoin, deepMerge, HarnessPathError } from '../io.js';

async function makeTempProject(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'harness-test-'));
}

async function rmrf(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true });
}

describe('harness/io', () => {
  it('safeJoin allows paths inside the project root', () => {
    const root = process.cwd();
    expect(() => safeJoin(root, '.claude', 'settings.json')).not.toThrow();
  });

  it('safeJoin rejects path traversal', () => {
    const root = process.cwd();
    expect(() => safeJoin(root, '..', 'etc', 'passwd')).toThrow(HarnessPathError);
  });

  it('deepMerge preserves nested untouched siblings', () => {
    const existing = {
      permissions: { allow: ['Bash(npm *)'], deny: ['Bash(rm *)'] },
      hooks: { PreToolUse: [{ matcher: 'Bash' }] },
      model: 'old',
    };
    const merged = deepMerge(existing as Record<string, unknown>, { model: 'new' });
    expect(merged.model).toBe('new');
    expect(merged.permissions).toEqual({ allow: ['Bash(npm *)'], deny: ['Bash(rm *)'] });
    expect(merged.hooks).toEqual({ PreToolUse: [{ matcher: 'Bash' }] });
  });

  it('deepMerge merges nested objects rather than replacing them', () => {
    const existing = { permissions: { allow: ['A'], deny: ['B'] } };
    const merged = deepMerge(existing as Record<string, unknown>, {
      permissions: { defaultMode: 'auto' } as Record<string, unknown>,
    });
    expect(merged.permissions).toEqual({ allow: ['A'], deny: ['B'], defaultMode: 'auto' });
  });
});

describe('claudeHarnessAdapter', () => {
  let dir: string;
  beforeEach(async () => { dir = await makeTempProject(); });
  afterEach(async () => { await rmrf(dir); });

  it('returns empty snapshot for a fresh project', async () => {
    const snap = await claudeHarnessAdapter.read(dir);
    expect(snap.cli).toBe('claude');
    expect(snap.exists).toBe(false);
    expect(snap.settings.model).toBeUndefined();
    expect(snap.memory).toBe('');
    expect(snap.mcp).toEqual([]);
  });

  it('writes settings without losing pre-existing fields', async () => {
    const settingsPath = path.join(dir, '.claude', 'settings.json');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        permissions: { allow: ['Bash(npm *)'], deny: ['Bash(rm *)'] },
        hooks: { PreToolUse: [{ matcher: 'Bash' }] },
      }),
    );

    await claudeHarnessAdapter.writeSettings(dir, { model: 'claude-sonnet-4-6' });

    const raw = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    expect(raw.model).toBe('claude-sonnet-4-6');
    expect(raw.permissions).toEqual({ allow: ['Bash(npm *)'], deny: ['Bash(rm *)'] });
    expect(raw.hooks).toEqual({ PreToolUse: [{ matcher: 'Bash' }] });
  });

  it('persists approvalMode under permissions.defaultMode without clobbering allow/deny', async () => {
    const settingsPath = path.join(dir, '.claude', 'settings.json');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify({ permissions: { allow: ['Read(./)'] } }));

    await claudeHarnessAdapter.writeSettings(dir, { approvalMode: 'auto' });
    const raw = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    expect(raw.permissions).toEqual({ allow: ['Read(./)'], defaultMode: 'auto' });
  });

  it('upserts and removes MCP servers in .mcp.json', async () => {
    await claudeHarnessAdapter.upsertMcp(dir, {
      alias: 'memory',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    });

    let snap = await claudeHarnessAdapter.read(dir);
    expect(snap.mcp).toHaveLength(1);
    expect(snap.mcp[0].alias).toBe('memory');
    expect(snap.mcp[0].command).toBe('npx');

    await claudeHarnessAdapter.removeMcp(dir, 'memory');
    snap = await claudeHarnessAdapter.read(dir);
    expect(snap.mcp).toHaveLength(0);
  });

  it('writes CLAUDE.md memory file', async () => {
    await claudeHarnessAdapter.writeMemory(dir, '# Project notes\n');
    const memory = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(memory).toBe('# Project notes\n');
    const snap = await claudeHarnessAdapter.read(dir);
    expect(snap.memory).toBe('# Project notes\n');
  });

  it('toggles a hook entry between settings.json and hooks.disabled.json', async () => {
    const a = { hooks: [{ type: 'command', command: 'a' }] };
    const b = { matcher: 'Bash', hooks: [{ type: 'command', command: 'b' }] };
    await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
    await fs.writeFile(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ model: 'm', hooks: { Stop: [a, b] } }));

    await claudeHarnessAdapter.toggleHook!(dir, 'Stop', 0, false);
    let snap = await claudeHarnessAdapter.read(dir);
    expect(snap.hooks).toEqual({ Stop: [b] });
    expect(snap.disabledHooks).toEqual({ Stop: [a] });
    expect(snap.settings.model).toBe('m');

    await claudeHarnessAdapter.toggleHook!(dir, 'Stop', 0, false);
    snap = await claudeHarnessAdapter.read(dir);
    expect(snap.hooks).toBeUndefined();
    expect(snap.disabledHooks).toEqual({ Stop: [a, b] });

    await claudeHarnessAdapter.toggleHook!(dir, 'Stop', 1, true);
    await claudeHarnessAdapter.toggleHook!(dir, 'Stop', 0, true);
    snap = await claudeHarnessAdapter.read(dir);
    expect(snap.hooks).toEqual({ Stop: [b, a] });
    expect(snap.disabledHooks).toEqual({});
    expect(await fs.stat(path.join(dir, '.claude', 'hooks.disabled.json')).catch(() => null)).toBeNull();
  });

  it('toggles a skill by renaming SKILL.md and keeps edits on the parked file', async () => {
    const skillDir = path.join(dir, '.claude', 'skills', 'demo');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\ndescription: Demo\n---\nbody\n');

    await claudeHarnessAdapter.toggleSkill!(dir, 'demo', false);
    let snap = await claudeHarnessAdapter.read(dir);
    expect(snap.skills).toEqual([expect.objectContaining({ name: 'demo', enabled: false, description: 'Demo' })]);

    await claudeHarnessAdapter.writeSkill!(dir, 'demo', 'edited');
    expect(await fs.readFile(path.join(skillDir, 'SKILL.md.disabled'), 'utf8')).toBe('edited');
    expect(await fs.stat(path.join(skillDir, 'SKILL.md')).catch(() => null)).toBeNull();

    await claudeHarnessAdapter.toggleSkill!(dir, 'demo', true);
    snap = await claudeHarnessAdapter.read(dir);
    expect(snap.skills?.[0]).toMatchObject({ enabled: true, content: 'edited' });
  });
});

describe('antigravityHarnessAdapter', () => {
  let dir: string;
  beforeEach(async () => { dir = await makeTempProject(); });
  afterEach(async () => { await rmrf(dir); });

  it('round-trips model under model.name', async () => {
    await antigravityHarnessAdapter.writeSettings(dir, { model: 'antigravity-default' });
    const snap = await antigravityHarnessAdapter.read(dir);
    expect(snap.settings.model).toBe('antigravity-default');
  });

  it('keeps existing nested groups when patching a sibling', async () => {
    const sp = path.join(dir, '.agents', 'settings.json');
    await fs.mkdir(path.dirname(sp), { recursive: true });
    await fs.writeFile(
      sp,
      JSON.stringify({ ui: { theme: 'GitHub' }, tools: { sandbox: 'docker' } }),
    );

    await antigravityHarnessAdapter.writeSettings(dir, { model: 'antigravity-default' });
    const raw = JSON.parse(await fs.readFile(sp, 'utf8'));
    expect(raw.ui).toEqual({ theme: 'GitHub' });
    expect(raw.tools).toEqual({ sandbox: 'docker' });
    expect(raw.model).toEqual({ name: 'antigravity-default' });
  });

  it('writes MCP servers to a dedicated mcp_config.json', async () => {
    await antigravityHarnessAdapter.upsertMcp(dir, {
      alias: 'fetcher',
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer x' },
    });

    const raw = JSON.parse(await fs.readFile(path.join(dir, '.agents', 'mcp_config.json'), 'utf8'));
    expect(raw.mcpServers.fetcher.httpUrl).toBe('https://example.com/mcp');
    expect(raw.mcpServers.fetcher.headers).toEqual({ Authorization: 'Bearer x' });
  });
});

describe('codexHarnessAdapter', () => {
  let dir: string;
  beforeEach(async () => { dir = await makeTempProject(); });
  afterEach(async () => { await rmrf(dir); });

  it('round-trips top-level scalar fields through TOML', async () => {
    await codexHarnessAdapter.writeSettings(dir, {
      model: 'gpt-5',
      sandbox: 'workspace-write',
      approvalMode: 'on-request',
    });

    const text = await fs.readFile(path.join(dir, '.codex', 'config.toml'), 'utf8');
    const parsed = TOML.parse(text);
    expect(parsed.model).toBe('gpt-5');
    expect(parsed.sandbox_mode).toBe('workspace-write');
    expect(parsed.approval_policy).toBe('on-request');

    const snap = await codexHarnessAdapter.read(dir);
    expect(snap.settings.model).toBe('gpt-5');
    expect(snap.settings.sandbox).toBe('workspace-write');
    expect(snap.settings.approvalMode).toBe('on-request');
  });

  it('persists MCP servers as TOML tables under mcp_servers', async () => {
    await codexHarnessAdapter.upsertMcp(dir, {
      alias: 'memory',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      env: { DEBUG: '1' },
    });

    const text = await fs.readFile(path.join(dir, '.codex', 'config.toml'), 'utf8');
    const parsed = TOML.parse(text) as { mcp_servers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }> };
    expect(parsed.mcp_servers?.memory?.command).toBe('npx');
    expect(parsed.mcp_servers?.memory?.args).toEqual(['-y', '@modelcontextprotocol/server-memory']);
    expect(parsed.mcp_servers?.memory?.env).toEqual({ DEBUG: '1' });
  });

  it('removes MCP servers cleanly', async () => {
    await codexHarnessAdapter.upsertMcp(dir, {
      alias: 'a', transport: 'stdio', command: 'echo',
    });
    await codexHarnessAdapter.upsertMcp(dir, {
      alias: 'b', transport: 'stdio', command: 'echo',
    });
    await codexHarnessAdapter.removeMcp(dir, 'a');

    const snap = await codexHarnessAdapter.read(dir);
    expect(snap.mcp.map((s) => s.alias)).toEqual(['b']);
  });
});
