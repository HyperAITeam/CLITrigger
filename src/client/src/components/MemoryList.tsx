import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown, ChevronRight, Edit2, Trash2, Pin, Network,
  Download, Wrench, Loader2, AlertCircle, Save, FileText, Database, Activity, RefreshCw, FolderSync,
} from 'lucide-react';
import type { MemoryNode, MemoryEdge, MemoryRelationType, Todo, Discussion } from '../types';
import { useI18n } from '../i18n';
import {
  getMemoryGraph,
  updateMemoryNode,
  updateMemoryNodePosition,
  deleteMemoryNode,
  createMemoryEdge,
  updateMemoryEdge,
  deleteMemoryEdge,
  insertMemoryWikilink,
  parseMemoryTags,
  ingestMemory,
  lintMemory,
  mergeMemoryNodes,
  getMemoryNodeRaw,
  getProjectRawFiles,
  getMemoryLogs,
  uploadWikiAsset,
  getWikiDiskDiff,
  rebuildWikiExport,
  type RawFileEntry,
  type IngestResultData,
  type WikiDiskDiffEntry,
} from '../api/memory';
import type { MemoryLog } from '../types';
import { getTodos } from '../api/todos';
import { getDiscussions } from '../api/discussions';
import Modal from './Modal';
import MemoryNetworkGraph from './MemoryNetworkGraph';
import RawFileViewer from './RawFileViewer';

const WIKI_SCHEMA_TAG = '__wiki_schema__';
const WIKI_INDEX_TAG = '__wiki_index__';
const RELATION_TYPES: MemoryRelationType[] = ['related', 'precedes', 'example_of', 'counter_example', 'refines'];

function isSchemaNode(n: MemoryNode): boolean {
  try { return JSON.parse(n.tags ?? '[]').includes(WIKI_SCHEMA_TAG); } catch { return false; }
}

function isIndexNode(n: MemoryNode): boolean {
  try { return JSON.parse(n.tags ?? '[]').includes(WIKI_INDEX_TAG); } catch { return false; }
}

function isSystemNode(n: MemoryNode): boolean {
  return isSchemaNode(n) || isIndexNode(n);
}

interface MemoryListProps {
  projectId: string;
}

