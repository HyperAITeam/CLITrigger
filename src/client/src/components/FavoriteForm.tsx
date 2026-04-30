import { useState, useEffect } from 'react';
import { Terminal, FileCode, Link as LinkIcon } from 'lucide-react';
import { useI18n } from '../i18n';
import type { Favorite, FavoriteType } from '../types';
import type { FavoriteInput } from '../api/favorites';
import Modal from './Modal';

interface FavoriteFormProps {
  initial?: Favorite;
  onSubmit: (data: FavoriteInput) => Promise<void> | void;
  onCancel: () => void;
}

const TYPES: Array<{ value: FavoriteType; icon: React.ComponentType<{ size?: number }> }> = [
  { value: 'executable', icon: FileCode },
  { value: 'command', icon: Terminal },
  { value: 'url', icon: LinkIcon },
];

function parseArgsString(input: string): string[] {
  // Split on whitespace, treat double-quoted segments as single arg.
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    out.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return out;
}

function stringifyArgs(args: string | null): string {
  if (!args) return '';
  try {
    const parsed = JSON.parse(args);
    if (Array.isArray(parsed)) {
      return parsed
        .map((s) => (typeof s === 'string' && /\s/.test(s) ? `"${s}"` : String(s)))
        .join(' ');
    }
  } catch { /* ignore */ }
  return '';
}

export default function FavoriteForm({ initial, onSubmit, onCancel }: FavoriteFormProps) {
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<FavoriteType>(initial?.type ?? 'executable');
  const [target, setTarget] = useState(initial?.target ?? '');
  const [argsText, setArgsText] = useState(stringifyArgs(initial?.args ?? null));
  const [cwd, setCwd] = useState(initial?.cwd ?? '');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setName(initial?.name ?? '');
    setType(initial?.type ?? 'executable');
    setTarget(initial?.target ?? '');
    setArgsText(stringifyArgs(initial?.args ?? null));
    setCwd(initial?.cwd ?? '');
  }, [initial]);

  const isEditing = !!initial;
  const trimmedName = name.trim();
  const trimmedTarget = target.trim();
  const targetValid = type !== 'url' || /^https?:\/\//i.test(trimmedTarget);
  const canSubmit = !!trimmedName && !!trimmedTarget && targetValid && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const data: FavoriteInput = {
        name: trimmedName,
        type,
        target: trimmedTarget,
        args: type === 'executable' && argsText.trim() ? parseArgsString(argsText.trim()) : null,
        cwd: type !== 'url' && cwd.trim() ? cwd.trim() : null,
      };
      await onSubmit(data);
    } finally {
      setSubmitting(false);
    }
  };

  const targetHint =
    type === 'executable' ? t('favorites.form.targetHint.executable') :
    type === 'command' ? t('favorites.form.targetHint.command') :
    t('favorites.form.targetHint.url');

  return (
    <Modal open onClose={onCancel} size="md">
      <div className="card p-8 shadow-2xl rounded-2xl">
        <h2 className="text-lg font-semibold text-warm-800 mb-6">
          {isEditing ? t('favorites.form.title.edit') : t('favorites.form.title.create')}
        </h2>

        <form onSubmit={handleSubmit}>
          {/* Type segmented control */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-warm-600 mb-2">
              {t('favorites.form.type')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {TYPES.map(({ value, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setType(value)}
                  className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all border"
                  style={type === value
                    ? { backgroundColor: 'var(--color-accent)', color: 'white', borderColor: 'var(--color-accent)' }
                    : { color: 'var(--color-text-tertiary)', borderColor: 'var(--color-border)' }
                  }
                >
                  <Icon size={14} />
                  {t(`favorites.types.${value}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-warm-600 mb-2">
              {t('favorites.form.name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field"
              autoFocus
            />
          </div>

          {/* Target */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-warm-600 mb-2">
              {t('favorites.form.target')}
            </label>
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="input-field text-sm font-mono"
              placeholder={targetHint}
            />
            <p className="mt-1 text-2xs" style={{ color: 'var(--color-text-muted)' }}>
              {targetHint}
            </p>
          </div>

          {/* Args (executable only) */}
          {type === 'executable' && (
            <div className="mb-5">
              <label className="block text-sm font-medium text-warm-600 mb-2">
                {t('favorites.form.args')}
              </label>
              <input
                type="text"
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                className="input-field text-sm font-mono"
                placeholder='--flag value "with spaces"'
              />
            </div>
          )}

          {/* Cwd (executable + command) */}
          {type !== 'url' && (
            <div className="mb-5">
              <label className="block text-sm font-medium text-warm-600 mb-2">
                {t('favorites.form.cwd')}
              </label>
              <input
                type="text"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                className="input-field text-sm font-mono"
                placeholder="C:/Projects/my-project"
              />
            </div>
          )}

          {/* Security notice */}
          <p className="mb-6 text-2xs leading-snug" style={{ color: 'var(--color-text-muted)' }}>
            {t('favorites.security.notice')}
          </p>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={onCancel} className="btn-ghost text-sm">
              {t('favorites.form.cancel')}
            </button>
            <button type="submit" disabled={!canSubmit} className="btn-primary text-sm">
              {isEditing ? t('favorites.form.save') : t('favorites.form.create')}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
