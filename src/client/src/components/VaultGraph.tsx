import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type ReactFlowInstance,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Type, Link2, Folder, FolderTree, ChevronRight } from 'lucide-react';
import type { VaultFile, VaultEdge as VaultEdgeType } from '../api/vault';
import { getVaultFileContent, saveVaultFile } from '../api/vault';
import { useI18n } from '../i18n';

interface Props {
  files: VaultFile[];
  edges: VaultEdgeType[];
  selectedPath: string | null;
  onSelectFile: (path: string | null) => void;
  projectId: string;
  // Called after a wikilink is written so the parent reloads the graph.
  onGraphChanged?: () => void;
}

const NODE_RADIUS_BASE = 8;
const NODE_RADIUS_MAX = 22;

const EDGE_STYLE = {
  stroke: '#6B7280',
  strokeWidth: 1,
  strokeDasharray: '4 3',
  opacity: 0.6,
};

const RELATED_HEADING = '## 관련 문서';

// Insert a `- [[stem]]` bullet into the "## 관련 문서" section, creating that
// section at end-of-file if it doesn't exist. Returns null (no-op) when the
// link already exists anywhere in the doc — that edge is already present.
function addRelatedLink(content: string, stem: string): string | null {
  const link = `[[${stem}]]`;
  if (content.includes(link)) return null;
  const bullet = `- ${link}`;
  const lines = content.split('\n');
  const hIdx = lines.findIndex(l => l.trim() === RELATED_HEADING);
  if (hIdx === -1) {
    const base = content.replace(/\s+$/, '');
    return `${base}\n\n${RELATED_HEADING}\n\n${bullet}\n`;
  }
  // End of section = next markdown heading after hIdx, or EOF.
  let end = lines.length;
  for (let i = hIdx + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) { end = i; break; }
  }
  // Insert after the last non-empty line inside the section.
  let insertAt = hIdx + 1;
  for (let i = hIdx + 1; i < end; i++) {
    if (lines[i].trim() !== '') insertAt = i + 1;
  }
  lines.splice(insertAt, 0, bullet);
  return lines.join('\n');
}

// Graph node key for `path` while viewing `folder` ('' = root, else 'a/b/').
// Inside the folder: its immediate child (subfolder 'a/b/c/' or the file).
// Outside: the child of the deepest ancestor of `folder` that contains it,
// e.g. folder 'docs/api/' + 'docs/guide/x.md' → 'docs/guide/'. Folder keys end with '/'.
export function groupKey(path: string, folder: string): string {
  let base = folder;
  while (base && !path.startsWith(base)) base = base.slice(0, base.lastIndexOf('/', base.length - 2) + 1);
  const rest = path.slice(base.length);
  const slash = rest.indexOf('/');
  return slash === -1 ? path : base + rest.slice(0, slash + 1);
}

