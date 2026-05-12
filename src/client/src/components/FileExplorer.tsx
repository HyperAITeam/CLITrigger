import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, ChevronRight, FileText, FileImage, FileCode, FileVideo, FileAudio,
  Folder, FolderOpen, Loader2, AlertCircle, RefreshCw, EyeOff, Eye, Copy, ExternalLink,
  Code2, Sparkles, Pencil, Save, X,
} from 'lucide-react';
import CodeMirror, { type Extension } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { useI18n } from '../i18n';
import { listFiles, getFileContent, getBinaryFileUrl, saveFileContent } from '../api/files';
import type { FileEntry } from '../api/files';
import { ApiError } from '../api/client';
import { useTheme } from '../hooks/useTheme';
import { useToast } from '../hooks/useToast';
import MarkdownContent from './MarkdownContent';
import ToastContainer from './Toast';

interface FileExplorerProps {
  projectId: string;
}

interface TreeNodeState {
  expanded: boolean;
  loading: boolean;
  error?: string;
  children?: FileEntry[];
}

const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs', '.php',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.sql', '.xml', '.svg', '.csv', '.tsv', '.env', '.lock', '.gitignore', '.dockerignore',
  '.editorconfig', '.prettierrc', '.eslintrc',
]);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.flac']);
const PDF_EXT = new Set(['.pdf']);
const MARKDOWN_EXT = new Set(['.md', '.markdown']);
const HTML_EXT = new Set(['.html', '.htm']);

