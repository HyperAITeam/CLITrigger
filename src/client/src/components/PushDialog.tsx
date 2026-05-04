import { useEffect, useMemo, useState } from 'react';
import * as projectsApi from '../api/projects';
import type { GitRemote, PushBranchSpec } from '../api/projects';
import { useI18n } from '../i18n';
import Modal from './Modal';

interface PushDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  onPushed?: () => void;
}

interface BranchRow {
  local: string;
  current: boolean;
  remote: string;
  customRemote: boolean;
  setUpstream: boolean;
  checked: boolean;
}

const CUSTOM_SENTINEL = '__custom__';

export default function PushDialog({ open, onClose, projectId, projectName, onPushed }: PushDialogProps) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [selectedRemote, setSelectedRemote] = useState<string>('origin');
  const [rows, setRows] = useState<BranchRow[]>([]);
  const [remoteBranchNames, setRemoteBranchNames] = useState<string[]>([]);
  const [pushAllTags, setPushAllTags] = useState(true);
  const [force, setForce] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([projectsApi.getGitRemotes(projectId), projectsApi.getGitRefs(projectId)])
      .then(([remoteRes, refsRes]) => {
        if (cancelled) return;
        const rs = remoteRes.remotes || [];
        setRemotes(rs);
        const defaultRemote = rs.find((r) => r.name === 'origin')?.name || rs[0]?.name || 'origin';
        setSelectedRemote(defaultRemote);

        const allBranches = refsRes.branches || [];
        const localBranches = allBranches.filter((b) => !b.remote);
        const remotePrefix = `remotes/${defaultRemote}/`;
        const remoteOnSelected = allBranches
          .filter((b) => b.remote && b.name.startsWith(remotePrefix))
          .map((b) => b.name.slice(remotePrefix.length))
          .filter((n) => n && n !== 'HEAD');
        setRemoteBranchNames(remoteOnSelected);

        const remoteSet = new Set(remoteOnSelected);
        setRows(
          localBranches.map((b) => {
            const hasRemote = remoteSet.has(b.name);
            return {
              local: b.name,
              current: b.current,
              remote: b.name,
              customRemote: false,
              setUpstream: !hasRemote,
              checked: b.current,
            };
          })
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load remotes');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  // Re-derive remote branches when the selected remote changes after initial load
  useEffect(() => {
    if (!open || !selectedRemote) return;
    let cancelled = false;
    projectsApi.getGitRefs(projectId).then((res) => {
      if (cancelled) return;
      const prefix = `remotes/${selectedRemote}/`;
      const names = (res.branches || [])
        .filter((b) => b.remote && b.name.startsWith(prefix))
        .map((b) => b.name.slice(prefix.length))
        .filter((n) => n && n !== 'HEAD');
      setRemoteBranchNames(names);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedRemote, projectId, open]);

  const allChecked = rows.length > 0 && rows.every((r) => r.checked);
  const someChecked = rows.some((r) => r.checked);
  const checkedCount = rows.filter((r) => r.checked).length;

  const remoteUrl = useMemo(
    () => remotes.find((r) => r.name === selectedRemote)?.url || '',
    [remotes, selectedRemote]
  );

  const updateRow = (local: string, patch: Partial<BranchRow>) => {
    setRows((prev) => prev.map((r) => (r.local === local ? { ...r, ...patch } : r)));
  };

  const toggleAll = () => {
    const next = !allChecked;
    setRows((prev) => prev.map((r) => ({ ...r, checked: next })));
  };

  const handleSubmit = async () => {
    setError(null);
    const selected = rows.filter((r) => r.checked);
    if (selected.length === 0) {
      setError(t('git.pushDialog.errorRequireBranch'));
      return;
    }
    const branches: PushBranchSpec[] = selected.map((r) => ({
      local: r.local,
      remote: (r.remote || '').trim() || r.local,
      setUpstream: r.setUpstream,
    }));
    setSubmitting(true);
    try {
      await projectsApi.gitPush(projectId, {
        remote: selectedRemote,
        branches,
        pushAllTags,
        force,
      });
      onPushed?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={submitting ? () => {} : onClose} size="xl" disableBackdropClose disableEscClose={submitting}>
      <div className="bg-warm-50 dark:bg-warm-900 rounded-lg shadow-xl border border-warm-200 dark:border-warm-700 flex flex-col overflow-hidden" style={{ width: '720px', maxWidth: '95vw' }}>
        {/* Header */}
        <div className="px-5 py-3 border-b border-warm-200 dark:border-warm-700 bg-warm-100 dark:bg-warm-800">
          <div className="text-sm font-semibold text-warm-900 dark:text-warm-50">
            Push : {projectName}
          </div>
        </div>

        {/* Remote row */}
        <div className="px-5 py-4 flex items-center gap-3 border-b border-warm-200 dark:border-warm-700">
          <label className="text-sm text-warm-700 dark:text-warm-300 whitespace-nowrap">
            {t('git.pushDialog.targetRemote')}:
          </label>
          <select
            value={selectedRemote}
            onChange={(e) => setSelectedRemote(e.target.value)}
            className="px-2 py-1 text-sm border border-warm-300 dark:border-warm-600 rounded bg-white dark:bg-warm-800 text-warm-900 dark:text-warm-50"
            disabled={loading || submitting || remotes.length === 0}
          >
            {remotes.length === 0 && <option value="origin">origin</option>}
            {remotes.map((r) => (
              <option key={r.name} value={r.name}>{r.name}</option>
            ))}
          </select>
          <input
            readOnly
            value={remoteUrl}
            className="flex-1 px-2 py-1 text-xs font-mono border border-warm-300 dark:border-warm-600 rounded bg-warm-100 dark:bg-warm-800 text-warm-700 dark:text-warm-300"
          />
        </div>

        {/* Branch table */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-5 pt-3 pb-1 text-xs font-semibold text-warm-700 dark:text-warm-300">
            {t('git.pushDialog.branchesHeader')}
          </div>
          <div className="px-5 pb-3 overflow-auto" style={{ maxHeight: '50vh' }}>
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-warm-100 dark:bg-warm-800 text-warm-700 dark:text-warm-300">
                <tr>
                  <th className="text-left font-medium py-1.5 px-2 w-12">{t('git.pushDialog.colPush')}</th>
                  <th className="text-left font-medium py-1.5 px-2">{t('git.pushDialog.colLocal')}</th>
                  <th className="text-left font-medium py-1.5 px-2">{t('git.pushDialog.colRemote')}</th>
                  <th className="text-left font-medium py-1.5 px-2 w-16">{t('git.pushDialog.colTracking')}</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={4} className="py-6 text-center text-warm-500">{t('git.pushDialog.loading')}</td></tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-warm-500">{t('git.pushDialog.noLocalBranches')}</td></tr>
                )}
                {rows.map((row) => (
                  <tr key={row.local} className="border-t border-warm-200 dark:border-warm-700">
                    <td className="py-1.5 px-2">
                      <input
                        type="checkbox"
                        checked={row.checked}
                        onChange={(e) => updateRow(row.local, { checked: e.target.checked })}
                        disabled={submitting}
                      />
                    </td>
                    <td className="py-1.5 px-2 font-mono text-xs text-warm-900 dark:text-warm-50">
                      {row.local}{row.current && <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">●</span>}
                    </td>
                    <td className="py-1.5 px-2">
                      {row.customRemote ? (
                        <input
                          type="text"
                          value={row.remote}
                          onChange={(e) => updateRow(row.local, { remote: e.target.value })}
                          placeholder={row.local}
                          className="w-full px-2 py-0.5 text-xs font-mono border border-warm-300 dark:border-warm-600 rounded bg-white dark:bg-warm-800 text-warm-900 dark:text-warm-50"
                          disabled={submitting}
                        />
                      ) : (
                        <select
                          value={remoteBranchNames.includes(row.remote) ? row.remote : (row.remote ? row.remote : '')}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === CUSTOM_SENTINEL) {
                              updateRow(row.local, { customRemote: true });
                            } else {
                              updateRow(row.local, { remote: v });
                            }
                          }}
                          className="w-full px-2 py-0.5 text-xs font-mono border border-warm-300 dark:border-warm-600 rounded bg-white dark:bg-warm-800 text-warm-900 dark:text-warm-50"
                          disabled={submitting}
                        >
                          {!remoteBranchNames.includes(row.remote) && row.remote && (
                            <option value={row.remote}>{row.remote} ({t('git.pushDialog.newBranch')})</option>
                          )}
                          {remoteBranchNames.map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                          <option value={CUSTOM_SENTINEL}>{t('git.pushDialog.customRemote')}</option>
                        </select>
                      )}
                    </td>
                    <td className="py-1.5 px-2">
                      <input
                        type="checkbox"
                        checked={row.setUpstream}
                        onChange={(e) => updateRow(row.local, { setUpstream: e.target.checked })}
                        disabled={submitting}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Bottom controls */}
        <div className="px-5 py-3 border-t border-warm-200 dark:border-warm-700 flex items-center justify-between gap-4 bg-warm-100 dark:bg-warm-800">
          <div className="flex items-center gap-4 text-sm text-warm-800 dark:text-warm-200">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }}
                onChange={toggleAll}
                disabled={submitting || rows.length === 0}
              />
              {t('git.pushDialog.selectAll')}
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={pushAllTags}
                onChange={(e) => setPushAllTags(e.target.checked)}
                disabled={submitting}
              />
              {t('git.pushDialog.allTags')}
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
                disabled={submitting}
              />
              <span title={t('git.pushDialog.forceHint')}>{t('git.pushDialog.force')}</span>
            </label>
          </div>
        </div>

        {error && (
          <div className="px-5 py-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border-t border-red-200 dark:border-red-800">
            {error}
          </div>
        )}

        {/* Footer buttons */}
        <div className="px-5 py-3 border-t border-warm-200 dark:border-warm-700 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-1.5 text-sm border border-warm-300 dark:border-warm-600 rounded bg-warm-50 dark:bg-warm-800 text-warm-800 dark:text-warm-200 hover:bg-warm-100 dark:hover:bg-warm-700 disabled:opacity-50"
          >
            {t('git.pushDialog.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || loading || checkedCount === 0}
            className="px-4 py-1.5 text-sm rounded bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? t('git.pushDialog.pushing') : t('git.pushDialog.submit')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
