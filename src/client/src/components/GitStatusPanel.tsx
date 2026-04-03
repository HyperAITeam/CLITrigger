import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Project } from '../types';
import * as projectsApi from '../api/projects';
import type { GitLogEntry, GitRef } from '../api/projects';
import { useI18n } from '../i18n';

interface GitStatusPanelProps {
  project: Project;
}

// --- Lane assignment algorithm ---

const LANE_COLORS = [
  '#D4A843', // gold
  '#2196F3', // blue
  '#4CAF50', // green
  '#E53935', // red
  '#9C27B0', // purple
  '#FF9800', // orange
  '#00BCD4', // cyan
  '#795548', // brown
];

interface GraphNode {
  lane: number;
  color: string;
  connections: Array<{
    fromLane: number;
    toLane: number;
    toRow: number;
    color: string;
  }>;
}

function computeGraphLanes(commits: GitLogEntry[]): GraphNode[] {
  const hashToRow = new Map<string, number>();
  commits.forEach((c, i) => hashToRow.set(c.hash, i));

  const activeLanes: (string | null)[] = [];
  const result: GraphNode[] = [];

  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row];

    // Find lane for this commit
    let lane = activeLanes.indexOf(commit.hash);
    if (lane === -1) {
      // New lane — find first empty slot
      lane = activeLanes.indexOf(null);
      if (lane === -1) {
        lane = activeLanes.length;
        activeLanes.push(null);
      }
    }
    activeLanes[lane] = null; // consume

    const color = LANE_COLORS[lane % LANE_COLORS.length];
    const connections: GraphNode['connections'] = [];

    for (let pi = 0; pi < commit.parentHashes.length; pi++) {
      const parentHash = commit.parentHashes[pi];
      const parentRow = hashToRow.get(parentHash);
      if (parentRow === undefined) continue;

      let parentLane = activeLanes.indexOf(parentHash);
      if (parentLane !== -1) {
        // Parent already claimed by another child — merge line
        connections.push({
          fromLane: lane,
          toLane: parentLane,
          toRow: parentRow,
          color: LANE_COLORS[parentLane % LANE_COLORS.length],
        });
      } else {
        if (pi === 0) {
          // First parent takes current lane
          activeLanes[lane] = parentHash;
          connections.push({
            fromLane: lane,
            toLane: lane,
            toRow: parentRow,
            color,
          });
        } else {
          // Additional parents — find empty lane
          let newLane = activeLanes.indexOf(null);
          if (newLane === -1) {
            newLane = activeLanes.length;
            activeLanes.push(null);
          }
          activeLanes[newLane] = parentHash;
          connections.push({
            fromLane: lane,
            toLane: newLane,
            toRow: parentRow,
            color: LANE_COLORS[newLane % LANE_COLORS.length],
          });
        }
      }
    }

    result.push({ lane, color, connections });
  }

  // Trim trailing empty lanes
  return result;
}

// --- Ref badge ---

