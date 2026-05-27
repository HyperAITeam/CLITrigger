import { Component, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import {
  FolderOpen, Loader2, AlertCircle, Copy, ExternalLink,
  Pencil, Save, Check,
} from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { useI18n } from '../../i18n';
import { getFileContent, getBinaryFileUrl, openFile, saveFileContent } from '../../api/files';
import type { FileEntry } from '../../api/files';
import { ApiError } from '../../api/client';
import { useTheme } from '../../hooks/useTheme';
import { useToast } from '../../hooks/useToast';
import MarkdownContent from '../MarkdownContent';
import ToastContainer from '../Toast';
import {
  IMAGE_EXT, PDF_EXT, VIDEO_EXT, AUDIO_EXT, MARKDOWN_EXT, HTML_EXT,
  extOf, formatSize, iconFor, languageExtensionFor,
} from './files-utils';

class RenderErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: Error, info: ErrorInfo) { console.error('[VaultPreview] Render error:', err, info); }
  componentDidUpdate(prev: { fallback: ReactNode; children: ReactNode }) {
    if (prev.children !== this.props.children && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

export interface PreviewPanelProps {
  projectId: string;
  path: string | null;
  entry: FileEntry | null;
  onDirtyChange?: (dirty: boolean) => void;
  onNavigateFile?: (filePath: string) => void;
  onSaved?: () => void;
}

export function PreviewPanel({
  projectId, path, entry, onDirtyChange, onNavigateFile, onSaved,
}: PreviewPanelProps) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { toasts, error: toastError, dismiss: dismissToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [binaryMime, setBinaryMime] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ size: number; mtime: number } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editorValue, setEditorValue] = useState('');
  const [savedValue, setSavedValue] = useState('');
  const [savedMtime, setSavedMtime] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = editMode && editorValue !== savedValue;

  useEffect(() => () => {
    if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
  }, []);

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

  const ext = entry ? extOf(entry.name) : '';
  const isImage = binaryMime?.startsWith('image/') || IMAGE_EXT.has(ext);
  const isPdf = binaryMime === 'application/pdf' || PDF_EXT.has(ext);
  const isVideo = binaryMime?.startsWith('video/') || VIDEO_EXT.has(ext);
  const isAudio = binaryMime?.startsWith('audio/') || AUDIO_EXT.has(ext);
  const isMarkdown = MARKDOWN_EXT.has(ext);
  const isHtml = HTML_EXT.has(ext);
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
      setSavedFlash(true);
      if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
      savedFlashTimer.current = setTimeout(() => setSavedFlash(false), 800);
      onSaved?.();
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
  }, [path, savedMtime, editorValue, saving, projectId, toastError, t, onSaved]);

  const handleEnterEdit = useCallback(() => {
    if (!editable) return;
    setEditMode(true);
  }, [editable]);

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

  const copyPath = () => {
    if (!path) return;
    navigator.clipboard.writeText(path).catch(() => { /* swallow */ });
  };

  const openInOS = () => {
    if (!path) return;
    openFile(projectId, path, 'open').catch(() => { /* swallow */ });
  };

  const revealInOS = () => {
    if (!path) return;
    openFile(projectId, path, 'reveal').catch(() => { /* swallow */ });
  };

  if (!path || !entry) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-warm-400">
        {t('vault.activeFile.empty')}
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col">
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
              {savedFlash && (
                <span className="inline-flex items-center gap-1 text-status-success text-xs transition-opacity duration-200">
                  <Check className="w-3.5 h-3.5" />
                  <span>{t('files.editor.saved')}</span>
                </span>
              )}
              <button
                onClick={handleCancelEdit}
                disabled={saving}
                className="px-1.5 py-1 rounded text-warm-500 hover:bg-warm-100 hover:text-warm-700 disabled:opacity-40 inline-flex items-center gap-1"
                title={t('files.editor.done')}
              >
                <Check className="w-3.5 h-3.5" />
                <span>{t('files.editor.done')}</span>
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
          <button
            onClick={openInOS}
            className="p-1 rounded hover:bg-warm-100 text-warm-500 hover:text-warm-700"
            title={t('files.openInOS')}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={revealInOS}
            className="p-1 rounded hover:bg-warm-100 text-warm-500 hover:text-warm-700"
            title={t('files.revealInExplorer')}
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={copyPath}
            className="p-1 rounded hover:bg-warm-100 text-warm-500 hover:text-warm-700"
            title={t('files.copyPath')}
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
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
        {!loading && !error && !editMode && textContent !== null && isMarkdown && (
          <RenderErrorBoundary
            fallback={<pre className="text-xs font-mono text-warm-800 whitespace-pre p-3 leading-relaxed">{textContent}</pre>}
          >
            <div className="p-4">
              <MarkdownContent
                content={textContent}
                onLinkClick={onNavigateFile ? (href) => {
                  const clean = decodeURIComponent(href.split('#')[0].split('?')[0]);
                  if (!clean) return;
                  const dir = path!.includes('/') ? path!.slice(0, path!.lastIndexOf('/')) : '';
                  const parts = (dir ? `${dir}/${clean}` : clean).replace(/\\/g, '/').split('/');
                  const resolved: string[] = [];
                  for (const p of parts) {
                    if (p === '.' || p === '') continue;
                    if (p === '..') { resolved.pop(); continue; }
                    resolved.push(p);
                  }
                  onNavigateFile(resolved.join('/'));
                } : undefined}
              />
            </div>
          </RenderErrorBoundary>
        )}
        {!loading && !error && !editMode && textContent !== null && isHtml && (
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
        {!loading && !error && !editMode && textContent !== null && !isMarkdown && !isHtml && (
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
