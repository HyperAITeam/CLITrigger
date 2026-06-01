import { get, post, put } from './client';

export interface FileEntry {
  name: string;
  type: 'directory' | 'file' | 'symlink' | 'other';
  size: number | null;
  mtime: number | null;
  hidden: boolean;
  // True only when hidden by a `.vaultignore` pattern (not dotfiles/defaults),
  // so the context menu can offer "unhide" instead of "hide".
  ignored?: boolean;
}

export interface ListFilesResult {
  path: string;
  root: string;
  entries: FileEntry[];
}

export interface TextFileContent {
  path: string;
  size: number;
  mtime: number;
  binary: false;
  content: string;
}

export interface BinaryFileMeta {
  path: string;
  size: number;
  mtime: number;
  binary: true;
  mime: string;
}

export type FileContent = TextFileContent | BinaryFileMeta;

export function listFiles(projectId: string, path: string = '', showHidden = false): Promise<ListFilesResult> {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  if (showHidden) params.set('showHidden', '1');
  const qs = params.toString();
  return get(`/api/projects/${projectId}/files${qs ? `?${qs}` : ''}`);
}

export function getFileContent(projectId: string, path: string): Promise<FileContent> {
  return get(`/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`);
}

export function getBinaryFileUrl(projectId: string, path: string): string {
  return `/api/projects/${projectId}/files/binary?path=${encodeURIComponent(path)}`;
}

export function openFile(
  projectId: string,
  path: string,
  mode: 'open' | 'reveal',
): Promise<{ ok: true }> {
  return post(`/api/projects/${projectId}/files/open`, { path, mode });
}

// Move/rename a file or directory. `to` is the full new project-relative path.
export function moveFile(
  projectId: string,
  from: string,
  to: string,
): Promise<{ success: boolean; from: string; to: string }> {
  return post(`/api/projects/${projectId}/files/move`, { from, to });
}

export interface SaveFileResult {
  path: string;
  size: number;
  mtime: number;
}

export function saveFileContent(
  projectId: string,
  path: string,
  content: string,
  mtime: number,
): Promise<SaveFileResult> {
  return put(`/api/projects/${projectId}/files/content`, { path, content, mtime });
}
