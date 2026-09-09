import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { useI18n } from '../i18n';
import * as sessionsApi from '../api/sessions';
import type { ProcessNode, SessionProcessTrees } from '../api/sessions';

// On Windows the PTY root is the cmd.exe wrapper node-pty spawns and the CLI
// is its only child; show the CLI as the main process. POSIX roots are the CLI.
function mainProcess(tree: ProcessNode): ProcessNode {
  return tree.name.toLowerCase() === 'cmd.exe' && tree.children.length === 1 ? tree.children[0] : tree;
}

function countDescendants(node: ProcessNode): number {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}

function formatMemory(bytes: number): string {
  return `${Math.round(bytes / 1048576)} MB`;
}

// Flat rows indented by depth; hovering a row shows the full command line.
function ProcessTreeRows({ node, depth }: { node: ProcessNode; depth: number }) {
  return (
    <>
      <div
        className="flex items-center gap-2 py-0.5 min-w-0 whitespace-nowrap"
        style={{ paddingLeft: depth * 12 }}
        title={node.command}
      >
        <span className="text-warm-700 shrink-0">{node.name}</span>
        <span className="text-warm-400 shrink-0">{node.pid}</span>
        <span className="text-warm-400 shrink-0">{formatMemory(node.memoryBytes)}</span>
        <span className="text-warm-400 truncate">{node.command}</span>
      </div>
      {node.children.map((child) => <ProcessTreeRows key={child.pid} node={child} depth={depth + 1} />)}
    </>
  );
}

function SessionProcessRow({ title, tree }: { title: string; tree: ProcessNode | null }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  if (!tree) {
    return (
      <div className="py-2 flex items-center gap-3 min-w-0">
        <span className="text-sm text-warm-700 truncate">{title}</span>
        <span className="text-2xs text-warm-400 shrink-0">{t('header.processesNotFound')}</span>
      </div>
    );
  }
  const main = mainProcess(tree);
  const subCount = countDescendants(main);
  return (
    <div className="py-2">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-sm text-warm-700 truncate">{title}</span>
        <span className="font-mono text-2xs text-warm-500 shrink-0" title={main.command}>
          {main.name} {main.pid} · {formatMemory(main.memoryBytes)}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          disabled={subCount === 0}
          className="ml-auto flex items-center gap-1 text-2xs text-warm-500 hover:text-warm-800 disabled:opacity-40 disabled:cursor-default shrink-0"
          title={t('header.processesSubHint')}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {subCount === 0 ? t('header.processesNoSub') : t('header.processesSub').replace('{count}', String(subCount))}
        </button>
      </div>
      {expanded && (
        <div className="mt-1.5 font-mono text-2xs overflow-x-auto">
          {main.children.map((child) => <ProcessTreeRows key={child.pid} node={child} depth={0} />)}
        </div>
      )}
    </div>
  );
}

export default function ProjectProcessesPanel({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SessionProcessTrees | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    sessionsApi.getSessionProcessTrees(projectId)
      .then(setResult)
      .catch((err) => setResult({ available: false, reason: err instanceof Error ? err.message : String(err) }))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Mounted only while the Processes settings tab is open, so this is one
  // enumeration per open (1.5–2.5 s on Windows) — never polled.
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 border border-warm-200 rounded-xl">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-warm-700">{t('header.processesTitle')}</h4>
        <div className="flex items-center gap-2">
          {result && result.available && (
            <span className="text-2xs text-warm-400" title={t('header.processesSnapshotAt')}>
              {new Date(result.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button type="button" onClick={load} disabled={loading} className="btn-icon btn-icon-sm" title={t('header.processesRefresh')}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <p className="text-2xs text-warm-500 mb-3">{t('header.processesHint')}</p>
      {!result ? (
        <p className="text-xs text-warm-400">{t('header.processesLoading')}</p>
      ) : !result.available ? (
        <p className="text-xs text-status-error">{t('header.processesFailed').replace('{reason}', result.reason)}</p>
      ) : result.sessions.length === 0 ? (
        <p className="text-xs text-warm-400">{t('header.processesNoneRunning')}</p>
      ) : (
        <div className="divide-y divide-warm-100">
          {result.sessions.map((session) => (
            <SessionProcessRow key={session.id} title={session.title} tree={session.tree} />
          ))}
        </div>
      )}
    </div>
  );
}
