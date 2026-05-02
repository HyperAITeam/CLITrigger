import { buildMemoryBlock, type MemoryInjectMode } from './memory-injector.js';
import { selectRelevantNodes } from './memory-retriever.js';

export interface MemoryInjectionContext {
  projectId: string;
  mode: MemoryInjectMode;
  nodeIds: string[];
  /** Required for mode='auto' — task title + description, agent prompt, etc. */
  query?: string;
  log: (type: string, message: string) => void;
}

export async function applyMemoryInjection(ctx: MemoryInjectionContext): Promise<string | null> {
  if (ctx.mode === 'none') return null;

  let effectiveMode: MemoryInjectMode = ctx.mode;
  let effectiveIds: string[] = ctx.nodeIds;

  if (ctx.mode === 'auto') {
    const query = (ctx.query || '').trim();
    if (!query) {
      ctx.log('output', `[memory] inject mode='auto' but no query provided — skipped`);
      return null;
    }
    ctx.log('output', `[memory] inject mode='auto' — running retrieval...`);
    const res = await selectRelevantNodes(ctx.projectId, query);
    if (res.selectedIds.length === 0) {
      const reason = res.reason ?? 'unknown';
      ctx.log('output', `[memory] auto retrieval picked 0 nodes (${reason}, ${res.candidateCount} candidate(s)) — skipped`);
      return null;
    }
    ctx.log('output', `[memory] auto retrieval picked ${res.selectedIds.length}/${res.candidateCount} candidate node(s)`);
    effectiveMode = 'selected';
    effectiveIds = res.selectedIds;
  }

  const result = buildMemoryBlock({
    projectId: ctx.projectId,
    mode: effectiveMode,
    nodeIds: effectiveIds,
  });
  if (!result) {
    ctx.log('output', `[memory] inject mode '${ctx.mode}' produced no nodes — skipped`);
    return null;
  }
  ctx.log('output', `[memory] injected ${result.nodeCount} node(s)${result.edgeCount > 0 ? `, ${result.edgeCount} relation(s)` : ''}, mode=${ctx.mode}`);
  return result.block;
}
