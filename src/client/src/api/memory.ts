import { get, post, put, del } from './client';
import type {
  MemoryNode,
  MemoryEdge,
  MemoryGraph,
  MemoryRelationType,
  MemoryInjectMode,
  MemoryBacklink,
  MemoryWikilinkResolution,
} from '../types';

export function getMemoryGraph(projectId: string): Promise<MemoryGraph> {
  return get(`/api/projects/${projectId}/memory/graph`);
}

export function getMemoryNodes(projectId: string): Promise<MemoryNode[]> {
  return get(`/api/projects/${projectId}/memory/nodes`);
}

export function createMemoryNode(
  projectId: string,
  data: { title: string; body?: string; tags?: string[]; pinned?: boolean },
): Promise<MemoryNode> {
  return post(`/api/projects/${projectId}/memory/nodes`, data);
}

export function updateMemoryNode(
  nodeId: string,
  data: { title?: string; body?: string; tags?: string[] | null; pinned?: boolean },
): Promise<MemoryNode> {
  return put(`/api/memory/nodes/${nodeId}`, data);
}

export function updateMemoryNodePosition(nodeId: string, x: number, y: number): Promise<void> {
  return put(`/api/memory/nodes/${nodeId}/position`, { position_x: x, position_y: y });
}

export function deleteMemoryNode(nodeId: string): Promise<void> {
  return del(`/api/memory/nodes/${nodeId}`);
}

export function createMemoryEdge(
  projectId: string,
  data: { from_node_id: string; to_node_id: string; relation_type?: MemoryRelationType; label?: string | null },
): Promise<MemoryEdge> {
  return post(`/api/projects/${projectId}/memory/edges`, data);
}

export function updateMemoryEdge(
  edgeId: string,
  data: { relation_type?: MemoryRelationType; label?: string | null },
): Promise<MemoryEdge> {
  return put(`/api/memory/edges/${edgeId}`, data);
}

export function deleteMemoryEdge(edgeId: string): Promise<void> {
  return del(`/api/memory/edges/${edgeId}`);
}

export function previewMemoryInjection(
  projectId: string,
  mode: MemoryInjectMode,
  nodeIds: string[] = [],
): Promise<{ prompt: string; nodeCount: number; edgeCount: number }> {
  return post(`/api/projects/${projectId}/memory/preview`, { mode, nodeIds });
}

export function getMemoryBacklinks(nodeId: string): Promise<MemoryBacklink[]> {
  return get(`/api/memory/nodes/${nodeId}/backlinks`);
}

export function insertMemoryWikilink(
  sourceNodeId: string,
  data: { targetNodeId?: string; targetTitle?: string },
): Promise<MemoryNode> {
  return post(`/api/memory/nodes/${sourceNodeId}/insert-link`, data);
}

export function resolveMemoryWikilinks(
  projectId: string,
  data: { body?: string; titles?: string[] },
): Promise<MemoryWikilinkResolution[]> {
  return post(`/api/projects/${projectId}/memory/wikilinks/resolve`, data);
}

export function parseMemoryNodeIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function ingestMemory(
  projectId: string,
  data: { source_text?: string; source_type?: string; source_id?: string; locale?: string },
): Promise<{ created: number; updated: number; edgesAdded: number; nodeIds: string[] }> {
  return post(`/api/projects/${projectId}/memory/ingest`, data);
}

export async function getMemoryNodeRaw(nodeId: string): Promise<string> {
  const res = await fetch(`/api/memory/nodes/${nodeId}/raw`, { credentials: 'include' });
  if (!res.ok) {
    let msg = `Failed to load raw source (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.text();
}

export interface RawFileEntry {
  source_type: string;
  filename: string;
  relative_path: string;
  size: number;
  mtime: string;
  derived_node_ids: string[];
}

export function getProjectRawFiles(projectId: string): Promise<{ files: RawFileEntry[] }> {
  return get(`/api/projects/${projectId}/memory/raw-files`);
}

export async function getRawFileByPath(projectId: string, relativePath: string): Promise<string> {
  const url = `/api/projects/${projectId}/memory/raw-files/content?path=${encodeURIComponent(relativePath)}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    let msg = `Failed to load raw file (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.text();
}

export function openRawFileExternal(
  projectId: string,
  relativePath: string,
  mode: 'open' | 'reveal' = 'open',
): Promise<{ ok: boolean }> {
  return post(`/api/projects/${projectId}/memory/raw-files/open`, { path: relativePath, mode });
}

export function lintMemory(
  projectId: string,
): Promise<{ issues: { type: string; node_titles: string[]; message: string }[] }> {
  return post(`/api/projects/${projectId}/memory/lint`, {});
}

export function parseMemoryTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
