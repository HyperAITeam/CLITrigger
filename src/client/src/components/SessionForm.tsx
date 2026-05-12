import { useEffect, useRef, useState } from 'react';
import { GitBranch, Plus } from 'lucide-react';
import { useI18n } from '../i18n';
import { CLI_TOOLS, getToolConfig, type CliTool } from '../cli-tools';
import MemoryInjectControl from './MemoryInjectControl';
import type { MemoryInjectMode, SessionTag, SessionAlias } from '../types';
import * as tagsApi from '../api/sessionTags';
import * as aliasesApi from '../api/sessionAliases';
import * as settingsApi from '../api/sessionSettings';

export interface SessionFormInitial {
  title: string;
  description: string;
  cliTool: string;
  cliModel: string;
  useWorktree: boolean;
  memoryInjectMode: MemoryInjectMode;
  memoryNodeIds: string[];
  memoryRawFilePaths?: string[];
  tagId?: string | null;
  sessionAliasId?: string | null;
}

interface SessionFormProps {
  projectId: string;
  /** Present → edit mode, prefills the form. Absent → create mode (defaults). */
  initial?: SessionFormInitial;
  onSave: (
    title: string,
    description: string,
    cliTool?: string,
    cliModel?: string,
    useWorktree?: boolean,
    memoryInjectMode?: MemoryInjectMode,
    memoryNodeIds?: string[],
    memoryRawFilePaths?: string[],
    tagId?: string | null,
    sessionAliasId?: string | null,
  ) => void;
  onCancel: () => void;
  projectCliTool?: string;
  projectCliModel?: string;
  isGitRepo?: boolean;
  /** Default for `useWorktree` in create mode; ignored when `initial` is set. */
  projectUseWorktree?: boolean;
}

