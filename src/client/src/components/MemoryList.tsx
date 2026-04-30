import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown, ChevronRight, Edit2, Trash2, Pin, Network,
  Download, Wrench, Loader2, AlertCircle, Save, FileText, Database,
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
  getMemoryNodeRaw,
} from '../api/memory';
import { getTodos } from '../api/todos';
import { getDiscussions } from '../api/discussions';
import Modal from './Modal';
import MemoryNetworkGraph from './MemoryNetworkGraph';

const WIKI_SCHEMA_TAG = '__wiki_schema__';
const RELATION_TYPES: MemoryRelationType[] = ['related', 'precedes', 'example_of', 'counter_example', 'refines'];

function isSchemaNode(n: MemoryNode): boolean {
  try { return JSON.parse(n.tags ?? '[]').includes(WIKI_SCHEMA_TAG); } catch { return false; }
}

interface MemoryListProps {
  projectId: string;
}

export default function MemoryList({ projectId }: MemoryListProps) {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<MemoryNode[]>([]);
  const [edges, setEdges] = useState<MemoryEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [rightPanel, setRightPanel] = useState<'graph' | 'editor'>('graph');
  const [editingEdge, setEditingEdge] = useState<MemoryEdge | null>(null);
  const [pendingConnection, setPendingConnection] = useState<{ fromId: string; toId: string } | null>(null);
  const [showIngest, setShowIngest] = useState(false);
  const [showLint, setShowLint] = useState(false);
  const [wikiOpen, setWikiOpen] = useState(true);
  const [rawOpen, setRawOpen] = useState(true);

  const reload = () => {
    getMemoryGraph(projectId)
      .then(g => { setNodes(g.nodes); setEdges(g.edges); })
      .catch(err => console.error('Load memory graph failed', err));
  };

  useEffect(() => { reload(); }, [projectId]);

  const schemaNode = useMemo(() => nodes.find(isSchemaNode), [nodes]);
  const wikiNodes = useMemo(() => nodes.filter(n => !isSchemaNode(n) && !n.source_type), [nodes]);
  const rawNodes = useMemo(() => nodes.filter(n => !isSchemaNode(n) && !!n.source_type), [nodes]);

  // Group wiki nodes by first tag
  const wikiGroups = useMemo(() => {
    const groups = new Map<string, MemoryNode[]>();
    for (const n of wikiNodes) {
      const tags = parseMemoryTags(n.tags).filter(t => t !== WIKI_SCHEMA_TAG);
      const key = tags[0] ?? '—';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(n);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [wikiNodes]);

  // Group raw nodes by source_type
  const rawGroups = useMemo(() => {
    const groups = new Map<string, MemoryNode[]>();
    for (const n of rawNodes) {
      const key = n.source_type ?? 'manual';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(n);
    }
    return Array.from(groups.entries());
  }, [rawNodes]);

  const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) : null;

  const handleSelectNode = (id: string) => {
    setSelectedNodeId(id);
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
        <h2 className="text-lg font-semibold text-warm-800 mr-auto">{t('wiki.title')}</h2>
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

      {/* Main: sidebar + content */}
      <div className="flex border border-warm-200 rounded-xl overflow-hidden" style={{ height: 580 }}>

        {/* ── Left Sidebar ── */}
        <div className="w-52 flex-shrink-0 border-r border-warm-200 bg-warm-50 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto py-1">

            {/* SCHEMA */}
            {schemaNode && (
              <SidebarItem
                node={schemaNode}
                selected={selectedNodeId === schemaNode.id}
                onClick={() => handleSelectNode(schemaNode.id)}
                onDelete={handleDelete}
                icon={<FileText size={12} className="text-warm-400 flex-shrink-0" />}
              />
            )}

            {/* wiki/ */}
            <SectionHeader
              label="wiki/"
              open={wikiOpen}
              onToggle={() => setWikiOpen(v => !v)}
              count={wikiNodes.length}
            />
            {wikiOpen && (
              wikiGroups.length === 0 ? (
                <p className="px-4 py-2 text-[11px] text-warm-400 italic">empty — use Ingest</p>
              ) : (
                wikiGroups.map(([group, groupNodes]) => (
                  <TagGroup key={group} label={group} nodes={groupNodes} selectedId={selectedNodeId} onSelect={handleSelectNode} onDelete={handleDelete} />
                ))
              )
            )}

            {/* raw/ */}
            {rawNodes.length > 0 && (
              <>
                <SectionHeader
                  label="raw/"
                  open={rawOpen}
                  onToggle={() => setRawOpen(v => !v)}
                  count={rawNodes.length}
                />
                {rawOpen && rawGroups.map(([sourceType, sourceNodes]) => (
                  <TagGroup
                    key={sourceType}
                    label={sourceType}
                    nodes={sourceNodes}
                    selectedId={selectedNodeId}
                    onSelect={handleSelectNode}
                    onDelete={handleDelete}
                    icon={<Database size={10} className="text-warm-400" />}
                  />
                ))}
              </>
            )}
          </div>
        </div>

        {/* ── Right Content ── */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
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

          {rightPanel === 'editor' && selectedNode ? (
            <InlineEditor
              node={selectedNode}
              allNodes={nodes}
              edges={edges}
              onUpdated={handleNodeUpdated}
              onDelete={handleDelete}
              onSelectNode={handleSelectNode}
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
                onSelectNode={(id) => { setSelectedNodeId(id); setRightPanel('editor'); }}
                onCreateConnection={handleConnectionRequest}
                onUpdateNodePosition={handleUpdatePosition}
              />
            )
          )}
        </div>
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
        <LintModal projectId={projectId} onClose={() => setShowLint(false)} />
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

// ── Inline Editor ──

interface InlineEditorProps {
  node: MemoryNode;
  allNodes: MemoryNode[];
  edges: MemoryEdge[];
  onUpdated: (node: MemoryNode) => void;
  onDelete: (node: MemoryNode) => void;
  onSelectNode: (id: string) => void;
}

function InlineEditor({ node, allNodes, edges, onUpdated, onDelete, onSelectNode }: InlineEditorProps) {
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

      {/* Body editor */}
      <textarea
        ref={bodyRef}
        value={body}
        onChange={e => { setBody(e.target.value); setDirty(true); }}
        placeholder={t('wiki.form.bodyPlaceholder')}
        className="flex-1 px-4 py-3 text-sm text-warm-800 bg-transparent resize-none outline-none font-mono leading-relaxed"
        style={{ minHeight: 0 }}
      />

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

interface IngestModalProps { projectId: string; onClose: () => void; onDone: () => void; }

function IngestModal({ projectId, onClose, onDone }: IngestModalProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'task' | 'discussion' | 'text'>('task');
  const [todos, setTodos] = useState<Todo[]>([]);
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [selectedTodoId, setSelectedTodoId] = useState('');
  const [selectedDiscussionId, setSelectedDiscussionId] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ created: number; updated: number; edgesAdded: number } | null>(null);

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
      let payload: { source_text?: string; source_type?: string; source_id?: string };
      if (tab === 'task') {
        payload = { source_type: 'todo', source_id: selectedTodoId };
      } else if (tab === 'discussion') {
        payload = { source_type: 'discussion', source_id: selectedDiscussionId };
      } else {
        payload = { source_type: 'manual', source_text: pasteText.trim() };
      }
      const res = await ingestMemory(projectId, payload);
      setResult(res);
      setTimeout(onDone, 1500);
    } catch (err) {
      console.error('Ingest failed', err);
      setError(err instanceof Error ? err.message : String(err));
    }
    finally { setRunning(false); }
  };

  return (
    <Modal open={true} onClose={onClose} size="md">
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
        {result && (
          <p className="mt-3 text-xs text-status-success">
            {t('wiki.ingest.success').replace('{created}', String(result.created)).replace('{updated}', String(result.updated)).replace('{edges}', String(result.edgesAdded))}
          </p>
        )}
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

interface LintModalProps { projectId: string; onClose: () => void; }

function LintModal({ projectId, onClose }: LintModalProps) {
  const { t } = useI18n();
  const [running, setRunning] = useState(true);
  const [issues, setIssues] = useState<{ type: string; node_titles: string[]; message: string }[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    lintMemory(projectId).then(res => setIssues(res.issues)).catch(err => setError(err instanceof Error ? err.message : 'Error')).finally(() => setRunning(false));
  }, [projectId]);

  const COLORS: Record<string, string> = {
    contradiction: 'text-red-600 bg-red-50 border-red-200',
    orphan: 'text-warm-500 bg-warm-100 border-warm-200',
    duplicate: 'text-amber-600 bg-amber-50 border-amber-200',
    stale: 'text-blue-600 bg-blue-50 border-blue-200',
  };

  return (
    <Modal open={true} onClose={onClose} size="md">
      <div className="bg-warm-50 rounded-xl border border-warm-200 p-5 shadow-soft">
        <h3 className="text-base font-semibold text-warm-800 mb-4">{t('wiki.lint.title')}</h3>
        {running ? (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-warm-500"><Loader2 size={16} className="animate-spin" />{t('wiki.lint.running')}</div>
        ) : error ? (
          <div className="flex items-center gap-2 text-sm text-red-600 py-4"><AlertCircle size={16} />{error}</div>
        ) : issues.length === 0 ? (
          <p className="text-sm text-warm-600 py-4">{t('wiki.lint.empty')}</p>
        ) : (
          <ul className="space-y-2 max-h-80 overflow-y-auto">
            {issues.map((issue, i) => (
              <li key={i} className={`rounded-lg border p-3 ${COLORS[issue.type] ?? 'text-warm-700 bg-warm-100 border-warm-200'}`}>
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70 mt-0.5">{issue.type}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">{issue.message}</p>
                    {issue.node_titles.length > 0 && <p className="text-[10px] opacity-70 mt-0.5">{issue.node_titles.join(', ')}</p>}
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
