import { useState, useEffect, useCallback } from 'react';
import type { Project } from '../types';
import * as githubApi from '../api/github';
import type { GitHubIssue } from '../api/github';
import { useI18n } from '../i18n';

interface GitHubPanelProps {
  project: Project;
  onImportAsTask: (title: string, description: string) => void;
}

export default function GitHubPanel({ project, onImportAsTask }: GitHubPanelProps) {
  const { t } = useI18n();
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<'open' | 'closed' | 'all'>('open');
  const [importingNum, setImportingNum] = useState<number | null>(null);
  const [importedNum, setImportedNum] = useState<number | null>(null);
  const [expandedNum, setExpandedNum] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const isConfigured = project.github_enabled && project.github_token && project.github_owner && project.github_repo;

  const fetchIssues = useCallback(async (reset = false) => {
    if (!isConfigured) return;
    setLoading(true);
    try {
      const currentPage = reset ? 1 : page;
      const result = await githubApi.getIssues(project.id, {
        state: stateFilter,
        page: currentPage,
        per_page: 20,
        search: search || undefined,
      });
      if (reset) {
        setIssues(result.items);
        setPage(1);
      } else {
        setIssues((prev) => [...prev, ...result.items]);
      }
      setHasMore(result.items.length >= 20);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [project.id, isConfigured, search, stateFilter, page]);

  useEffect(() => {
    fetchIssues(true);
  }, [project.id, isConfigured, stateFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => {
    fetchIssues(true);
  };

  const handleLoadMore = () => {
    setPage((p) => p + 1);
    // fetchIssues will be called via effect or we call directly
    setTimeout(() => fetchIssues(false), 0);
  };

  const handleImport = async (issueNumber: number) => {
    setImportingNum(issueNumber);
    try {
      const result = await githubApi.importIssue(project.id, issueNumber);
      onImportAsTask(result.title, result.description);
      setImportedNum(issueNumber);
      setTimeout(() => setImportedNum(null), 2000);
    } catch {
      // ignore
    } finally {
      setImportingNum(null);
    }
  };

  if (!isConfigured) {
    return (
      <div className="card p-16 text-center animate-fade-in">
        <div className="text-warm-300 mb-3">
          <svg className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844a9.59 9.59 0 012.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10z" />
          </svg>
        </div>
        <p className="text-warm-400 text-sm">{t('github.notConfigured')}</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-warm-700">{t('github.title')}</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="btn-primary text-xs"
          >
            {t('github.createIssue')}
          </button>
          <button
            onClick={() => fetchIssues(true)}
            disabled={loading}
            className="btn-ghost text-xs"
          >
            {t('github.refresh')}
          </button>
        </div>
      </div>

      {/* Create Issue Form */}
      {showCreate && (
        <CreateIssueForm
          projectId={project.id}
          onCreated={() => { setShowCreate(false); fetchIssues(true); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Filter + Search */}
      <div className="flex gap-2 mb-4">
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value as 'open' | 'closed' | 'all')}
          className="input-field text-xs w-24"
        >
          <option value="open">{t('github.open')}</option>
          <option value="closed">{t('github.closed')}</option>
          <option value="all">{t('github.all')}</option>
        </select>
        <div className="flex-1 relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder={t('github.search')}
            className="input-field text-xs pr-8"
          />
          <button
            onClick={handleSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-warm-400 hover:text-warm-600"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Issue List */}
      {issues.length === 0 && !loading && (
        <div className="card p-10 text-center">
          <p className="text-warm-400 text-sm">{t('github.noIssues')}</p>
          <p className="text-warm-300 text-xs mt-1">{t('github.noIssuesHint')}</p>
        </div>
      )}

      <div className="space-y-2">
        {issues.map((issue) => (
          <IssueCard
            key={issue.number}
            issue={issue}
            projectId={project.id}
            expanded={expandedNum === issue.number}
            onToggle={() => setExpandedNum(expandedNum === issue.number ? null : issue.number)}
            importing={importingNum === issue.number}
            imported={importedNum === issue.number}
            onImport={() => handleImport(issue.number)}
          />
        ))}
      </div>

      {/* Load more */}
      {hasMore && (
        <div className="mt-4 text-center">
          <button
            onClick={handleLoadMore}
            disabled={loading}
            className="btn-ghost text-xs"
          >
            {loading ? '...' : t('github.loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Issue Card ──

interface IssueCardProps {
  issue: GitHubIssue;
  projectId: string;
  expanded: boolean;
  onToggle: () => void;
  importing: boolean;
  imported: boolean;
  onImport: () => void;
}

function IssueCard({ issue, projectId, expanded, onToggle, importing, imported, onImport }: IssueCardProps) {
  const { t } = useI18n();
  const updatedAt = new Date(issue.updated_at).toLocaleDateString();

  return (
    <div className="card p-3 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        {/* State icon */}
        <div className={`w-4 h-4 mt-0.5 flex-shrink-0 ${issue.state === 'open' ? 'text-status-success' : 'text-purple-500'}`}>
          {issue.state === 'open' ? (
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="4" fill="currentColor" />
            </svg>
          ) : (
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Title */}
          <div className="flex items-center gap-2">
            <button
              onClick={onToggle}
              className="text-xs font-medium text-blue-600 hover:text-blue-800 truncate text-left"
            >
              #{issue.number} {issue.title}
            </button>
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {issue.labels.map((label) => (
              <span
                key={label.name}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
                style={{
                  backgroundColor: `#${label.color}20`,
                  color: `#${label.color}`,
                }}
              >
                {label.name}
              </span>
            ))}
            {issue.user && (
              <span className="text-[10px] text-warm-400">
                {issue.user.login}
              </span>
            )}
            {issue.comments > 0 && (
              <span className="text-[10px] text-warm-400">
                {issue.comments} comments
              </span>
            )}
            <span className="text-[10px] text-warm-300 ml-auto">
              {updatedAt}
            </span>
          </div>
        </div>

        {/* Import button */}
        <button
          onClick={onImport}
          disabled={importing || imported}
          className={`flex-shrink-0 text-xs px-2 py-1 rounded-lg font-medium transition-colors ${
            imported
              ? 'bg-status-success/10 text-status-success'
              : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
          }`}
          title={t('github.import')}
        >
          {importing ? t('github.importing') : imported ? t('github.imported') : t('github.import')}
        </button>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <ExpandedIssuePanel issueNumber={issue.number} projectId={projectId} body={issue.body} />
      )}
    </div>
  );
}

// ── Expanded Issue Panel ──

function ExpandedIssuePanel({ issueNumber, projectId, body }: { issueNumber: number; projectId: string; body: string | null }) {
  const { t } = useI18n();
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    githubApi.getComments(projectId, issueNumber)
      .then((data) => setComments(data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId, issueNumber]);

  return (
    <div className="mt-3 pt-3 border-t border-warm-100 space-y-2 animate-slide-up max-h-64 overflow-y-auto">
      {/* Issue body */}
      {body ? (
        <div className="text-xs text-warm-500 whitespace-pre-wrap break-words">{body}</div>
      ) : (
        <p className="text-xs text-warm-400 italic">{t('github.noBody')}</p>
      )}

      {/* Comments */}
      {loading ? (
        <p className="text-xs text-warm-400">{t('github.loadingComments')}</p>
      ) : comments.length > 0 ? (
        <div className="space-y-2 mt-2">
          <p className="text-[10px] font-semibold text-warm-500 uppercase">{t('github.comments')}</p>
          {comments.map((c: any) => (
            <div key={c.id} className="pl-3 border-l-2 border-warm-100">
              <p className="text-[10px] text-warm-400 font-medium">{c.user?.login}</p>
              <p className="text-xs text-warm-500 whitespace-pre-wrap break-words">{c.body}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Create Issue Form ──

function CreateIssueForm({ projectId, onCreated, onCancel }: { projectId: string; onCreated: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    try {
      await githubApi.createIssue(projectId, { title, body: body || undefined });
      onCreated();
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="card p-4 mb-4 animate-slide-up">
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-warm-500 mb-1">{t('github.issueTitle')}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="input-field text-xs"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-warm-500 mb-1">{t('github.issueBody')}</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="input-field text-xs"
            rows={3}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost text-xs">{t('header.cancel')}</button>
          <button
            onClick={handleCreate}
            disabled={creating || !title.trim()}
            className="btn-primary text-xs"
          >
            {creating ? t('github.creating') : t('github.createIssue')}
          </button>
        </div>
      </div>
    </div>
  );
}
