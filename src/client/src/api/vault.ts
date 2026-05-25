import { get, post, put, del } from './client';

export interface VaultFile {
  relativePath: string;
  stem: string;
  title: string;
  tags: string[];
  wikilinks: string[];
  size: number;
  mtime: string;
  bodyPreview: string;
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
