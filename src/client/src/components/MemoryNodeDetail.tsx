import { useEffect, useMemo, useState } from 'react';
import { Edit2, Trash2, Pin, X, Link2, Plus } from 'lucide-react';
import type { MemoryNode, MemoryEdge, MemoryRelationType, MemoryBacklink } from '../types';
import { useI18n } from '../i18n';
import { parseMemoryTags, getMemoryBacklinks, insertMemoryWikilink } from '../api/memory';
import MarkdownContent from './MarkdownContent';

interface MemoryNodeDetailProps {
  node: MemoryNode;
  allNodes: MemoryNode[];
  edges: MemoryEdge[];
  onEdit: (node: MemoryNode) => void;
  onDelete: (node: MemoryNode) => void;
  onSelectNode?: (nodeId: string) => void;
  onClose: () => void;
  /** Called when a wikilink is appended to this node's body (so parent can refresh state). */
  onNodeUpdated?: (updated: MemoryNode) => void;
}

const RELATION_KEYS: Record<MemoryRelationType, string> = {
  related: 'memory.edge.relations.related',
  precedes: 'memory.edge.relations.precedes',
  example_of: 'memory.edge.relations.example_of',
  counter_example: 'memory.edge.relations.counter_example',
  refines: 'memory.edge.relations.refines',
};

