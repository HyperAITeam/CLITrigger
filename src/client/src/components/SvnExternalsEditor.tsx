import { useState } from 'react';
import * as svnApi from '../api/svn';
import type { GitLogEntry } from '../api/projects';
import { useI18n } from '../i18n';
import Button from './Button';
import {
  parseExternals,
  serializeExternals,
  type ExternalEntry,
  type ExternalsLine,
} from '../lib/svn-externals';

// TortoiseSVN-style svn:externals editor: a Path / URL / Peg / Operative / HEAD
// table plus an inline edit form whose "Show log" lists the external URL's
// revisions so a peg can be picked instead of typed.

const EMPTY_ENTRY: ExternalEntry = { path: '', url: '', peg: '', operative: '' };

const inputClass =
  'w-full text-2xs font-mono text-warm-700 bg-warm-50 dark:bg-warm-800/40 rounded-md px-2 py-1 border border-warm-200 dark:border-warm-700 focus:outline-none focus:border-accent';

interface LogState {
  url: string;
  commits: GitLogEntry[];
  hasMore: boolean;
}

interface Props {
  projectId: string;
  value: string;
  saving: boolean;
  onSave: (value: string) => void;
  onCancel: () => void;
  onEditAsText: (value: string) => void;
}

export default function SvnExternalsEditor({ projectId, value, saving, onSave, onCancel, onEditAsText }: Props) {
  const { t } = useI18n();
  const [lines, setLines] = useState<ExternalsLine[]>(() => parseExternals(value));
  const [selected, setSelected] = useState<number | null>(null);
  const [heads, setHeads] = useState<Record<string, string>>({}); // url → HEAD revision
  const [findingHead, setFindingHead] = useState(false);
  const [log, setLog] = useState<LogState | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = lines.flatMap((line, index) => (line.kind === 'entry' ? [{ index, entry: line.entry }] : []));
  const selectedLine = selected !== null ? lines[selected] : undefined;
  const current = selectedLine?.kind === 'entry' ? selectedLine.entry : null;
  const invalid = rows.some(({ entry }) => !entry.path.trim() || !entry.url.trim());

  const update = (index: number, patch: Partial<ExternalEntry>) =>
    setLines((ls) => ls.map((l, i) => (i === index && l.kind === 'entry' ? { kind: 'entry', entry: { ...l.entry, ...patch } } : l)));

  const add = () => {
    setLines((ls) => [...ls, { kind: 'entry', entry: { ...EMPTY_ENTRY } }]);
    setSelected(lines.length);
  };

  const remove = () => {
    if (selected === null) return;
    setLines((ls) => ls.filter((_, i) => i !== selected));
    setSelected(null);
  };

  const findHeads = async () => {
    setFindingHead(true);
    setError(null);
    const next: Record<string, string> = {};
    await Promise.all(rows.map(async ({ entry }) => {
      const url = entry.url.trim();
      if (!url) return;
      try {
        next[url] = (await svnApi.getSvnUrlInfo(projectId, url)).revision;
      } catch (err) {
        next[url] = '?';
        setError(err instanceof Error ? err.message : String(err));
      }
    }));
    setHeads(next);
    setFindingHead(false);
  };

  const loadLog = async (url: string, skip: number) => {
    setLogLoading(true);
    setError(null);
    try {
      const r = await svnApi.getSvnLog(projectId, skip, 50, url);
      setLog((prev) => ({
        url,
        commits: skip > 0 && prev?.url === url ? [...prev.commits, ...r.commits] : r.commits,
        hasMore: r.hasMore,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLogLoading(false);
    }
  };

  const visibleLog = log && current && log.url === current.url.trim() ? log : null;

  return (
    <div className="mt-1">
      {error && <p className="text-status-error text-2xs mb-2 whitespace-pre-wrap break-all">{error}</p>}

      <div className="border border-warm-100 dark:border-warm-800 rounded-md overflow-hidden">
        <table className="w-full table-fixed text-2xs font-mono">
          <thead className="bg-warm-50 dark:bg-warm-800/40 text-warm-400 text-left">
            <tr>
              <th className="px-2 py-1 font-normal w-[28%]">{t('svn.ext.path')}</th>
              <th className="px-2 py-1 font-normal w-[42%]">URL</th>
              <th className="px-2 py-1 font-normal w-[10%]">{t('svn.ext.peg')}</th>
              <th className="px-2 py-1 font-normal w-[10%]">{t('svn.ext.operative')}</th>
              <th className="px-2 py-1 font-normal w-[10%]">HEAD</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-2 py-2 text-warm-400">{t('svn.ext.empty')}</td></tr>
            )}
            {rows.map(({ index, entry }) => (
              <tr
                key={index}
                onClick={() => setSelected(index)}
                className={`cursor-pointer border-t border-warm-100 dark:border-warm-800 ${
                  selected === index ? 'bg-accent/10' : 'hover:bg-warm-50 dark:hover:bg-warm-800/40'
                }`}
              >
                <td className="px-2 py-1 truncate text-warm-700" title={entry.path}>{entry.path || '—'}</td>
                <td className="px-2 py-1 truncate text-warm-600" title={entry.url}>{entry.url || '—'}</td>
                <td className="px-2 py-1 text-warm-600">{entry.peg}</td>
                <td className="px-2 py-1 text-warm-600">{entry.operative}</td>
                <td className="px-2 py-1 text-warm-600">{heads[entry.url.trim()] ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {current && selected !== null && (
        <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center text-2xs text-warm-500">
          <label>{t('svn.ext.localPath')}</label>
          <input
            value={current.path}
            onChange={(e) => update(selected, { path: e.target.value })}
            spellCheck={false}
            className={inputClass}
          />
          <label>URL</label>
          <input
            value={current.url}
            onChange={(e) => update(selected, { url: e.target.value })}
            spellCheck={false}
            className={inputClass}
          />
          <label>{t('svn.ext.revision')}</label>
          <div className="flex items-center gap-2">
            <span>{t('svn.ext.peg')}</span>
            <input
              value={current.peg}
              onChange={(e) => update(selected, { peg: e.target.value.trim() })}
              placeholder="HEAD"
              className={`${inputClass} w-24`}
            />
            <span>{t('svn.ext.operative')}</span>
            <input
              value={current.operative}
              onChange={(e) => update(selected, { operative: e.target.value.trim() })}
              placeholder="—"
              className={`${inputClass} w-24`}
            />
            <Button
              size="sm"
              onClick={() => loadLog(current.url.trim(), 0)}
              disabled={logLoading || !current.url.trim()}
            >
              {logLoading ? t('svn.checking') : t('svn.ext.showLog')}
            </Button>
          </div>

          {visibleLog && (
            <div className="col-span-2 border border-warm-100 dark:border-warm-800 rounded-md max-h-48 overflow-y-auto">
              <p className="px-2 py-1 text-warm-400 border-b border-warm-100 dark:border-warm-800">{t('svn.ext.pickHint')}</p>
              {visibleLog.commits.map((c) => (
                <button
                  key={c.hash}
                  onClick={() => update(selected, { peg: c.hash })}
                  className={`w-full text-left px-2 py-1 flex items-center gap-2 hover:bg-warm-50 dark:hover:bg-warm-800/40 ${
                    c.hash === current.peg ? 'bg-accent/10' : ''
                  }`}
                >
                  <span className="font-mono text-accent shrink-0">r{c.hash}</span>
                  <span className="text-warm-400 shrink-0">{c.author}</span>
                  <span className="text-warm-400 shrink-0">{new Date(c.date).toLocaleDateString()}</span>
                  <span className="truncate text-warm-600">{c.message.split('\n')[0]}</span>
                </button>
              ))}
              {visibleLog.hasMore && (
                <button
                  onClick={() => loadLog(visibleLog.url, visibleLog.commits.length)}
                  disabled={logLoading}
                  className="w-full px-2 py-1 text-warm-400 hover:text-accent"
                >
                  {t('svn.loadMore')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={add}>{t('svn.ext.new')}</Button>
        <Button size="sm" onClick={remove} disabled={!current}>{t('svn.ext.remove')}</Button>
        <Button size="sm" onClick={findHeads} disabled={findingHead || rows.length === 0}>
          {findingHead ? t('svn.checking') : t('svn.ext.findHead')}
        </Button>
        <button
          onClick={() => onEditAsText(serializeExternals(lines))}
          className="text-2xs text-warm-400 hover:text-accent"
        >
          {t('svn.ext.editText')}
        </button>
        <div className="flex-1" />
        <Button size="sm" onClick={onCancel} disabled={saving}>{t('svn.cancel')}</Button>
        <Button variant="primary" size="sm" onClick={() => onSave(serializeExternals(lines))} disabled={saving || invalid}>
          {t('svn.saveProperty')}
        </Button>
      </div>
    </div>
  );
}