function languageExtensionFor(ext: string): Extension[] {
  if (MARKDOWN_EXT.has(ext)) return [markdown()];
  if (HTML_EXT.has(ext)) return [html()];
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return [javascript()];
  if (ext === '.ts' || ext === '.tsx') return [javascript({ typescript: true, jsx: ext === '.tsx' })];
  if (ext === '.json') return [json()];
  if (ext === '.css' || ext === '.scss' || ext === '.sass' || ext === '.less') return [css()];
  if (ext === '.py') return [python()];
  return [];
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

function formatSize(n: number | null): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function iconFor(entry: FileEntry, expanded: boolean) {
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

// ---- Resizer (inline; mirrors GitStatusPanel pattern) ----

function Resizer({ onResize }: { onResize: (clientX: number) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={(e) => {
        e.preventDefault();
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        const onMove = (ev: MouseEvent) => onResize(ev.clientX);
        const onUp = () => {
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      }}
      className="w-1 mx-1 shrink-0 cursor-col-resize bg-warm-200/60 hover:bg-accent transition-colors rounded"
    />
  );
}

// ---- Tree row ----

function TreeRow({
  entry,
  depth,
  state,
  fullPath,
  selectedPath,
  onToggle,
  onSelect,
}: {
  entry: FileEntry;
  depth: number;
  state?: TreeNodeState;
  fullPath: string;
  selectedPath: string | null;
  onToggle: (path: string, entry: FileEntry) => void;
  onSelect: (path: string, entry: FileEntry) => void;
}) {
  const isDir = entry.type === 'directory';
  const expanded = state?.expanded ?? false;
  const isSelected = selectedPath === fullPath;

  return (
    <button
      type="button"
      onClick={() => {
        if (isDir) onToggle(fullPath, entry);
        else onSelect(fullPath, entry);
      }}
      onDoubleClick={() => { if (isDir) onSelect(fullPath, entry); }}
      className={`w-full flex items-center gap-1.5 py-0.5 px-1 text-xs text-left rounded transition-colors ${
        isSelected ? 'bg-accent/15 text-warm-800' : 'hover:bg-warm-100 text-warm-700'
      }`}
      style={{ paddingLeft: 4 + depth * 12 }}
      title={entry.name}
    >
      {isDir ? (
        expanded
          ? <ChevronDown className="w-3 h-3 shrink-0 text-warm-400" />
          : <ChevronRight className="w-3 h-3 shrink-0 text-warm-400" />
      ) : <span className="w-3 h-3 shrink-0" />}
      {iconFor(entry, expanded)}
      <span className={`truncate ${entry.hidden ? 'opacity-60 italic' : ''}`}>{entry.name}</span>
    </button>
  );
}

// ---- Tree (recursive lazy load) ----

function TreeBranch({
  projectId,
  parentPath,
  entries,
  depth,
  nodeStates,
  setNodeStates,
  showHidden,
  selectedPath,
  onSelect,
}: {
  projectId: string;
  parentPath: string;
  entries: FileEntry[];
  depth: number;
  nodeStates: Map<string, TreeNodeState>;
  setNodeStates: React.Dispatch<React.SetStateAction<Map<string, TreeNodeState>>>;
  showHidden: boolean;
  selectedPath: string | null;
  onSelect: (path: string, entry: FileEntry) => void;
}) {
  const toggle = useCallback(async (full: string, entry: FileEntry) => {
    const prev = nodeStates.get(full);
    if (prev?.expanded) {
      setNodeStates((m) => {
        const n = new Map(m);
        n.set(full, { ...prev, expanded: false });
        return n;
      });
      return;
    }
    if (prev?.children) {
      setNodeStates((m) => {
        const n = new Map(m);
        n.set(full, { ...prev, expanded: true });
        return n;
      });
      return;
    }
    setNodeStates((m) => {
      const n = new Map(m);
      n.set(full, { expanded: true, loading: true });
      return n;
    });
    try {
      const res = await listFiles(projectId, full, showHidden);
      setNodeStates((m) => {
        const n = new Map(m);
        n.set(full, { expanded: true, loading: false, children: res.entries });
        return n;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed';
      setNodeStates((m) => {
        const n = new Map(m);
        n.set(full, { expanded: true, loading: false, error: msg });
        return n;
      });
    }
  }, [nodeStates, projectId, setNodeStates, showHidden]);

  return (
    <>
      {entries.map((entry) => {
        const full = parentPath ? `${parentPath}/${entry.name}` : entry.name;
        const state = nodeStates.get(full);
        return (
          <div key={full}>
            <TreeRow
              entry={entry}
              depth={depth}
              state={state}
              fullPath={full}
              selectedPath={selectedPath}
              onToggle={toggle}
              onSelect={onSelect}
            />
            {entry.type === 'directory' && state?.expanded && (
              <>
                {state.loading && (
                  <div className="flex items-center gap-1 text-xs text-warm-400 py-0.5" style={{ paddingLeft: 8 + (depth + 1) * 12 }}>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>loading…</span>
                  </div>
                )}
                {state.error && (
                  <div className="flex items-center gap-1 text-xs text-red-500 py-0.5" style={{ paddingLeft: 8 + (depth + 1) * 12 }}>
                    <AlertCircle className="w-3 h-3" /> {state.error}
                  </div>
                )}
                {state.children && (
                  <TreeBranch
                    projectId={projectId}
                    parentPath={full}
                    entries={state.children}
                    depth={depth + 1}
                    nodeStates={nodeStates}
                    setNodeStates={setNodeStates}
                    showHidden={showHidden}
                    selectedPath={selectedPath}
                    onSelect={onSelect}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

// ---- Preview panel ----

function PreviewPanel({
  projectId,
  path,
  entry,
  onDirtyChange,
}: {
  projectId: string;
  path: string | null;
  entry: FileEntry | null;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { toasts, success: toastSuccess, error: toastError, dismiss: dismissToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [binaryMime, setBinaryMime] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ size: number; mtime: number } | null>(null);
  const [viewMode, setViewMode] = useState<'rendered' | 'source'>('rendered');
  const [editMode, setEditMode] = useState(false);
  const [editorValue, setEditorValue] = useState('');
  const [savedValue, setSavedValue] = useState('');
  const [savedMtime, setSavedMtime] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = editMode && editorValue !== savedValue;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!path || !entry || entry.type !== 'file') {
      setTextContent(null);
      setBinaryMime(null);
      setError(null);
      setMeta(null);
      setEditMode(false);
      setEditorValue('');
      setSavedValue('');
      setSavedMtime(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTextContent(null);
    setBinaryMime(null);
    setMeta(null);
    setViewMode('rendered');
    setEditMode(false);
    setEditorValue('');
    setSavedValue('');
    setSavedMtime(null);
    getFileContent(projectId, path)
      .then((res) => {
        if (cancelled) return;
        setMeta({ size: res.size, mtime: res.mtime });
        if (res.binary) {
          setBinaryMime(res.mime);
        } else {
          setTextContent(res.content);
          setEditorValue(res.content);
          setSavedValue(res.content);
          setSavedMtime(res.mtime);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 413) {
          setError(t('files.tooLarge'));
        } else {
          setError(err instanceof Error ? err.message : 'failed');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, entry, projectId, t]);

  const copyPath = () => {
    if (!path) return;
    navigator.clipboard.writeText(path).catch(() => { /* swallow */ });
  };

  if (!path || !entry) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-warm-400">
        {t('files.preview.empty')}
      </div>
    );
  }

  const ext = extOf(entry.name);
  const isImage = binaryMime?.startsWith('image/') || IMAGE_EXT.has(ext);
  const isPdf = binaryMime === 'application/pdf' || PDF_EXT.has(ext);
  const isVideo = binaryMime?.startsWith('video/') || VIDEO_EXT.has(ext);
  const isAudio = binaryMime?.startsWith('audio/') || AUDIO_EXT.has(ext);
  const isMarkdown = MARKDOWN_EXT.has(ext);
  const isHtml = HTML_EXT.has(ext);
  const canToggleView = (isMarkdown || isHtml) && textContent !== null;
  const editable = !loading && !error && textContent !== null && !binaryMime;

  const handleSave = useCallback(async () => {
    if (!path || savedMtime == null || saving) return;
    setSaving(true);
    try {
      const res = await saveFileContent(projectId, path, editorValue, savedMtime);
      setSavedValue(editorValue);
      setSavedMtime(res.mtime);
      setTextContent(editorValue);
      setMeta({ size: res.size, mtime: res.mtime });
      toastSuccess(t('files.editor.saved'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toastError(t('files.editor.conflict'));
      } else if (err instanceof Error) {
        toastError(`${t('files.editor.saveFailed')}: ${err.message}`);
      } else {
        toastError(t('files.editor.saveFailed'));
      }
    } finally {
      setSaving(false);
    }
  }, [path, savedMtime, editorValue, saving, projectId, toastSuccess, toastError, t]);

  const handleEnterEdit = useCallback(() => {
    if (!editable) return;
    if (isMarkdown || isHtml) setViewMode('source');
    setEditMode(true);
  }, [editable, isMarkdown, isHtml]);

  const handleCancelEdit = useCallback(() => {
    if (dirty && !window.confirm(t('files.editor.discardConfirm'))) return;
    setEditorValue(savedValue);
    setEditMode(false);
  }, [dirty, savedValue, t]);

  const onEditorKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      void handleSave();
    }
  }, [handleSave]);

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-warm-200 text-xs">
        {iconFor(entry, false)}
        <span className="truncate font-medium text-warm-800">{path}</span>
        <span className="text-warm-400 shrink-0">{formatSize(meta?.size ?? entry.size)}</span>
        {dirty && (
          <span className="text-amber-600 shrink-0 text-[10px] uppercase tracking-wide">
            • {t('files.editor.dirty')}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {editMode ? (
            <>
              <button
                onClick={handleSave}
                disabled={!dirty || saving}
                className="px-1.5 py-1 rounded text-warm-700 hover:bg-warm-100 disabled:opacity-40 disabled:hover:bg-transparent inline-flex items-center gap-1"
                title={t('files.editor.save')}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>{t('files.editor.save')}</span>
              </button>
              <button
                onClick={handleCancelEdit}
                disabled={saving}
                className="px-1.5 py-1 rounded text-warm-500 hover:bg-warm-100 hover:text-warm-700 disabled:opacity-40 inline-flex items-center gap-1"
                title={t('files.editor.cancel')}
              >
                <X className="w-3.5 h-3.5" />
                <span>{t('files.editor.cancel')}</span>
              </button>
            </>
          ) : (
            editable && (
              <button
                onClick={handleEnterEdit}
                className="px-1.5 py-1 rounded hover:bg-warm-100 text-warm-500 hover:text-warm-700 inline-flex items-center gap-1"
                title={t('files.editor.edit')}
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>{t('files.editor.edit')}</span>
              </button>
            )
          )}
          {!editMode && canToggleView && (
            <button
              onClick={() => setViewMode((m) => (m === 'rendered' ? 'source' : 'rendered'))}
              className="px-1.5 py-1 rounded hover:bg-warm-100 text-warm-500 hover:text-warm-700 inline-flex items-center gap-1"
              title={t('files.viewMode.toggleHint')}
            >
              {viewMode === 'rendered' ? (
                <>
                  <Code2 className="w-3.5 h-3.5" />
                  <span>{t('files.viewMode.source')}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{t('files.viewMode.rendered')}</span>
                </>
              )}
            </button>
          )}
          <button
            onClick={copyPath}
            className="p-1 rounded hover:bg-warm-100 text-warm-500 hover:text-warm-700"
            title={t('files.copyPath')}
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto bg-[var(--color-bg-page)]">
        {loading && (
          <div className="flex items-center justify-center gap-2 text-xs text-warm-500 py-8">
            <Loader2 className="w-4 h-4 animate-spin" /> {t('files.loading')}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-500 p-4">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}
        {!loading && !error && editMode && (
          <div className="h-full" onKeyDown={onEditorKeyDown}>
            <CodeMirror
              value={editorValue}
              onChange={setEditorValue}
              extensions={languageExtensionFor(ext)}
              theme={theme === 'dark' ? oneDark : 'light'}
              height="100%"
              className="h-full text-xs"
              basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
            />
          </div>
        )}
        {!loading && !error && !editMode && textContent !== null && isMarkdown && viewMode === 'rendered' && (
          <div className="p-4">
            <MarkdownContent content={textContent} />
          </div>
        )}
        {!loading && !error && !editMode && textContent !== null && isHtml && viewMode === 'rendered' && (
          <div className="flex flex-col h-full">
            <div className="px-3 py-1.5 text-xs text-warm-500 bg-warm-50 border-b border-warm-200 shrink-0">
              {t('files.html.sandboxNotice')}
            </div>
            <iframe
              srcDoc={textContent}
              sandbox=""
              title={entry.name}
              className="flex-1 w-full border-0 bg-white min-h-[60vh]"
            />
          </div>
        )}
        {!loading && !error && !editMode && textContent !== null && !(isMarkdown && viewMode === 'rendered') && !(isHtml && viewMode === 'rendered') && (
          <pre className="text-xs font-mono text-warm-800 whitespace-pre p-3 leading-relaxed">{textContent}</pre>
        )}
        {!loading && !error && binaryMime && isImage && (
          <div className="flex items-center justify-center p-4">
            <img
              src={getBinaryFileUrl(projectId, path)}
              alt={entry.name}
              className="max-w-full max-h-[80vh] object-contain"
            />
          </div>
        )}
        {!loading && !error && binaryMime && isPdf && (
          <iframe
            src={getBinaryFileUrl(projectId, path)}
            title={entry.name}
            className="w-full h-full min-h-[60vh] border-0"
          />
        )}
        {!loading && !error && binaryMime && isVideo && (
          <div className="flex items-center justify-center p-4">
            <video src={getBinaryFileUrl(projectId, path)} controls className="max-w-full max-h-[80vh]" />
          </div>
        )}
        {!loading && !error && binaryMime && isAudio && (
          <div className="p-4">
            <audio src={getBinaryFileUrl(projectId, path)} controls className="w-full" />
          </div>
        )}
        {!loading && !error && binaryMime && !isImage && !isPdf && !isVideo && !isAudio && (
          <div className="flex flex-col items-center justify-center gap-2 text-xs text-warm-500 py-8">
            <span>{t('files.binaryNotPreviewable')} ({binaryMime})</span>
            <a
              href={getBinaryFileUrl(projectId, path)}
              download={entry.name}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-warm-100 hover:bg-warm-200 text-warm-700"
            >
              <ExternalLink className="w-3 h-3" /> {t('files.download')}
            </a>
          </div>
        )}
      </div>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

// ---- Main component ----

export default function FileExplorer({ projectId }: FileExplorerProps) {
  const { t } = useI18n();
  const [rootEntries, setRootEntries] = useState<FileEntry[] | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [rootLoading, setRootLoading] = useState(false);
  const [nodeStates, setNodeStates] = useState<Map<string, TreeNodeState>>(new Map());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<FileEntry | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const lsKey = `fileExplorer:${projectId}`;
  const [paneWidth, setPaneWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(`${lsKey}:paneWidth`);
      if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 160 && n <= 800) return n;
      }
    } catch { /* ignore */ }
    return 280;
  });

  useEffect(() => {
    try { localStorage.setItem(`${lsKey}:paneWidth`, String(paneWidth)); } catch { /* ignore */ }
  }, [paneWidth, lsKey]);

  const containerRef = useRef<HTMLDivElement>(null);
  const previewDirtyRef = useRef(false);
  const handleDirtyChange = useCallback((dirty: boolean) => {
    previewDirtyRef.current = dirty;
  }, []);

  const loadRoot = useCallback(async () => {
    setRootLoading(true);
    setRootError(null);
    try {
      const res = await listFiles(projectId, '', showHidden);
      setRootEntries(res.entries);
      setNodeStates(new Map()); // reset expanded state on root reload
    } catch (err) {
      setRootError(err instanceof Error ? err.message : 'failed');
      setRootEntries(null);
    } finally {
      setRootLoading(false);
    }
  }, [projectId, showHidden]);

  useEffect(() => {
    loadRoot();
  }, [loadRoot]);

  const onResize = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = Math.min(800, Math.max(160, clientX - rect.left));
    setPaneWidth(next);
  }, []);

  const handleSelect = useCallback((path: string, entry: FileEntry) => {
    if (previewDirtyRef.current && !window.confirm(t('files.editor.discardConfirm'))) return;
    setSelectedPath(path);
    setSelectedEntry(entry);
  }, [t]);

  const totalEntries = useMemo(() => rootEntries?.length ?? 0, [rootEntries]);

  return (
    <div
      ref={containerRef}
      className="flex h-[calc(100vh-220px)] min-h-[400px] border border-warm-200 rounded-lg overflow-hidden bg-[var(--color-bg-card)]"
    >
      {/* Left: tree */}
      <div className="flex flex-col min-h-0 min-w-0" style={{ width: paneWidth }}>
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-warm-200 text-xs">
          <span className="font-medium text-warm-700 truncate flex-1">{t('files.root')}</span>
          <span className="text-warm-400 shrink-0">{totalEntries}</span>
          <button
            onClick={() => setShowHidden((v) => !v)}
            className="p-1 rounded hover:bg-warm-100 text-warm-500 hover:text-warm-700"
            title={showHidden ? t('files.hideHidden') : t('files.showHidden')}
          >
            {showHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={loadRoot}
            className="p-1 rounded hover:bg-warm-100 text-warm-500 hover:text-warm-700"
            title={t('files.refresh')}
            disabled={rootLoading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${rootLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto py-1">
          {rootLoading && !rootEntries && (
            <div className="flex items-center gap-1 text-xs text-warm-400 px-2 py-1">
              <Loader2 className="w-3 h-3 animate-spin" /> {t('files.loading')}
            </div>
          )}
          {rootError && (
            <div className="flex items-center gap-1 text-xs text-red-500 px-2 py-1">
              <AlertCircle className="w-3 h-3" /> {rootError}
            </div>
          )}
          {rootEntries && rootEntries.length === 0 && !rootLoading && (
            <div className="text-xs text-warm-400 px-2 py-2">{t('files.empty')}</div>
          )}
          {rootEntries && rootEntries.length > 0 && (
            <TreeBranch
              projectId={projectId}
              parentPath=""
              entries={rootEntries}
              depth={0}
              nodeStates={nodeStates}
              setNodeStates={setNodeStates}
              showHidden={showHidden}
              selectedPath={selectedPath}
              onSelect={handleSelect}
            />
          )}
        </div>
      </div>

      <Resizer onResize={onResize} />

      {/* Right: preview */}
      <PreviewPanel
        projectId={projectId}
        path={selectedPath}
        entry={selectedEntry}
        onDirtyChange={handleDirtyChange}
      />
    </div>
  );
}
