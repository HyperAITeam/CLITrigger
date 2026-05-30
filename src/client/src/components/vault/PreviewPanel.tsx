import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  FolderOpen, Loader2, AlertCircle, Copy, ExternalLink,
  Pencil, Save, Check, Search, Highlighter, Eraser, Trash2, Undo2, Redo2, MousePointer2,
} from 'lucide-react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  search, SearchQuery, setSearchQuery, findNext as cmFindNext,
  findPrevious as cmFindPrevious, replaceNext as cmReplaceNext, replaceAll as cmReplaceAll,
  SearchCursor, RegExpCursor,
} from '@codemirror/search';
import { FindReplaceBar, type FindOptions } from './FindReplaceBar';
import { AnnotationOverlay, type AnnotationOverlayHandle, type AnnotationOverlayState, type AnnotationTool } from './AnnotationOverlay';
import { useI18n } from '../../i18n';
import { getFileContent, getBinaryFileUrl, openFile, saveFileContent } from '../../api/files';
import type { FileEntry } from '../../api/files';
import { ApiError } from '../../api/client';
import { useTheme } from '../../hooks/useTheme';
import { useToast } from '../../hooks/useToast';
import { useVaultZoom } from '../../hooks/useVaultZoom';
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
  const [zoom] = useVaultZoom(projectId);
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
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findShowReplace, setFindShowReplace] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findReplacement, setFindReplacement] = useState('');
  const [findOptions, setFindOptions] = useState<FindOptions>({ caseSensitive: false, wholeWord: false, regexp: false });
  const [matchCount, setMatchCount] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previewMatchesRef = useRef<HTMLElement[]>([]);
  const [annotateMode, setAnnotateMode] = useState(false);
  const [annotateTool, setAnnotateTool] = useState<AnnotationTool>('pen');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const overlayRef = useRef<AnnotationOverlayHandle>(null);
  const handleOverlayState = useCallback((s: AnnotationOverlayState) => {
    setCanUndo(s.canUndo);
    setCanRedo(s.canRedo);
  }, []);
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
  const cmExtensions = useMemo(() => [...languageExtensionFor(ext), search({ top: false })], [ext]);

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

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!editable) return;
    if (editMode && (e.target as HTMLElement).closest('.cm-editor')) return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, [editable, editMode]);

  const openFind = useCallback((withReplace: boolean) => {
    setFindShowReplace(withReplace && editMode);
    setFindOpen(true);
  }, [editMode]);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setMatchCount({ current: 0, total: 0 });
    if (contentRef.current) unwrapHighlights(contentRef.current);
    previewMatchesRef.current = [];
    const view = cmRef.current?.view;
    if (view) view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });
  }, []);

  const findNext = useCallback(() => {
    if (editMode) {
      const view = cmRef.current?.view;
      if (view) { cmFindNext(view); view.focus(); }
      return;
    }
    setMatchCount(prev => prev.total === 0 ? prev : { ...prev, current: (prev.current % prev.total) + 1 });
  }, [editMode]);

  const findPrev = useCallback(() => {
    if (editMode) {
      const view = cmRef.current?.view;
      if (view) { cmFindPrevious(view); view.focus(); }
      return;
    }
    setMatchCount(prev => prev.total === 0 ? prev : { ...prev, current: ((prev.current - 2 + prev.total) % prev.total) + 1 });
  }, [editMode]);

  const doReplace = useCallback(() => {
    if (!editMode) return;
    const view = cmRef.current?.view;
    if (view) cmReplaceNext(view);
  }, [editMode]);

  const doReplaceAll = useCallback(() => {
    if (!editMode) return;
    const view = cmRef.current?.view;
    if (view) cmReplaceAll(view);
  }, [editMode]);

  const onEditorKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      void handleSave();
    }
  }, [handleSave]);

  const handleContentKeyDown = useCallback((e: React.KeyboardEvent) => {
    const isCtrl = e.ctrlKey || e.metaKey;
    if (isCtrl && (e.key === 'f' || e.key === 'F')) {
      if (!editable) return;
      e.preventDefault();
      openFind(false);
    } else if (isCtrl && (e.key === 'h' || e.key === 'H')) {
      if (!editable || !editMode) return;
      e.preventDefault();
      openFind(true);
    } else if (e.key === 'F3') {
      if (!findOpen) return;
      e.preventDefault();
      if (e.shiftKey) findPrev(); else findNext();
    } else if (annotateMode && isCtrl && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) overlayRef.current?.redo();
      else overlayRef.current?.undo();
    } else if (annotateMode && isCtrl && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      overlayRef.current?.redo();
    }
  }, [editable, editMode, findOpen, openFind, findNext, findPrev, annotateMode]);

  useEffect(() => {
    if (!findOpen) return;
    if (editMode) {
      if (contentRef.current) unwrapHighlights(contentRef.current);
      previewMatchesRef.current = [];
      return;
    }
    const root = contentRef.current;
    if (!root) return;
    unwrapHighlights(root);
    previewMatchesRef.current = [];
    if (!findQuery) {
      setMatchCount({ current: 0, total: 0 });
      return;
    }
    const matches = highlightInDom(root, findQuery, findOptions);
    previewMatchesRef.current = matches;
    setMatchCount({ current: matches.length > 0 ? 1 : 0, total: matches.length });
  }, [findOpen, editMode, findQuery, findOptions, textContent]);

  useEffect(() => {
    if (editMode || !findOpen) return;
    const arr = previewMatchesRef.current;
    arr.forEach(m => m.classList.remove('vault-find-match-active'));
    const idx = matchCount.current - 1;
    if (idx >= 0 && arr[idx]) {
      arr[idx].classList.add('vault-find-match-active');
      arr[idx].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [matchCount.current, editMode, findOpen]);

  useEffect(() => {
    if (!findOpen || !editMode) return;
    const view = cmRef.current?.view;
    if (!view) return;
    const sq = new SearchQuery({
      search: findQuery,
      caseSensitive: findOptions.caseSensitive,
      wholeWord: findOptions.wholeWord,
      regexp: findOptions.regexp,
      replace: findReplacement,
    });
    view.dispatch({ effects: setSearchQuery.of(sq) });
    if (!findQuery) {
      setMatchCount({ current: 0, total: 0 });
      return;
    }
    try {
      const { state } = view;
      let count = 0;
      if (findOptions.regexp) {
        const cursor = new RegExpCursor(state.doc, findQuery, { ignoreCase: !findOptions.caseSensitive });
        while (!cursor.next().done) { count++; if (count > 9999) break; }
      } else {
        const norm = findOptions.caseSensitive ? undefined : (s: string) => s.toLowerCase();
        const cursor = new SearchCursor(state.doc, findQuery, 0, state.doc.length, norm);
        while (!cursor.next().done) { count++; if (count > 9999) break; }
      }
      setMatchCount({ current: count > 0 ? 1 : 0, total: count });
    } catch {
      setMatchCount({ current: 0, total: 0 });
    }
  }, [findOpen, editMode, findQuery, findOptions, findReplacement, editorValue]);

  useEffect(() => {
    if (contentRef.current) unwrapHighlights(contentRef.current);
    previewMatchesRef.current = [];
    if (findOpen) setMatchCount({ current: 0, total: 0 });
  }, [editMode, path]);

  useEffect(() => {
    setAnnotateMode(false);
    overlayRef.current?.clearAll();
  }, [path, editMode]);

  const toggleAnnotate = useCallback(() => {
    setAnnotateMode(v => {
      if (v) overlayRef.current?.clearAll();
      else setAnnotateTool('select');
      return !v;
    });
  }, []);

  const canAnnotate = !editMode && !loading && !error && isMarkdown && textContent !== null;

  const handleCheckboxToggle = useCallback(async (idx: number, nowChecked: boolean) => {
    if (!path || textContent == null || savedMtime == null || editMode) return;
    const newText = toggleNthTask(textContent, idx, nowChecked);
    if (newText === textContent) return;
    const prevText = textContent;
    const prevSaved = savedValue;
    const prevMtime = savedMtime;
    setTextContent(newText);
    setSavedValue(newText);
    try {
      const res = await saveFileContent(projectId, path, newText, prevMtime);
      setSavedMtime(res.mtime);
      setMeta({ size: res.size, mtime: res.mtime });
      onSaved?.();
    } catch (err) {
      setTextContent(prevText);
      setSavedValue(prevSaved);
      setSavedMtime(prevMtime);
      if (err instanceof ApiError && err.status === 409) {
        toastError(t('files.editor.conflict'));
      } else if (err instanceof Error) {
        toastError(`${t('files.editor.saveFailed')}: ${err.message}`);
      } else {
        toastError(t('files.editor.saveFailed'));
      }
    }
  }, [path, textContent, savedValue, savedMtime, editMode, projectId, toastError, t, onSaved]);

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
          {canAnnotate && (
            <button
              onClick={toggleAnnotate}
              className={`p-1 rounded inline-flex items-center ${annotateMode ? 'bg-amber-100 text-amber-700' : 'text-warm-500 hover:bg-warm-100 hover:text-warm-700'}`}
              title={annotateMode ? t('annotate.stop') : t('annotate.start')}
              aria-pressed={annotateMode}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
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

      {annotateMode && canAnnotate && (
        <div className="flex items-center gap-1 px-3 py-1 border-b border-warm-200 bg-warm-50 text-xs">
          <button
            type="button"
            onClick={() => setAnnotateTool('select')}
            title={t('annotate.select')}
            aria-pressed={annotateTool === 'select'}
            className={`p-1 rounded inline-flex items-center gap-1 ${annotateTool === 'select' ? 'bg-amber-100 text-amber-700' : 'text-warm-500 hover:bg-warm-100 hover:text-warm-700'}`}
          >
            <MousePointer2 className="w-3 h-3" />
            <span>{t('annotate.select')}</span>
          </button>
          <span className="mx-1 text-warm-300">|</span>
          <button
            type="button"
            onClick={() => setAnnotateTool('pen')}
            title={t('annotate.pen')}
            aria-pressed={annotateTool === 'pen'}
            className={`p-1 rounded inline-flex items-center gap-1 ${annotateTool === 'pen' ? 'bg-amber-100 text-amber-700' : 'text-warm-500 hover:bg-warm-100 hover:text-warm-700'}`}
          >
            <Pencil className="w-3 h-3" />
            <span>{t('annotate.pen')}</span>
          </button>
          <button
            type="button"
            onClick={() => setAnnotateTool('highlighter')}
            title={t('annotate.highlighter')}
            aria-pressed={annotateTool === 'highlighter'}
            className={`p-1 rounded inline-flex items-center gap-1 ${annotateTool === 'highlighter' ? 'bg-amber-100 text-amber-700' : 'text-warm-500 hover:bg-warm-100 hover:text-warm-700'}`}
          >
            <Highlighter className="w-3 h-3" />
            <span>{t('annotate.highlighter')}</span>
          </button>
          <button
            type="button"
            onClick={() => setAnnotateTool('eraser')}
            title={t('annotate.eraser')}
            aria-pressed={annotateTool === 'eraser'}
            className={`p-1 rounded inline-flex items-center gap-1 ${annotateTool === 'eraser' ? 'bg-amber-100 text-amber-700' : 'text-warm-500 hover:bg-warm-100 hover:text-warm-700'}`}
          >
            <Eraser className="w-3 h-3" />
            <span>{t('annotate.eraser')}</span>
          </button>
          <span className="mx-1 text-warm-300">|</span>
          <button
            type="button"
            onClick={() => overlayRef.current?.undo()}
            disabled={!canUndo}
            title={t('annotate.undo')}
            className={`p-1 rounded inline-flex items-center gap-1 ${canUndo ? 'text-warm-500 hover:bg-warm-100 hover:text-warm-700' : 'text-warm-300 cursor-not-allowed'}`}
          >
            <Undo2 className="w-3 h-3" />
            <span>{t('annotate.undo')}</span>
          </button>
          <button
            type="button"
            onClick={() => overlayRef.current?.redo()}
            disabled={!canRedo}
            title={t('annotate.redo')}
            className={`p-1 rounded inline-flex items-center gap-1 ${canRedo ? 'text-warm-500 hover:bg-warm-100 hover:text-warm-700' : 'text-warm-300 cursor-not-allowed'}`}
          >
            <Redo2 className="w-3 h-3" />
            <span>{t('annotate.redo')}</span>
          </button>
          <span className="mx-1 text-warm-300">|</span>
          <button
            type="button"
            onClick={() => overlayRef.current?.clearAll()}
            title={t('annotate.clear')}
            className="p-1 rounded text-warm-500 hover:bg-warm-100 hover:text-warm-700 inline-flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" />
            <span>{t('annotate.clear')}</span>
          </button>
        </div>
      )}

      <div
        ref={contentRef}
        className="flex-1 min-h-0 overflow-auto relative outline-none"
        onContextMenu={handleContextMenu}
        onKeyDown={handleContentKeyDown}
        tabIndex={-1}
      >
        {findOpen && (
          <FindReplaceBar
            open={findOpen}
            query={findQuery}
            replacement={findReplacement}
            options={findOptions}
            showReplace={findShowReplace && editMode}
            matchCount={matchCount}
            canReplace={editMode}
            onQueryChange={setFindQuery}
            onReplacementChange={setFindReplacement}
            onOptionsChange={setFindOptions}
            onToggleReplace={() => setFindShowReplace(v => !v)}
            onNext={findNext}
            onPrev={findPrev}
            onReplace={doReplace}
            onReplaceAll={doReplaceAll}
            onClose={closeFind}
          />
        )}
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
          <div className="h-full" style={{ fontSize: `${zoom}px` }} onKeyDown={onEditorKeyDown}>
            <CodeMirror
              ref={cmRef}
              value={editorValue}
              onChange={setEditorValue}
              extensions={cmExtensions}
              theme={theme === 'dark' ? oneDark : 'light'}
              height="100%"
              className="h-full"
              basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true, searchKeymap: false }}
            />
          </div>
        )}
        {!loading && !error && !editMode && textContent !== null && isMarkdown && (
          <RenderErrorBoundary
            fallback={<pre className="text-xs font-mono text-warm-800 whitespace-pre p-3 leading-relaxed">{textContent}</pre>}
          >
            <div className="p-4 vault-md-zoom relative" style={{ fontSize: `${zoom}px` }}>
              <AnnotationOverlay ref={overlayRef} enabled={annotateMode} tool={annotateTool} onStateChange={handleOverlayState} />
              <MarkdownContent
                content={textContent}
                onCheckboxToggle={handleCheckboxToggle}
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
      {ctxMenu && (
        <MdContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          mode={editMode ? 'edit' : 'preview'}
          annotateMode={annotateMode}
          canAnnotate={canAnnotate}
          onEdit={() => { setCtxMenu(null); handleEnterEdit(); }}
          onDone={() => { setCtxMenu(null); handleCancelEdit(); }}
          onFind={() => { setCtxMenu(null); openFind(false); }}
          onToggleAnnotate={() => { setCtxMenu(null); toggleAnnotate(); }}
          onClose={() => setCtxMenu(null)}
        />
      )}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function MdContextMenu({
  x, y, mode, annotateMode, canAnnotate,
  onEdit, onDone, onFind, onToggleAnnotate, onClose,
}: {
  x: number;
  y: number;
  mode: 'preview' | 'edit';
  annotateMode: boolean;
  canAnnotate: boolean;
  onEdit: () => void;
  onDone: () => void;
  onFind: () => void;
  onToggleAnnotate: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: y, left: x, visible: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = x;
    let top = y;
    if (left + w > vw - 8) left = Math.max(8, vw - 8 - w);
    if (top + h > vh - 8) top = Math.max(8, vh - 8 - h);
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    setPos({ top, left, visible: true });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-tooltip min-w-[160px] rounded-lg py-1 shadow-elevated text-xs"
      style={{
        top: pos.top,
        left: pos.left,
        opacity: pos.visible ? 1 : 0,
        backgroundColor: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
      }}
    >
      {mode === 'preview' ? (
        <button
          type="button"
          onClick={onEdit}
          className="w-full text-left px-3 py-1.5 hover:bg-warm-100 text-warm-700 flex items-center gap-2"
        >
          <Pencil className="w-3.5 h-3.5" />
          <span>{t('files.editor.edit')}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onDone}
          className="w-full text-left px-3 py-1.5 hover:bg-warm-100 text-warm-700 flex items-center gap-2"
        >
          <Check className="w-3.5 h-3.5" />
          <span>{t('files.editor.done')}</span>
        </button>
      )}
      <button
        type="button"
        onClick={onFind}
        className="w-full text-left px-3 py-1.5 hover:bg-warm-100 text-warm-700 flex items-center gap-2"
      >
        <Search className="w-3.5 h-3.5" />
        <span>{t('find.openFind')}</span>
      </button>
      {mode === 'preview' && canAnnotate && (
        <button
          type="button"
          onClick={onToggleAnnotate}
          className="w-full text-left px-3 py-1.5 hover:bg-warm-100 text-warm-700 flex items-center gap-2"
        >
          <Pencil className="w-3.5 h-3.5" />
          <span>{annotateMode ? t('annotate.stop') : t('annotate.start')}</span>
        </button>
      )}
    </div>,
    document.body,
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toggleNthTask(text: string, n: number, checked: boolean): string {
  let i = 0;
  return text.replace(/^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]/gm, (match, prefix: string) => {
    if (i++ !== n) return match;
    return prefix + (checked ? '[x]' : '[ ]');
  });
}

function unwrapHighlights(container: HTMLElement) {
  const marks = container.querySelectorAll('mark.vault-find-match, mark.vault-find-match-active');
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    (parent as Element).normalize?.();
  });
}

