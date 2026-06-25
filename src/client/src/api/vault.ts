import { get, post, put, del } from './client';

export type VaultFileKind = 'md' | 'html' | 'pdf';

export interface VaultFile {
  relativePath: string;
  stem: string;
  title: string;
  tags: string[];
  wikilinks: string[];
  size: number;
  mtime: string;
  bodyPreview: string;
  kind: VaultFileKind;
}

export interface VaultEdge {
  from: string;
  to: string;
}

export interface VaultGraph {
  files: VaultFile[];
  edges: VaultEdge[];
}

export type VaultInjectMode = 'none' | 'all' | 'selected' | 'auto';

export function getVaultFiles(projectId: string): Promise<{ files: VaultFile[] }> {
  return get(`/api/projects/${projectId}/vault/files`);
}

export function getVaultGraph(projectId: string): Promise<VaultGraph> {
  return get(`/api/projects/${projectId}/vault/graph`);
}

export function getVaultFileContent(projectId: string, filePath: string): Promise<{ path: string; content: string }> {
  return get(`/api/projects/${projectId}/vault/file?path=${encodeURIComponent(filePath)}`);
}

export function saveVaultFile(projectId: string, filePath: string, content: string): Promise<{ success: boolean }> {
  return put(`/api/projects/${projectId}/vault/file`, { path: filePath, content });
}

export function createVaultFile(projectId: string, filePath: string, content?: string): Promise<{ success: boolean }> {
  return post(`/api/projects/${projectId}/vault/file`, { path: filePath, content: content ?? '' });
}

export function deleteVaultFileApi(projectId: string, filePath: string): Promise<{ success: boolean }> {
  return del(`/api/projects/${projectId}/vault/file?path=${encodeURIComponent(filePath)}`);
}

export function renameVaultFileApi(projectId: string, oldPath: string, newPath: string): Promise<{ success: boolean }> {
  return post(`/api/projects/${projectId}/vault/rename`, { oldPath, newPath });
}

export function previewVaultInjection(
  projectId: string,
  mode: 'all' | 'selected',
  filePaths?: string[],
): Promise<{ block: string; fileCount: number; charCount: number }> {
  return post(`/api/projects/${projectId}/vault/preview`, { mode, filePaths });
}

export function searchVaultFiles(projectId: string, query: string): Promise<{ files: VaultFile[] }> {
  return get(`/api/projects/${projectId}/vault/search?q=${encodeURIComponent(query)}`);
}

export function getVaultIgnore(projectId: string): Promise<{ content: string }> {
  return get(`/api/projects/${projectId}/vault/ignore`);
}

export function saveVaultIgnore(projectId: string, content: string): Promise<{ success: boolean }> {
  return put(`/api/projects/${projectId}/vault/ignore`, { content });
}

// Append an anchored exact-path pattern for `relPath` to `.vaultignore`.
// Leading '/' anchors to the project root (exact path, no same-name over-match);
// directories get a trailing '/'. No-op if the pattern is already present.
export async function addPathToVaultIgnore(
  projectId: string, relPath: string, isDir: boolean,
): Promise<void> {
  const { content } = await getVaultIgnore(projectId);
  const pattern = '/' + relPath.replace(/^\/+/, '') + (isDir ? '/' : '');
  const lines = content.split(/\r?\n/).map((l) => l.trim());
  if (lines.includes(pattern)) return;
  const sep = content.length === 0 || content.endsWith('\n') ? '' : '\n';
  await saveVaultIgnore(projectId, content + sep + pattern + '\n');
}

// Inverse of addPathToVaultIgnore. Server-side because just dropping the
// exact pattern line isn't enough under a broad pattern like `*` (the
// onboarding "ignore everything" default) — gitignore semantics need a
// negation chain through every ancestor directory, which the server
// generates and verifies with the same `ignore` package the scanner uses.
export async function removePathFromVaultIgnore(
  projectId: string, relPath: string, isDir: boolean,
): Promise<void> {
  await post(`/api/projects/${projectId}/vault/ignore/unhide`, { path: relPath, isDir });
}
