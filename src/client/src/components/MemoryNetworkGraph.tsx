import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { MemoryNode, MemoryEdge, MemoryRelationType } from '../types';
import { useI18n } from '../i18n';
import { parseWikilinks } from '../lib/wikilinks';

interface Props {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onCreateConnection: (fromId: string, toId: string) => void;
  onUpdateNodePosition: (nodeId: string, x: number, y: number) => Promise<void>;
}

const NODE_RADIUS_BASE = 8;
const NODE_RADIUS_MAX = 22;

const RELATION_COLOR: Record<MemoryRelationType, string> = {
  related: '#9CA3AF',
  precedes: '#3B82F6',
  example_of: '#10B981',
  counter_example: '#EF4444',
  refines: '#8B5CF6',
};

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
}

/**
 * Tiny verlet-ish force simulation: repulsion + spring + center.
 * Stops once total kinetic energy decays. Pure JS, no extra deps.
 */
function runForceLayout(
  ids: string[],
  links: Array<[string, string]>,
  initial: Map<string, { x: number; y: number }>,
): Map<string, { x: number; y: number }> {
  const N = ids.length;
  if (N === 0) return new Map();
  const idx = new Map(ids.map((id, i) => [id, i]));
  const sim: SimNode[] = ids.map(id => {
    const init = initial.get(id);
    return {
      id,
      x: init?.x ?? (Math.random() - 0.5) * 600,
      y: init?.y ?? (Math.random() - 0.5) * 600,
      vx: 0,
      vy: 0,
      pinned: !!init,
    };
  });

  const REPULSION = 9000;
  const SPRING_K = 0.04;
  const REST_LEN = 110;
  const CENTER_K = 0.005;
  const FRICTION = 0.85;
  const ITERATIONS = 220;

  for (let step = 0; step < ITERATIONS; step++) {
    // Pairwise repulsion
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = sim[i], b = sim[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) d2 = 1;
        const force = REPULSION / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }
    // Springs along edges
    for (const [from, to] of links) {
      const a = sim[idx.get(from) ?? -1];
      const b = sim[idx.get(to) ?? -1];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const offset = d - REST_LEN;
      const fx = (dx / d) * offset * SPRING_K;
      const fy = (dy / d) * offset * SPRING_K;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    // Center pull + integrate
    for (const n of sim) {
      n.vx += -n.x * CENTER_K;
      n.vy += -n.y * CENTER_K;
      n.vx *= FRICTION;
      n.vy *= FRICTION;
      n.x += n.vx;
      n.y += n.vy;
    }
  }
  const out = new Map<string, { x: number; y: number }>();
  for (const n of sim) out.set(n.id, { x: n.x, y: n.y });
  return out;
}

function MemoryDot({ data }: { data: { node: MemoryNode; size: number; selected: boolean; highlight: boolean; onSelect: (id: string) => void } }) {
  const { node, size, selected, highlight } = data;
  const isHighlighted = node.pinned === 1 || highlight;
  const fill = selected ? '#3B82F6' : isHighlighted ? '#10B981' : '#E5E7EB';
  const ring = selected ? '#60A5FA' : 'transparent';
  const handleStyle: React.CSSProperties = {
    width: 8,
    height: 8,
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.25)',
    opacity: 0.6,
  };
  return (
    <div
      onClick={() => data.onSelect(node.id)}
      style={{ width: size * 2 + 24, height: size * 2 + 24 }}
      className="flex items-center justify-center cursor-pointer group"
    >
      {/* Handles anchor edges to the node and enable drag-to-connect */}
      <Handle type="target" position={Position.Top} style={handleStyle} isConnectable />
      <Handle type="source" position={Position.Bottom} style={handleStyle} isConnectable />
      <div
        style={{
          width: size * 2,
          height: size * 2,
          background: fill,
          boxShadow: selected ? `0 0 0 3px ${ring}` : undefined,
        }}
        className="rounded-full transition-transform group-hover:scale-110"
      />
      <div
        className="absolute opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap text-[11px] font-medium text-gray-100 bg-[#1A1A1A]/95 border border-white/10 px-2 py-1 rounded-md shadow-elevated"
        style={{ top: size * 2 + 14, transform: 'translateX(0)' }}
      >
        {node.title}
      </div>
    </div>
  );
}

const nodeTypes = { memoryDot: MemoryDot };