function hashTagToHsl(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) {
    h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return `hsl(${h % 360}, 62%, 58%)`;
}

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function runForceLayout(
  ids: string[],
  links: Array<[string, string]>,
): Map<string, { x: number; y: number }> {
  const N = ids.length;
  if (N === 0) return new Map();
  const idx = new Map(ids.map((id, i) => [id, i]));
  const sim: SimNode[] = ids.map(() => ({
    id: '',
    x: (Math.random() - 0.5) * 600,
    y: (Math.random() - 0.5) * 600,
    vx: 0,
    vy: 0,
  }));
  for (let i = 0; i < N; i++) sim[i].id = ids[i];

  const REPULSION = 9000;
  const SPRING_K = 0.04;
  const REST_LEN = 110;
  const CENTER_K = 0.005;
  const FRICTION = 0.85;
  const ITERATIONS = 220;

  for (let step = 0; step < ITERATIONS; step++) {
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
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
    }
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
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
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

const centeredHandle: React.CSSProperties = {
  width: 1, height: 1, minWidth: 0, minHeight: 0,
  background: 'transparent', border: 'none',
  top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
};

function FolderDot({ data }: { data: { id: string; name: string; count: number; size: number; selected: boolean; onSelect: (key: string) => void } }) {
  const { id, name, count, size, selected } = data;
  return (
    <div
      onClick={() => data.onSelect(id)}
      style={{ width: size * 2 + 24, height: size * 2 + 24 }}
      className="flex items-center justify-center cursor-pointer group"
    >
      <Handle type="target" position={Position.Top} style={centeredHandle} isConnectable={false} />
      <Handle type="source" position={Position.Top} style={centeredHandle} isConnectable={false} />
      <div
        style={{ width: size * 2, height: size * 2, background: '#C9A86A', boxShadow: selected ? '0 0 0 3px #60A5FA' : undefined }}
        className="rounded-md flex items-center justify-center transition-transform group-hover:scale-110"
      >
        <Folder className="w-1/2 h-1/2 text-black/60" />
      </div>
      <div
        className="absolute pointer-events-none whitespace-nowrap text-[11px] font-medium text-gray-100"
        style={{ top: size * 2 + 14 }}
      >
        {name} <span className="text-gray-400">{count}</span>
      </div>
    </div>
  );
}

function VaultDot({ data }: { data: { file: VaultFile; size: number; selected: boolean; highlight: boolean; tagColor: string | null; showLabel: boolean; onSelect: (p: string) => void } }) {
  const { file, size, selected, highlight, tagColor, showLabel } = data;
  const { t } = useI18n();
  const fill = selected ? '#3B82F6' : highlight ? '#10B981' : tagColor ?? '#E5E7EB';
  const ring = selected ? '#60A5FA' : 'transparent';
  return (
    <div
      onClick={() => data.onSelect(file.relativePath)}
      style={{ width: size * 2 + 24, height: size * 2 + 24 }}
      className="flex items-center justify-center cursor-pointer group"
    >
      <Handle type="target" position={Position.Top} style={centeredHandle} isConnectable={false} />
      <Handle type="source" position={Position.Top} style={centeredHandle} isConnectable={false} />
      <div
        style={{
          width: size * 2, height: size * 2,
          background: fill,
          boxShadow: selected ? `0 0 0 3px ${ring}` : undefined,
        }}
        className="rounded-full transition-transform group-hover:scale-110"
      />
      <div
        className={`absolute ${showLabel ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity pointer-events-none whitespace-nowrap text-[11px] font-medium text-gray-100 bg-[#1A1A1A]/95 border border-white/10 px-2 py-1 rounded-md shadow-elevated`}
        style={{ top: size * 2 + 14 }}
      >
        {file.stem}
        <span className="block text-[9px] font-normal text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
          {t('vault.graph.rightClickHint')}
        </span>
      </div>
    </div>
  );
}

const nodeTypes = { vaultDot: VaultDot, folderDot: FolderDot };

// Small portal menu for right-clicking a graph node. Follows the project's
// floating-element rule: createPortal + position:fixed + viewport clamp.
function NodeContextMenu({ menu, canLink, label, onPick, onClose }: {
  menu: { x: number; y: number };
  canLink: boolean;
  label: string;
  onPick: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: menu.y, left: menu.x, visible: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let left = menu.x, top = menu.y;
    if (left + el.offsetWidth > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - el.offsetWidth);
    if (top + el.offsetHeight > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - el.offsetHeight);
    setPos({ top: Math.max(8, top), left: Math.max(8, left), visible: true });
  }, [menu.x, menu.y]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as HTMLElement)) onClose(); };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  return createPortal(
    <div
      ref={ref}
      className="fixed z-tooltip min-w-[160px] rounded-lg py-1 shadow-elevated text-xs"
      style={{ top: pos.top, left: pos.left, opacity: pos.visible ? 1 : 0, backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)' }}
    >
      <button
        type="button"
        disabled={!canLink}
        onClick={onPick}
        className="w-full text-left px-3 py-1.5 hover:bg-warm-100 text-warm-700 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Link2 className="w-3.5 h-3.5" />
        <span>{label}</span>
      </button>
    </div>,
    document.body,
  );
}

