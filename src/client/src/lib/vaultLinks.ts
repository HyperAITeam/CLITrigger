import type { VaultEdge } from '../api/vault';

// Transitive closure of outgoing wikilink edges reachable from `start`,
// excluding `start` itself. Cycle-safe via the seen set. Used to optionally
// include a document's linked docs when sending it to a terminal/task.
export function collectLinkedPaths(edges: VaultEdge[], start: string): string[] {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.from) ?? [];
    list.push(e.to);
    adj.set(e.from, list);
  }
  const seen = new Set([start]);
  const queue = [start];
  const out: string[] = [];
  while (queue.length) {
    for (const to of adj.get(queue.shift()!) ?? []) {
      if (seen.has(to)) continue;
      seen.add(to);
      out.push(to);
      queue.push(to);
    }
  }
  return out;
}
