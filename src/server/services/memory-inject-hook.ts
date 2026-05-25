import { buildMemoryBlock, buildRawFileBlock, type MemoryInjectMode } from './memory-injector.js';
import { selectRelevantNodes } from './memory-retriever.js';
import { buildVaultBlock, type VaultInjectMode } from './vault-injector.js';
import { selectRelevantFiles } from './vault-retriever.js';

export interface MemoryInjectionContext {
  projectId: string;
  mode: MemoryInjectMode;
  nodeIds: string[];
  /** Raw markdown source files (relative paths under .clitrigger/raw) to inject verbatim. */
  rawFilePaths?: string[];
  /** Vault file paths (project-relative .md files) for file-based injection. */
  vaultFilePaths?: string[];
  /** Project root absolute path — required when rawFilePaths or vaultFilePaths is non-empty. */
  projectRoot?: string;
  /** Required for mode='auto' — task title + description, agent prompt, etc. */
  query?: string;
  log: (type: string, message: string) => void;
}

export async function applyMemoryInjection(ctx: MemoryInjectionContext): Promise<string | null> {
  const vaultPaths = (ctx.vaultFilePaths ?? []).filter(Boolean);
  const hasVault = vaultPaths.length > 0 || ctx.mode !== 'none';
  const hasProjectRoot = !!ctx.projectRoot;

  // Vault-based injection (new path): if vaultFilePaths is set or no nodeIds exist, use file-based
  if (hasProjectRoot && (vaultPaths.length > 0 || (ctx.nodeIds.length === 0 && ctx.mode !== 'none'))) {
    return applyVaultInjection(ctx, vaultPaths);
  }

  // Legacy node-based injection (old path): falls through when nodeIds are present
  return applyLegacyInjection(ctx);
}

async function applyVaultInjection(ctx: MemoryInjectionContext, vaultPaths: string[]): Promise<string | null> {
  if (ctx.mode === 'none') return null;
  if (!ctx.projectRoot) return null;

  let effectiveMode: VaultInjectMode = ctx.mode;
  let effectivePaths: string[] = vaultPaths;

  if (ctx.mode === 'auto') {
    const query = (ctx.query || '').trim();
    if (!query) {
      ctx.log('output', `[vault] inject mode='auto' but no query provided — skipped`);
      return null;
    }
    ctx.log('output', `[vault] inject mode='auto' — running retrieval...`);
    const res = await selectRelevantFiles(ctx.projectId, ctx.projectRoot, query);
    if (res.selectedPaths.length === 0) {
      const reason = res.reason ?? 'unknown';
      ctx.log('output', `[vault] auto retrieval picked 0 files (${reason}, ${res.candidateCount} candidate(s)) — skipped`);
      return null;
    }
    ctx.log('output', `[vault] auto retrieval picked ${res.selectedPaths.length}/${res.candidateCount} candidate file(s)`);
    effectiveMode = 'selected';
    effectivePaths = res.selectedPaths;
  }

  const result = buildVaultBlock({
    projectRoot: ctx.projectRoot,
    mode: effectiveMode,
    filePaths: effectivePaths,
  });

  if (!result) {
    ctx.log('output', `[vault] inject mode '${ctx.mode}' produced no files — skipped`);
    return null;
  }

  ctx.log('output', `[vault] injected ${result.fileCount} file(s), mode=${ctx.mode}`);
  return result.block;
}

async function applyLegacyInjection(ctx: MemoryInjectionContext): Promise<string | null> {
  const rawPaths = (ctx.rawFilePaths ?? []).filter(Boolean);
  const hasRaw = rawPaths.length > 0 && !!ctx.projectRoot;

  if (ctx.mode === 'none' && !hasRaw) return null;

  let nodeBlock: string | null = null;
  let nodeCount = 0;
  let edgeCount = 0;

  if (ctx.mode !== 'none') {
    let effectiveMode: MemoryInjectMode = ctx.mode;
    let effectiveIds: string[] = ctx.nodeIds;

    if (ctx.mode === 'auto') {
      const query = (ctx.query || '').trim();
      if (!query) {
        ctx.log('output', `[memory] inject mode='auto' but no query provided — skipped`);
      } else {
        ctx.log('output', `[memory] inject mode='auto' — running retrieval...`);
        const res = await selectRelevantNodes(ctx.projectId, query);
        if (res.selectedIds.length === 0) {
          const reason = res.reason ?? 'unknown';
          ctx.log('output', `[memory] auto retrieval picked 0 nodes (${reason}, ${res.candidateCount} candidate(s)) — skipped`);
          effectiveMode = 'none';
        } else {
          ctx.log('output', `[memory] auto retrieval picked ${res.selectedIds.length}/${res.candidateCount} candidate node(s)`);
          effectiveMode = 'selected';
          effectiveIds = res.selectedIds;
        }
      }
    }

    if (effectiveMode !== 'none') {
      const result = buildMemoryBlock({
        projectId: ctx.projectId,
        mode: effectiveMode,
        nodeIds: effectiveIds,
      });
      if (result) {
        nodeBlock = result.block;
        nodeCount = result.nodeCount;
        edgeCount = result.edgeCount;
      } else {
        ctx.log('output', `[memory] inject mode '${ctx.mode}' produced no nodes — skipped`);
      }
    }
  }

  let rawBlock: string | null = null;
  let rawFileCount = 0;
  let rawSkipped = 0;
  if (hasRaw) {
    const result = buildRawFileBlock(ctx.projectRoot!, rawPaths);
    if (result && result.fileCount > 0) {
      rawBlock = result.block;
      rawFileCount = result.fileCount;
      rawSkipped = result.skipped.length;
      for (const s of result.skipped) {
        ctx.log('output', `[memory] raw file skipped (${s.reason}): ${s.path}`);
      }
    } else if (result) {
      rawSkipped = result.skipped.length;
      for (const s of result.skipped) {
        ctx.log('output', `[memory] raw file skipped (${s.reason}): ${s.path}`);
      }
    }
  }

  if (!nodeBlock && !rawBlock) return null;

  const segments: string[] = [];
  if (nodeBlock) segments.push(nodeBlock);
  if (rawBlock) segments.push(rawBlock);

  const parts: string[] = [];
  if (nodeBlock) {
    parts.push(`${nodeCount} node(s)`);
    if (edgeCount > 0) parts.push(`${edgeCount} relation(s)`);
  }
  if (rawBlock) {
    parts.push(`${rawFileCount} raw file(s)`);
    if (rawSkipped > 0) parts.push(`${rawSkipped} skipped`);
  }
  ctx.log('output', `[memory] injected ${parts.join(', ')}, mode=${ctx.mode}`);

  return segments.join('\n\n');
}
