import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, GitBranch, Type, Bug } from 'lucide-react';
import { useI18n } from '../i18n';
import { useToast } from '../hooks/useToast';
import * as tagsApi from '../api/sessionTags';
import * as aliasesApi from '../api/sessionAliases';
import * as settingsApi from '../api/sessionSettings';
import { setGlobalDefaultFontSize } from '../hooks/useSessionFontSize';
import { DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE } from './terminal-theme';
import type { SessionTag, SessionAlias } from '../types';

interface PanelProps {
  onClose?: () => void;
}

const TAG_PALETTE = [
  '#A78BFA', '#F472B6', '#FB923C', '#FBBF24',
  '#34D399', '#60A5FA', '#F87171', '#94A3B8',
];

function pickPaletteColor(existing: SessionTag[]): string {
  for (const color of TAG_PALETTE) {
    if (!existing.some((t) => t.color.toLowerCase() === color.toLowerCase())) return color;
  }
  return TAG_PALETTE[existing.length % TAG_PALETTE.length];
}

export default function SessionSettingsPanel({ onClose }: PanelProps) {
  const { t } = useI18n();
  const { error: toastError, success: toastSuccess } = useToast();

  const [tags, setTags] = useState<SessionTag[]>([]);
  const [defaultUseWorktree, setDefaultUseWorktree] = useState(false);
  const [defaultFontSize, setDefaultFontSize] = useState<number>(DEFAULT_FONT_SIZE);
  const [imeDebug, setImeDebug] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [savingWorktree, setSavingWorktree] = useState(false);
  const [savingImeDebug, setSavingImeDebug] = useState(false);
  const fontSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(TAG_PALETTE[0]);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(TAG_PALETTE[0]);
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Aliases (raw-shell command presets) ──
  const [aliases, setAliases] = useState<SessionAlias[]>([]);
  const [newAliasName, setNewAliasName] = useState('');
  const [newAliasCmd, setNewAliasCmd] = useState('');
  const [creatingAlias, setCreatingAlias] = useState(false);
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
  const [editAliasName, setEditAliasName] = useState('');
  const [editAliasCmd, setEditAliasCmd] = useState('');
  const [savingAliasEdit, setSavingAliasEdit] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([tagsApi.getSessionTags(), settingsApi.getSessionSettings(), aliasesApi.getSessionAliases()])
      .then(([tagList, settings, aliasList]) => {
        if (cancelled) return;
        setTags(tagList);
        setDefaultUseWorktree(settings.defaultUseWorktree);
        setDefaultFontSize(settings.defaultFontSize);
        setGlobalDefaultFontSize(settings.defaultFontSize);
        setImeDebug(settings.imeDebug);
        setNewColor(pickPaletteColor(tagList));
        setAliases(aliasList);
        setLoaded(true);
      })
      .catch((err) => {
        if (!cancelled) toastError(err instanceof Error ? err.message : 'Failed to load');
      });
    return () => { cancelled = true; };
  }, [toastError]);

  const trimmedNewName = newName.trim();
  const canCreate = !!trimmedNewName && !creating;
  const sortedTags = useMemo(() => [...tags].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)), [tags]);

  useEffect(() => {
    return () => {
      if (fontSaveTimerRef.current) clearTimeout(fontSaveTimerRef.current);
    };
  }, []);

  const handleChangeFontSize = (raw: number) => {
    if (!Number.isFinite(raw)) return;
    const clamped = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(raw)));
    setDefaultFontSize(clamped);
    setGlobalDefaultFontSize(clamped);
    if (fontSaveTimerRef.current) clearTimeout(fontSaveTimerRef.current);
    fontSaveTimerRef.current = setTimeout(() => {
      settingsApi.updateSessionSettings({ defaultFontSize: clamped })
        .then((updated) => {
          setDefaultFontSize(updated.defaultFontSize);
          setGlobalDefaultFontSize(updated.defaultFontSize);
        })
        .catch((err) => toastError(err instanceof Error ? err.message : 'Save failed'));
    }, 350);
  };

  const handleToggleWorktree = async (next: boolean) => {
    setSavingWorktree(true);
    try {
      const updated = await settingsApi.updateSessionSettings({ defaultUseWorktree: next });
      setDefaultUseWorktree(updated.defaultUseWorktree);
      toastSuccess(t('sessionSettings.saved'));
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingWorktree(false);
    }
  };

  const handleToggleImeDebug = async (next: boolean) => {
    setSavingImeDebug(true);
    try {
      const updated = await settingsApi.updateSessionSettings({ imeDebug: next });
      setImeDebug(updated.imeDebug);
      // Push to the Electron main process so file logging starts/stops now,
      // without a restart. No-op in the browser build.
      (window as unknown as { electronAPI?: { imeSetDebug?: (v: boolean) => void } })
        .electronAPI?.imeSetDebug?.(updated.imeDebug);
      toastSuccess(t('sessionSettings.saved'));
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingImeDebug(false);
    }
  };

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreating(true);
    try {
      const tag = await tagsApi.createSessionTag({ name: trimmedNewName, color: newColor });
      setTags((prev) => [...prev, tag]);
      setNewName('');
      setNewColor(pickPaletteColor([...tags, tag]));
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (tag: SessionTag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const trimmed = editName.trim();
    if (!trimmed) return;
    setSavingEdit(true);
    try {
      const updated = await tagsApi.updateSessionTag(editingId, { name: trimmed, color: editColor });
      setTags((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      cancelEdit();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (tag: SessionTag) => {
    if (!confirm(t('sessionSettings.tags.deleteConfirm').replace('{name}', tag.name))) return;
    try {
      await tagsApi.deleteSessionTag(tag.id);
      setTags((prev) => prev.filter((x) => x.id !== tag.id));
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const trimmedNewAliasName = newAliasName.trim();
  const trimmedNewAliasCmd = newAliasCmd.trim();
  const canCreateAlias = !!trimmedNewAliasName && !!trimmedNewAliasCmd && !creatingAlias;
  const sortedAliases = useMemo(() => [...aliases].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)), [aliases]);

  const handleCreateAlias = async () => {
    if (!canCreateAlias) return;
    setCreatingAlias(true);
    try {
      const alias = await aliasesApi.createSessionAlias({ name: trimmedNewAliasName, command_template: trimmedNewAliasCmd });
      setAliases((prev) => [...prev, alias]);
      setNewAliasName('');
      setNewAliasCmd('');
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreatingAlias(false);
    }
  };

  const startEditAlias = (alias: SessionAlias) => {
    setEditingAliasId(alias.id);
    setEditAliasName(alias.name);
    setEditAliasCmd(alias.command_template);
  };

  const cancelEditAlias = () => {
    setEditingAliasId(null);
    setEditAliasName('');
    setEditAliasCmd('');
  };

  const handleSaveAliasEdit = async () => {
    if (!editingAliasId) return;
    const name = editAliasName.trim();
    const cmd = editAliasCmd.trim();
    if (!name || !cmd) return;
    setSavingAliasEdit(true);
    try {
      const updated = await aliasesApi.updateSessionAlias(editingAliasId, { name, command_template: cmd });
      setAliases((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      cancelEditAlias();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingAliasEdit(false);
    }
  };

  const handleDeleteAlias = async (alias: SessionAlias) => {
    if (!confirm(`Delete alias "${alias.name}"? Sessions using it will fall back to OS default shell.`)) return;
    try {
      await aliasesApi.deleteSessionAlias(alias.id);
      setAliases((prev) => prev.filter((x) => x.id !== alias.id));
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div className="p-8">
      <h2 className="text-lg font-semibold text-warm-800 mb-1">{t('sessionSettings.title')}</h2>
      <p className="text-xs text-warm-400 mb-6">{t('sessionSettings.description')}</p>

      <section className="mb-7">
        <h3 className="text-sm font-semibold text-warm-700 mb-2 flex items-center gap-1.5">
          <GitBranch size={14} />
          {t('sessionSettings.worktree.title')}
        </h3>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={defaultUseWorktree}
            disabled={savingWorktree || !loaded}
            onChange={(e) => handleToggleWorktree(e.target.checked)}
            className="rounded border-warm-300"
          />
          <span className="text-sm text-warm-600">{t('sessionSettings.worktree.label')}</span>
        </label>
        <p className="mt-1 text-2xs ml-6" style={{ color: 'var(--color-text-muted)' }}>
          {t('sessionSettings.worktree.hint')}
        </p>
      </section>

      <section className="mb-7">
        <h3 className="text-sm font-semibold text-warm-700 mb-2 flex items-center gap-1.5">
          <Type size={14} />
          {t('sessionSettings.fontSize.title')}
        </h3>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            step={1}
            value={defaultFontSize}
            disabled={!loaded}
            onChange={(e) => handleChangeFontSize(parseInt(e.target.value, 10))}
            className="flex-1 max-w-xs"
            aria-label={t('sessionSettings.fontSize.label')}
          />
          <input
            type="number"
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            step={1}
            value={defaultFontSize}
            disabled={!loaded}
            onChange={(e) => handleChangeFontSize(parseInt(e.target.value, 10))}
            className="input text-sm w-20"
          />
          <span className="text-xs text-warm-400">px</span>
        </div>
        <p className="mt-1 text-2xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('sessionSettings.fontSize.hint')}
        </p>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-warm-700 mb-2">{t('sessionSettings.tags.title')}</h3>
        <p className="text-xs text-warm-400 mb-3">{t('sessionSettings.tags.description')}</p>

        <div className="flex items-center gap-2 mb-3">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="w-9 h-9 rounded cursor-pointer border border-warm-200"
            title={t('sessionSettings.tags.color')}
          />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreate(); } }}
            placeholder={t('sessionSettings.tags.namePlaceholder')}
            className="input text-sm flex-1"
            maxLength={32}
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            className="btn-primary text-sm py-1.5 px-3 inline-flex items-center gap-1"
          >
            <Plus size={14} />
            {t('sessionSettings.tags.add')}
          </button>
        </div>

        {sortedTags.length === 0 ? (
          <p className="text-xs text-warm-400 italic py-3">{t('sessionSettings.tags.empty')}</p>
        ) : (
          <ul className="space-y-1.5">
            {sortedTags.map((tag) => {
              const editing = editingId === tag.id;
              return (
                <li
                  key={tag.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  {editing ? (
                    <>
                      <input
                        type="color"
                        value={editColor}
                        onChange={(e) => setEditColor(e.target.value)}
                        className="w-7 h-7 rounded cursor-pointer border border-warm-200"
                      />
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); handleSaveEdit(); }
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        autoFocus
                        className="input text-sm flex-1"
                        maxLength={32}
                      />
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        disabled={savingEdit || !editName.trim()}
                        className="p-1.5 text-status-success hover:bg-status-success/10 rounded"
                        title={t('sessionSettings.tags.save')}
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="p-1.5 text-warm-400 hover:bg-warm-100 rounded"
                        title={t('sessionSettings.tags.cancel')}
                      >
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span
                        className="w-4 h-4 rounded-full shrink-0 border"
                        style={{ backgroundColor: tag.color, borderColor: 'rgba(0,0,0,0.08)' }}
                      />
                      <span className="text-sm text-warm-700 flex-1 truncate">{tag.name}</span>
                      <button
                        type="button"
                        onClick={() => startEdit(tag)}
                        className="p-1.5 text-warm-400 hover:text-warm-700 hover:bg-warm-100 rounded"
                        title={t('sessionSettings.tags.edit')}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(tag)}
                        className="p-1.5 text-warm-400 hover:text-status-error hover:bg-warm-100 rounded"
                        title={t('sessionSettings.tags.delete')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-7">
        <h3 className="text-sm font-semibold text-warm-700 mb-2">Terminal aliases</h3>
        <p className="text-xs text-warm-400 mb-3">
          Saved command snippets. Click the ⌘ icon in any terminal window's titlebar to insert one as input — Enter is yours to press.
        </p>

        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            value={newAliasName}
            onChange={(e) => setNewAliasName(e.target.value)}
            placeholder="Name (e.g. WSL Ubuntu)"
            className="input text-sm w-44"
            maxLength={64}
          />
          <input
            type="text"
            value={newAliasCmd}
            onChange={(e) => setNewAliasCmd(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateAlias(); } }}
            placeholder="Command (e.g. wsl -d Ubuntu)"
            className="input text-sm flex-1 font-mono"
            maxLength={1024}
          />
          <button
            type="button"
            onClick={handleCreateAlias}
            disabled={!canCreateAlias}
            className="btn-primary text-sm py-1.5 px-3 inline-flex items-center gap-1"
          >
            <Plus size={14} />
            Add
          </button>
        </div>

        {sortedAliases.length === 0 ? (
          <p className="text-xs text-warm-400 italic py-3">No aliases yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {sortedAliases.map((alias) => {
              const editing = editingAliasId === alias.id;
              return (
                <li
                  key={alias.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  {editing ? (
                    <>
                      <input
                        type="text"
                        value={editAliasName}
                        onChange={(e) => setEditAliasName(e.target.value)}
                        className="input text-sm w-44"
                        maxLength={64}
                      />
                      <input
                        type="text"
                        value={editAliasCmd}
                        onChange={(e) => setEditAliasCmd(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); handleSaveAliasEdit(); }
                          if (e.key === 'Escape') cancelEditAlias();
                        }}
                        autoFocus
                        className="input text-sm flex-1 font-mono"
                        maxLength={1024}
                      />
                      <button
                        type="button"
                        onClick={handleSaveAliasEdit}
                        disabled={savingAliasEdit || !editAliasName.trim() || !editAliasCmd.trim()}
                        className="p-1.5 text-status-success hover:bg-status-success/10 rounded"
                        title="Save"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditAlias}
                        className="p-1.5 text-warm-400 hover:bg-warm-100 rounded"
                        title="Cancel"
                      >
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-sm text-warm-700 w-44 truncate">{alias.name}</span>
                      <code className="text-xs text-warm-500 flex-1 truncate font-mono">{alias.command_template}</code>
                      <button
                        type="button"
                        onClick={() => startEditAlias(alias)}
                        className="p-1.5 text-warm-400 hover:text-warm-700 hover:bg-warm-100 rounded"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteAlias(alias)}
                        className="p-1.5 text-warm-400 hover:text-status-error hover:bg-warm-100 rounded"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-7">
        <h3 className="text-sm font-semibold text-warm-700 mb-2 flex items-center gap-1.5">
          <Bug size={14} />
          IME 디버그 로그
        </h3>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={imeDebug}
            disabled={savingImeDebug || !loaded}
            onChange={(e) => handleToggleImeDebug(e.target.checked)}
            className="rounded border-warm-300"
          />
          <span className="text-sm text-warm-600">한글 입력(IME) 진단 로그 기록</span>
        </label>
        <p className="mt-1 text-2xs ml-6" style={{ color: 'var(--color-text-muted)' }}>
          조합 창이 화면 좌상단에 뜨는 문제를 진단하기 위해 입력 시점 상태를 기록합니다.
          데스크톱 앱에서만 동작하며, 로그는 앱 데이터 폴더의 ime-debug.log에 저장됩니다.
        </p>
      </section>

      {onClose && (
        <div className="flex justify-end gap-3 mt-7">
          <button type="button" onClick={onClose} className="btn-ghost text-sm">
            {t('tunnel.close')}
          </button>
        </div>
      )}
    </div>
  );
}
