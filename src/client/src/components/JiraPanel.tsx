import { useState, useEffect, useCallback } from 'react';
import { Link, Search } from 'lucide-react';
import type { Project, JiraIssue } from '../types';
import * as jiraApi from '../api/jira';
import { useI18n } from '../i18n';

interface JiraPanelProps {
  project: Project;
  onImportAsTask: (title: string, description: string) => void;
}

export default function JiraPanel({ project, onImportAsTask }: JiraPanelProps) {
  const { t } = useI18n();
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [startAt, setStartAt] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [importedKey, setImportedKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const isConfigured = project.jira_enabled && project.jira_base_url && project.jira_email && project.jira_api_token;

  const fetchIssues = useCallback(async (reset = false) => {
    if (!isConfigured) return;
    setLoading(true);
    try {
      const offset = reset ? 0 : startAt;
      const result = await jiraApi.getIssues(project.id, {
        status: statusFilter !== 'all' ? statusFilter : undefined,
        search: search || undefined,
        maxResults: 20,
        startAt: offset,
      });
      if (reset) {
        setIssues(result.issues);
        setStartAt(result.issues.length);
      } else {
        setIssues((prev) => [...prev, ...result.issues]);
        setStartAt(offset + result.issues.length);
      }
      setTotal(result.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [project.id, isConfigured, statusFilter, search, startAt]);

  useEffect(() => {
    fetchIssues(true);
  }, [project.id, isConfigured, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isConfigured) return;
    jiraApi.getStatuses(project.id).then(setStatuses).catch(() => {});
  }, [project.id, isConfigured]);

  const handleSearch = () => {
    fetchIssues(true);
  };

  const handleImport = async (issueKey: string) => {
    setImportingKey(issueKey);
    try {
      const result = await jiraApi.importIssue(project.id, issueKey);
      onImportAsTask(result.title, result.description);
      setImportedKey(issueKey);
      setTimeout(() => setImportedKey(null), 2000);
    } catch {
      // ignore
    } finally {
      setImportingKey(null);
    }
  };

  if (!isConfigured) {
    return (
      <div className="card p-16 text-center animate-fade-in">
        <div className="text-warm-300 mb-3">
          <Link size={48} className="mx-auto" strokeWidth={1} />
        </div>
        <p className="text-warm-400 text-sm">{t('jira.notConfigured')}</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-warm-700">{t('jira.title')}</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="btn-primary text-xs"
          >
            {t('jira.createIssue')}
          </button>
          <button
            onClick={() => fetchIssues(true)}
            disabled={loading}
            className="btn-ghost text-xs"
          >
            {t('jira.refresh')}
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

      {/* Search + Filter Bar */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder={t('jira.search')}
            className="input-field text-xs pr-8"
          />
          <button
            onClick={handleSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-warm-400 hover:text-warm-600"
          >
            <Search size={14} />
          </button>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-field text-xs w-36"
        >
          <option value="all">{t('jira.allStatuses')}</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Issues count */}
      {total > 0 && (
        <p className="text-xs text-warm-400 mb-3">{total} {t('jira.total')}</p>
      )}

      {/* Issue List */}
      {issues.length === 0 && !loading && (
        <div className="card p-10 text-center">
          <p className="text-warm-400 text-sm">{t('jira.noIssues')}</p>
          <p className="text-warm-300 text-xs mt-1">{t('jira.noIssuesHint')}</p>
        </div>
      )}

      <div className="space-y-2">
        {issues.map((issue) => (
          <IssueCard
            key={issue.key}
            issue={issue}
            projectId={project.id}
            expanded={expandedKey === issue.key}
            onToggle={() => setExpandedKey(expandedKey === issue.key ? null : issue.key)}
            importing={importingKey === issue.key}
            imported={importedKey === issue.key}
            onImport={() => handleImport(issue.key)}
          />
        ))}
      </div>

      {/* Load more */}
      {issues.length < total && (
        <div className="mt-4 text-center">
          <button
            onClick={() => fetchIssues(false)}
            disabled={loading}
            className="btn-ghost text-xs"
          >
            {loading ? '...' : t('jira.loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Issue Card ──

interface IssueCardProps {
  issue: JiraIssue;
  projectId: string;
  expanded: boolean;
  onToggle: () => void;
  importing: boolean;
  imported: boolean;
  onImport: () => void;
}

function IssueCard({ issue, projectId, expanded, onToggle, importing, imported, onImport }: IssueCardProps) {
  const { t } = useI18n();

  const statusColor = getStatusColor(issue.fields.status.statusCategory?.colorName);

  return (
    <div className="card p-3 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        {/* Issue type icon */}
        {issue.fields.issuetype.iconUrl && (
          <img src={issue.fields.issuetype.iconUrl} alt={issue.fields.issuetype.name} className="w-4 h-4 mt-0.5 flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          {/* Key + Summary */}
          <div className="flex items-center gap-2">
            <button
              onClick={onToggle}
              className="text-xs font-mono text-blue-600 hover:text-blue-800 font-medium flex-shrink-0"
            >
              {issue.key}
            </button>
            <span className="text-xs text-warm-700 truncate">{issue.fields.summary}</span>
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium ${statusColor}`}>
              {issue.fields.status.name}
            </span>
            {issue.fields.priority && (
              <span className="text-2xs text-warm-400 flex items-center gap-1">
                {issue.fields.priority.iconUrl && <img src={issue.fields.priority.iconUrl} alt="" className="w-3 h-3" />}
                {issue.fields.priority.name}
              </span>
            )}
            <span className="text-2xs text-warm-300">
              {issue.fields.assignee?.displayName || t('jira.unassigned')}
            </span>
            {issue.fields.labels.length > 0 && (
              <span className="text-2xs text-warm-300">{issue.fields.labels.join(', ')}</span>
            )}
            <span className="text-2xs text-warm-300 ml-auto">
              {new Date(issue.fields.updated).toLocaleDateString()}
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
          title={t('jira.import')}
        >
          {importing ? t('jira.importing') : imported ? t('jira.imported') : t('jira.import')}
        </button>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <ExpandedIssuePanel issueKey={issue.key} projectId={projectId} />
      )}
    </div>
  );
}

// ── Expanded Issue Panel (transitions + comment) ──

function ExpandedIssuePanel({ issueKey, projectId }: { issueKey: string; projectId: string }) {
  const { t } = useI18n();
  const [transitions, setTransitions] = useState<Array<{ id: string; name: string }>>([]);
  const [transitioning, setTransitioning] = useState(false);
  const [comment, setComment] = useState('');
  const [commenting, setCommenting] = useState(false);

  useEffect(() => {
    jiraApi.getTransitions(projectId, issueKey).then((d) => setTransitions(d.transitions)).catch(() => {});
  }, [projectId, issueKey]);

  const handleTransition = async (transitionId: string) => {
    setTransitioning(true);
    try {
      await jiraApi.transitionIssue(projectId, issueKey, transitionId);
      // Refresh transitions
      const d = await jiraApi.getTransitions(projectId, issueKey);
      setTransitions(d.transitions);
    } catch {
      // ignore
    } finally {
      setTransitioning(false);
    }
  };

  const handleComment = async () => {
    if (!comment.trim()) return;
    setCommenting(true);
    try {
      await jiraApi.addComment(projectId, issueKey, comment);
      setComment('');
    } catch {
      // ignore
    } finally {
      setCommenting(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-warm-100 space-y-3 animate-slide-up">
      {/* Transitions */}
      {transitions.length > 0 && (
        <div>
          <p className="text-2xs font-medium text-warm-500 mb-1.5">{t('jira.transition')}</p>
          <div className="flex flex-wrap gap-1.5">
            {transitions.map((tr) => (
              <button
                key={tr.id}
                onClick={() => handleTransition(tr.id)}
                disabled={transitioning}
                className="text-2xs px-2 py-1 rounded-md bg-warm-50 text-warm-600 hover:bg-warm-100 transition-colors font-medium"
              >
                {tr.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Comment */}
      <div>
        <p className="text-2xs font-medium text-warm-500 mb-1.5">{t('jira.comment')}</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleComment()}
            placeholder={t('jira.commentPlaceholder')}
            className="input-field text-xs flex-1"
          />
          <button
            onClick={handleComment}
            disabled={commenting || !comment.trim()}
            className="btn-primary text-xs"
          >
            {commenting ? '...' : t('jira.commentSend')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create Issue Form ──

function CreateIssueForm({ projectId, onCreated, onCancel }: { projectId: string; onCreated: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [issueType, setIssueType] = useState('Task');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!summary.trim()) return;
    setCreating(true);
    try {
      await jiraApi.createIssue(projectId, { summary, description: description || undefined, issueType });
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
          <label className="block text-xs font-medium text-warm-500 mb-1">{t('jira.createSummary')}</label>
          <input
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="input-field text-xs"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-warm-500 mb-1">{t('jira.createDesc')}</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input-field text-xs"
            rows={3}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-warm-500 mb-1">{t('jira.createType')}</label>
          <select value={issueType} onChange={(e) => setIssueType(e.target.value)} className="input-field text-xs w-40">
            <option value="Task">Task</option>
            <option value="Bug">Bug</option>
            <option value="Story">Story</option>
            <option value="Epic">Epic</option>
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost text-xs">{t('header.cancel')}</button>
          <button
            onClick={handleCreate}
            disabled={creating || !summary.trim()}
            className="btn-primary text-xs"
          >
            {creating ? t('jira.creating') : t('jira.createIssue')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──

function getStatusColor(colorName?: string): string {
  switch (colorName) {
    case 'blue-gray':
    case 'default':
      return 'bg-warm-100 text-warm-600';
    case 'blue':
      return 'bg-blue-100 text-blue-700';
    case 'green':
      return 'bg-status-success/10 text-status-success';
    case 'yellow':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-warm-100 text-warm-600';
  }
}