export default function MemoryList({ projectId }: MemoryListProps) {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<MemoryNode[]>([]);
  const [edges, setEdges] = useState<MemoryEdge[]>([]);
  const [rawFiles, setRawFiles] = useState<RawFileEntry[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedRawPath, setSelectedRawPath] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<'graph' | 'editor'>('graph');
  const [editingEdge, setEditingEdge] = useState<MemoryEdge | null>(null);
  const [pendingConnection, setPendingConnection] = useState<{ fromId: string; toId: string } | null>(null);
  const [showIngest, setShowIngest] = useState(false);
  const [showLint, setShowLint] = useState(false);
  const [showDiskDiff, setShowDiskDiff] = useState(false);
  const [subTab, setSubTab] = useState<'wiki' | 'sources' | 'activity'>('wiki');
  const [logs, setLogs] = useState<MemoryLog[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);

  const reloadLogs = useCallback(() => {
    getMemoryLogs(projectId, 200)
      .then(r => { setLogs(r.logs); setLogsLoaded(true); })
      .catch(err => { console.error('Load memory logs failed', err); setLogsLoaded(true); });
  }, [projectId]);

  useEffect(() => {
    if (subTab === 'activity') reloadLogs();
  }, [subTab, reloadLogs]);

  const outerRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readNumber('clitrigger:wiki:sidebar-w', 208, 160, 560));
  useEffect(() => { localStorage.setItem('clitrigger:wiki:sidebar-w', String(sidebarWidth)); }, [sidebarWidth]);
  const handleSidebarResize = useCallback((clientX: number) => {
    if (!outerRef.current) return;
    const rect = outerRef.current.getBoundingClientRect();
    setSidebarWidth(clamp(clientX - rect.left, 160, 560));
  }, []);

  const reload = () => {
    getMemoryGraph(projectId)
      .then(g => { setNodes(g.nodes); setEdges(g.edges); })
      .catch(err => console.error('Load memory graph failed', err));
    getProjectRawFiles(projectId)
      .then(r => setRawFiles(r.files))
      .catch(err => console.error('Load raw files failed', err));
  };

  useEffect(() => { reload(); }, [projectId]);

  const schemaNode = useMemo(() => nodes.find(isSchemaNode), [nodes]);
  const indexNode = useMemo(() => nodes.find(isIndexNode), [nodes]);
  const entryNodes = useMemo(() => nodes.filter(n => !isSystemNode(n)), [nodes]);

  // Group entry nodes by first tag
  const entryGroups = useMemo(() => {
    const groups = new Map<string, MemoryNode[]>();
    for (const n of entryNodes) {
      const tags = parseMemoryTags(n.tags).filter(t => t !== WIKI_SCHEMA_TAG);
      const key = tags[0] ?? '—';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(n);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [entryNodes]);

  // Group raw files by source_type
  const sourceGroups = useMemo(() => {
    const groups = new Map<string, RawFileEntry[]>();
    for (const f of rawFiles) {
      if (!groups.has(f.source_type)) groups.set(f.source_type, []);
      groups.get(f.source_type)!.push(f);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rawFiles]);

  const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) : null;
  const selectedRawFile = selectedRawPath ? rawFiles.find(f => f.relative_path === selectedRawPath) : null;

  const handleSelectNode = (id: string) => {
    setSelectedNodeId(id);
    setSelectedRawPath(null);
    setSubTab('wiki');
    setRightPanel('editor');
  };

  const handleSelectRawFile = (relativePath: string) => {
    setSelectedRawPath(relativePath);
    setSelectedNodeId(null);
    setSubTab('sources');
    setRightPanel('editor');
  };

  const handleDelete = async (node: MemoryNode) => {
    if (!window.confirm(t('wiki.deleteConfirm'))) return;
    await deleteMemoryNode(node.id);
    setNodes(prev => prev.filter(n => n.id !== node.id));
    setEdges(prev => prev.filter(e => e.from_node_id !== node.id && e.to_node_id !== node.id));
    if (selectedNodeId === node.id) setSelectedNodeId(null);
  };

  const handleUpdatePosition = async (nodeId: string, x: number, y: number) => {
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, position_x: x, position_y: y } : n));
    try { await updateMemoryNodePosition(nodeId, x, y); } catch { /* ignore */ }
  };

  const handleCreateEdge = async (fromId: string, toId: string) => {
    try {
      const edge = await createMemoryEdge(projectId, { from_node_id: fromId, to_node_id: toId, relation_type: 'related' });
      setEdges(prev => [...prev, edge]);
    } catch { /* ignore duplicate */ }
  };

  const handleConnectionRequest = (fromId: string, toId: string) => setPendingConnection({ fromId, toId });

  const handleResolveConnection = async (kind: 'wikilink' | 'edge') => {
    if (!pendingConnection) return;
    const { fromId, toId } = pendingConnection;
    if (kind === 'wikilink') {
      try {
        const updated = await insertMemoryWikilink(fromId, { targetNodeId: toId });
        setNodes(prev => prev.map(n => n.id === updated.id ? updated : n));
      } catch { /* ignore */ }
    } else {
      await handleCreateEdge(fromId, toId);
    }
    setPendingConnection(null);
  };

  const handleDeleteEdge = async (edgeId: string) => {
    await deleteMemoryEdge(edgeId);
    setEdges(prev => prev.filter(e => e.id !== edgeId));
  };

  const handleSaveEdge = async (edgeId: string, relation: MemoryRelationType, label: string) => {
    const updated = await updateMemoryEdge(edgeId, { relation_type: relation, label: label || null });
    setEdges(prev => prev.map(e => e.id === edgeId ? updated : e));
    setEditingEdge(null);
  };

  const handleNodeUpdated = (updated: MemoryNode) => {
    setNodes(prev => prev.map(n => n.id === updated.id ? updated : n));
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-warm-800">{t('wiki.title')}</h2>
        <div className="ml-3 inline-flex rounded-lg border border-warm-200 overflow-hidden">
          <button
            onClick={() => setSubTab('wiki')}
            className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium ${subTab === 'wiki' ? 'bg-warm-700 text-warm-50' : 'bg-warm-50 text-warm-700 hover:bg-warm-100'}`}
          >
            <FileText size={12} /> {t('wiki.subTab.wiki')}
          </button>
          <button
            onClick={() => setSubTab('sources')}
            className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border-l border-warm-200 ${subTab === 'sources' ? 'bg-warm-700 text-warm-50' : 'bg-warm-50 text-warm-700 hover:bg-warm-100'}`}
          >
            <Database size={12} /> {t('wiki.subTab.sources')}
            {rawFiles.length > 0 && (
              <span className={`text-[10px] ${subTab === 'sources' ? 'text-warm-200' : 'text-warm-400'}`}>{rawFiles.length}</span>
            )}
          </button>
          <button
            onClick={() => setSubTab('activity')}
            className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border-l border-warm-200 ${subTab === 'activity' ? 'bg-warm-700 text-warm-50' : 'bg-warm-50 text-warm-700 hover:bg-warm-100'}`}
          >
            <Activity size={12} /> {t('wiki.subTab.activity')}
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowDiskDiff(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-warm-300 text-warm-700 text-xs font-medium hover:bg-warm-100"
            title={t('wiki.diskDiff.tooltip')}
          >
            <FolderSync size={12} /> {t('wiki.diskDiff.button')}
          </button>
          <button
            onClick={() => setShowLint(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-warm-300 text-warm-700 text-xs font-medium hover:bg-warm-100"
          >
            <Wrench size={12} /> {t('wiki.lint')}
          </button>
          <button
            onClick={() => setShowIngest(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-warm-300 text-warm-700 text-xs font-medium hover:bg-warm-100"
          >
            <Download size={12} /> {t('wiki.ingest')}
          </button>
        </div>
      </div>

      {/* Main: sidebar + content (Activity tab uses full width with no sidebar) */}
      <div ref={outerRef} className="flex border border-warm-200 rounded-xl overflow-hidden" style={{ height: 'calc(100vh - 280px)', minHeight: 480 }}>

        {subTab === 'activity' ? (
          <ActivityPanel
            logs={logs}
            loaded={logsLoaded}
            allNodes={nodes}
            onReload={reloadLogs}
            onSelectNode={handleSelectNode}
            onSelectRawFileBySourceId={(sourceType, sourceId) => {
              const matched = rawFiles.find(f => f.source_type === sourceType && (f.derived_node_ids.length > 0 || f.filename.includes((sourceId ?? '').slice(0, 8))));
              if (matched) {
                setSubTab('sources');
                setSelectedRawPath(matched.relative_path);
                setSelectedNodeId(null);
              }
            }}
          />
        ) : (
        <>
        {/* ── Left Sidebar ── */}
        <div style={{ width: sidebarWidth }} className="flex-shrink-0 bg-warm-50 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto py-1">
            {subTab === 'wiki' ? (
              <>
                {(schemaNode || indexNode) && (
                  <div className="border-b border-warm-200 pb-1 mb-1">
                    <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-warm-500">
                      {t('wiki.systemSection')}
                    </div>
                    {indexNode && (
                      <SidebarItem
                        node={indexNode}
                        selected={selectedNodeId === indexNode.id}
                        onClick={() => handleSelectNode(indexNode.id)}
                        onDelete={handleDelete}
                        icon={<Network size={12} className="text-blue-500 flex-shrink-0" />}
                      />
                    )}
                    {schemaNode && (
                      <SidebarItem
                        node={schemaNode}
                        selected={selectedNodeId === schemaNode.id}
                        onClick={() => handleSelectNode(schemaNode.id)}
                        onDelete={handleDelete}
                        icon={<FileText size={12} className="text-amber-500 flex-shrink-0" />}
                      />
                    )}
                    <p className="px-3 pb-1 text-[10px] text-warm-400 leading-snug">
                      {t('wiki.systemSectionHint')}
                    </p>
                  </div>
                )}
                {entryGroups.length === 0 ? (
                  <p className="px-4 py-2 text-[11px] text-warm-400 italic">empty — use Ingest</p>
                ) : (
                  entryGroups.map(([group, groupNodes]) => (
                    <TagGroup key={group} label={group} nodes={groupNodes} selectedId={selectedNodeId} onSelect={handleSelectNode} onDelete={handleDelete} />
                  ))
                )}
              </>
            ) : (
              rawFiles.length === 0 ? (
                <p className="px-4 py-2 text-[11px] text-warm-400 italic">{t('wiki.sources.noFiles')}</p>
              ) : (
                sourceGroups.map(([sourceType, files]) => (
                  <RawSourceGroup
                    key={sourceType}
                    label={sourceType}
                    files={files}
                    selectedPath={selectedRawPath}
                    onSelect={handleSelectRawFile}
                  />
                ))
              )
            )}
          </div>
        </div>

        <WikiResizer onResize={handleSidebarResize} />

        {/* ── Right Content ── */}
        <div className="flex-1 flex flex-col overflow-hidden relative min-w-0">
          {/* Panel toggle (only when node selected) */}
          {selectedNode && (
            <div className="absolute top-2 right-2 z-10 inline-flex rounded-lg border border-warm-200 overflow-hidden shadow-sm">
              <button
                onClick={() => setRightPanel('graph')}
                className={`px-2.5 py-1 text-[11px] flex items-center gap-1 ${rightPanel === 'graph' ? 'bg-warm-700 text-warm-50' : 'bg-warm-50 text-warm-600 hover:bg-warm-100'}`}
              >
                <Network size={11} /> Graph
              </button>
              <button
                onClick={() => setRightPanel('editor')}
                className={`px-2.5 py-1 text-[11px] flex items-center gap-1 ${rightPanel === 'editor' ? 'bg-warm-700 text-warm-50' : 'bg-warm-50 text-warm-600 hover:bg-warm-100'}`}
              >
                <Edit2 size={11} /> Edit
              </button>
            </div>
          )}

          {subTab === 'wiki' ? (
            rightPanel === 'editor' && selectedNode ? (
              <InlineEditor
                node={selectedNode}
                allNodes={nodes}
                rawFiles={rawFiles}
                edges={edges}
                onUpdated={handleNodeUpdated}
                onDelete={handleDelete}
                onSelectNode={handleSelectNode}
                onSelectRawFile={handleSelectRawFile}
              />
            ) : (
              nodes.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-8">
                  <p className="text-warm-700 font-medium mb-1">{t('wiki.empty')}</p>
                  <p className="text-sm text-warm-500">{t('wiki.emptyHint')}</p>
                </div>
              ) : (
                <MemoryNetworkGraph
                  nodes={nodes}
                  edges={edges}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={(id) => { if (id) handleSelectNode(id); else { setSelectedNodeId(null); setSelectedRawPath(null); } }}
                  onCreateConnection={handleConnectionRequest}
                  onUpdateNodePosition={handleUpdatePosition}
                />
              )
            )
          ) : (
            selectedRawFile ? (
              <RawFileViewer
                projectId={projectId}
                file={selectedRawFile}
                allNodes={nodes}
                onSelectNode={handleSelectNode}
                onDeleted={() => { setSelectedRawPath(null); reload(); }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center px-8">
                {rawFiles.length === 0 ? (
                  <>
                    <Database size={32} className="text-warm-300 mb-3" />
                    <p className="text-warm-700 font-medium mb-1">{t('wiki.sources.noFiles')}</p>
                  </>
                ) : (
                  <>
                    <FileText size={32} className="text-warm-300 mb-3" />
                    <p className="text-sm text-warm-500">{t('wiki.sources.empty')}</p>
                  </>
                )}
              </div>
            )
          )}
        </div>
        </>
        )}
      </div>

      {/* Modals */}
      {editingEdge && (
        <EdgeEditModal
          edge={editingEdge}
          onClose={() => setEditingEdge(null)}
          onSave={handleSaveEdge}
          onDelete={async (id) => { await handleDeleteEdge(id); setEditingEdge(null); }}
        />
      )}
      {pendingConnection && (
        <ConnectionKindModal
          fromNode={nodes.find(n => n.id === pendingConnection.fromId)}
          toNode={nodes.find(n => n.id === pendingConnection.toId)}
          onClose={() => setPendingConnection(null)}
          onChoose={handleResolveConnection}
        />
      )}
      {showIngest && (
        <IngestModal
          projectId={projectId}
          onClose={() => setShowIngest(false)}
          onDone={() => { setShowIngest(false); reload(); }}
        />
      )}
      {showLint && (
        <LintModal
          projectId={projectId}
          nodes={nodes}
          onClose={() => setShowLint(false)}
          onChanged={reload}
        />
      )}
      {showDiskDiff && (
        <DiskDiffModal
          projectId={projectId}
          onClose={() => setShowDiskDiff(false)}
          onRebuilt={reload}
        />
      )}
    </div>
  );
}

// ── Sidebar helpers ──

function SectionHeader({ label, open, onToggle, count }: { label: string; open: boolean; onToggle: () => void; count: number }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold text-warm-500 hover:text-warm-700 hover:bg-warm-100 select-none"
    >
      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      <span className="font-mono">{label}</span>
      <span className="ml-auto text-warm-400">{count}</span>
    </button>
  );
}

function TagGroup({ label, nodes, selectedId, onSelect, onDelete, icon }: {
  label: string;
  nodes: MemoryNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (node: MemoryNode) => void;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1 pl-5 pr-2 py-1 text-[11px] text-warm-500 hover:text-warm-700 hover:bg-warm-100 select-none"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {icon}
        <span className="truncate">{label}</span>
        <span className="ml-auto text-warm-400">{nodes.length}</span>
      </button>
      {open && nodes.map(n => (
        <SidebarItem key={n.id} node={n} selected={selectedId === n.id} onClick={() => onSelect(n.id)} onDelete={onDelete} />
      ))}
    </div>
  );
}

function SidebarItem({ node, selected, onClick, onDelete, icon }: {
  node: MemoryNode;
  selected: boolean;
  onClick: () => void;
  onDelete: (node: MemoryNode) => void;
  icon?: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className={`group flex items-center gap-1 pl-9 pr-2 py-1 cursor-pointer text-[12px] transition-colors ${selected ? 'bg-warm-200 text-warm-900' : 'text-warm-700 hover:bg-warm-100'}`}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {icon}
      {node.pinned === 1 && <Pin size={10} className="text-warm-400 flex-shrink-0" />}
      <span className="truncate flex-1">{node.title}</span>
      {node.source_type && <span className="text-[9px] text-warm-400 flex-shrink-0">auto</span>}
      {hovered && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(node); }}
          className="p-0.5 rounded hover:bg-red-100 text-red-400 flex-shrink-0"
        >
          <Trash2 size={10} />
        </button>
      )}
    </div>
  );
}

function RawSourceGroup({ label, files, selectedPath, onSelect }: {
  label: string;
  files: RawFileEntry[];
  selectedPath: string | null;
  onSelect: (relativePath: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1 pl-5 pr-2 py-1 text-[11px] text-warm-500 hover:text-warm-700 hover:bg-warm-100 select-none"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Database size={10} className="text-warm-400" />
        <span className="truncate font-mono">{label}/</span>
        <span className="ml-auto text-warm-400">{files.length}</span>
      </button>
      {open && files.map(f => (
        <div
          key={f.relative_path}
          onClick={() => onSelect(f.relative_path)}
          className={`group flex items-center gap-1 pl-9 pr-2 py-1 cursor-pointer text-[12px] transition-colors ${selectedPath === f.relative_path ? 'bg-warm-200 text-warm-900' : 'text-warm-700 hover:bg-warm-100'}`}
        >
          <FileText size={10} className="text-warm-400 flex-shrink-0" />
          <span className="truncate flex-1" title={f.filename}>{f.filename}</span>
          {f.derived_node_ids.length > 0 && (
            <span className="text-[9px] text-warm-400 flex-shrink-0">{f.derived_node_ids.length}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Inline Editor ──

interface InlineEditorProps {
  node: MemoryNode;
  allNodes: MemoryNode[];
  rawFiles: RawFileEntry[];
  edges: MemoryEdge[];
  onUpdated: (node: MemoryNode) => void;
  onDelete: (node: MemoryNode) => void;
  onSelectNode: (id: string) => void;
  onSelectRawFile: (relativePath: string) => void;
}

function InlineEditor({ node, allNodes, rawFiles, edges, onUpdated, onDelete, onSelectNode, onSelectRawFile }: InlineEditorProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState(node.title);
  const [body, setBody] = useState(node.body ?? '');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>(parseMemoryTags(node.tags).filter(t => t !== WIKI_SCHEMA_TAG));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Reset when node changes
  useEffect(() => {
    setTitle(node.title);
    setBody(node.body ?? '');
    setTags(parseMemoryTags(node.tags).filter(t => t !== WIKI_SCHEMA_TAG));
    setDirty(false);
  }, [node.id]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await updateMemoryNode(node.id, {
        title: title.trim() || node.title,
        body,
        tags: tags.length > 0 ? tags : null,
      });
      if (updated) { onUpdated(updated); setDirty(false); }
    } finally {
      setSaving(false);
    }
  };

  const addTag = (raw: string) => {
    const cleaned = raw.trim();
    if (cleaned && !tags.includes(cleaned)) {
      setTags(prev => [...prev, cleaned]);
      setDirty(true);
    }
    setTagInput('');
  };

  const nodeEdges = edges.filter(e => e.from_node_id === node.id || e.to_node_id === node.id);
  const idToTitle = new Map(allNodes.map(n => [n.id, n.title]));

  const sourceFile = node.source_path ? rawFiles.find(f => f.relative_path === node.source_path) : undefined;
  const siblingCount = sourceFile ? sourceFile.derived_node_ids.length : 0;

  const [assetError, setAssetError] = useState('');
  const [assetUploading, setAssetUploading] = useState(false);

  const insertAtCursor = useCallback((insertion: string) => {
    const ta = bodyRef.current;
    if (!ta) {
      setBody(prev => `${prev}${prev && !prev.endsWith('\n') ? '\n' : ''}${insertion}`);
      setDirty(true);
      return;
    }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    const next = body.slice(0, start) + insertion + body.slice(end);
    setBody(next);
    setDirty(true);
    requestAnimationFrame(() => {
      const t = bodyRef.current;
      if (!t) return;
      t.focus();
      const pos = start + insertion.length;
      t.selectionStart = pos;
      t.selectionEnd = pos;
    });
  }, [body]);

  const uploadAndInsertImage = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 10 * 1024 * 1024) {
      setAssetError(t('wiki.asset.tooLarge'));
      return;
    }
    setAssetError('');
    setAssetUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : '');
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(file);
      });
      const res = await uploadWikiAsset(node.project_id, file.name || 'image', dataUrl);
      const alt = file.name?.replace(/\.[^.]+$/, '') || 'image';
      insertAtCursor(`![${alt}](${res.relativePath})`);
    } catch (err) {
      setAssetError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setAssetUploading(false);
    }
  }, [node.project_id, insertAtCursor, t]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          uploadAndInsertImage(file);
          return;
        }
      }
    }
  }, [uploadAndInsertImage]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLTextAreaElement>) => {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const images = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (images.length === 0) return;
    e.preventDefault();
    for (const file of images) {
      uploadAndInsertImage(file);
    }
  }, [uploadAndInsertImage]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Title bar */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-2 border-b border-warm-200">
        <input
          value={title}
          onChange={e => { setTitle(e.target.value); setDirty(true); }}
          className="flex-1 text-base font-semibold bg-transparent border-none outline-none text-warm-900 min-w-0"
          onKeyDown={e => { if (e.key === 'Enter') bodyRef.current?.focus(); }}
        />
        <div className="flex items-center gap-1 flex-shrink-0">
          {dirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-warm-700 text-warm-50 text-xs font-medium hover:bg-warm-800 disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {t('wiki.save')}
            </button>
          )}
          {node.source_path && (
            <button
              onClick={() => setShowRaw(true)}
              className="p-1.5 rounded hover:bg-warm-200 text-warm-500"
              title={t('wiki.viewRaw')}
            >
              <FileText size={14} />
            </button>
          )}
          <button
            onClick={() => onDelete(node)}
            className="p-1.5 rounded hover:bg-red-100 text-red-500"
            title={t('wiki.delete')}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap items-center gap-1 px-4 py-2 border-b border-warm-100">
        {tags.map(tag => (
          <span key={tag} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-warm-200 text-[11px] text-warm-700">
            {tag}
            <button onClick={() => { setTags(prev => prev.filter(t => t !== tag)); setDirty(true); }} className="hover:text-red-500">×</button>
          </span>
        ))}
        <input
          value={tagInput}
          onChange={e => setTagInput(e.target.value)}
          onKeyDown={e => { if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) { e.preventDefault(); addTag(tagInput); } }}
          onBlur={() => { if (tagInput.trim()) addTag(tagInput); }}
          placeholder="+ tag"
          className="text-[11px] bg-transparent outline-none text-warm-500 placeholder-warm-400 w-16"
        />
      </div>

      {/* Source file sibling chip */}
      {sourceFile && siblingCount >= 2 && (
        <button
          onClick={() => onSelectRawFile(sourceFile.relative_path)}
          className="mx-4 mt-2 inline-flex items-center gap-1.5 self-start px-2 py-0.5 rounded-full bg-warm-100 hover:bg-warm-200 text-[11px] text-warm-600 border border-warm-200"
        >
          <FileText size={10} />
          {t('wiki.rawFile.openSiblings').replace('{n}', String(siblingCount))}
        </button>
      )}

      {/* Schema banner — when editing the wiki schema node, surface that this is special */}
      {isSchemaNode(node) && (
        <div className="mx-4 mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <div className="font-semibold">{t('wiki.schemaBannerTitle')}</div>
          <div className="mt-0.5 text-amber-700">{t('wiki.schemaBannerHint')}</div>
        </div>
      )}

      {/* Index banner — auto-maintained, manual edits are overwritten */}
      {isIndexNode(node) && (
        <div className="mx-4 mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
          <div className="font-semibold">{t('wiki.indexBannerTitle')}</div>
          <div className="mt-0.5 text-blue-700">{t('wiki.indexBannerHint')}</div>
        </div>
      )}

      {/* Body editor */}
      <textarea
        ref={bodyRef}
        value={body}
        onChange={e => { setBody(e.target.value); setDirty(true); }}
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }}
        placeholder={t('wiki.form.bodyPlaceholder')}
        className="flex-1 px-4 py-3 text-sm text-warm-800 bg-transparent resize-none outline-none font-mono leading-relaxed"
        style={{ minHeight: 0 }}
      />

      {(assetUploading || assetError) && (
        <div className="px-4 py-1.5 border-t border-warm-100 text-[11px] flex items-center gap-2">
          {assetUploading && (
            <span className="inline-flex items-center gap-1 text-warm-500"><Loader2 size={11} className="animate-spin" />{t('wiki.asset.uploading')}</span>
          )}
          {assetError && (
            <span className="text-status-error">{assetError}</span>
          )}
        </div>
      )}

      {/* Connections */}
      {nodeEdges.length > 0 && (
        <div className="border-t border-warm-200 px-4 py-2 max-h-32 overflow-y-auto">
          <p className="text-[10px] font-semibold text-warm-500 uppercase tracking-wide mb-1">{t('wiki.connections')}</p>
          <div className="space-y-0.5">
            {nodeEdges.map(e => {
              const isOut = e.from_node_id === node.id;
              const otherId = isOut ? e.to_node_id : e.from_node_id;
              const otherTitle = idToTitle.get(otherId) ?? otherId;
              return (
                <div key={e.id} className="flex items-center gap-1 text-[11px] text-warm-600">
                  <span className="text-warm-400">{isOut ? '→' : '←'}</span>
                  <span className="text-warm-400">[{e.relation_type}]</span>
                  <button
                    onClick={() => onSelectNode(otherId)}
                    className="hover:underline text-warm-700 truncate max-w-[200px] text-left"
                  >
                    {otherTitle}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showRaw && <RawSourceModal node={node} onClose={() => setShowRaw(false)} />}
    </div>
  );
}

// ── Raw source modal ──

interface RawSourceModalProps { node: MemoryNode; onClose: () => void; }

function RawSourceModal({ node, onClose }: RawSourceModalProps) {
  const { t } = useI18n();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getMemoryNodeRaw(node.id)
      .then(setContent)
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [node.id]);

  return (
    <Modal open={true} onClose={onClose} size="lg">
      <div className="bg-warm-50 rounded-xl border border-warm-200 p-5 shadow-soft">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-warm-800">{t('wiki.viewRaw')}</h3>
          {node.source_path && (
            <code className="text-[11px] text-warm-500 truncate max-w-[60%]">{node.source_path}</code>
          )}
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-warm-500 py-8 justify-center">
            <Loader2 size={14} className="animate-spin" /> {t('wiki.loading')}
          </div>
        ) : error ? (
          <p className="text-sm text-status-error py-4">{error}</p>
        ) : (
          <pre className="text-xs text-warm-800 bg-warm-100 rounded-lg p-3 max-h-[60vh] overflow-auto whitespace-pre-wrap font-mono">{content}</pre>
        )}
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-warm-300 text-warm-700 text-sm hover:bg-warm-100">{t('wiki.close')}</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Connection kind modal ──

interface ConnectionKindModalProps {
  fromNode?: MemoryNode;
  toNode?: MemoryNode;
  onClose: () => void;
  onChoose: (kind: 'wikilink' | 'edge') => Promise<void>;
}

function ConnectionKindModal({ fromNode, toNode, onClose, onChoose }: ConnectionKindModalProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  if (!fromNode || !toNode) return null;
  const handle = async (kind: 'wikilink' | 'edge') => {
    if (busy) return;
    setBusy(true);
    try { await onChoose(kind); } finally { setBusy(false); }
  };
  return (
    <Modal open={true} onClose={onClose} size="sm">
      <div className="bg-warm-50 rounded-xl border border-warm-200 p-5 shadow-soft">
        <h3 className="text-base font-semibold text-warm-800 mb-1">{t('wiki.connect.title')}</h3>
        <p className="text-sm text-warm-600 mb-4">
          <span className="font-medium">{fromNode.title}</span> → <span className="font-medium">{toNode.title}</span>
        </p>
        <div className="space-y-2">
          <button onClick={() => handle('wikilink')} disabled={busy} className="w-full text-left p-3 rounded-lg border border-warm-200 hover:border-warm-400 hover:bg-warm-100 disabled:opacity-50">
            <div className="text-sm font-medium text-warm-800">{t('wiki.connect.wikilink')}</div>
            <div className="text-xs text-warm-500 mt-0.5">{t('wiki.connect.wikilinkHint')}</div>
          </button>
          <button onClick={() => handle('edge')} disabled={busy} className="w-full text-left p-3 rounded-lg border border-warm-200 hover:border-warm-400 hover:bg-warm-100 disabled:opacity-50">
            <div className="text-sm font-medium text-warm-800">{t('wiki.connect.edge')}</div>
            <div className="text-xs text-warm-500 mt-0.5">{t('wiki.connect.edgeHint')}</div>
          </button>
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-warm-300 text-warm-700 text-sm hover:bg-warm-100">{t('wiki.cancel')}</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Edge edit modal ──

interface EdgeEditModalProps {
  edge: MemoryEdge;
  onClose: () => void;
  onSave: (edgeId: string, relation: MemoryRelationType, label: string) => Promise<void>;
  onDelete: (edgeId: string) => Promise<void>;
}

function EdgeEditModal({ edge, onClose, onSave, onDelete }: EdgeEditModalProps) {
  const { t } = useI18n();
  const [relation, setRelation] = useState<MemoryRelationType>(edge.relation_type);
  const [label, setLabel] = useState(edge.label ?? '');
  const [saving, setSaving] = useState(false);
  return (
    <Modal open={true} onClose={onClose} size="sm">
      <div className="bg-warm-50 rounded-xl border border-warm-200 p-5 shadow-soft">
        <h3 className="text-base font-semibold text-warm-800 mb-4">{t('wiki.edge.editTitle')}</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-warm-600 mb-1">{t('wiki.edge.relationType')}</label>
            <select value={relation} onChange={e => setRelation(e.target.value as MemoryRelationType)} className="w-full px-3 py-2 rounded-lg border border-warm-200 bg-warm-0 text-sm focus:outline-none">
              {RELATION_TYPES.map(rt => <option key={rt} value={rt}>{t(`wiki.edge.relations.${rt}`)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-warm-600 mb-1">{t('wiki.edge.label')}</label>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder={t('wiki.edge.labelPlaceholder')} className="w-full px-3 py-2 rounded-lg border border-warm-200 bg-warm-0 text-sm focus:outline-none" />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={async () => { if (saving) return; setSaving(true); try { await onSave(edge.id, relation, label); } finally { setSaving(false); } }} disabled={saving} className="px-4 py-2 rounded-lg bg-warm-700 text-warm-50 text-sm font-medium hover:bg-warm-800 disabled:opacity-50">
            {t('wiki.save')}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-warm-300 text-warm-700 text-sm hover:bg-warm-100">{t('wiki.cancel')}</button>
          <button onClick={async () => { if (window.confirm(t('wiki.edge.deleteConfirm'))) await onDelete(edge.id); }} className="ml-auto px-4 py-2 rounded-lg text-red-600 text-sm hover:bg-red-50">{t('wiki.delete')}</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Ingest modal ──

function IngestResultView({ result }: { result: IngestResultData }) {
  const { t } = useI18n();
  const applied = result.created + result.updated + result.edgesAdded;
  const s = result.skipped;
  const hasProposals = s.proposedCreate + s.proposedUpdate + s.proposedEdges > 0;
  const skipRows: { label: string; n: number }[] = [
    { label: t('wiki.ingest.skip.duplicate'), n: s.duplicateTitle },
    { label: t('wiki.ingest.skip.unique'), n: s.uniqueConflict },
    { label: t('wiki.ingest.skip.empty'), n: s.emptyTitle },
    { label: t('wiki.ingest.skip.badId'), n: s.invalidUpdateId },
    { label: t('wiki.ingest.skip.badEdge'), n: s.invalidEdgeRef },
    { label: t('wiki.ingest.skip.selfEdge'), n: s.selfEdge },
    { label: t('wiki.ingest.skip.edgeUnique'), n: s.edgeUniqueConflict },
  ].filter(r => r.n > 0);

  if (applied > 0) {
    return (
      <div className="mt-3 text-xs text-status-success">
        {t('wiki.ingest.success').replace('{created}', String(result.created)).replace('{updated}', String(result.updated)).replace('{edges}', String(result.edgesAdded))}
        {skipRows.length > 0 && (
          <div className="mt-1 text-warm-500">
            {t('wiki.ingest.skipNote')}: {skipRows.map(r => `${r.label} ${r.n}`).join(', ')}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-warm-200 bg-warm-100/50 p-3 text-xs text-warm-700 space-y-1.5">
      <div className="font-medium text-warm-800">
        {s.parseFailed
          ? t('wiki.ingest.parseFailed')
          : hasProposals
            ? t('wiki.ingest.allSkipped')
            : t('wiki.ingest.modelEmpty')}
      </div>
      {hasProposals && (
        <div className="text-warm-600">
          {t('wiki.ingest.proposed')
            .replace('{c}', String(s.proposedCreate))
            .replace('{u}', String(s.proposedUpdate))
            .replace('{e}', String(s.proposedEdges))}
        </div>
      )}
      {skipRows.length > 0 && (
        <ul className="list-disc list-inside space-y-0.5 text-warm-600">
          {skipRows.map(r => <li key={r.label}>{r.label}: {r.n}</li>)}
        </ul>
      )}
      {result.rawResponseSnippet && (
        <details className="mt-1">
          <summary className="cursor-pointer text-warm-500 hover:text-warm-700">{t('wiki.ingest.rawSnippet')}</summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-warm-50 p-2 text-2xs text-warm-700 border border-warm-200">{result.rawResponseSnippet}</pre>
        </details>
      )}
    </div>
  );
}

interface IngestModalProps { projectId: string; onClose: () => void; onDone: () => void; }

function IngestModal({ projectId, onClose, onDone }: IngestModalProps) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<'task' | 'discussion' | 'text'>('task');
  const [todos, setTodos] = useState<Todo[]>([]);
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [selectedTodoId, setSelectedTodoId] = useState('');
  const [selectedDiscussionId, setSelectedDiscussionId] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<IngestResultData | null>(null);

  useEffect(() => {
    getTodos(projectId).then(all => setTodos(all.filter(td => td.status === 'completed'))).catch(() => {});
    getDiscussions(projectId).then(all => setDiscussions(all.filter(d => d.status === 'completed'))).catch(() => {});
  }, [projectId]);

  const canRun =
    tab === 'task' ? !!selectedTodoId :
    tab === 'discussion' ? !!selectedDiscussionId :
    pasteText.trim().length > 0;

  const handleRun = async () => {
    if (!canRun || running) return;
    setRunning(true); setResult(null); setError('');
    try {
      let payload: { source_text?: string; source_type?: string; source_id?: string; locale?: string };
      if (tab === 'task') {
        payload = { source_type: 'todo', source_id: selectedTodoId, locale: lang };
      } else if (tab === 'discussion') {
        payload = { source_type: 'discussion', source_id: selectedDiscussionId, locale: lang };
      } else {
        payload = { source_type: 'manual', source_text: pasteText.trim(), locale: lang };
      }
      const res = await ingestMemory(projectId, payload);
      setResult(res);
      const applied = res.created + res.updated + res.edgesAdded;
      if (applied > 0) setTimeout(onDone, 1500);
    } catch (err) {
      console.error('Ingest failed', err);
      setError(err instanceof Error ? err.message : String(err));
    }
    finally { setRunning(false); }
  };

  return (
    <Modal open={true} onClose={onClose} size="md" disableBackdropClose={running} disableEscClose={running}>
      <div className="bg-warm-50 rounded-xl border border-warm-200 p-5 shadow-soft">
        <h3 className="text-base font-semibold text-warm-800 mb-4">{t('wiki.ingest.title')}</h3>
        <div className="inline-flex rounded-lg border border-warm-200 overflow-hidden mb-4">
          <button onClick={() => setTab('task')} className={`px-3 py-1.5 text-xs ${tab === 'task' ? 'bg-warm-700 text-warm-50' : 'bg-warm-50 text-warm-700 hover:bg-warm-100'}`}>{t('wiki.ingest.tabTask')}</button>
          <button onClick={() => setTab('discussion')} className={`px-3 py-1.5 text-xs ${tab === 'discussion' ? 'bg-warm-700 text-warm-50' : 'bg-warm-50 text-warm-700 hover:bg-warm-100'}`}>{t('wiki.ingest.tabDiscussion')}</button>
          <button onClick={() => setTab('text')} className={`px-3 py-1.5 text-xs ${tab === 'text' ? 'bg-warm-700 text-warm-50' : 'bg-warm-50 text-warm-700 hover:bg-warm-100'}`}>{t('wiki.ingest.tabText')}</button>
        </div>
        {tab === 'task' ? (
          todos.length === 0 ? <p className="text-sm text-warm-500 py-4">{t('wiki.ingest.noTasks')}</p> : (
            <select value={selectedTodoId} onChange={e => setSelectedTodoId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-warm-200 bg-warm-50 text-sm focus:outline-none">
              <option value="">{t('wiki.ingest.selectTask')}</option>
              {todos.map(todo => <option key={todo.id} value={todo.id}>{todo.title}</option>)}
            </select>
          )
        ) : tab === 'discussion' ? (
          discussions.length === 0 ? <p className="text-sm text-warm-500 py-4">{t('wiki.ingest.noDiscussions')}</p> : (
            <select value={selectedDiscussionId} onChange={e => setSelectedDiscussionId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-warm-200 bg-warm-50 text-sm focus:outline-none">
              <option value="">{t('wiki.ingest.selectDiscussion')}</option>
              {discussions.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          )
        ) : (
          <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder={t('wiki.ingest.textPlaceholder')} rows={8} className="w-full px-3 py-2 rounded-lg border border-warm-200 bg-warm-50 text-sm resize-y focus:outline-none" />
        )}
        {error && <p className="mt-3 text-xs text-status-error">{error}</p>}
        {result && <IngestResultView result={result} />}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} disabled={running} className="px-4 py-2 rounded-lg border border-warm-300 text-warm-700 text-sm hover:bg-warm-100 disabled:opacity-50">{t('wiki.cancel')}</button>
          <button onClick={handleRun} disabled={!canRun || running} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-warm-700 text-warm-50 text-sm font-medium hover:bg-warm-800 disabled:opacity-50">
            {running && <Loader2 size={14} className="animate-spin" />}
            {running ? t('wiki.ingest.running') : t('wiki.ingest.run')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Lint modal ──

interface LintIssue { type: string; node_titles: string[]; message: string; }

interface LintModalProps {
  projectId: string;
  nodes: MemoryNode[];
  onClose: () => void;
  onChanged: () => void;
}

const ISSUE_COLORS: Record<string, string> = {
  contradiction: 'text-red-600 bg-red-50 border-red-200',
  orphan: 'text-warm-500 bg-warm-100 border-warm-200',
  duplicate: 'text-amber-600 bg-amber-50 border-amber-200',
  stale: 'text-blue-600 bg-blue-50 border-blue-200',
};

function LintModal({ projectId, nodes, onClose, onChanged }: LintModalProps) {
  const { t } = useI18n();
  const [running, setRunning] = useState(true);
  const [issues, setIssues] = useState<LintIssue[]>([]);
  const [error, setError] = useState('');
  const [busyIdx, setBusyIdx] = useState<number | null>(null);

  const runLint = useCallback(() => {
    setRunning(true);
    setError('');
    lintMemory(projectId)
      .then(res => setIssues(res.issues))
      .catch(err => setError(err instanceof Error ? err.message : 'Error'))
      .finally(() => setRunning(false));
  }, [projectId]);

  useEffect(() => { runLint(); }, [runLint]);

  const titleToNode = useMemo(() => {
    const m = new Map<string, MemoryNode>();
    for (const n of nodes) m.set(n.title.toLowerCase(), n);
    return m;
  }, [nodes]);
  const findNode = (title: string) => titleToNode.get(title.toLowerCase());

  const removeIssue = (idx: number) => setIssues(prev => prev.filter((_, i) => i !== idx));

  const handleDelete = async (idx: number, title: string) => {
    const node = findNode(title);
    if (!node) return;
    if (!window.confirm(t('wiki.deleteConfirm'))) return;
    setBusyIdx(idx);
    try {
      await deleteMemoryNode(node.id);
      removeIssue(idx);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusyIdx(null);
    }
  };

  const handleMerge = async (idx: number, keepTitle: string, absorbTitle: string) => {
    const keep = findNode(keepTitle);
    const absorb = findNode(absorbTitle);
    if (!keep || !absorb) return;
    const confirmMsg = t('wiki.lint.mergeConfirm')
      .replace('{keep}', keep.title)
      .replace('{absorb}', absorb.title);
    if (!window.confirm(confirmMsg)) return;
    setBusyIdx(idx);
    try {
      await mergeMemoryNodes(keep.id, absorb.id);
      removeIssue(idx);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed');
    } finally {
      setBusyIdx(null);
    }
  };

  const handleAddLink = async (idx: number, sourceTitle: string, targetNodeId: string) => {
    const source = findNode(sourceTitle);
    if (!source) return;
    setBusyIdx(idx);
    try {
      await insertMemoryWikilink(source.id, { targetNodeId });
      removeIssue(idx);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add link failed');
    } finally {
      setBusyIdx(null);
    }
  };

  return (
    <Modal open={true} onClose={onClose} size="md" disableBackdropClose={running} disableEscClose={running}>
      <div className="bg-warm-50 rounded-xl border border-warm-200 p-5 shadow-soft">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-warm-800">{t('wiki.lint.title')}</h3>
          {!running && (
            <button
              onClick={runLint}
              className="text-[11px] text-warm-500 hover:text-warm-800 underline-offset-2 hover:underline"
            >
              {t('wiki.lint.rerun')}
            </button>
          )}
        </div>
        {running ? (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-warm-500"><Loader2 size={16} className="animate-spin" />{t('wiki.lint.running')}</div>
        ) : error ? (
          <div className="flex items-center gap-2 text-sm text-red-600 py-4"><AlertCircle size={16} />{error}</div>
        ) : issues.length === 0 ? (
          <p className="text-sm text-warm-600 py-4">{t('wiki.lint.empty')}</p>
        ) : (
          <ul className="space-y-2 max-h-96 overflow-y-auto">
            {issues.map((issue, i) => (
              <li key={i} className={`rounded-lg border p-3 ${ISSUE_COLORS[issue.type] ?? 'text-warm-700 bg-warm-100 border-warm-200'}`}>
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70 mt-0.5">{issue.type}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">{issue.message}</p>
                    {issue.node_titles.length > 0 && (
                      <p className="text-[10px] opacity-70 mt-0.5">{issue.node_titles.join(', ')}</p>
                    )}
                    <IssueActions
                      issue={issue}
                      idx={i}
                      busy={busyIdx === i}
                      anyBusy={busyIdx !== null}
                      nodes={nodes}
                      findNode={findNode}
                      onDelete={handleDelete}
                      onMerge={handleMerge}
                      onAddLink={handleAddLink}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-warm-300 text-warm-700 text-sm hover:bg-warm-100">{t('wiki.lint.close')}</button>
        </div>
      </div>
    </Modal>
  );
}

interface IssueActionsProps {
  issue: LintIssue;
  idx: number;
  busy: boolean;
  anyBusy: boolean;
  nodes: MemoryNode[];
  findNode: (title: string) => MemoryNode | undefined;
  onDelete: (idx: number, title: string) => void;
  onMerge: (idx: number, keepTitle: string, absorbTitle: string) => void;
  onAddLink: (idx: number, sourceTitle: string, targetNodeId: string) => void;
}

function IssueActions({ issue, idx, busy, anyBusy, nodes, findNode, onDelete, onMerge, onAddLink }: IssueActionsProps) {
  const { t } = useI18n();
  const [linkTarget, setLinkTarget] = useState('');
  const titles = issue.node_titles;
  const disabled = anyBusy && !busy;

  const btnBase = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium transition-colors disabled:opacity-40';
  const btnNeutral = `${btnBase} border-warm-300 bg-warm-50 text-warm-700 hover:bg-warm-100`;
  const btnDanger = `${btnBase} border-red-200 bg-red-50 text-red-600 hover:bg-red-100`;

  if (issue.type === 'duplicate' && titles.length >= 2) {
    const a = titles[0];
    const b = titles[1];
    if (!findNode(a) || !findNode(b)) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button disabled={disabled || busy} onClick={() => onMerge(idx, a, b)} className={btnNeutral}>
          {busy ? <Loader2 size={10} className="animate-spin" /> : null}
          {t('wiki.lint.action.mergeKeep').replace('{keep}', a).replace('{absorb}', b)}
        </button>
        <button disabled={disabled || busy} onClick={() => onMerge(idx, b, a)} className={btnNeutral}>
          {busy ? <Loader2 size={10} className="animate-spin" /> : null}
          {t('wiki.lint.action.mergeKeep').replace('{keep}', b).replace('{absorb}', a)}
        </button>
      </div>
    );
  }

  if (issue.type === 'orphan' && titles.length >= 1) {
    const orphanTitle = titles[0];
    const orphan = findNode(orphanTitle);
    if (!orphan) return null;
    const otherNodes = nodes.filter(n => n.id !== orphan.id && !isSchemaNode(n));
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button disabled={disabled || busy} onClick={() => onDelete(idx, orphanTitle)} className={btnDanger}>
          {busy ? <Loader2 size={10} className="animate-spin" /> : null}
          {t('wiki.lint.action.delete')}
        </button>
        {otherNodes.length > 0 && (
          <>
            <select
              disabled={disabled || busy}
              value={linkTarget}
              onChange={e => setLinkTarget(e.target.value)}
              className="px-2 py-0.5 rounded-md border border-warm-300 bg-warm-50 text-[11px] text-warm-700 max-w-[160px]"
            >
              <option value="">{t('wiki.lint.action.linkTo')}</option>
              {otherNodes.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}
            </select>
            <button
              disabled={disabled || busy || !linkTarget}
              onClick={() => { if (linkTarget) { onAddLink(idx, orphanTitle, linkTarget); setLinkTarget(''); } }}
              className={btnNeutral}
            >
              {busy ? <Loader2 size={10} className="animate-spin" /> : null}
              {t('wiki.lint.action.link')}
            </button>
          </>
        )}
      </div>
    );
  }

  if (issue.type === 'stale' && titles.length >= 1) {
    const valid = titles.filter(tt => findNode(tt));
    if (valid.length === 0) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {valid.map(tt => (
          <button key={tt} disabled={disabled || busy} onClick={() => onDelete(idx, tt)} className={btnDanger}>
            {busy ? <Loader2 size={10} className="animate-spin" /> : null}
            {t('wiki.lint.action.deleteTitle').replace('{title}', tt)}
          </button>
        ))}
      </div>
    );
  }

  return null;
}

function WikiResizer({ onResize }: { onResize: (clientX: number) => void }) {
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

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function readNumber(key: string, fallback: number, lo: number, hi: number): number {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  const v = parseFloat(raw);
  return isNaN(v) ? fallback : clamp(v, lo, hi);
}

// ── Disk diff modal (read-only comparison of .clitrigger/wiki/ vs DB) ──

const DIFF_COLORS: Record<WikiDiskDiffEntry['type'], string> = {
  modified: 'text-amber-700 bg-amber-50 border-amber-200',
  missing: 'text-blue-700 bg-blue-50 border-blue-200',
  untracked: 'text-warm-700 bg-warm-100 border-warm-200',
};

function DiskDiffModal({ projectId, onClose, onRebuilt }: { projectId: string; onClose: () => void; onRebuilt: () => void; }) {
  const { t } = useI18n();
  const [running, setRunning] = useState(true);
  const [diff, setDiff] = useState<WikiDiskDiffEntry[]>([]);
  const [error, setError] = useState('');
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<string | null>(null);

  const runDiff = useCallback(() => {
    setRunning(true);
    setError('');
    getWikiDiskDiff(projectId)
      .then(r => setDiff(r.diff))
      .catch(err => setError(err instanceof Error ? err.message : 'Error'))
      .finally(() => setRunning(false));
  }, [projectId]);

  useEffect(() => { runDiff(); }, [runDiff]);

  const handleRebuild = async () => {
    if (!window.confirm(t('wiki.diskDiff.rebuildConfirm'))) return;
    setRebuilding(true);
    setRebuildResult(null);
    try {
      const res = await rebuildWikiExport(projectId);
      setRebuildResult(t('wiki.diskDiff.rebuildResult')
        .replace('{written}', String(res.written))
        .replace('{removed}', String(res.removed)));
      onRebuilt();
      runDiff();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rebuild failed');
    } finally {
      setRebuilding(false);
    }
  };

  const grouped = useMemo(() => {
    const m: Record<WikiDiskDiffEntry['type'], WikiDiskDiffEntry[]> = { modified: [], missing: [], untracked: [] };
    for (const d of diff) m[d.type].push(d);
    return m;
  }, [diff]);

  return (
    <Modal open={true} onClose={onClose} size="md" disableBackdropClose={running || rebuilding} disableEscClose={running || rebuilding}>
      <div className="bg-warm-50 rounded-xl border border-warm-200 p-5 shadow-soft">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-warm-800">{t('wiki.diskDiff.title')}</h3>
          <div className="flex items-center gap-2">
            {!running && (
              <button onClick={runDiff} className="text-[11px] text-warm-500 hover:text-warm-800 hover:underline">
                {t('wiki.diskDiff.refresh')}
              </button>
            )}
          </div>
        </div>

        <p className="text-[11px] text-warm-500 mb-3 leading-snug">{t('wiki.diskDiff.intro')}</p>

        {running ? (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-warm-500">
            <Loader2 size={16} className="animate-spin" />{t('wiki.diskDiff.running')}
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-sm text-red-600 py-4"><AlertCircle size={16} />{error}</div>
        ) : diff.length === 0 ? (
          <p className="text-sm text-warm-600 py-4">{t('wiki.diskDiff.empty')}</p>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {(['modified', 'missing', 'untracked'] as const).map(type => {
              const entries = grouped[type];
              if (entries.length === 0) return null;
              return (
                <div key={type}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-warm-500 mb-1">
                    {t(`wiki.diskDiff.section.${type}`).replace('{n}', String(entries.length))}
                  </p>
                  <ul className="space-y-1">
                    {entries.map((e, i) => (
                      <li key={`${type}-${i}`} className={`rounded-md border p-2 ${DIFF_COLORS[type]}`}>
                        <div className="flex items-baseline gap-2">
                          <code className="text-[11px] font-mono">{e.filename}</code>
                          {e.title && <span className="text-[11px] truncate">— {e.title}</span>}
                        </div>
                        {(e.diskBytes !== undefined || e.dbBytes !== undefined) && (
                          <div className="text-[10px] mt-0.5 opacity-70 font-mono">
                            {e.dbBytes !== undefined && `db=${e.dbBytes}b`}
                            {e.diskBytes !== undefined && e.dbBytes !== undefined && ' '}
                            {e.diskBytes !== undefined && `disk=${e.diskBytes}b`}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        {rebuildResult && (
          <p className="mt-3 text-xs text-status-success">{rebuildResult}</p>
        )}

        <div className="flex items-center gap-2 mt-4">
          {diff.length > 0 && !running && (
            <button
              onClick={handleRebuild}
              disabled={rebuilding}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-warm-700 text-warm-50 text-xs font-medium hover:bg-warm-800 disabled:opacity-50"
              title={t('wiki.diskDiff.rebuildTooltip')}
            >
              {rebuilding && <Loader2 size={12} className="animate-spin" />}
              {t('wiki.diskDiff.rebuild')}
            </button>
          )}
          <button
            onClick={onClose}
            disabled={running || rebuilding}
            className="ml-auto px-4 py-2 rounded-lg border border-warm-300 text-warm-700 text-sm hover:bg-warm-100 disabled:opacity-50"
          >
            {t('wiki.diskDiff.close')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Activity panel (memory_logs feed) ──

const EVENT_ICON: Record<MemoryLog['event_type'], typeof Activity> = {
  ingest: Download,
  lint: Wrench,
  retrieve: Network,
  merge: Pin,
};

const SEVERITY_BAR: Record<MemoryLog['severity'], string> = {
  info: 'border-l-warm-300',
  warning: 'border-l-amber-400',
  error: 'border-l-red-400',
};

const SEVERITY_TEXT: Record<MemoryLog['severity'], string> = {
  info: 'text-warm-700',
  warning: 'text-amber-700',
  error: 'text-red-700',
};

interface ActivityPanelProps {
  logs: MemoryLog[];
  loaded: boolean;
  allNodes: MemoryNode[];
  onReload: () => void;
  onSelectNode: (id: string) => void;
  onSelectRawFileBySourceId: (sourceType: string | null, sourceId: string | null) => void;
}

type ActivityFilter = 'all' | MemoryLog['event_type'];

function ActivityPanel({ logs, loaded, allNodes, onReload, onSelectNode, onSelectRawFileBySourceId }: ActivityPanelProps) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (filter === 'all') return logs;
    return logs.filter(l => l.event_type === filter);
  }, [logs, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: logs.length, ingest: 0, lint: 0, retrieve: 0, merge: 0 };
    for (const l of logs) c[l.event_type] = (c[l.event_type] ?? 0) + 1;
    return c;
  }, [logs]);

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filters: ActivityFilter[] = ['all', 'ingest', 'lint', 'retrieve', 'merge'];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-warm-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-warm-200 bg-warm-50">
        <div className="inline-flex rounded-md border border-warm-200 overflow-hidden">
          {filters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 text-[11px] font-medium border-r border-warm-200 last:border-r-0 ${filter === f ? 'bg-warm-700 text-warm-50' : 'bg-warm-50 text-warm-700 hover:bg-warm-100'}`}
            >
              {t(`wiki.activity.filter.${f}`)}
              <span className={`ml-1 text-[10px] ${filter === f ? 'text-warm-200' : 'text-warm-400'}`}>{counts[f] ?? 0}</span>
            </button>
          ))}
        </div>
        <button
          onClick={onReload}
          className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[11px] text-warm-600 hover:text-warm-800 hover:bg-warm-100 rounded-md"
          title={t('wiki.activity.refresh')}
        >
          <RefreshCw size={11} /> {t('wiki.activity.refresh')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!loaded ? (
          <div className="flex items-center justify-center py-8 text-sm text-warm-500 gap-2">
            <Loader2 size={14} className="animate-spin" /> {t('wiki.loading')}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-8">
            <Activity size={32} className="text-warm-300 mb-3" />
            <p className="text-warm-700 font-medium mb-1">{t('wiki.activity.empty')}</p>
            <p className="text-sm text-warm-500">{t('wiki.activity.emptyHint')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-warm-100">
            {filtered.map(log => (
              <ActivityRow
                key={log.id}
                log={log}
                expanded={expanded.has(log.id)}
                onToggle={() => toggleExpanded(log.id)}
                allNodes={allNodes}
                onSelectNode={onSelectNode}
                onSelectRawFileBySourceId={onSelectRawFileBySourceId}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ActivityRow({ log, expanded, onToggle, allNodes, onSelectNode, onSelectRawFileBySourceId }: {
  log: MemoryLog;
  expanded: boolean;
  onToggle: () => void;
  allNodes: MemoryNode[];
  onSelectNode: (id: string) => void;
  onSelectRawFileBySourceId: (sourceType: string | null, sourceId: string | null) => void;
}) {
  const Icon = EVENT_ICON[log.event_type] ?? Activity;
  const meta = useMemo(() => {
    if (!log.metadata) return null;
    try { return JSON.parse(log.metadata) as Record<string, unknown>; } catch { return null; }
  }, [log.metadata]);

  // For merge events, link to the keep node when present
  const keepId = (meta && typeof meta.keepId === 'string') ? meta.keepId : null;
  const keepNode = keepId ? allNodes.find(n => n.id === keepId) : null;

  return (
    <li
      onClick={onToggle}
      className={`px-4 py-2 border-l-4 ${SEVERITY_BAR[log.severity]} cursor-pointer hover:bg-warm-50`}
    >
      <div className="flex items-start gap-2">
        <Icon size={12} className={`mt-1 flex-shrink-0 ${SEVERITY_TEXT[log.severity]}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${SEVERITY_TEXT[log.severity]}`}>
              {log.event_type}
            </span>
            <span className="text-[10px] text-warm-400">{formatRelativeTime(log.created_at)}</span>
            {log.source_type && (
              <span className="text-[10px] text-warm-400 px-1 rounded bg-warm-100">{log.source_type}</span>
            )}
            {log.source_title && (
              <span className="text-[10px] text-warm-500 truncate max-w-[260px]">{log.source_title}</span>
            )}
          </div>
          <p className={`mt-0.5 text-sm ${SEVERITY_TEXT[log.severity]}`}>{log.message}</p>
          {keepNode && (
            <button
              onClick={(e) => { e.stopPropagation(); onSelectNode(keepNode.id); }}
              className="mt-1 text-[11px] text-warm-600 hover:text-warm-900 underline-offset-2 hover:underline"
            >
              → {keepNode.title}
            </button>
          )}
          {log.event_type === 'ingest' && log.source_type && log.source_type !== 'manual' && log.source_id && (
            <button
              onClick={(e) => { e.stopPropagation(); onSelectRawFileBySourceId(log.source_type, log.source_id); }}
              className="mt-1 text-[11px] text-warm-600 hover:text-warm-900 underline-offset-2 hover:underline"
            >
              → raw source
            </button>
          )}
          {expanded && meta && (
            <pre className="mt-2 text-[10px] text-warm-700 bg-warm-100 rounded p-2 overflow-auto max-h-48 font-mono whitespace-pre-wrap">
              {JSON.stringify(meta, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </li>
  );
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}
