import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import * as harnessApi from '../../api/harness';
import type { HarnessSnapshotMap } from '../../api/harness';
import type { PluginPanelProps } from '../types';
import CliTab from './CliTab';
import type { CliId, HarnessSnapshot } from './types';

const CLI_IDS: CliId[] = ['claude', 'gemini', 'codex'];

const STORAGE_KEY = 'harness:active-cli';

function loadActiveCli(projectId: string): CliId {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${projectId}`);
    if (raw === 'claude' || raw === 'gemini' || raw === 'codex') return raw;
  } catch { /* ignore */ }
  return 'claude';
}

function saveActiveCli(projectId: string, cli: CliId): void {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${projectId}`, cli);
  } catch { /* ignore */ }
}

export default function HarnessPanel({ project }: PluginPanelProps) {
  const { t } = useI18n();
  const [snapshots, setSnapshots] = useState<HarnessSnapshotMap | null>(null);
  const [active, setActive] = useState<CliId>(() => loadActiveCli(project.id));
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setSnapshots(null);
    harnessApi
      .getAllSnapshots(project.id)
      .then((data) => {
        if (!cancelled) setSnapshots(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const handleTabChange = (cli: CliId) => {
    setActive(cli);
    saveActiveCli(project.id, cli);
  };

  const handleSnapshotChange = (cli: CliId, next: HarnessSnapshot) => {
    setSnapshots((prev) => (prev ? { ...prev, [cli]: next } : prev));
  };

  return (
    <div className="space-y-4">
      <div className="p-3 border border-status-warning/30 rounded-lg bg-status-warning/5 text-xs text-warm-600">
        <p className="font-semibold mb-1">{t('harness.warning.worktreeIsolation.title')}</p>
        <p>{t('harness.warning.worktreeIsolation.body')}</p>
      </div>

      <div className="flex items-center gap-1 border-b border-warm-200">
        {CLI_IDS.map((cli) => (
          <button
            key={cli}
            type="button"
            onClick={() => handleTabChange(cli)}
            className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              active === cli
                ? 'border-accent text-accent-dark'
                : 'border-transparent text-warm-500 hover:text-warm-700'
            }`}
          >
            {t(`harness.cli.${cli}`)}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="p-3 border border-status-error/30 rounded-lg bg-status-error/5 text-xs text-status-error">
          {loadError}
        </div>
      )}

      {!snapshots && !loadError && (
        <p className="text-xs text-warm-400">{t('harness.loading')}</p>
      )}

      {snapshots && (
        <CliTab
          projectId={project.id}
          cli={active}
          snapshot={snapshots[active]}
          onChange={(next) => handleSnapshotChange(active, next)}
        />
      )}
    </div>
  );
}
