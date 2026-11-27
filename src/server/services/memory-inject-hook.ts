import type { Project } from '../db/queries.js';
import { buildVaultBlock, type VaultInjectMode } from './vault-injector.js';
import { selectRelevantFiles } from './vault-retriever.js';

export type MemoryInjectMode = 'none' | 'all' | 'selected' | 'auto';

export interface MemoryInjectionContext {
  project: Project;
  mode: MemoryInjectMode;
  /** Vault file paths (project-relative, `@alias/...` for linked folders) injected when mode='selected'. */
  vaultFilePaths: string[];
  /** Required for mode='auto' — task title + description, agent prompt, etc. */
  query?: string;
  log: (type: string, message: string) => void;
}

/** Parses the JSON array stored in the `memory_raw_file_paths` columns. */
export function parseRawFilePaths(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function applyMemoryInjection(ctx: MemoryInjectionContext): Promise<string | null> {
  if (ctx.mode === 'none' || !ctx.project.path) return null;

  let effectiveMode: VaultInjectMode = ctx.mode;
  let effectivePaths = ctx.vaultFilePaths.filter(Boolean);

  if (ctx.mode === 'auto') {
    const query = (ctx.query || '').trim();
    if (!query) {
      ctx.log('output', `[vault] inject mode='auto' but no query provided — skipped`);
      return null;
    }
    ctx.log('output', `[vault] inject mode='auto' — running retrieval...`);
    const res = await selectRelevantFiles(ctx.project, query);
    if (res.selectedPaths.length === 0) {
      const reason = res.reason ?? 'unknown';
      ctx.log('output', `[vault] auto retrieval picked 0 files (${reason}, ${res.candidateCount} candidate(s)) — skipped`);
      return null;
    }
    ctx.log('output', `[vault] auto retrieval picked ${res.selectedPaths.length}/${res.candidateCount} candidate file(s)`);
    effectiveMode = 'selected';
    effectivePaths = res.selectedPaths;
  }

  const result = await buildVaultBlock({
    project: ctx.project,
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