function highlightInDom(container: HTMLElement, query: string, options: FindOptions): HTMLElement[] {
  const results: HTMLElement[] = [];
  if (!query) return results;
  let regex: RegExp;
  try {
    if (options.regexp) {
      regex = new RegExp(query, options.caseSensitive ? 'g' : 'gi');
    } else {
      const escaped = escapeRegExp(query);
      const wrapped = options.wholeWord ? `\\b${escaped}\\b` : escaped;
      regex = new RegExp(wrapped, options.caseSensitive ? 'g' : 'gi');
    }
  } catch { return results; }

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (p.tagName === 'SCRIPT' || p.tagName === 'STYLE') return NodeFilter.FILTER_REJECT;
      if (p.classList.contains('vault-find-match') || p.classList.contains('vault-find-match-active')) {
        return NodeFilter.FILTER_REJECT;
      }
      if (p.closest('[data-vault-find-bar]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes: Text[] = [];
  let cur: Node | null;
  while ((cur = walker.nextNode())) textNodes.push(cur as Text);

  for (const node of textNodes) {
    const text = node.nodeValue;
    if (!text) continue;
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    let lastIdx = 0;
    const newNodes: Node[] = [];
    let foundAny = false;
    while ((m = regex.exec(text))) {
      foundAny = true;
      if (m.index > lastIdx) newNodes.push(document.createTextNode(text.slice(lastIdx, m.index)));
      const mark = document.createElement('mark');
      mark.className = 'vault-find-match';
      mark.textContent = m[0];
      newNodes.push(mark);
      results.push(mark);
      lastIdx = m.index + m[0].length;
      if (m[0].length === 0) regex.lastIndex++;
    }
    if (foundAny) {
      if (lastIdx < text.length) newNodes.push(document.createTextNode(text.slice(lastIdx)));
      const parent = node.parentNode!;
      for (const nn of newNodes) parent.insertBefore(nn, node);
      parent.removeChild(node);
    }
  }
  return results;
}
