import { get, put, del } from './client';
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
