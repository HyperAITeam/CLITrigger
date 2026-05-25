import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, ChevronRight, FileText, FolderOpen, Plus, Trash2, Save,
  Network, Edit2, Search, Loader2,
} from 'lucide-react';
import { useI18n } from '../i18n';
import {
  getVaultGraph,
  getVaultFileContent,
  saveVaultFile,
  createVaultFile,
  deleteVaultFileApi,
  type VaultFile,
  type VaultEdge,
} from '../api/vault';
import VaultGraph from './VaultGraph';
import Modal from './Modal';

interface VaultExplorerProps {
  projectId: string;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function readNumber(key: string, fallback: number, lo: number, hi: number): number {
  if (typeof window === 'undefined') return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
}

interface DirTree {
  name: string;
  path: string;
  files: VaultFile[];
  children: DirTree[];
}

function buildTree(files: VaultFile[]): DirTree {
  const root: DirTree = { name: '.', path: '.', files: [], children: [] };
  const dirMap = new Map<string, DirTree>();
  dirMap.set('.', root);

  const ensureDir = (dirPath: string): DirTree => {
    if (dirMap.has(dirPath)) return dirMap.get(dirPath)!;
    const parts = dirPath.split('/');
    const parentPath = parts.slice(0, -1).join('/') || '.';
    const parent = ensureDir(parentPath);
    const node: DirTree = { name: parts[parts.length - 1], path: dirPath, files: [], children: [] };
    parent.children.push(node);
    dirMap.set(dirPath, node);
    return node;
  };

  for (const f of files) {
    const parts = f.relativePath.split('/');
    if (parts.length === 1) {
      root.files.push(f);
    } else {
      const dirPath = parts.slice(0, -1).join('/');
      ensureDir(dirPath).files.push(f);
    }
  }

  const sortDir = (d: DirTree) => {
    d.children.sort((a, b) => a.name.localeCompare(b.name));
    d.files.sort((a, b) => a.stem.localeCompare(b.stem));
    d.children.forEach(sortDir);
  };
  sortDir(root);
  return root;
}

function VaultResizer({ onResize }: { onResize: (clientX: number) => void }) {
  return (
    <div
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
      role="separator"
      aria-orientation="vertical"
      className="w-1 shrink-0 cursor-col-resize bg-warm-200 hover:bg-accent transition-colors"
    />
  );
}

export default function VaultExplorer({ projectId }: VaultExplorerProps) {
  const { t } = useI18n();
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [edges, setEdges] = useState<VaultEdge[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<'graph' | 'editor'>('graph');
  const [filter, setFilter] = useState('');
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileName, setNewFileName] = useState('');

  // Editor state
  const [editContent, setEditContent] = useState('');
  const [editDirty, setEditDirty] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const outerRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readNumber('clitrigger:vault:sidebar-w', 220, 160, 560));
  useEffect(() => { localStorage.setItem('clitrigger:vault:sidebar-w', String(sidebarWidth)); }, [sidebarWidth]);
  const handleSidebarResize = useCallback((clientX: number) => {
    if (!outerRef.current) return;
    const rect = outerRef.current.getBoundingClientRect();
    setSidebarWidth(clamp(clientX - rect.left, 160, 560));
  }, []);

  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set(['.']));

  const reload = useCallback(() => {
    getVaultGraph(projectId)
      .then(g => { setFiles(g.files); setEdges(g.edges); })
      .catch(err => console.error('Load vault failed', err));
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

  const selectFile = useCallback(async (path: string | null) => {
    setSelectedPath(path);
    if (!path) return;
    setRightPanel('editor');
    setEditLoading(true);
    try {
      const res = await getVaultFileContent(projectId, path);
      setEditContent(res.content);
      setEditDirty(false);
    } catch (err) {
      console.error('Load vault file failed', err);
      setEditContent('');
    } finally {
      setEditLoading(false);
    }
  }, [projectId]);

  const handleSave = useCallback(async () => {
    if (!selectedPath || !editDirty) return;
    setSaving(true);
    try {
      await saveVaultFile(projectId, selectedPath, editContent);
      setEditDirty(false);
      reload();
    } catch (err) {
      console.error('Save vault file failed', err);
    } finally {
      setSaving(false);
    }
  }, [projectId, selectedPath, editContent, editDirty, reload]);

  const handleContentChange = useCallback((value: string) => {
    setEditContent(value);
    setEditDirty(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      // auto-save is handled via the dirty flag check on blur or explicit save
    }, 500);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!selectedPath) return;
    if (!confirm(t('vault.confirmDelete').replace('{path}', selectedPath))) return;
    try {
      await deleteVaultFileApi(projectId, selectedPath);
      setSelectedPath(null);
      setEditContent('');
      setEditDirty(false);
      reload();
    } catch (err) {
      console.error('Delete vault file failed', err);
    }
  }, [projectId, selectedPath, reload, t]);

  const handleCreateFile = useCallback(async () => {
    const name = newFileName.trim();
    if (!name) return;
    const path = name.endsWith('.md') ? name : `${name}.md`;
    try {
      await createVaultFile(projectId, path);
      setShowNewFileModal(false);
      setNewFileName('');
      reload();
      selectFile(path);
    } catch (err) {
      console.error('Create vault file failed', err);
    }
  }, [projectId, newFileName, reload, selectFile]);

  const tree = useMemo(() => {
    let filtered = files;
    if (filter) {
      const q = filter.toLowerCase();
      filtered = files.filter(f =>
        f.stem.toLowerCase().includes(q) ||
        f.title.toLowerCase().includes(q) ||
        f.relativePath.toLowerCase().includes(q)
      );
    }
    return buildTree(filtered);
  }, [files, filter]);

  const selectedFile = useMemo(() =>
    files.find(f => f.relativePath === selectedPath) ?? null,
  [files, selectedPath]);

  const backlinks = useMemo(() => {
    if (!selectedFile) return [];
    const stem = selectedFile.stem.toLowerCase();
    const title = selectedFile.title.toLowerCase();
    return files.filter(f =>
      f.relativePath !== selectedPath &&
      f.wikilinks.some(w => w.toLowerCase() === stem || w.toLowerCase() === title)
    );
  }, [files, selectedFile, selectedPath]);

  const toggleDir = (dirPath: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  const renderDir = (dir: DirTree, depth = 0): React.ReactNode => {
    if (depth === 0 && dir.children.length === 0 && dir.files.length === 0) {
      return <div className="text-xs text-warm-500 italic px-3 py-4">{t('vault.empty')}</div>;
    }

    const isRoot = depth === 0;
    const expanded = expandedDirs.has(dir.path);

    return (
      <div key={dir.path}>
        {!isRoot && (
          <button
            onClick={() => toggleDir(dir.path)}
            className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-warm-600 hover:bg-warm-100"
            style={{ paddingLeft: depth * 12 + 8 }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <FolderOpen size={12} className="text-warm-400" />
            <span className="truncate">{dir.name}</span>
            <span className="text-[10px] text-warm-400 ml-auto">{dir.files.length}</span>
          </button>
        )}

        {(isRoot || expanded) && (
          <>
            {dir.files.map(f => (
              <button
                key={f.relativePath}
                onClick={() => selectFile(f.relativePath)}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-warm-100 ${
                  selectedPath === f.relativePath ? 'bg-warm-200 text-warm-900 font-medium' : 'text-warm-700'
                }`}
                style={{ paddingLeft: (isRoot ? 0 : depth) * 12 + 20 }}
                title={f.relativePath}
              >
                <FileText size={12} className="text-warm-400 shrink-0" />
                <span className="truncate">{f.stem}</span>
                {f.tags.length > 0 && (
                  <span className="text-[10px] text-warm-400 truncate ml-auto">{f.tags[0]}</span>
                )}
              </button>
            ))}
            {dir.children.map(c => renderDir(c, depth + 1))}
          </>
        )}
      </div>
    );
  };

  return (
    <div ref={outerRef} className="flex h-[calc(100vh-220px)] min-h-[500px] border border-warm-200 rounded-xl overflow-hidden bg-warm-0">
      {/* ── Left Sidebar ── */}
      <div className="flex flex-col overflow-hidden bg-warm-50" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
        {/* Sidebar header */}
        <div className="flex items-center gap-1.5 p-2 border-b border-warm-200">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-warm-400" />
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder={t('vault.searchPlaceholder')}
              className="w-full pl-7 pr-2 py-1 rounded-md border border-warm-200 bg-warm-0 text-xs focus:outline-none focus:ring-1 focus:ring-warm-400"
            />
          </div>
          <button
            onClick={() => setShowNewFileModal(true)}
            className="p-1.5 rounded-md text-warm-500 hover:bg-warm-200 hover:text-warm-700"
            title={t('vault.newFile')}
          >
            <Plus size={14} />
          </button>
        </div>

        {/* File tree */}
        <div className="flex-1 overflow-y-auto">
          {renderDir(tree)}
        </div>

        {/* File count */}
        <div className="px-3 py-1.5 border-t border-warm-200 text-[10px] text-warm-400">
          {files.length} {t('vault.filesCount')}
        </div>
      </div>

      <VaultResizer onResize={handleSidebarResize} />

      {/* ── Right Content ── */}
      <div className="flex-1 flex flex-col overflow-hidden relative min-w-0">
        {/* Panel toggle */}
        {selectedPath && (
          <div className="absolute top-2 right-2 z-10 flex gap-1">
            <button
              onClick={() => setRightPanel('editor')}
              className={`px-2 py-1 rounded text-xs ${
                rightPanel === 'editor' ? 'bg-warm-700 text-warm-50' : 'bg-warm-200 text-warm-600 hover:bg-warm-300'
              }`}
            >
              <Edit2 size={12} />
            </button>
            <button
              onClick={() => setRightPanel('graph')}
              className={`px-2 py-1 rounded text-xs ${
                rightPanel === 'graph' ? 'bg-warm-700 text-warm-50' : 'bg-warm-200 text-warm-600 hover:bg-warm-300'
              }`}
            >
              <Network size={12} />
            </button>
          </div>
        )}

        {rightPanel === 'graph' ? (
          <div className="flex-1 p-2">
            <VaultGraph
              files={files}
              edges={edges}
              selectedPath={selectedPath}
              onSelectFile={(p) => { setSelectedPath(p); if (p) setRightPanel('editor'); }}
            />
          </div>
        ) : selectedPath ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Editor header */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-warm-200 bg-warm-50">
              <FileText size={14} className="text-warm-400 shrink-0" />
              <span className="text-xs text-warm-600 truncate flex-1" title={selectedPath}>
                {selectedPath}
              </span>
              {editDirty && (
                <span className="text-[10px] text-amber-600 font-medium">{t('vault.unsaved')}</span>
              )}
              <button
                onClick={handleSave}
                disabled={!editDirty || saving}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-warm-700 text-warm-50 disabled:opacity-40 hover:bg-warm-800"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                {t('vault.save')}
              </button>
              <button
                onClick={handleDelete}
                className="p-1 rounded text-warm-400 hover:text-red-500 hover:bg-red-50"
                title={t('vault.delete')}
              >
                <Trash2 size={14} />
              </button>
            </div>

            {/* Tags */}
            {selectedFile && selectedFile.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 px-4 py-1.5 border-b border-warm-100">
                {selectedFile.tags.map(tag => (
                  <span key={tag} className="text-[10px] bg-warm-200 text-warm-600 px-1.5 py-0.5 rounded">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Editor body */}
            <div className="flex-1 overflow-hidden">
              {editLoading ? (
                <div className="flex items-center justify-center h-full text-warm-500">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : (
                <textarea
                  value={editContent}
                  onChange={e => handleContentChange(e.target.value)}
                  onBlur={() => { if (editDirty) handleSave(); }}
                  className="w-full h-full px-4 py-3 bg-warm-0 text-sm font-mono resize-none focus:outline-none"
                  spellCheck={false}
                />
              )}
            </div>

            {/* Backlinks */}
            {backlinks.length > 0 && (
              <div className="border-t border-warm-200 px-4 py-2 bg-warm-50">
                <div className="text-[10px] text-warm-500 uppercase tracking-wide mb-1">{t('vault.backlinks')} ({backlinks.length})</div>
                <div className="flex flex-wrap gap-1">
                  {backlinks.map(f => (
                    <button
                      key={f.relativePath}
                      onClick={() => selectFile(f.relativePath)}
                      className="text-xs text-warm-600 bg-warm-100 hover:bg-warm-200 px-2 py-0.5 rounded"
                    >
                      {f.stem}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 p-2">
            <VaultGraph
              files={files}
              edges={edges}
              selectedPath={selectedPath}
              onSelectFile={(p) => { setSelectedPath(p); if (p) setRightPanel('editor'); }}
            />
          </div>
        )}
      </div>

      {/* New File Modal */}
      <Modal open={showNewFileModal} onClose={() => setShowNewFileModal(false)} size="sm">
        <div className="space-y-3 p-4">
          <div className="text-sm font-medium text-warm-800">{t('vault.newFile')}</div>
          <input
            value={newFileName}
            onChange={e => setNewFileName(e.target.value)}
            placeholder="filename.md"
            autoFocus
            className="w-full px-3 py-2 rounded-md border border-warm-200 bg-warm-0 text-sm focus:outline-none focus:ring-2 focus:ring-warm-400"
            onKeyDown={e => { if (e.key === 'Enter') handleCreateFile(); }}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowNewFileModal(false)}
              className="px-3 py-1.5 rounded-md text-xs text-warm-600 hover:bg-warm-100"
            >
              {t('form.cancel')}
            </button>
            <button
              onClick={handleCreateFile}
              disabled={!newFileName.trim()}
              className="px-3 py-1.5 rounded-md text-xs bg-warm-700 text-warm-50 disabled:opacity-40 hover:bg-warm-800"
            >
              {t('vault.create')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
