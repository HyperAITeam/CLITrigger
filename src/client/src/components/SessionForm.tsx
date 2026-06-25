import { useEffect, useRef, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { useI18n } from '../i18n';
import { CLI_TOOLS, type CliTool, type CliToolConfig } from '../cli-tools';
import { getCliStatus, type CliToolStatus } from '../api/cli-status';
import VaultInjectControl from './VaultInjectControl';
import type { MemoryInjectMode, SessionTag } from '../types';
import type { VaultInjectMode } from '../api/vault';
import * as tagsApi from '../api/sessionTags';
import * as settingsApi from '../api/sessionSettings';

export interface SessionFormInitial {
  title: string;
  description: string;
  cliTool: string;
  useWorktree: boolean;
  memoryInjectMode: MemoryInjectMode;
  memoryNodeIds: string[];
  memoryRawFilePaths?: string[];
  tagId?: string | null;
}

interface SessionFormProps {
  projectId: string;
  /** Present → edit mode, prefills the form. Absent → create mode (defaults). */
  initial?: SessionFormInitial;
  onSave: (
    title: string,
    description: string,
    cliTool?: string,
    useWorktree?: boolean,
    memoryInjectMode?: MemoryInjectMode,
    memoryNodeIds?: string[],
    memoryRawFilePaths?: string[],
    tagId?: string | null,
  ) => void;
  onCancel: () => void;
  projectCliTool?: string;
  isGitRepo?: boolean;
  /** Default for `useWorktree` in create mode; ignored when `initial` is set. */
  projectUseWorktree?: boolean;
}

export default function SessionForm({ projectId, initial, onSave, onCancel, projectCliTool, isGitRepo, projectUseWorktree }: SessionFormProps) {
  const { t } = useI18n();
  const isEdit = !!initial;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [cliTool, setCliTool] = useState(initial?.cliTool ?? (projectCliTool || ''));
  const [useWorktree, setUseWorktree] = useState(initial?.useWorktree ?? !!projectUseWorktree);
  const [vaultMode, setVaultMode] = useState<VaultInjectMode>((initial?.memoryInjectMode as VaultInjectMode | undefined) ?? 'none');
  const [vaultPaths, setVaultPaths] = useState<string[]>(initial?.memoryRawFilePaths ?? []);
  const [includeLinked, setIncludeLinked] = useState<boolean>(false);
  const [tagId, setTagId] = useState<string | null>(initial?.tagId ?? null);
  const [tags, setTags] = useState<SessionTag[]>([]);
  const [cliStatuses, setCliStatuses] = useState<CliToolStatus[]>([]);
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
    if (!isEdit && isGitRepo) {
      settingsApi.getSessionSettings()
        .then((s) => { if (!cancelled) setUseWorktree(s.defaultUseWorktree); })
        .catch(() => { /* keep default false */ });
    }
    return () => { cancelled = true; };
  }, [isEdit, isGitRepo]);

  // CLI install status + resolved raw-shell name, for dropdown labels.
  useEffect(() => {
    let cancelled = false;
    getCliStatus()
      .then((list) => { if (!cancelled) setCliStatuses(list); })
      .catch(() => { /* fall back to static labels */ });
    return () => { cancelled = true; };
  }, []);

  const interactiveTools = CLI_TOOLS.filter((tool) => tool.supportsInteractive);

  // Label each option from live status: raw-shell shows its actual shell
  // ("Raw Shell (PowerShell)"); uninstalled AI CLIs get a "(not installed)" tag.
  const optionLabel = (tool: CliToolConfig): string => {
    const status = cliStatuses.find((s) => s.tool === tool.value);
    if (tool.value === 'raw-shell') {
      return status?.version ? `Raw Shell (${status.version})` : tool.label;
    }
    if (status && !status.installed) {
      return `${tool.label}${t('session.cliNotInstalled')}`;
    }
    return tool.label;
  };
  const selectedTool = (cliTool || projectCliTool || 'claude') as CliTool;
  // Raw shell: no auto-submitted prompt, no wiki/memory injection.
  // Description/memory state is left untouched in the form so toggling
  // back to an AI CLI doesn't lose what the user already typed; the inputs
  // are just hidden while raw-shell is selected and the server ignores them.
  const isRawShell = selectedTool === 'raw-shell';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(
      title.trim(),
      description.trim(),
      cliTool || undefined,
      useWorktree,
      vaultMode as MemoryInjectMode,
      [],
      vaultPaths,
      tagId,
    );
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
          onChange={(e) => setCliTool(e.target.value)}
          className="input text-xs flex-1"
        >
          <option value="">{t('session.cliTool')} (Default)</option>
          {interactiveTools.map((tool) => (
            <option key={tool.value} value={tool.value}>{optionLabel(tool)}</option>
          ))}
        </select>
      </div>
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
        <VaultInjectControl
          projectId={projectId}
          mode={vaultMode}
          selectedPaths={vaultPaths}
          includeLinked={includeLinked}
          onChange={(m, paths, linked) => { setVaultMode(m); setVaultPaths(paths); setIncludeLinked(linked); }}
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
