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
    <Modal open={open} onClose={submitting ? () => {} : onClose} size="2xl" disableBackdropClose disableEscClose={submitting}>
      <div className="card p-5 space-y-4">
        {/* Title */}
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Push : {projectName}
        </h3>

        {/* Remote row */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-warm-500 whitespace-nowrap">
            {t('git.pushDialog.targetRemote')}
          </label>
          <select
            value={selectedRemote}
            onChange={(e) => setSelectedRemote(e.target.value)}
            className="input-field text-xs py-1.5 px-3 w-auto"
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
            className="input-field text-xs font-mono py-1.5 px-3 flex-1 cursor-default"
          />
        </div>

        {/* Branches section */}
        <div>
          <div className="section-label mb-2">{t('git.pushDialog.branchesHeader')}</div>
          <div className="rounded-xl border border-theme-border-strong overflow-hidden">
            <div className="overflow-auto max-h-[50vh]">
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 bg-warm-100 z-10">
                  <tr>
                    <th className="text-left text-2xs font-semibold uppercase tracking-wider text-warm-500 py-2 px-3 w-12">{t('git.pushDialog.colPush')}</th>
                    <th className="text-left text-2xs font-semibold uppercase tracking-wider text-warm-500 py-2 px-3">{t('git.pushDialog.colLocal')}</th>
                    <th className="text-left text-2xs font-semibold uppercase tracking-wider text-warm-500 py-2 px-3">{t('git.pushDialog.colRemote')}</th>
                    <th className="text-left text-2xs font-semibold uppercase tracking-wider text-warm-500 py-2 px-3 w-16">{t('git.pushDialog.colTracking')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={4} className="py-6 text-center text-xs text-warm-500">{t('git.pushDialog.loading')}</td></tr>
                  )}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={4} className="py-6 text-center text-xs text-warm-500">{t('git.pushDialog.noLocalBranches')}</td></tr>
                  )}
                  {rows.map((row) => (
                    <tr key={row.local} className="border-t border-theme-border/50 hover:bg-theme-hover/40 transition-colors">
                      <td className="py-2 px-3">
                        <input
                          type="checkbox"
                          checked={row.checked}
                          onChange={(e) => updateRow(row.local, { checked: e.target.checked })}
                          disabled={submitting}
                          className="cursor-pointer"
                        />
                      </td>
                      <td className="py-2 px-3 font-mono text-xs" style={{ color: 'var(--color-text-primary)' }}>
                        {row.local}
                        {row.current && <span className="ml-1.5 text-[10px] text-status-warning">●</span>}
                      </td>
                      <td className="py-2 px-3">
                        {row.customRemote ? (
                          <input
                            type="text"
                            value={row.remote}
                            onChange={(e) => updateRow(row.local, { remote: e.target.value })}
                            placeholder={row.local}
                            className="input-field text-xs font-mono py-1 px-2 w-full"
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
                            className="input-field text-xs font-mono py-1 px-2 w-full"
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
                      <td className="py-2 px-3">
                        <input
                          type="checkbox"
                          checked={row.setUpstream}
                          onChange={(e) => updateRow(row.local, { setUpstream: e.target.checked })}
                          disabled={submitting}
                          className="cursor-pointer"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Toggles */}
        <div className="flex items-center gap-5 text-xs text-warm-700">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={allChecked}
              ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }}
              onChange={toggleAll}
              disabled={submitting || rows.length === 0}
              className="cursor-pointer"
            />
            {t('git.pushDialog.selectAll')}
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={pushAllTags}
              onChange={(e) => setPushAllTags(e.target.checked)}
              disabled={submitting}
              className="cursor-pointer"
            />
            {t('git.pushDialog.allTags')}
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              disabled={submitting}
              className="cursor-pointer"
            />
            <span title={t('git.pushDialog.forceHint')}>{t('git.pushDialog.force')}</span>
          </label>
        </div>

        {/* Error */}
        {error && (
          <div className="text-xs text-status-error font-medium">{error}</div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="btn-secondary btn-md"
          >
            {t('git.pushDialog.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || loading || checkedCount === 0}
            className="btn-primary btn-md"
          >
            {submitting ? t('git.pushDialog.pushing') : t('git.pushDialog.submit')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
