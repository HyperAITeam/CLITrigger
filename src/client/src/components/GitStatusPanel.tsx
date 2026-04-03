import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Project } from '../types';
import * as projectsApi from '../api/projects';
import type { GitStatusFile } from '../api/projects';
import { useI18n } from '../i18n';

interface GitStatusPanelProps {
  project: Project;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  index?: string;
  working_dir?: string;
  children: TreeNode[];
}

function buildTree(files: GitStatusFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isFile = i === parts.length - 1;
      const pathSoFar = parts.slice(0, i + 1).join('/');

      let existing = current.find((n) => n.name === name && n.type === (isFile ? 'file' : 'dir'));

      if (!existing) {
        existing = {
          name,
          path: pathSoFar,
          type: isFile ? 'file' : 'dir',
          children: [],
          ...(isFile ? { index: file.index, working_dir: file.working_dir } : {}),
        };
        current.push(existing);
      }

      current = existing.children;
    }
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.children.length > 0) sortNodes(n.children);
    }
    return nodes;
  };

  return sortNodes(root);
}

function countFiles(nodes: TreeNode[]): number {
  let count = 0;
  for (const n of nodes) {
    if (n.type === 'file') count++;
    else count += countFiles(n.children);
  }
  return count;
}

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  M: { color: 'text-status-warning', label: 'Modified' },
  A: { color: 'text-status-success', label: 'Added' },
  D: { color: 'text-status-error', label: 'Deleted' },
  '?': { color: 'text-warm-400', label: 'Untracked' },
  R: { color: 'text-status-running', label: 'Renamed' },
  C: { color: 'text-status-running', label: 'Copied' },
  U: { color: 'text-status-error', label: 'Unmerged' },
};

function StatusBadge({ code, type }: { code: string; type: 'staged' | 'unstaged' }) {
  if (!code || code === ' ' || code === '?') {
    if (code === '?' && type === 'unstaged') {
      return <span className="inline-block w-5 text-center text-[10px] font-bold text-warm-400">?</span>;
    }
    return <span className="inline-block w-5" />;
  }
  const cfg = STATUS_CONFIG[code] || { color: 'text-warm-500', label: code };
  return (
    <span className={`inline-block w-5 text-center text-[10px] font-bold ${cfg.color}`} title={`${type}: ${cfg.label}`}>
      {code}
    </span>
  );
}

function FileTreeNode({ node, expanded, onToggle, depth }: {
  node: TreeNode;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  depth: number;
}) {
  const isOpen = expanded.has(node.path);
  const pl = depth * 16;

  if (node.type === 'dir') {
    const fileCount = countFiles(node.children);
    return (
      <>
        <button
          onClick={() => onToggle(node.path)}
          className="w-full flex items-center gap-1.5 py-1 px-2 hover:bg-warm-50 rounded text-left transition-colors"
          style={{ paddingLeft: `${pl + 8}px` }}
        >
          <svg
            className={`h-3.5 w-3.5 text-warm-400 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <svg className="h-4 w-4 text-accent-gold shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
          </svg>
          <span className="text-sm text-warm-700 font-medium truncate">{node.name}</span>
          <span className="text-[10px] text-warm-400 ml-auto shrink-0">{fileCount}</span>
        </button>
        {isOpen && node.children.map((child) => (
          <FileTreeNode key={child.path} node={child} expanded={expanded} onToggle={onToggle} depth={depth + 1} />
        ))}
      </>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 py-1 px-2 hover:bg-warm-50 rounded transition-colors"
      style={{ paddingLeft: `${pl + 24}px` }}
    >
      <svg className="h-3.5 w-3.5 text-warm-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
      <span className="text-sm text-warm-600 truncate font-mono">{node.name}</span>
      <div className="ml-auto flex items-center gap-0.5 shrink-0">
        <StatusBadge code={node.index ?? ' '} type="staged" />
        <StatusBadge code={node.working_dir ?? ' '} type="unstaged" />
      </div>
    </div>
  );
}

export default function GitStatusPanel({ project }: GitStatusPanelProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<projectsApi.GitStatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await projectsApi.getGitStatusTree(project.id);
      setStatus(result);
      // Auto-expand all directories on first load
      if (result.files.length > 0) {
        const dirs = new Set<string>();
        for (const f of result.files) {
          const parts = f.path.split('/');
          for (let i = 1; i < parts.length; i++) {
            dirs.add(parts.slice(0, i).join('/'));
          }
        }
        setExpanded(dirs);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch git status');
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const tree = useMemo(() => (status ? buildTree(status.files) : []), [status]);

  const handleToggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  return (
    <div className="animate-fade-in">
      {/* Branch info header */}
      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-accent-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
              </svg>
              <span className="text-sm font-semibold text-warm-800">
                {status?.branch || '...'}
              </span>
            </div>
            {status && (status.ahead > 0 || status.behind > 0) && (
              <div className="flex items-center gap-2 text-xs">
                {status.ahead > 0 && (
                  <span className="badge bg-status-success/10 text-status-success">
                    {status.ahead} {t('git.ahead')}
                  </span>
                )}
                {status.behind > 0 && (
                  <span className="badge bg-status-warning/10 text-status-warning">
                    {status.behind} {t('git.behind')}
                  </span>
                )}
              </div>
            )}
            {status?.tracking && (
              <span className="text-xs text-warm-400">{status.tracking}</span>
            )}
          </div>
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="btn-ghost text-xs flex items-center gap-1.5"
          >
            <svg className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            {t('git.refresh')}
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="card p-6 text-center">
          <p className="text-status-error text-sm">{error}</p>
        </div>
      )}

      {/* Loading state */}
      {loading && !status && (
        <div className="card p-6 text-center">
          <p className="text-warm-500 text-sm">{t('detail.loading')}</p>
        </div>
      )}

      {/* File tree */}
      {status && !error && (
        <div className="card p-3">
          {status.files.length === 0 ? (
            <div className="py-8 text-center">
              <svg className="h-8 w-8 text-status-success mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-warm-500 text-sm">{t('git.noChanges')}</p>
            </div>
          ) : (
            <>
              {/* Legend */}
              <div className="flex items-center gap-3 px-2 pb-2 mb-2 border-b border-warm-100 text-[10px] text-warm-400">
                <span>{status.files.length} {t('git.files')}</span>
                <span className="ml-auto">{t('git.staged')}</span>
                <span>{t('git.unstaged')}</span>
              </div>
              {/* Tree */}
              <div className="max-h-[60vh] overflow-y-auto">
                {tree.map((node) => (
                  <FileTreeNode key={node.path} node={node} expanded={expanded} onToggle={handleToggle} depth={0} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
