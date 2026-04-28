import * as queries from '../db/queries.js';
import type { MemoryNode, MemoryEdge } from '../db/queries.js';

export type MemoryInjectMode = 'none' | 'all' | 'selected';

export interface MemoryInjectionRequest {
  projectId: string;
  mode: MemoryInjectMode;
  nodeIds?: string[];
  includeEdges?: boolean;
}

export interface MemoryInjectionResult {
  block: string;
  nodeCount: number;
  edgeCount: number;
}

export function buildMemoryBlock(req: MemoryInjectionRequest): MemoryInjectionResult | null {
  if (req.mode === 'none') return null;

  let nodes: MemoryNode[];
  if (req.mode === 'all') {
    nodes = queries.getMemoryNodesByProjectId(req.projectId);
  } else {
    const ids = (req.nodeIds ?? []).filter(Boolean);
    if (ids.length === 0) return null;
    nodes = queries.getMemoryNodesByIds(ids).filter(n => n.project_id === req.projectId);
  }

  if (nodes.length === 0) return null;

  const edges = req.includeEdges !== false
    ? queries.getMemoryEdgesForNodes(nodes.map(n => n.id))
    : [];

  return {
    block: formatMemoryBlock(nodes, edges),
    nodeCount: nodes.length,
    edgeCount: edges.length,
  };
}

function formatMemoryBlock(nodes: MemoryNode[], edges: MemoryEdge[]): string {
  const lines: string[] = [];
  lines.push('<long_term_memory>');
  lines.push('You have access to the following long-term project memory. Treat each <memory_node> as authoritative reference material curated by the user. Apply it where relevant; you may quote IDs (e.g. "per memory_node:abc123") when explaining decisions, but do not echo entire bodies verbatim unless asked.');
  lines.push('');

  for (const n of nodes) {
    const titleAttr = escapeAttr(n.title);
    const tagsAttr = parseTagsList(n.tags);
    const tagsAttrStr = tagsAttr.length > 0 ? ` tags="${escapeAttr(tagsAttr.join(','))}"` : '';
    lines.push(`<memory_node id="${n.id}" title="${titleAttr}"${tagsAttrStr}>`);
    if (n.body) lines.push(n.body);
    lines.push('</memory_node>');
  }

  if (edges.length > 0) {
    lines.push('');
    lines.push('<memory_relations>');
    for (const e of edges) {
      const labelPart = e.label ? `: ${e.label}` : '';
      lines.push(`- ${e.from_node_id} --[${e.relation_type}${labelPart}]--> ${e.to_node_id}`);
    }
    lines.push('</memory_relations>');
  }

  lines.push('</long_term_memory>');
  return lines.join('\n');
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseTagsList(tagsJson: string | null): string[] {
  if (!tagsJson) return [];
  try {
    const parsed = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
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