export default function MemoryNetworkGraph({
  nodes: rawNodes,
  edges: rawEdges,
  selectedNodeId,
  onSelectNode,
  onCreateConnection,
  onUpdateNodePosition,
}: Props) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const layoutAppliedRef = useRef(false);

  // Wikilinks act as additional graph links (dotted, color #4B5563)
  const wikilinkPairs = useMemo(() => {
    const titleToId = new Map<string, string>();
    for (const n of rawNodes) titleToId.set(n.title.toLowerCase(), n.id);
    const pairs: Array<{ from: string; to: string; key: string }> = [];
    for (const n of rawNodes) {
      const refs = parseWikilinks(n.body || '');
      for (const r of refs) {
        const targetId = titleToId.get(r.title.toLowerCase());
        if (!targetId || targetId === n.id) continue;
        pairs.push({ from: n.id, to: targetId, key: `wl-${n.id}-${targetId}` });
      }
    }
    return pairs;
  }, [rawNodes]);

  // Compute degree (edges + wikilinks both directions) for sizing
  const degree = useMemo(() => {
    const d = new Map<string, number>();
    const inc = (id: string) => d.set(id, (d.get(id) ?? 0) + 1);
    for (const e of rawEdges) { inc(e.from_node_id); inc(e.to_node_id); }
    for (const p of wikilinkPairs) { inc(p.from); inc(p.to); }
    return d;
  }, [rawEdges, wikilinkPairs]);
  const maxDegree = useMemo(() => {
    let m = 1;
    for (const v of degree.values()) if (v > m) m = v;
    return m;
  }, [degree]);

  // Run force layout once on mount (or when raw nodes count changes drastically)
  const initialPositions = useMemo(() => {
    const ids = rawNodes.map(n => n.id);
    const links: Array<[string, string]> = [
      ...rawEdges.map(e => [e.from_node_id, e.to_node_id] as [string, string]),
      ...wikilinkPairs.map(p => [p.from, p.to] as [string, string]),
    ];
    const initial = new Map<string, { x: number; y: number }>();
    for (const n of rawNodes) {
      if (n.position_x != null && n.position_y != null) {
        initial.set(n.id, { x: n.position_x, y: n.position_y });
      }
    }
    if (initial.size === ids.length && ids.length > 0) {
      return initial;
    }
    return runForceLayout(ids, links, initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawNodes.length, rawEdges.length, wikilinkPairs.length]);

  const handleSelect = useCallback((id: string) => {
    onSelectNode(id === selectedNodeId ? null : id);
  }, [selectedNodeId, onSelectNode]);

  const matchesSearch = useCallback((node: MemoryNode) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return node.title.toLowerCase().includes(q) || (node.body || '').toLowerCase().includes(q);
  }, [search]);

  const initialNodes: Node[] = useMemo(() => rawNodes.map(n => {
    const pos = initialPositions.get(n.id) ?? { x: 0, y: 0 };
    const deg = degree.get(n.id) ?? 0;
    const size = NODE_RADIUS_BASE + (deg / maxDegree) * (NODE_RADIUS_MAX - NODE_RADIUS_BASE);
    const highlight = matchesSearch(n);
    return {
      id: n.id,
      type: 'memoryDot',
      position: { x: pos.x, y: pos.y },
      data: {
        node: n,
        size,
        selected: n.id === selectedNodeId,
        highlight,
        onSelect: handleSelect,
      },
      style: search.trim() && !highlight ? { opacity: 0.18 } : undefined,
    };
  }), [rawNodes, initialPositions, degree, maxDegree, selectedNodeId, handleSelect, matchesSearch, search]);

  const initialEdges: Edge[] = useMemo(() => {
    const flowEdges: Edge[] = rawEdges.map(e => ({
      id: e.id,
      source: e.from_node_id,
      target: e.to_node_id,
      style: {
        stroke: RELATION_COLOR[e.relation_type] ?? '#9CA3AF',
        strokeWidth: 1.5,
      },
    }));
    for (const p of wikilinkPairs) {
      flowEdges.push({
        id: p.key,
        source: p.from,
        target: p.to,
        style: { stroke: '#6B7280', strokeWidth: 1, strokeDasharray: '4 3', opacity: 0.6 },
      });
    }
    return flowEdges;
  }, [rawEdges, wikilinkPairs]);

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(initialNodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setFlowNodes(initialNodes);
    setFlowEdges(initialEdges);
  }, [initialNodes, initialEdges, setFlowNodes, setFlowEdges]);

  // Persist computed positions back to DB once after first layout (only for nodes that had no saved pos)
  useEffect(() => {
    if (layoutAppliedRef.current) return;
    if (rawNodes.length === 0) return;
    layoutAppliedRef.current = true;
    for (const n of rawNodes) {
      if (n.position_x == null || n.position_y == null) {
        const pos = initialPositions.get(n.id);
        if (pos) onUpdateNodePosition(n.id, pos.x, pos.y).catch(() => {});
      }
    }
  }, [rawNodes, initialPositions, onUpdateNodePosition]);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;
    onCreateConnection(connection.source, connection.target);
  }, [onCreateConnection]);

  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
    onUpdateNodePosition(node.id, node.position.x, node.position.y);
  }, [onUpdateNodePosition]);

  if (rawNodes.length === 0) {
    return (
      <div className="h-[600px] rounded-xl border border-warm-200 flex items-center justify-center text-warm-500 text-sm bg-[#1A1A1A]">
        {t('wiki.empty')}
      </div>
    );
  }

  return (
    <div className="relative h-[600px] rounded-xl border border-warm-200 overflow-hidden" style={{ background: '#1A1A1A' }}>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={t('wiki.searchPlaceholder')}
        className="absolute top-3 left-3 z-10 px-3 py-1.5 rounded-lg bg-black/50 text-warm-50 placeholder:text-warm-400 border border-warm-700 text-xs w-56 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#2A2A2A" />
        <Controls className="!bg-[#222] !border-[#333] !text-warm-50" />
      </ReactFlow>
    </div>
  );
}