export default function MemoryNodeDetail({
  node,
  allNodes,
  edges,
  onEdit,
  onDelete,
  onSelectNode,
  onClose,
  onNodeUpdated,
}: MemoryNodeDetailProps) {
  const { t } = useI18n();
  const tags = parseMemoryTags(node.tags);
  const nodeMap = useMemo(() => new Map(allNodes.map(n => [n.id, n])), [allNodes]);
  const [backlinks, setBacklinks] = useState<MemoryBacklink[]>([]);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');
  const [adding, setAdding] = useState(false);

  const outgoing = edges.filter(e => e.from_node_id === node.id);
  const incoming = edges.filter(e => e.to_node_id === node.id);

  useEffect(() => {
    let cancelled = false;
    getMemoryBacklinks(node.id)
      .then(b => { if (!cancelled) setBacklinks(b); })
      .catch(err => console.error('Load backlinks failed', err));
    return () => { cancelled = true; };
  }, [node.id, node.body, node.title]);

  const linkCandidates = useMemo(() => {
    const q = linkSearch.toLowerCase();
    return allNodes
      .filter(n => n.id !== node.id)
      .filter(n => !q || n.title.toLowerCase().includes(q))
      .slice(0, 8);
  }, [allNodes, node.id, linkSearch]);

  const handleAddLink = async (target: MemoryNode) => {
    if (adding) return;
    setAdding(true);
    try {
      const updated = await insertMemoryWikilink(node.id, { targetNodeId: target.id });
      onNodeUpdated?.(updated);
      setLinkPickerOpen(false);
      setLinkSearch('');
    } catch (err) {
      console.error('Insert wikilink failed', err);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="w-[420px] flex flex-col rounded-xl border border-warm-200 bg-warm-50 overflow-hidden">
      <div className="flex items-start justify-between gap-2 p-4 border-b border-warm-200">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {node.pinned === 1 && <Pin size={14} className="text-warm-500 flex-shrink-0" />}
            <h3 className="text-base font-semibold text-warm-800 truncate">{node.title}</h3>
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {tags.map(tag => (
                <span key={tag} className="px-2 py-0.5 rounded-md bg-warm-200 text-xs text-warm-700">{tag}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setLinkPickerOpen(v => !v)}
            className="p-1.5 hover:bg-warm-200 rounded"
            title={t('memory.addLink')}
          >
            <Link2 size={14} />
          </button>
          <button onClick={() => onEdit(node)} className="p-1.5 hover:bg-warm-200 rounded" title={t('memory.edit')}>
            <Edit2 size={14} />
          </button>
          <button onClick={() => onDelete(node)} className="p-1.5 hover:bg-red-100 text-red-600 rounded" title={t('memory.delete')}>
            <Trash2 size={14} />
          </button>
          <button onClick={onClose} className="p-1.5 hover:bg-warm-200 rounded">
            <X size={14} />
          </button>
        </div>
      </div>

      {linkPickerOpen && (
        <div className="border-b border-warm-200 bg-warm-100 p-3">
          <input
            value={linkSearch}
            onChange={e => setLinkSearch(e.target.value)}
            placeholder={t('memory.addLinkPlaceholder')}
            className="w-full px-2 py-1.5 rounded border border-warm-300 bg-warm-50 text-sm focus:outline-none focus:ring-2 focus:ring-warm-400"
            autoFocus
          />
          <ul className="mt-2 max-h-[200px] overflow-y-auto space-y-1">
            {linkCandidates.map(n => (
              <li key={n.id}>
                <button
                  onClick={() => handleAddLink(n)}
                  disabled={adding}
                  className="w-full text-left px-2 py-1 rounded text-sm text-warm-700 hover:bg-warm-200 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Plus size={12} className="flex-shrink-0" />
                  <span className="truncate">{n.title}</span>
                </button>
              </li>
            ))}
            {linkCandidates.length === 0 && (
              <li className="px-2 py-1 text-xs text-warm-500">{t('memory.noResults')}</li>
            )}
          </ul>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {node.body ? (
          <MarkdownContent
            content={node.body}
            memoryNodes={allNodes}
            onSelectMemoryNode={onSelectNode}
          />
        ) : (
          <p className="text-sm text-warm-500 italic">{t('memory.noBody')}</p>
        )}

        {backlinks.length > 0 && (
          <div className="mt-5 pt-4 border-t border-warm-200">
            <h4 className="text-xs font-semibold text-warm-600 uppercase mb-2">{t('memory.backlinks')}</h4>
            <ul className="space-y-2">
              {backlinks.map(b => (
                <li key={b.id} className="text-sm">
                  <button
                    onClick={() => onSelectNode?.(b.id)}
                    className="text-warm-700 hover:underline font-medium"
                  >
                    {b.title}
                  </button>
                  <div className="text-xs text-warm-500 mt-0.5">{b.snippet}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(outgoing.length > 0 || incoming.length > 0) && (
          <div className="mt-5 pt-4 border-t border-warm-200">
            <h4 className="text-xs font-semibold text-warm-600 uppercase mb-2">{t('memory.connections')}</h4>
            {outgoing.length > 0 && (
              <div className="mb-3">
                <div className="text-xs text-warm-500 mb-1">{t('memory.outgoing')}</div>
                <ul className="space-y-1">
                  {outgoing.map(e => {
                    const target = nodeMap.get(e.to_node_id);
                    return (
                      <li key={e.id} className="text-sm">
                        <span className="text-warm-500">[{t(RELATION_KEYS[e.relation_type])}]</span>{' '}
                        <button
                          onClick={() => target && onSelectNode?.(target.id)}
                          className="text-warm-700 hover:underline"
                        >
                          {target?.title ?? e.to_node_id}
                        </button>
                        {e.label && <span className="text-warm-500 italic"> — {e.label}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {incoming.length > 0 && (
              <div>
                <div className="text-xs text-warm-500 mb-1">{t('memory.incoming')}</div>
                <ul className="space-y-1">
                  {incoming.map(e => {
                    const src = nodeMap.get(e.from_node_id);
                    return (
                      <li key={e.id} className="text-sm">
                        <button
                          onClick={() => src && onSelectNode?.(src.id)}
                          className="text-warm-700 hover:underline"
                        >
                          {src?.title ?? e.from_node_id}
                        </button>
                        {' '}<span className="text-warm-500">[{t(RELATION_KEYS[e.relation_type])}]</span>
                        {e.label && <span className="text-warm-500 italic"> — {e.label}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