function RefBadge({ refStr }: { refStr: string }) {
  const isHead = refStr.startsWith('HEAD');
  const isRemote = refStr.startsWith('origin/') || refStr.includes('remotes/');
  const isTag = refStr.startsWith('tag: ');

  let label = refStr;
  let classes = '';

  if (isTag) {
    label = refStr.replace('tag: ', '');
    classes = 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300';
  } else if (isHead) {
    label = refStr.replace('HEAD -> ', '');
    classes = 'bg-status-success/15 text-status-success font-semibold';
  } else if (isRemote) {
    classes = 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
  } else {
    classes = 'bg-accent-gold/15 text-accent-gold';
  }

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${classes}`}>
      {label}
    </span>
  );
}

// --- Graph SVG ---

const ROW_HEIGHT = 32;
const LANE_WIDTH = 16;
const DOT_RADIUS = 4;
const MAX_LANES = 10;

function CommitGraphSvg({ graphNodes, totalRows }: { graphNodes: GraphNode[]; totalRows: number }) {
  const maxLane = Math.min(
    MAX_LANES,
    graphNodes.reduce((max, n) => {
      const connMax = n.connections.reduce((cm, c) => Math.max(cm, c.fromLane, c.toLane), 0);
      return Math.max(max, n.lane, connMax);
    }, 0) + 1
  );
  const width = (maxLane + 1) * LANE_WIDTH + 8;

  return (
    <svg
      width={width}
      height={totalRows * ROW_HEIGHT}
      className="shrink-0"
      style={{ minWidth: width }}
    >
      {/* Draw connections first (behind dots) */}
      {graphNodes.map((node, row) =>
        node.connections.map((conn, ci) => {
          const x1 = conn.fromLane * LANE_WIDTH + LANE_WIDTH / 2 + 4;
          const y1 = row * ROW_HEIGHT + ROW_HEIGHT / 2;
          const x2 = conn.toLane * LANE_WIDTH + LANE_WIDTH / 2 + 4;
          const y2Row = Math.min(conn.toRow, row + 1);
          const y2 = y2Row * ROW_HEIGHT + ROW_HEIGHT / 2;

          if (x1 === x2) {
            // Straight line down
            return (
              <line
                key={`${row}-${ci}`}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={conn.color} strokeWidth={2} strokeOpacity={0.7}
              />
            );
          } else {
            // Curved merge/branch line
            const midY = (y1 + y2) / 2;
            return (
              <path
                key={`${row}-${ci}`}
                d={`M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`}
                fill="none" stroke={conn.color} strokeWidth={2} strokeOpacity={0.7}
              />
            );
          }
        })
      )}
      {/* Draw dots */}
      {graphNodes.map((node, row) => {
        const cx = node.lane * LANE_WIDTH + LANE_WIDTH / 2 + 4;
        const cy = row * ROW_HEIGHT + ROW_HEIGHT / 2;
        return (
          <circle
            key={`dot-${row}`}
            cx={cx} cy={cy} r={DOT_RADIUS}
            fill={node.color} stroke="white" strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
}

// --- Refs Sidebar ---

function RefsSidebar({ branches, tags, stashCount }: {
  branches: GitRef[];
  tags: string[];
  stashCount: number;
}) {
  const { t } = useI18n();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['local', 'remote'])
  );

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const localBranches = branches.filter(b => !b.remote);
  const remoteBranches = branches.filter(b => b.remote);

  const SectionHeader = ({ id, label, count }: { id: string; label: string; count: number }) => (
    <button
      onClick={() => toggleSection(id)}
      className="w-full flex items-center gap-1.5 py-1.5 text-[11px] font-semibold text-warm-500 uppercase tracking-wider hover:text-warm-700 transition-colors"
    >
      <svg
        className={`h-3 w-3 transition-transform ${expandedSections.has(id) ? 'rotate-90' : ''}`}
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
      {label}
      <span className="text-warm-400 font-normal ml-auto">{count}</span>
    </button>
  );

  return (
    <div className="space-y-1">
      {/* Local branches */}
      <SectionHeader id="local" label={t('git.branches')} count={localBranches.length} />
      {expandedSections.has('local') && (
        <div className="pl-1 space-y-px">
          {localBranches.map(b => (
            <div
              key={b.name}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs truncate ${
                b.current ? 'text-accent-gold font-semibold bg-accent-gold/10' : 'text-warm-600 hover:bg-warm-50'
              }`}
            >
              {b.current && (
                <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
              <span className="truncate">{b.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Remote branches */}
      {remoteBranches.length > 0 && (
        <>
          <SectionHeader id="remote" label={t('git.remotes')} count={remoteBranches.length} />
          {expandedSections.has('remote') && (
            <div className="pl-1 space-y-px">
              {remoteBranches.map(b => (
                <div key={b.name} className="px-2 py-1 text-xs text-warm-500 truncate hover:bg-warm-50 rounded">
                  {b.name.replace('remotes/', '')}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <>
          <SectionHeader id="tags" label={t('git.tags')} count={tags.length} />
          {expandedSections.has('tags') && (
            <div className="pl-1 space-y-px">
              {tags.map(tag => (
                <div key={tag} className="flex items-center gap-1.5 px-2 py-1 text-xs text-warm-500 truncate hover:bg-warm-50 rounded">
                  <svg className="h-3 w-3 text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                  </svg>
                  {tag}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Stashes */}
      {stashCount > 0 && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-warm-500 uppercase tracking-wider">
          {t('git.stashes')}
          <span className="text-warm-400 font-normal ml-auto">{stashCount}</span>
        </div>
      )}
    </div>
  );
}

// --- Relative time ---

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo`;
  return `${Math.floor(diffDay / 365)}y`;
}

// --- Main component ---

export default function GitStatusPanel({ project }: GitStatusPanelProps) {
  const { t } = useI18n();
  const [commits, setCommits] = useState<GitLogEntry[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<GitRef[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [stashCount, setStashCount] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  const fetchRefs = useCallback(async () => {
    try {
      const refs = await projectsApi.getGitRefs(project.id);
      setBranches(refs.branches);
      setTags(refs.tags);
      setStashCount(refs.stashCount);
    } catch {
      // non-critical
    }
  }, [project.id]);

  const fetchLog = useCallback(async (skip: number, reset = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await projectsApi.getGitLog(project.id, skip, 50);
      setCommits(prev => reset ? result.commits : [...prev, ...result.commits]);
      setHasMore(result.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch git log');
    } finally {
      setLoading(false);
      setInitialLoading(false);
      loadingRef.current = false;
    }
  }, [project.id]);

  const refresh = useCallback(() => {
    setCommits([]);
    setHasMore(true);
    setInitialLoading(true);
    fetchLog(0, true);
    fetchRefs();
  }, [fetchLog, fetchRefs]);

  useEffect(() => {
    fetchLog(0, true);
    fetchRefs();
  }, [fetchLog, fetchRefs]);

  // Infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingRef.current && commits.length > 0) {
          fetchLog(commits.length);
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, commits.length, fetchLog]);

  const graphNodes = useMemo(() => computeGraphLanes(commits), [commits]);

  return (
    <div className="animate-fade-in flex gap-3" style={{ height: 'calc(100vh - 260px)', minHeight: '400px' }}>
      {/* Left sidebar */}
      <div className="card w-48 shrink-0 overflow-y-auto p-3">
        <RefsSidebar branches={branches} tags={tags} stashCount={stashCount} />
      </div>

      {/* Main commit history */}
      <div className="card flex-1 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-warm-100">
          <span className="text-sm font-semibold text-warm-700">{t('git.commitHistory')}</span>
          <button
            onClick={refresh}
            disabled={loading}
            className="btn-ghost text-xs flex items-center gap-1.5"
          >
            <svg className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            {t('git.refresh')}
          </button>
        </div>

        {/* Column headers */}
        <div className="flex items-center px-4 py-1.5 border-b border-warm-50 text-[10px] text-warm-400 uppercase tracking-wider">
          <div className="w-24 shrink-0">{t('git.graph')}</div>
          <div className="flex-1 min-w-0">{t('git.description')}</div>
          <div className="w-20 text-right shrink-0">{t('git.date')}</div>
          <div className="w-24 text-right shrink-0">{t('git.author')}</div>
          <div className="w-20 text-right shrink-0">{t('git.hash')}</div>
        </div>

        {/* Error */}
        {error && (
          <div className="p-6 text-center">
            <p className="text-status-error text-sm">{error}</p>
          </div>
        )}

        {/* Initial loading */}
        {initialLoading && !error && (
          <div className="p-6 text-center">
            <p className="text-warm-500 text-sm">{t('detail.loading')}</p>
          </div>
        )}

        {/* No commits */}
        {!initialLoading && !error && commits.length === 0 && (
          <div className="p-6 text-center">
            <p className="text-warm-500 text-sm">{t('git.noCommits')}</p>
          </div>
        )}

        {/* Commit list */}
        {commits.length > 0 && (
          <div className="flex-1 overflow-y-auto" ref={scrollRef}>
            <div className="relative flex">
              {/* SVG Graph */}
              <div className="shrink-0 sticky left-0">
                <CommitGraphSvg graphNodes={graphNodes} totalRows={commits.length} />
              </div>

              {/* Commit rows */}
              <div className="flex-1 min-w-0">
                {commits.map((commit, i) => (
                  <div
                    key={commit.hash}
                    className="flex items-center px-3 hover:bg-warm-50/50 transition-colors border-b border-warm-50/50"
                    style={{ height: ROW_HEIGHT }}
                  >
                    {/* Ref badges + message */}
                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                      {commit.refs.length > 0 && (
                        <div className="flex items-center gap-1 shrink-0">
                          {commit.refs.map((ref, ri) => (
                            <RefBadge key={ri} refStr={ref} />
                          ))}
                        </div>
                      )}
                      <span className="text-xs text-warm-700 truncate">{commit.message}</span>
                    </div>

                    {/* Date */}
                    <div className="w-20 text-right shrink-0">
                      <span className="text-[11px] text-warm-400" title={commit.date}>
                        {relativeTime(commit.date)}
                      </span>
                    </div>

                    {/* Author */}
                    <div className="w-24 text-right shrink-0">
                      <span className="text-[11px] text-warm-500 truncate inline-block max-w-full">
                        {commit.author}
                      </span>
                    </div>

                    {/* Hash */}
                    <div className="w-20 text-right shrink-0">
                      <span
                        className="text-[11px] font-mono text-warm-400 cursor-pointer hover:text-accent-gold transition-colors"
                        title={commit.hash}
                        onClick={() => navigator.clipboard.writeText(commit.hash)}
                      >
                        {commit.hash.substring(0, 7)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Sentinel for infinite scroll */}
            <div ref={sentinelRef} className="h-8 flex items-center justify-center">
              {loading && (
                <span className="text-xs text-warm-400">{t('git.loadMore')}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
