import { useState, useEffect, useCallback } from 'react';
import type { Project, NotionPage } from '../types';
import { Skeleton } from './Skeleton';
import * as notionApi from '../api/notion';
import { useI18n } from '../i18n';

interface NotionPanelProps {
  project: Project;
  onImportAsTask: (title: string, description: string) => void;
}

export default function NotionPanel({ project, onImportAsTask }: NotionPanelProps) {
  const { t } = useI18n();
  const [pages, setPages] = useState<NotionPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedId, setImportedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const isConfigured = project.notion_enabled && project.notion_api_key && project.notion_database_id;

  const fetchPages = useCallback(async (reset = false) => {
    if (!isConfigured) return;
    setLoading(true);
    try {
      const result = await notionApi.queryPages(project.id, {
        startCursor: reset ? undefined : (nextCursor || undefined),
        search: search || undefined,
      });
      if (reset) {
        setPages(result.results);
      } else {
        setPages((prev) => [...prev, ...result.results]);
      }
      setHasMore(result.has_more);
      setNextCursor(result.next_cursor);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [project.id, isConfigured, search, nextCursor]);

  useEffect(() => {
    fetchPages(true);
  }, [project.id, isConfigured]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => {
    fetchPages(true);
  };

  const handleImport = async (pageId: string) => {
    setImportingId(pageId);
    try {
      const result = await notionApi.importPage(project.id, pageId);
      onImportAsTask(result.title, result.description);
      setImportedId(pageId);
      setTimeout(() => setImportedId(null), 2000);
    } catch {
      // ignore
    } finally {
      setImportingId(null);
    }
  };

  if (!isConfigured) {
    return (
      <div className="card p-16 text-center animate-fade-in">
        <div className="text-warm-300 mb-3">
          <svg className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        </div>
        <p className="text-warm-400 text-sm">{t('notion.notConfigured')}</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-warm-700">{t('notion.title')}</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="btn-primary text-xs"
          >
            {t('notion.createPage')}
          </button>
          <button
            onClick={() => fetchPages(true)}
            disabled={loading}
            className="btn-ghost text-xs"
          >
            {t('notion.refresh')}
          </button>
        </div>
      </div>

      {/* Create Page Form */}
      {showCreate && (
        <CreatePageForm
          projectId={project.id}
          onCreated={() => { setShowCreate(false); fetchPages(true); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Search Bar */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder={t('notion.search')}
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

      {/* Page List */}
      {pages.length === 0 && loading && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="card p-3 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <div className="flex justify-between">
                <Skeleton className="h-3 w-1/4" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      )}

      {pages.length === 0 && !loading && (
        <div className="card p-10 text-center">
          <p className="text-warm-400 text-sm">{t('notion.noPages')}</p>
          <p className="text-warm-300 text-xs mt-1">{t('notion.noPagesHint')}</p>
        </div>
      )}

      <div className="space-y-2">
        {pages.map((page) => (
          <PageCard
            key={page.id}
            page={page}
            projectId={project.id}
            expanded={expandedId === page.id}
            onToggle={() => setExpandedId(expandedId === page.id ? null : page.id)}
            importing={importingId === page.id}
            imported={importedId === page.id}
            onImport={() => handleImport(page.id)}
          />
        ))}
      </div>

      {/* Load more */}
      {hasMore && (
        <div className="mt-4 text-center">
          <button
            onClick={() => fetchPages(false)}
            disabled={loading}
            className="btn-ghost text-xs"
          >
            {loading ? '...' : t('notion.loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Page Card ──

interface PageCardProps {
  page: NotionPage;
  projectId: string;
  expanded: boolean;
  onToggle: () => void;
  importing: boolean;
  imported: boolean;
  onImport: () => void;
}

function PageCard({ page, projectId, expanded, onToggle, importing, imported, onImport }: PageCardProps) {
  const { t } = useI18n();

  const title = getPageTitle(page);
  const status = getPageStatus(page);
  const lastEdited = new Date(page.last_edited_time).toLocaleDateString();

  return (
    <div className="card p-3 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        {/* Notion page icon */}
        <div className="w-4 h-4 mt-0.5 flex-shrink-0 text-warm-400">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          {/* Title */}
          <div className="flex items-center gap-2">
            <button
              onClick={onToggle}
              className="text-xs font-medium text-blue-600 hover:text-blue-800 truncate text-left"
            >
              {title || 'Untitled'}
            </button>
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            {status && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${getStatusColor(status)}`}>
                {status}
              </span>
            )}
            <span className="text-[10px] text-warm-300 ml-auto">
              {lastEdited}
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
          title={t('notion.import')}
        >
          {importing ? t('notion.importing') : imported ? t('notion.imported') : t('notion.import')}
        </button>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <ExpandedPagePanel pageId={page.id} projectId={projectId} />
      )}
    </div>
  );
}

// ── Expanded Page Panel ──

function ExpandedPagePanel({ pageId, projectId }: { pageId: string; projectId: string }) {
  const { t } = useI18n();
  const [blocks, setBlocks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    notionApi.getPageBlocks(projectId, pageId)
      .then((data) => setBlocks(data.results || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId, pageId]);

  if (loading) {
    return (
      <div className="mt-3 pt-3 border-t border-warm-100 space-y-2 animate-slide-up">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    );
  }

  if (blocks.length === 0) {
    return (
      <div className="mt-3 pt-3 border-t border-warm-100 animate-slide-up">
        <p className="text-xs text-warm-400">{t('notion.noContent')}</p>
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-warm-100 space-y-1 animate-slide-up max-h-64 overflow-y-auto">
      {blocks.map((block: any) => (
        <BlockRenderer key={block.id} block={block} />
      ))}
    </div>
  );
}

function BlockRenderer({ block }: { block: any }) {
  const type = block.type;
  if (!type || !block[type]) return null;

  const content = block[type];
  const text = content.rich_text
    ? content.rich_text.map((t: any) => t.plain_text || '').join('')
    : '';

  if (!text && type !== 'divider') return null;

  switch (type) {
    case 'heading_1':
      return <p className="text-xs font-bold text-warm-700">{text}</p>;
    case 'heading_2':
      return <p className="text-xs font-semibold text-warm-600">{text}</p>;
    case 'heading_3':
      return <p className="text-xs font-medium text-warm-600">{text}</p>;
    case 'bulleted_list_item':
      return <p className="text-xs text-warm-500 pl-3">• {text}</p>;
    case 'numbered_list_item':
      return <p className="text-xs text-warm-500 pl-3">{text}</p>;
    case 'to_do':
      return (
        <p className="text-xs text-warm-500 pl-3">
          {content.checked ? '☑' : '☐'} {text}
        </p>
      );
    case 'code':
      return <pre className="text-[10px] bg-warm-50 p-2 rounded text-warm-600 overflow-x-auto">{text}</pre>;
    case 'divider':
      return <hr className="border-warm-100" />;
    default:
      return <p className="text-xs text-warm-500">{text}</p>;
  }
}

// ── Create Page Form ──

function CreatePageForm({ projectId, onCreated, onCancel }: { projectId: string; onCreated: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    try {
      await notionApi.createPage(projectId, { title });
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
          <label className="block text-xs font-medium text-warm-500 mb-1">{t('notion.pageTitle')}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="input-field text-xs"
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost text-xs">{t('header.cancel')}</button>
          <button
            onClick={handleCreate}
            disabled={creating || !title.trim()}
            className="btn-primary text-xs"
          >
            {creating ? t('notion.creating') : t('notion.createPage')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──

function getPageTitle(page: NotionPage): string {
  if (!page.properties) return 'Untitled';
  for (const prop of Object.values(page.properties)) {
    if (prop.type === 'title' && prop.title?.length > 0) {
      return prop.title.map((t: any) => t.plain_text || '').join('');
    }
  }
  return 'Untitled';
}

function getPageStatus(page: NotionPage): string | null {
  if (!page.properties) return null;
  for (const prop of Object.values(page.properties)) {
    if (prop.type === 'status' && prop.status) {
      return prop.status.name;
    }
    if (prop.type === 'select' && prop.select) {
      return prop.select.name;
    }
  }
  return null;
}

function getStatusColor(status: string): string {
  const lower = status.toLowerCase();
  if (lower.includes('done') || lower.includes('complete') || lower.includes('완료')) {
    return 'bg-status-success/10 text-status-success';
  }
  if (lower.includes('progress') || lower.includes('진행') || lower.includes('doing')) {
    return 'bg-blue-100 text-blue-700';
  }
  if (lower.includes('todo') || lower.includes('not started') || lower.includes('대기')) {
    return 'bg-warm-100 text-warm-600';
  }
  return 'bg-warm-100 text-warm-600';
}
