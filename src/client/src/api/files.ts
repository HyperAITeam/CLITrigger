import { get } from './client';

export interface FileEntry {
  name: string;
  type: 'directory' | 'file' | 'symlink' | 'other';
  size: number | null;
  mtime: number | null;
  hidden: boolean;
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
