import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  MarkerType,
  BackgroundVariant,
} from '@xyflow/react';
import dagre from 'dagre';
import { LayoutGrid, Pin } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import type { MemoryNode, MemoryEdge, MemoryRelationType } from '../types';
import { useI18n } from '../i18n';
import { useTheme } from '../hooks/useTheme';
import { parseMemoryTags } from '../api/memory';

const NODE_WIDTH = 240;
const NODE_HEIGHT = 90;

const RELATION_COLOR: Record<MemoryRelationType, string> = {
  related: '#9CA3AF',
  precedes: '#3B82F6',
  example_of: '#10B981',
  counter_example: '#EF4444',
  refines: '#8B5CF6',
};

interface MemoryGraphProps {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onCreateEdge: (fromId: string, toId: string) => Promise<void>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
  onEditEdge: (edge: MemoryEdge) => void;
  onUpdateNodePosition: (nodeId: string, x: number, y: number) => Promise<void>;
}

function layoutNodes(nodes: MemoryNode[], edges: MemoryEdge[]): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 100 });
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of edges) {
    if (e.relation_type === 'precedes' || e.relation_type === 'refines') {
      g.setEdge(e.from_node_id, e.to_node_id);
    }
  }
  dagre.layout(g);
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const node = g.node(n.id);
    if (node) positions.set(n.id, { x: node.x - NODE_WIDTH / 2, y: node.y - NODE_HEIGHT / 2 });
  }
  return positions;
}

function wouldCreateCycleForPrecedes(edges: MemoryEdge[], sourceId: string, targetId: string): boolean {
  // Cycle check only matters for precedes-style DAG; skip if we don't know the type yet
  // Walk forward from target; if we reach source, cycle exists.
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.relation_type !== 'precedes' && e.relation_type !== 'refines') continue;
    if (!adj.has(e.from_node_id)) adj.set(e.from_node_id, []);
    adj.get(e.from_node_id)!.push(e.to_node_id);
  }
  const stack = [targetId];
  const visited = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === sourceId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const next = adj.get(cur);
    if (next) stack.push(...next);
  }
  return false;
}

function MemoryNodeBox({ data }: { data: { node: MemoryNode; selected: boolean; onSelect: (id: string) => void } }) {
  const tags = parseMemoryTags(data.node.tags);
  return (
    <div
      onClick={() => data.onSelect(data.node.id)}
      className={`px-3 py-2 rounded-lg border cursor-pointer transition-all bg-warm-50 ${
        data.selected ? 'border-warm-700 shadow-md' : 'border-warm-300 hover:border-warm-500'
      }`}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <div className="flex items-start gap-1.5">
        {data.node.pinned === 1 && <Pin size={12} className="text-warm-500 flex-shrink-0 mt-0.5" />}
        <div className="font-medium text-sm text-warm-800 line-clamp-2 flex-1">{data.node.title}</div>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {tags.slice(0, 3).map(tag => (
            <span key={tag} className="px-1.5 py-0.5 rounded text-[10px] bg-warm-200 text-warm-700">{tag}</span>
          ))}
          {tags.length > 3 && <span className="text-[10px] text-warm-500">+{tags.length - 3}</span>}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { memoryNode: MemoryNodeBox };

export default function MemoryGraph({
  nodes: rawNodes,
  edges: rawEdges,
  selectedNodeId,
  onSelectNode,
  onCreateEdge,
  onDeleteEdge,
  onEditEdge,
  onUpdateNodePosition,
}: MemoryGraphProps) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const handleSelect = useCallback((id: string) => {
    onSelectNode(id === selectedNodeId ? null : id);
  }, [selectedNodeId, onSelectNode]);

  const { initialNodes, initialEdges } = useMemo(() => {
    const needsLayout = rawNodes.some(n => n.position_x == null || n.position_y == null);
    const positions = needsLayout ? layoutNodes(rawNodes, rawEdges) : null;
    const flowNodes: Node[] = rawNodes.map(n => ({
      id: n.id,
      type: 'memoryNode',
      position: {
        x: n.position_x ?? positions?.get(n.id)?.x ?? 0,
        y: n.position_y ?? positions?.get(n.id)?.y ?? 0,
      },
      data: { node: n, selected: n.id === selectedNodeId, onSelect: handleSelect },
    }));
    const flowEdges: Edge[] = rawEdges.map(e => ({
      id: e.id,
      source: e.from_node_id,
      target: e.to_node_id,
      type: 'smoothstep',
      label: e.label || undefined,
      style: { stroke: RELATION_COLOR[e.relation_type] ?? '#9CA3AF', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: RELATION_COLOR[e.relation_type] ?? '#9CA3AF' },
      data: { edge: e },
    }));
    return { initialNodes: flowNodes, initialEdges: flowEdges };
  }, [rawNodes, rawEdges, selectedNodeId, handleSelect]);

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(initialNodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setFlowNodes(initialNodes);
    setFlowEdges(initialEdges);
  }, [initialNodes, initialEdges, setFlowNodes, setFlowEdges]);

  const onConnect = useCallback(async (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;
    if (wouldCreateCycleForPrecedes(rawEdges, connection.source, connection.target)) return;
    await onCreateEdge(connection.source, connection.target);
  }, [rawEdges, onCreateEdge]);

  const onEdgesDelete = useCallback(async (deleted: Edge[]) => {
    for (const e of deleted) {
      await onDeleteEdge(e.id);
    }
  }, [onDeleteEdge]);

  const onEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    const memoryEdge = (edge.data as { edge?: MemoryEdge } | undefined)?.edge;
    if (memoryEdge) onEditEdge(memoryEdge);
  }, [onEditEdge]);

  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
    onUpdateNodePosition(node.id, node.position.x, node.position.y);
  }, [onUpdateNodePosition]);

  const handleAutoLayout = useCallback(() => {
    const positions = layoutNodes(rawNodes, rawEdges);
    setFlowNodes(nds => nds.map(n => {
      const pos = positions.get(n.id);
      return pos ? { ...n, position: pos } : n;
    }));
    for (const [id, pos] of positions) onUpdateNodePosition(id, pos.x, pos.y);
  }, [rawNodes, rawEdges, setFlowNodes, onUpdateNodePosition]);

  if (rawNodes.length === 0) {
    return (
      <div className="h-[600px] rounded-xl border border-warm-200 flex items-center justify-center text-warm-500 text-sm bg-warm-50">
        {t('memory.empty')}
      </div>
    );
  }

  return (
    <div className="relative h-[600px] rounded-xl border border-warm-200 overflow-hidden bg-warm-50">
      <button
        onClick={handleAutoLayout}
        className="absolute top-3 right-3 z-10 px-3 py-1.5 rounded-lg bg-warm-50 border border-warm-300 text-xs text-warm-700 hover:bg-warm-100 flex items-center gap-1 shadow-soft"
        title={t('memory.autoLayout')}
      >
        <LayoutGrid size={12} /> {t('memory.autoLayout')}
      </button>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onEdgeClick={onEdgeClick}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
        deleteKeyCode="Delete"
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color={isDark ? '#3a3a3a' : '#d6d0c4'} />
        <Controls className="!bg-warm-50 !border-warm-300" />
        <MiniMap pannable zoomable className="!bg-warm-100 !border-warm-300" />
      </ReactFlow>
    </div>
  );
}
