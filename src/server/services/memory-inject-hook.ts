import { buildMemoryBlock, type MemoryInjectMode } from './memory-injector.js';

export interface MemoryInjectionContext {
  projectId: string;
  mode: MemoryInjectMode;
  nodeIds: string[];
  log: (type: string, message: string) => void;
}

export function applyMemoryInjection(ctx: MemoryInjectionContext): string | null {
  if (ctx.mode === 'none') return null;
  const result = buildMemoryBlock({
    projectId: ctx.projectId,
    mode: ctx.mode,
    nodeIds: ctx.nodeIds,
  });
  if (!result) {
    ctx.log('output', `[memory] inject mode '${ctx.mode}' produced no nodes — skipped`);
    return null;
  }
  ctx.log('output', `[memory] injected ${result.nodeCount} node(s)${result.edgeCount > 0 ? `, ${result.edgeCount} relation(s)` : ''}, mode=${ctx.mode}`);
  return result.block;
}
