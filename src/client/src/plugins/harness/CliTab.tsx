import { useState } from 'react';
import { useI18n } from '../../i18n';
import * as harnessApi from '../../api/harness';
import SettingsForm from './SettingsForm';
import MemoryEditor from './MemoryEditor';
import McpServerList from './McpServerList';
import type { CliId, HarnessSettings, HarnessSnapshot, McpServer } from './types';

interface CliTabProps {
  projectId: string;
  cli: CliId;
  snapshot: HarnessSnapshot;
  onChange: (next: HarnessSnapshot) => void;
}

export default function CliTab({ projectId, cli, snapshot, onChange }: CliTabProps) {
  const { t } = useI18n();
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingMemory, setSavingMemory] = useState(false);
  const [savingMcp, setSavingMcp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSaveSettings = async (patch: HarnessSettings) => {
    setSavingSettings(true);
    setError(null);
    try {
      const next = await harnessApi.updateSettings(projectId, cli, patch);
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveMemory = async (content: string) => {
    setSavingMemory(true);
    setError(null);
    try {
      await harnessApi.updateMemory(projectId, cli, content);
      const refreshed = await harnessApi.getSnapshot(projectId, cli);
      onChange(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingMemory(false);
    }
  };

  const handleUpsertMcp = async (server: McpServer) => {
    setSavingMcp(true);
    setError(null);
    try {
      const mcp = await harnessApi.upsertMcp(projectId, cli, server);
      onChange({ ...snapshot, mcp });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setSavingMcp(false);
    }
  };

  const handleRemoveMcp = async (alias: string) => {
    setSavingMcp(true);
    setError(null);
    try {
      const mcp = await harnessApi.removeMcp(projectId, cli, alias);
      onChange({ ...snapshot, mcp });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingMcp(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 border border-status-error/30 rounded-lg bg-status-error/5 text-xs text-status-error">
          {error}
        </div>
      )}

      {snapshot.warnings.includes('codex.trustLevelMissing') && (
        <div className="p-3 border border-status-warning/30 rounded-lg bg-status-warning/5 text-xs text-warm-600">
          <p className="font-semibold mb-1">{t('harness.warning.codexTrustLevel.title')}</p>
          <p className="mb-2">{t('harness.warning.codexTrustLevel.body')}</p>
          <pre className="px-2 py-1 bg-warm-50 border border-warm-150 rounded text-[11px] font-mono whitespace-pre-wrap break-all">
{`[projects."${snapshot.filePaths.settings.replace(/[\\/]\.codex[\\/]config\.toml$/, '').replace(/\\/g, '\\\\')}"]\ntrust_level = "trusted"`}
          </pre>
        </div>
      )}

      {cli === 'codex' && (
        <div className="p-3 border border-warm-200 rounded-lg bg-warm-50 text-xs text-warm-500">
          {t('harness.warning.tomlComments')}
        </div>
      )}

      <SettingsForm cli={cli} settings={snapshot.settings} saving={savingSettings} onSave={handleSaveSettings} />
      <MemoryEditor filePath={snapshot.filePaths.memory} content={snapshot.memory} saving={savingMemory} onSave={handleSaveMemory} />
      <McpServerList servers={snapshot.mcp} saving={savingMcp} onUpsert={handleUpsertMcp} onRemove={handleRemoveMcp} />
    </div>
  );
}