export default function SessionForm({ projectId, initial, onSave, onCancel, projectCliTool, projectCliModel, isGitRepo, projectUseWorktree }: SessionFormProps) {
  const { t } = useI18n();
  const isEdit = !!initial;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [cliTool, setCliTool] = useState(initial?.cliTool ?? (projectCliTool || ''));
  const [cliModel, setCliModel] = useState(initial?.cliModel ?? (projectCliModel || ''));
  const [useWorktree, setUseWorktree] = useState(initial?.useWorktree ?? !!projectUseWorktree);
  const [memoryInjectMode, setMemoryInjectMode] = useState<MemoryInjectMode>(initial?.memoryInjectMode ?? 'none');
  const [memoryNodeIds, setMemoryNodeIds] = useState<string[]>(initial?.memoryNodeIds ?? []);
  const [memoryRawFilePaths, setMemoryRawFilePaths] = useState<string[]>(initial?.memoryRawFilePaths ?? []);
  const [tagId, setTagId] = useState<string | null>(initial?.tagId ?? null);
  const [tags, setTags] = useState<SessionTag[]>([]);
  const [sessionAliasId, setSessionAliasId] = useState<string | null>(initial?.sessionAliasId ?? null);
  const [aliases, setAliases] = useState<SessionAlias[]>([]);
  // Quick-add modal state for raw-shell aliases.
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddName, setQuickAddName] = useState('');
  const [quickAddCmd, setQuickAddCmd] = useState('');
  const [quickAddError, setQuickAddError] = useState<string | null>(null);
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // Windows EXE + Korean IME: xterm's helper textarea retains the native HWND
  // keyboard focus after a session has been interacted with, so React's
  // autoFocus on the title input only moves DOM focus — clicks land but the
  // caret never activates. Force a native focus handoff: blur the previous
  // active element, ask the main process to refocus webContents (recovers the
  // OS-level focus), then focus the title input across two RAFs so xterm's
  // own focus restoration has settled. Also park every xterm helper textarea
  // out of the focus traversal for the form's lifetime.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    prev?.blur?.();
    (window as unknown as { electronAPI?: { imeReset?: () => void } }).electronAPI?.imeReset?.();

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => titleRef.current?.focus());
    });

    const helpers = Array.from(document.querySelectorAll<HTMLTextAreaElement>('.xterm-helper-textarea'));
    const prevHelpers = helpers.map((h) => ({
      el: h,
      tabIndex: h.tabIndex,
      ariaHidden: h.getAttribute('aria-hidden'),
    }));
    helpers.forEach((h) => {
      h.tabIndex = -1;
      h.setAttribute('aria-hidden', 'true');
      h.blur();
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      prevHelpers.forEach(({ el, tabIndex, ariaHidden }) => {
        el.tabIndex = tabIndex;
        if (ariaHidden === null) el.removeAttribute('aria-hidden');
        else el.setAttribute('aria-hidden', ariaHidden);
      });
    };
    // Mount-time only — running this on every initial change would steal focus
    // away from the user mid-edit when the parent reuses the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    tagsApi.getSessionTags()
      .then((list) => { if (!cancelled) setTags(list); })
      .catch(() => { /* silent — settings panel surfaces errors */ });
    aliasesApi.getSessionAliases()
      .then((list) => { if (!cancelled) setAliases(list); })
      .catch(() => { /* silent — settings panel surfaces errors */ });
    if (!isEdit && isGitRepo) {
      settingsApi.getSessionSettings()
        .then((s) => { if (!cancelled) setUseWorktree(s.defaultUseWorktree); })
        .catch(() => { /* keep default false */ });
    }
    return () => { cancelled = true; };
  }, [isEdit, isGitRepo]);

  const interactiveTools = CLI_TOOLS.filter((tool) => tool.supportsInteractive);
  const selectedTool = (cliTool || projectCliTool || 'claude') as CliTool;
  const toolConfig = getToolConfig(selectedTool);
  // Raw shell: no model, no auto-submitted prompt, no wiki/memory injection.
  // Description/model/memory state is left untouched in the form so toggling
  // back to an AI CLI doesn't lose what the user already typed; the inputs
  // are just hidden while raw-shell is selected and the server ignores them.
  const isRawShell = selectedTool === 'raw-shell';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(
      title.trim(),
      description.trim(),
      cliTool || undefined,
      cliModel || undefined,
      useWorktree,
      memoryInjectMode,
      memoryNodeIds,
      memoryRawFilePaths,
      tagId,
      isRawShell ? sessionAliasId : null,
    );
  };

  const handleQuickAddAlias = async () => {
    const name = quickAddName.trim();
    const cmd = quickAddCmd.trim();
    if (!name || !cmd) return;
    setQuickAddSaving(true);
    setQuickAddError(null);
    try {
      const alias = await aliasesApi.createSessionAlias({ name, command_template: cmd });
      setAliases((prev) => [alias, ...prev]);
      setSessionAliasId(alias.id);
      setQuickAddOpen(false);
      setQuickAddName('');
      setQuickAddCmd('');
    } catch (err) {
      setQuickAddError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setQuickAddSaving(false);
    }
  };

  const selectedTag = tags.find((tt) => tt.id === tagId) ?? null;

  return (
    <form
      onSubmit={handleSubmit}
      className="card p-4 space-y-3 animate-scale-in"
    >
      <input
        ref={titleRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('session.title')}
        className="input w-full text-sm"
      />
      {!isRawShell && (
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('session.description')}
          className="input w-full text-sm min-h-[60px] resize-y"
          rows={2}
        />
      )}
      <div className="flex gap-2">
        <select
          value={cliTool}
          onChange={(e) => { setCliTool(e.target.value); setCliModel(''); }}
          className="input text-xs flex-1"
        >
          <option value="">{t('session.cliTool')} (Default)</option>
          {interactiveTools.map((tool) => (
            <option key={tool.value} value={tool.value}>{tool.label}</option>
          ))}
        </select>
        {!isRawShell && (
          <select
            value={cliModel}
            onChange={(e) => setCliModel(e.target.value)}
            className="input text-xs flex-1"
          >
            <option value="">{t('session.model')} (Default)</option>
            {toolConfig.models.filter((m) => m.value).map((model) => (
              <option key={model.value} value={model.value}>{model.label}</option>
            ))}
          </select>
        )}
        {isRawShell && (
          <>
            <select
              value={sessionAliasId ?? ''}
              onChange={(e) => setSessionAliasId(e.target.value || null)}
              className="input text-xs flex-1"
            >
              <option value="">OS default shell</option>
              {aliases.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => { setQuickAddOpen(true); setQuickAddError(null); }}
              className="btn-secondary text-xs px-2 inline-flex items-center gap-1"
              title="Quick add alias"
            >
              <Plus size={12} />
            </button>
          </>
        )}
      </div>
      {quickAddOpen && (
        <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
          <div className="text-xs font-semibold text-warm-700">New alias</div>
          <input
            type="text"
            value={quickAddName}
            onChange={(e) => setQuickAddName(e.target.value)}
            placeholder="Name (e.g. WSL Ubuntu)"
            className="input text-sm w-full"
            maxLength={64}
            autoFocus
          />
          <input
            type="text"
            value={quickAddCmd}
            onChange={(e) => setQuickAddCmd(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleQuickAddAlias(); } }}
            placeholder="Command (e.g. wsl -d Ubuntu)"
            className="input text-sm w-full font-mono"
            maxLength={1024}
          />
          {quickAddError && <div className="text-2xs text-status-error">{quickAddError}</div>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setQuickAddOpen(false)} className="btn-ghost text-xs py-1 px-2">Cancel</button>
            <button
              type="button"
              onClick={handleQuickAddAlias}
              disabled={quickAddSaving || !quickAddName.trim() || !quickAddCmd.trim()}
              className="btn-primary text-xs py-1 px-2"
            >
              Save
            </button>
          </div>
        </div>
      )}
      {tags.length > 0 && (
        <div className="flex items-center gap-2">
          {selectedTag && (
            <span
              className="w-4 h-4 rounded-full shrink-0 border"
              style={{ backgroundColor: selectedTag.color, borderColor: 'rgba(0,0,0,0.08)' }}
            />
          )}
          <select
            value={tagId ?? ''}
            onChange={(e) => setTagId(e.target.value || null)}
            className="input text-xs flex-1"
          >
            <option value="">{t('session.tag.none')}</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>{tag.name}</option>
            ))}
          </select>
        </div>
      )}
      {isGitRepo && (
        <label className="flex items-center gap-2 text-xs text-warm-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={useWorktree}
            onChange={(e) => setUseWorktree(e.target.checked)}
            className="rounded border-warm-300"
          />
          <GitBranch size={14} />
          {t('session.worktree')}
        </label>
      )}
      {!isRawShell && (
        <MemoryInjectControl
          projectId={projectId}
          mode={memoryInjectMode}
          selectedIds={memoryNodeIds}
          onChange={(m, ids) => { setMemoryInjectMode(m); setMemoryNodeIds(ids); }}
          rawFilePaths={memoryRawFilePaths}
          onChangeRawFiles={setMemoryRawFilePaths}
        />
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-1.5 px-3">
          {t('form.cancel')}
        </button>
        <button type="submit" className="btn-primary text-xs py-1.5 px-3">
          {isEdit ? t('session.save') : t('session.create')}
        </button>
      </div>
    </form>
  );
}
