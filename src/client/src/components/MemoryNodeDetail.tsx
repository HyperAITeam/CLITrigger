import { useMemo } from 'react';
import { Edit2, Trash2, Pin, X } from 'lucide-react';
import type { MemoryNode, MemoryEdge, MemoryRelationType } from '../types';
import { useI18n } from '../i18n';
import { parseMemoryTags } from '../api/memory';
import MarkdownContent from './MarkdownContent';

interface MemoryNodeDetailProps {
  node: MemoryNode;
  allNodes: MemoryNode[];
  edges: MemoryEdge[];
  onEdit: (node: MemoryNode) => void;
  onDelete: (node: MemoryNode) => void;
  onSelectNode?: (nodeId: string) => void;
  onClose: () => void;
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
}: MemoryNodeDetailProps) {
  const { t } = useI18n();
  const tags = parseMemoryTags(node.tags);
  const nodeMap = useMemo(() => new Map(allNodes.map(n => [n.id, n])), [allNodes]);

  const outgoing = edges.filter(e => e.from_node_id === node.id);
  const incoming = edges.filter(e => e.to_node_id === node.id);

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

      <div className="flex-1 overflow-y-auto p-4">
        {node.body ? (
          <MarkdownContent content={node.body} />
        ) : (
          <p className="text-sm text-warm-500 italic">{t('memory.noBody')}</p>
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
