import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useI18n } from '../../i18n';
import * as harnessApi from '../../api/harness';
import SettingsForm from './SettingsForm';
import MemoryEditor from './MemoryEditor';
import HooksPanel from './HooksPanel';
import SkillsPanel from './SkillsPanel';
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
  const [savingLocalMemory, setSavingLocalMemory] = useState(false);
  const [savingHooks, setSavingHooks] = useState(false);
  const [savingSkill, setSavingSkill] = useState(false);
  const [savingMcp, setSavingMcp] = useState(false);
  // Show the CLAUDE.local.md editor even before the file exists (saving
  // creates it). Reset implicitly on remount per project/cli.
  const [creatingLocal, setCreatingLocal] = useState(false);
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

  const handleSaveLocalMemory = async (content: string) => {
    setSavingLocalMemory(true);
    setError(null);
    try {
      await harnessApi.updateLocalMemory(projectId, cli, content);
      const refreshed = await harnessApi.getSnapshot(projectId, cli);
      onChange(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingLocalMemory(false);
    }
  };

  const handleSaveHooks = async (hooks: Record<string, unknown> | null) => {
    setSavingHooks(true);
    setError(null);
    try {
      const next = await harnessApi.updateHooks(projectId, cli, hooks);
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingHooks(false);
    }
  };

  const handleSaveSkill = async (name: string, content: string) => {
    setSavingSkill(true);
    setError(null);
    try {
      const next = await harnessApi.updateSkill(projectId, cli, name, content);
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSkill(false);
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

      {/* CLAUDE.local.md — shown when it exists; otherwise a create affordance */}
      {cli === 'claude' && snapshot.filePaths.localMemory && (
        snapshot.localMemoryExists || creatingLocal ? (
          <MemoryEditor
            filePath={snapshot.filePaths.localMemory}
            content={snapshot.localMemory ?? ''}
            saving={savingLocalMemory}
            onSave={handleSaveLocalMemory}
          />
        ) : (
          <button
            type="button"
            onClick={() => setCreatingLocal(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs text-warm-400 hover:text-warm-600 border border-dashed border-warm-200 hover:border-warm-300 rounded-xl transition-colors"
          >
            <Plus size={13} />
            {t('harness.localMemory.create') || 'Create CLAUDE.local.md'}
          </button>
        )
      )}

      {cli === 'claude' && (
        <>
          <HooksPanel
            hooks={snapshot.hooks}
            filePath={snapshot.filePaths.settings}
            saving={savingHooks}
            onSave={handleSaveHooks}
          />
          <SkillsPanel skills={snapshot.skills} saving={savingSkill} onSave={handleSaveSkill} />
        </>
      )}

      <McpServerList servers={snapshot.mcp} saving={savingMcp} onUpsert={handleUpsertMcp} onRemove={handleRemoveMcp} />
    </div>
  );
}
