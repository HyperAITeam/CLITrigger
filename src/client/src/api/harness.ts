import { get, post, put, del } from './client';
import type { CliId, HarnessSettings, HarnessSnapshot, McpServer } from '../plugins/harness/types';

export type HarnessSnapshotMap = Record<CliId, HarnessSnapshot>;

export function getAllSnapshots(projectId: string): Promise<HarnessSnapshotMap> {
  return get(`/api/harness/${projectId}`);
}

export function getSnapshot(projectId: string, cli: CliId): Promise<HarnessSnapshot> {
  return get(`/api/harness/${projectId}/${cli}`);
}

export function updateSettings(
  projectId: string,
  cli: CliId,
  patch: HarnessSettings,
): Promise<HarnessSnapshot> {
  return put(`/api/harness/${projectId}/${cli}/settings`, patch);
}

export function updateMemory(
  projectId: string,
  cli: CliId,
  content: string,
): Promise<{ ok: true }> {
  return put(`/api/harness/${projectId}/${cli}/memory`, { content });
}

export function updateLocalMemory(
  projectId: string,
  cli: CliId,
  content: string,
): Promise<{ ok: true }> {
  return put(`/api/harness/${projectId}/${cli}/local-memory`, { content });
}

// Replace the hooks block in the CLI's settings file. Pass null to remove it.
export function updateHooks(
  projectId: string,
  cli: CliId,
  hooks: Record<string, unknown> | null,
): Promise<HarnessSnapshot> {
  return put(`/api/harness/${projectId}/${cli}/hooks`, { hooks });
}

// Move hooks[event][index] to .claude/hooks.disabled.json (enabled=false) or
// disabledHooks[event][index] back into settings.json (enabled=true).
export function toggleHook(
  projectId: string,
  cli: CliId,
  event: string,
  index: number,
  enabled: boolean,
): Promise<HarnessSnapshot> {
  return post(`/api/harness/${projectId}/${cli}/hooks/toggle`, { event, index, enabled });
}

export function toggleSkill(
  projectId: string,
  cli: CliId,
  name: string,
  enabled: boolean,
): Promise<HarnessSnapshot> {
  return post(`/api/harness/${projectId}/${cli}/skills/${encodeURIComponent(name)}/toggle`, { enabled });
}

export function updateSkill(
  projectId: string,
  cli: CliId,
  name: string,
  content: string,
): Promise<HarnessSnapshot> {
  return put(`/api/harness/${projectId}/${cli}/skills/${encodeURIComponent(name)}`, { content });
}

// Inline CLAUDE.md + skills into the target CLI's AGENTS.md (antigravity/codex).
export function portFromClaude(projectId: string, cli: CliId): Promise<HarnessSnapshot> {
  return post(`/api/harness/${projectId}/${cli}/port-from-claude`);
}

export function upsertMcp(
  projectId: string,
  cli: CliId,
  server: McpServer,
): Promise<McpServer[]> {
  return put(`/api/harness/${projectId}/${cli}/mcp/${encodeURIComponent(server.alias)}`, server);
}

export function removeMcp(
  projectId: string,
  cli: CliId,
  alias: string,
): Promise<McpServer[]> {
  return del(`/api/harness/${projectId}/${cli}/mcp/${encodeURIComponent(alias)}`);
}
