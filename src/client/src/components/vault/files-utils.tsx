import {
  FileText, FileImage, FileCode, FileVideo, FileAudio,
  Folder, FolderOpen,
} from 'lucide-react';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { python } from '@codemirror/lang-python';
import type { Extension } from '@uiw/react-codemirror';
import type { FileEntry } from '../../api/files';

export const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.php',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.sql', '.xml', '.svg', '.csv', '.tsv', '.env', '.lock', '.gitignore', '.dockerignore',
  '.editorconfig', '.prettierrc', '.eslintrc',
]);
export const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp']);
export const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov']);
export const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.flac']);
export const PDF_EXT = new Set(['.pdf']);
export const MARKDOWN_EXT = new Set(['.md', '.markdown']);
export const HTML_EXT = new Set(['.html', '.htm']);

export function languageExtensionFor(ext: string): Extension[] {
  if (MARKDOWN_EXT.has(ext)) return [markdown()];
  if (HTML_EXT.has(ext)) return [html()];
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return [javascript()];
  if (ext === '.ts' || ext === '.tsx') return [javascript({ typescript: true, jsx: ext === '.tsx' })];
  if (ext === '.json') return [json()];
  if (ext === '.css' || ext === '.scss' || ext === '.sass' || ext === '.less') return [css()];
  if (ext === '.py') return [python()];
  return [];
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

export function formatSize(n: number | null): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function iconFor(entry: FileEntry, expanded: boolean) {
  if (entry.type === 'directory') {
    return expanded
      ? <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
      : <Folder className="w-4 h-4 text-amber-500 shrink-0" />;
  }
  const ext = extOf(entry.name);
  if (IMAGE_EXT.has(ext)) return <FileImage className="w-4 h-4 text-purple-500 shrink-0" />;
  if (VIDEO_EXT.has(ext)) return <FileVideo className="w-4 h-4 text-pink-500 shrink-0" />;
  if (AUDIO_EXT.has(ext)) return <FileAudio className="w-4 h-4 text-pink-400 shrink-0" />;
  if (TEXT_EXT.has(ext)) return <FileCode className="w-4 h-4 text-sky-500 shrink-0" />;
  return <FileText className="w-4 h-4 text-warm-400 shrink-0" />;
}

export function entryFromPath(path: string): FileEntry {
  const name = path.split('/').pop() || path;
  return { name, type: 'file', size: null, mtime: null, hidden: false };
}