export default function VaultGraph({ files, edges, selectedPath, onSelectFile, projectId, onGraphChanged }: Props) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  // Node-label visibility toggle (default off), persisted per project.
  const [showLabels, setShowLabels] = useState(() => {
    try { return localStorage.getItem(`vault:graph:showLabels:${projectId}`) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(`vault:graph:showLabels:${projectId}`, showLabels ? '1' : '0'); } catch { /* ignore */ }
  }, [showLabels, projectId]);
  // Folder grouping (default on), persisted per project. Off = one node per file.
  const [grouped, setGrouped] = useState(() => {
    try { return localStorage.getItem(`vault:graph:grouped:${projectId}`) !== '0'; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(`vault:graph:grouped:${projectId}`, grouped ? '1' : '0'); } catch { /* ignore */ }
  }, [grouped, projectId]);
  const [currentFolder, setCurrentFolder] = useState('');
  // Fall back to root when ungrouped or when the folder vanished (deleted/renamed).
  const folder = grouped && files.some(f => f.relativePath.startsWith(currentFolder)) ? currentFolder : '';
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);
  // Link-drawing mode: relativePath of the source node awaiting a target click.
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; rel: string; stem: string; kind: VaultFile['kind'] } | null>(null);
  const linkSourceStem = useMemo(
    () => files.find(f => f.relativePath === linkSource)?.stem ?? null,
    [files, linkSource],
  );

  // Write a `[[targetStem]]` into the source file's 관련 문서 section, then reload.
  const commitLink = useCallback(async (sourceRel: string, targetStem: string) => {
    try {
      const { content } = await getVaultFileContent(projectId, sourceRel);
      const next = addRelatedLink(content, targetStem);
      if (next == null) return; // already linked — nothing to do
      await saveVaultFile(projectId, sourceRel, next);
      onGraphChanged?.();
    } catch { /* swallow — read/save failure leaves the doc untouched */ }
  }, [projectId, onGraphChanged]);

  // Esc cancels link mode / closes the menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setLinkSource(null); setMenu(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onNodeContextMenu = useCallback<NodeMouseHandler>((e, node) => {
    e.preventDefault();
    const f = files.find(ff => ff.relativePath === node.id);
    if (!f) return;
    setMenu({ x: e.clientX, y: e.clientY, rel: f.relativePath, stem: f.stem, kind: f.kind });
  }, [files]);

  // What the graph shows: nodes inside `folder`, plus outside ("ghost") nodes
  // that link into it. File-level edges are merged per node pair with a count.
  const view = useMemo(() => {
    const keyOf = (p: string) => grouped ? groupKey(p, folder) : p;
    const counts = new Map<string, number>();
    const fileByKey = new Map<string, VaultFile>();
    for (const f of files) {
      const k = keyOf(f.relativePath);
      counts.set(k, (counts.get(k) ?? 0) + 1);
      if (!k.endsWith('/')) fileByKey.set(k, f);
    }
    const linkCounts = new Map<string, number>();
    for (const e of edges) {
      const a = keyOf(e.from), b = keyOf(e.to);
      if (a === b || (!a.startsWith(folder) && !b.startsWith(folder))) continue;
      const k = `${a}\t${b}`;
      linkCounts.set(k, (linkCounts.get(k) ?? 0) + 1);
    }
    const links = [...linkCounts].map(([k, count]) => {
      const [from, to] = k.split('\t');
      return { from, to, count };
    });
    const linked = new Set(links.flatMap(l => [l.from, l.to]));
    const ids = [...counts.keys()].filter(k => k.startsWith(folder) || linked.has(k));
    let maxFolderCount = 1;
    for (const [k, c] of counts) if (k.endsWith('/') && c > maxFolderCount) maxFolderCount = c;
    return { keyOf, counts, fileByKey, links, ids, maxFolderCount };
  }, [files, edges, grouped, folder]);

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    const inc = (p: string, n: number) => d.set(p, (d.get(p) ?? 0) + n);
    for (const l of view.links) { inc(l.from, l.count); inc(l.to, l.count); }
    return d;
  }, [view]);

  const maxDegree = useMemo(() => {
    let m = 1;
    for (const v of degree.values()) if (v > m) m = v;
    return m;
  }, [degree]);

  const firstTagByPath = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const f of files) {
      const t = f.tags.length ? [...f.tags].sort()[0] : null;
      m.set(f.relativePath, t);
    }
    return m;
  }, [files]);

  const legend = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of firstTagByPath.values()) {
      if (t && !m.has(t)) m.set(t, hashTagToHsl(t));
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [firstTagByPath]);

  // Re-run the layout only when the node/edge *set* changes (add/remove/rename).
  // Content-only reloads (new array identity, same paths) keep the current layout.
  const layoutKey = useMemo(() => {
    const ids = [...view.ids].sort().join('\n');
    const links = view.links.map(l => `${l.from}\t${l.to}`).sort().join('\n');
    return `${ids}\0${links}`;
  }, [view]);

  const positions = useMemo(() => {
    return runForceLayout(view.ids, view.links.map(l => [l.from, l.to] as [string, string]));
  }, [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = useCallback((p: string) => {
    // Folder node → drill in. Link mode stays armed so a target can be picked inside.
    if (p.endsWith('/')) { setCurrentFolder(p); return; }
    if (linkSource) {
      if (p !== linkSource) {
        const target = files.find(f => f.relativePath === p);
        if (target) void commitLink(linkSource, target.stem);
      }
      setLinkSource(null);
      return;
    }
    onSelectFile(p === selectedPath ? null : p);
  }, [linkSource, files, commitLink, selectedPath, onSelectFile]);

  const matchesSearch = useCallback((file: VaultFile) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return file.stem.toLowerCase().includes(q) || file.title.toLowerCase().includes(q) || file.bodyPreview.toLowerCase().includes(q);
  }, [search]);

  // A folder node matches search when any file inside it matches.
  const matchedKeys = useMemo(
    () => new Set(files.filter(matchesSearch).map(f => view.keyOf(f.relativePath))),
    [files, matchesSearch, view],
  );
  const selectedKey = selectedPath ? view.keyOf(selectedPath) : null;

  const initialNodes: Node[] = useMemo(() => view.ids.map(key => {
    const pos = positions.get(key) ?? { x: 0, y: 0 };
    const highlight = matchedKeys.has(key);
    const ghost = !key.startsWith(folder);
    const style = search.trim() && !highlight ? { opacity: 0.18 } : ghost ? { opacity: 0.5 } : undefined;
    if (key.endsWith('/')) {
      const count = view.counts.get(key) ?? 0;
      const size = NODE_RADIUS_BASE + (count / view.maxFolderCount) * (NODE_RADIUS_MAX - NODE_RADIUS_BASE);
      // Ghosts show their full path so you can tell where they sit in the tree.
      const name = ghost ? key.slice(0, -1) : key.slice(folder.length, -1);
      return {
        id: key,
        type: 'folderDot',
        position: { x: pos.x, y: pos.y },
        data: { id: key, name, count, size, selected: key === selectedKey, onSelect: handleSelect },
        style,
      };
    }
    const f = view.fileByKey.get(key)!;
    const deg = degree.get(key) ?? 0;
    const size = NODE_RADIUS_BASE + (deg / maxDegree) * (NODE_RADIUS_MAX - NODE_RADIUS_BASE);
    const firstTag = firstTagByPath.get(key) ?? null;
    const tagColor = firstTag ? hashTagToHsl(firstTag) : null;
    return {
      id: key,
      type: 'vaultDot',
      position: { x: pos.x, y: pos.y },
      // Green only for actual search hits — with no query every file "matches" and would hide tag colors.
      data: { file: f, size, selected: key === selectedPath, highlight: highlight && search.trim() !== '', tagColor, showLabel: showLabels, onSelect: handleSelect },
      style,
    };
  }), [view, folder, positions, degree, maxDegree, firstTagByPath, selectedPath, selectedKey, handleSelect, matchedKeys, search, showLabels]);

  const initialEdges: Edge[] = useMemo(() =>
    view.links.map((l, i) => ({
      id: `ve-${i}`,
      source: l.from,
      target: l.to,
      type: 'straight',
      // Merged folder links get thicker with more underlying doc links.
      style: l.count > 1 ? { ...EDGE_STYLE, strokeWidth: Math.min(1 + Math.log2(l.count), 4) } : EDGE_STYLE,
      // Arrowhead at the target = link direction (from → to).
      markerEnd: { type: MarkerType.ArrowClosed, color: '#9CA3AF', width: 16, height: 16 },
    })),
  [view]);

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(initialNodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setFlowNodes(initialNodes);
    setFlowEdges(initialEdges);
  }, [initialNodes, initialEdges, setFlowNodes, setFlowEdges]);

  // Refit after drilling in/out; xyflow queues this until the new nodes are measured.
  useEffect(() => {
    void flowInstance?.fitView({ padding: 0.2 });
  }, [folder, grouped, flowInstance]);

  const crumbs = folder.split('/').filter(Boolean);

  if (files.length === 0) {
    return (
      <div className="h-full min-h-[400px] rounded-xl border border-warm-200 flex items-center justify-center text-warm-500 text-sm bg-[#1A1A1A]">
        {t('vault.empty')}
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[400px] rounded-xl border border-warm-200 overflow-hidden" style={{ background: '#1A1A1A' }}>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={t('vault.searchPlaceholder')}
        className="absolute top-3 left-3 z-10 px-3 py-1.5 rounded-lg bg-black/50 text-warm-800 placeholder:text-warm-400 border border-warm-700 text-xs w-56 focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <div className="absolute top-3 right-3 z-10 flex gap-1.5">
        <button
          type="button"
          onClick={() => setGrouped(v => !v)}
          title={t('vault.graph.groupByFolder')}
          className={`p-1.5 rounded-lg border transition-colors ${grouped ? 'bg-accent border-accent text-white' : 'bg-black/50 border-warm-700 text-warm-300 hover:text-warm-100'}`}
        >
          <FolderTree className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setShowLabels(v => !v)}
          title={t('vault.graph.showLabels')}
          className={`p-1.5 rounded-lg border transition-colors ${showLabels ? 'bg-accent border-accent text-white' : 'bg-black/50 border-warm-700 text-warm-300 hover:text-warm-100'}`}
        >
          <Type className="w-3.5 h-3.5" />
        </button>
      </div>
      {grouped && (
        <div className="absolute top-12 left-3 z-10 flex items-center flex-wrap gap-0.5 max-w-[70%] px-2 py-1 rounded-lg bg-black/50 border border-warm-700 text-xs text-warm-300">
          {['', ...crumbs].map((name, i) => {
            const path = crumbs.slice(0, i).map(s => `${s}/`).join('');
            const current = path === folder;
            return (
              <span key={path} className="flex items-center gap-0.5">
                {i > 0 && <ChevronRight className="w-3 h-3 text-warm-500" />}
                <button
                  type="button"
                  disabled={current}
                  onClick={() => setCurrentFolder(path)}
                  className={current ? 'text-warm-100 font-medium' : 'hover:text-warm-100 hover:underline'}
                >
                  {i === 0 ? t('vault.graph.root') : name}
                </button>
              </span>
            );
          })}
        </div>
      )}
      {linkSource && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-lg bg-accent border border-accent text-white text-xs shadow-elevated whitespace-nowrap pointer-events-none">
          {linkSourceStem ? `${linkSourceStem} → ` : ''}{t('vault.graph.linkHint')}
        </div>
      )}
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={() => { setLinkSource(null); setMenu(null); }}
        onInit={setFlowInstance}
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
      {legend.length > 0 && (
        <div className="absolute bottom-3 left-3 z-10 bg-black/50 border border-warm-700 rounded-lg px-2 py-1.5 text-xs max-h-48 overflow-y-auto text-warm-800">
          {legend.map(([tag, color]) => (
            <div key={tag} className="flex items-center gap-1.5 py-0.5">
              <span
                className="inline-block rounded-full shrink-0"
                style={{ width: 8, height: 8, background: color }}
              />
              <span className="truncate">{tag}</span>
            </div>
          ))}
        </div>
      )}
      {menu && (
        <NodeContextMenu
          menu={menu}
          canLink={menu.kind === 'md'}
          label={t('vault.graph.addLink')}
          onPick={() => { setLinkSource(menu.rel); setMenu(null); }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
