import { useEffect, useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, Pin, List as ListIcon, Network, GitBranch } from 'lucide-react';
import type { MemoryNode, MemoryEdge, MemoryRelationType } from '../types';
import { useI18n } from '../i18n';
import {
  getMemoryGraph,
  createMemoryNode,
  updateMemoryNode,
  updateMemoryNodePosition,
  deleteMemoryNode,
  createMemoryEdge,
  updateMemoryEdge,
  deleteMemoryEdge,
  insertMemoryWikilink,
  parseMemoryTags,
} from '../api/memory';
import Modal from './Modal';
import MemoryForm from './MemoryForm';
import MemoryGraph from './MemoryGraph';
import MemoryNetworkGraph from './MemoryNetworkGraph';
import MemoryNodeDetail from './MemoryNodeDetail';

type MemoryView = 'list' | 'hierarchical' | 'network';

const VIEW_KEY = (projectId: string) => `memory-view:${projectId}`;

const RELATION_TYPES: MemoryRelationType[] = ['related', 'precedes', 'example_of', 'counter_example', 'refines'];

interface MemoryListProps {
  projectId: string;
}

export default function MemoryList({ projectId }: MemoryListProps) {
  const { t } = useI18n();
  const [nodes, setNodes] = useState<MemoryNode[]>([]);
  const [edges, setEdges] = useState<MemoryEdge[]>([]);
  const [view, setView] = useState<MemoryView>(() => {
    if (typeof window === 'undefined') return 'list';
    const saved = window.localStorage.getItem(VIEW_KEY(projectId));
    if (saved === 'hierarchical' || saved === 'network' || saved === 'list') return saved;
    if (saved === 'graph') return 'hierarchical'; // legacy value
    return 'list';
  });
  const [showForm, setShowForm] = useState(false);
  const [editNode, setEditNode] = useState<MemoryNode | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingEdge, setEditingEdge] = useState<MemoryEdge | null>(null);
  const [pendingConnection, setPendingConnection] = useState<{ fromId: string; toId: string } | null>(null);
  const [filterTag, setFilterTag] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    getMemoryGraph(projectId).then(graph => {
      if (cancelled) return;
      setNodes(graph.nodes);
      setEdges(graph.edges);
    }).catch(err => console.error('Load memory graph failed', err));
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    window.localStorage.setItem(VIEW_KEY(projectId), view);
  }, [view, projectId]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes) {
      for (const tag of parseMemoryTags(n.tags)) set.add(tag);
    }
    return Array.from(set).sort();
  }, [nodes]);

  const filteredNodes = useMemo(() => {
    return nodes.filter(n => {
      if (filterTag && !parseMemoryTags(n.tags).includes(filterTag)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!n.title.toLowerCase().includes(q) && !(n.body || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [nodes, filterTag, search]);

  const handleSave = async (data: { title: string; body: string; tags: string[]; pinned: boolean }) => {
    if (editNode) {
      const updated = await updateMemoryNode(editNode.id, {
        title: data.title,
        body: data.body,
        tags: data.tags.length > 0 ? data.tags : null,
        pinned: data.pinned,
      });
      setNodes(prev => prev.map(n => n.id === updated.id ? updated : n));
    } else {
      const created = await createMemoryNode(projectId, {
        title: data.title,
        body: data.body,
        tags: data.tags,
        pinned: data.pinned,
      });
      setNodes(prev => [created, ...prev]);
    }
    setShowForm(false);
    setEditNode(null);
  };

  const handleDelete = async (node: MemoryNode) => {
    if (!window.confirm(t('memory.deleteConfirm'))) return;
    await deleteMemoryNode(node.id);
    setNodes(prev => prev.filter(n => n.id !== node.id));
    setEdges(prev => prev.filter(e => e.from_node_id !== node.id && e.to_node_id !== node.id));
    if (selectedNodeId === node.id) setSelectedNodeId(null);
  };

  const handleStartEdit = (node: MemoryNode) => {
    setEditNode(node);
    setShowForm(true);
  };

  const handleCreateEdge = async (fromId: string, toId: string) => {
    try {
      const edge = await createMemoryEdge(projectId, { from_node_id: fromId, to_node_id: toId, relation_type: 'related' });
      setEdges(prev => [...prev, edge]);
    } catch (err) {
      console.error('Create edge failed', err);
    }
  };

  const handleConnectionRequest = (fromId: string, toId: string) => {
    setPendingConnection({ fromId, toId });
  };

  const handleResolveConnection = async (kind: 'wikilink' | 'edge') => {
    if (!pendingConnection) return;
    const { fromId, toId } = pendingConnection;
    if (kind === 'wikilink') {
      try {
        const updated = await insertMemoryWikilink(fromId, { targetNodeId: toId });
        setNodes(prev => prev.map(n => n.id === updated.id ? updated : n));
      } catch (err) {
        console.error('Insert wikilink failed', err);
      }
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

  const handleUpdatePosition = async (nodeId: string, x: number, y: number) => {
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, position_x: x, position_y: y } : n));
    try {
      await updateMemoryNodePosition(nodeId, x, y);
    } catch (err) {
      console.error('Update position failed', err);
    }
  };

  const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-warm-800 mr-auto">{t('memory.title')}</h2>

        <div className="inline-flex rounded-lg border border-warm-200 overflow-hidden">
          <button
            onClick={() => setView('list')}
            className={`px-3 py-1.5 text-xs flex items-center gap-1 ${view === 'list' ? 'bg-warm-700 text-warm-50' : 'bg-warm-50 text-warm-700 hover:bg-warm-100'}`}
          >
            <ListIcon size={12} /> {t('memory.viewList')}
          </button>
          <button
            onClick={() => setView('hierarchical')}
            className={`px-3 py-1.5 text-xs flex items-center gap-1 ${view === 'hierarchical' ? 'bg-warm-700 text-warm-50' : 'bg-warm-50 text-warm-700 hover:bg-warm-100'}`}
          >
            <GitBranch size={12} /> {t('memory.viewHierarchical')}
          </button>
          <button
            onClick={() => setView('network')}
            className={`px-3 py-1.5 text-xs flex items-center gap-1 ${view === 'network' ? 'bg-warm-700 text-warm-50' : 'bg-warm-50 text-warm-700 hover:bg-warm-100'}`}
          >
            <Network size={12} /> {t('memory.viewNetwork')}
          </button>
        </div>

        <button
          onClick={() => { setEditNode(null); setShowForm(true); }}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-warm-700 text-warm-50 text-xs font-medium hover:bg-warm-800"
        >
          <Plus size={12} /> {t('memory.add')}
        </button>
      </div>

      {nodes.length > 0 && view === 'list' && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('memory.searchPlaceholder')}
            className="px-3 py-1.5 rounded-lg border border-warm-200 bg-warm-50 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-warm-400"
          />
          {allTags.length > 0 && (
            <select
              value={filterTag}
              onChange={e => setFilterTag(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-warm-200 bg-warm-50 text-sm"
            >
              <option value="">{t('memory.allTags')}</option>
              {allTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
            </select>
          )}
          <span className="text-xs text-warm-500 ml-auto">
            {t('memory.countLabel').replace('{count}', String(filteredNodes.length))}
          </span>
        </div>
      )}

      {view === 'list' ? (
        nodes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-warm-300 p-12 text-center">
            <p className="text-warm-700 font-medium mb-1">{t('memory.empty')}</p>
            <p className="text-sm text-warm-500">{t('memory.emptyHint')}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filteredNodes.map(node => {
              const tags = parseMemoryTags(node.tags);
              const bodyPreview = node.body ? node.body.replace(/\s+/g, ' ').slice(0, 200) : '';
              return (
                <li
                  key={node.id}
                  className="rounded-xl border border-warm-200 bg-warm-50 p-3 hover:border-warm-400 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {node.pinned === 1 && <Pin size={12} className="text-warm-500 flex-shrink-0" />}
                        <h3 className="font-medium text-sm text-warm-800 truncate">{node.title}</h3>
                      </div>
                      {bodyPreview && (
                        <p className="text-xs text-warm-600 mt-1 line-clamp-2">{bodyPreview}</p>
                      )}
                      {tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {tags.map(tag => (
                            <span key={tag} className="px-1.5 py-0.5 rounded text-[10px] bg-warm-200 text-warm-700">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => handleStartEdit(node)} className="p-1.5 hover:bg-warm-200 rounded" title={t('memory.edit')}>
                        <Edit2 size={12} />
                      </button>
                      <button onClick={() => handleDelete(node)} className="p-1.5 hover:bg-red-100 text-red-600 rounded" title={t('memory.delete')}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
            {filteredNodes.length === 0 && (
              <li className="text-center text-sm text-warm-500 py-6">{t('memory.noResults')}</li>
            )}
          </ul>
        )
      ) : (
        <div className="flex gap-4">
          <div className="flex-1">
            {view === 'hierarchical' ? (
              <MemoryGraph
                nodes={nodes}
                edges={edges}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                onCreateEdge={handleConnectionRequest}
                onDeleteEdge={handleDeleteEdge}
                onEditEdge={setEditingEdge}
                onUpdateNodePosition={handleUpdatePosition}
              />
            ) : (
              <MemoryNetworkGraph
                nodes={nodes}
                edges={edges}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                onCreateConnection={handleConnectionRequest}
                onUpdateNodePosition={handleUpdatePosition}
              />
            )}
          </div>
          {selectedNode && (
            <MemoryNodeDetail
              node={selectedNode}
              allNodes={nodes}
              edges={edges}
              onEdit={handleStartEdit}
              onDelete={handleDelete}
              onSelectNode={setSelectedNodeId}
              onClose={() => setSelectedNodeId(null)}
              onNodeUpdated={updated => setNodes(prev => prev.map(n => n.id === updated.id ? updated : n))}
            />
          )}
        </div>
      )}

      <Modal open={showForm} onClose={() => { setShowForm(false); setEditNode(null); }} size="lg">
        <MemoryForm
          editNode={editNode}
          allNodes={nodes}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditNode(null); }}
        />
      </Modal>

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
    </div>
  );
}

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
    try { await onChoose(kind); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={true} onClose={onClose} size="sm">
      <div className="bg-warm-50 rounded-xl border border-warm-200 p-5 shadow-soft">
        <h3 className="text-base font-semibold text-warm-800 mb-1">{t('memory.connect.title')}</h3>
        <p className="text-sm text-warm-600 mb-4">
          <span className="font-medium">{fromNode.title}</span>
          {' → '}
          <span className="font-medium">{toNode.title}</span>
        </p>

        <div className="space-y-2">
          <button
            onClick={() => handle('wikilink')}
            disabled={busy}
            className="w-full text-left p-3 rounded-lg border border-warm-200 hover:border-warm-400 hover:bg-warm-100 disabled:opacity-50"
          >
            <div className="text-sm font-medium text-warm-800">{t('memory.connect.wikilink')}</div>
            <div className="text-xs text-warm-500 mt-0.5">{t('memory.connect.wikilinkHint')}</div>
          </button>
          <button
            onClick={() => handle('edge')}
            disabled={busy}
            className="w-full text-left p-3 rounded-lg border border-warm-200 hover:border-warm-400 hover:bg-warm-100 disabled:opacity-50"
          >
            <div className="text-sm font-medium text-warm-800">{t('memory.connect.edge')}</div>
            <div className="text-xs text-warm-500 mt-0.5">{t('memory.connect.edgeHint')}</div>
          </button>
        </div>

        <div className="flex justify-end mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-warm-300 text-warm-700 text-sm hover:bg-warm-100"
          >
            {t('memory.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

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
        <h3 className="text-base font-semibold text-warm-800 mb-4">{t('memory.edge.editTitle')}</h3>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-warm-600 mb-1">{t('memory.edge.relationType')}</label>
            <select
              value={relation}
              onChange={e => setRelation(e.target.value as MemoryRelationType)}
              className="w-full px-3 py-2 rounded-lg border border-warm-200 bg-warm-0 text-sm focus:outline-none focus:ring-2 focus:ring-warm-400"
            >
              {RELATION_TYPES.map(rt => (
                <option key={rt} value={rt}>{t(`memory.edge.relations.${rt}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-warm-600 mb-1">{t('memory.edge.label')}</label>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder={t('memory.edge.labelPlaceholder')}
              className="w-full px-3 py-2 rounded-lg border border-warm-200 bg-warm-0 text-sm focus:outline-none focus:ring-2 focus:ring-warm-400"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button
            onClick={async () => {
              if (saving) return;
              setSaving(true);
              try { await onSave(edge.id, relation, label); }
              finally { setSaving(false); }
            }}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-warm-700 text-warm-50 text-sm font-medium hover:bg-warm-800 disabled:opacity-50"
          >
            {t('memory.save')}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-warm-300 text-warm-700 text-sm hover:bg-warm-100"
          >
            {t('memory.cancel')}
          </button>
          <button
            onClick={async () => {
              if (window.confirm(t('memory.edge.deleteConfirm'))) {
                await onDelete(edge.id);
              }
            }}
            className="ml-auto px-4 py-2 rounded-lg text-red-600 text-sm hover:bg-red-50"
          >
            {t('memory.delete')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
