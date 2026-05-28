import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  CaseSensitive, WholeWord, Regex,
  ChevronUp, ChevronDown, X, ChevronRight, ArrowDownToLine,
} from 'lucide-react';
import { useI18n } from '../../i18n';

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

export interface FindReplaceBarProps {
  open: boolean;
  query: string;
  replacement: string;
  options: FindOptions;
  showReplace: boolean;
  matchCount: { current: number; total: number };
  canReplace: boolean;
  onQueryChange: (v: string) => void;
  onReplacementChange: (v: string) => void;
  onOptionsChange: (next: FindOptions) => void;
  onToggleReplace: () => void;
  onNext: () => void;
  onPrev: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

export function FindReplaceBar({
  open, query, replacement, options, showReplace,
  matchCount, canReplace,
  onQueryChange, onReplacementChange, onOptionsChange,
  onToggleReplace, onNext, onPrev, onReplace, onReplaceAll, onClose,
}: FindReplaceBarProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [invalidRegex, setInvalidRegex] = useState(false);

  useLayoutEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  useEffect(() => {
    if (!options.regexp || !query) { setInvalidRegex(false); return; }
    try { new RegExp(query); setInvalidRegex(false); }
    catch { setInvalidRegex(true); }
  }, [options.regexp, query]);

  const onSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) onPrev(); else onNext();
    }
  }, [onClose, onNext, onPrev]);

  const onReplaceKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) onReplaceAll(); else onReplace();
    }
  }, [onClose, onReplace, onReplaceAll]);

  if (!open) return null;

  const counterText = !query
    ? ''
    : matchCount.total === 0
      ? t('find.noMatches')
      : `${matchCount.current}/${matchCount.total}`;

  const toggle = (k: keyof FindOptions) => onOptionsChange({ ...options, [k]: !options[k] });

  const toggleBtn = (active: boolean, onClick: () => void, title: string, Icon: typeof CaseSensitive) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`p-1 rounded inline-flex items-center justify-center ${active
        ? 'bg-warm-200 text-warm-800'
        : 'text-warm-500 hover:bg-warm-100 hover:text-warm-700'}`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );

  return (
    <div
      data-vault-find-bar
      className="absolute top-1 right-3 z-tooltip rounded-lg shadow-elevated text-xs"
      style={{
        backgroundColor: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={onToggleReplace}
          title={t('find.toggleReplace')}
          className="p-1 rounded text-warm-500 hover:bg-warm-100 hover:text-warm-700"
        >
          {showReplace
            ? <ChevronDown className="w-3 h-3" />
            : <ChevronRight className="w-3 h-3" />}
        </button>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder={t('find.placeholder')}
          className={`w-56 px-2 py-1 rounded outline-none border bg-transparent text-warm-800 ${invalidRegex ? 'border-red-400' : 'border-warm-200 focus:border-warm-400'}`}
        />
        {toggleBtn(options.caseSensitive, () => toggle('caseSensitive'), t('find.case'), CaseSensitive)}
        {toggleBtn(options.wholeWord, () => toggle('wholeWord'), t('find.word'), WholeWord)}
        {toggleBtn(options.regexp, () => toggle('regexp'), t('find.regex'), Regex)}
        <span className="text-warm-500 min-w-[44px] text-center tabular-nums px-1">
          {counterText}
        </span>
        <button
          type="button"
          onClick={onPrev}
          disabled={!query || matchCount.total === 0}
          title={t('find.prev')}
          className="p-1 rounded text-warm-500 hover:bg-warm-100 hover:text-warm-700 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!query || matchCount.total === 0}
          title={t('find.next')}
          className="p-1 rounded text-warm-500 hover:bg-warm-100 hover:text-warm-700 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          title={t('find.close')}
          className="p-1 rounded text-warm-500 hover:bg-warm-100 hover:text-warm-700"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {showReplace && (
        <div className="flex items-center gap-1 px-2 pb-1.5">
          <span className="w-[22px]" />
          <input
            type="text"
            value={replacement}
            onChange={(e) => onReplacementChange(e.target.value)}
            onKeyDown={onReplaceKeyDown}
            placeholder={t('find.replacePlaceholder')}
            disabled={!canReplace}
            className="w-56 px-2 py-1 rounded outline-none border border-warm-200 bg-transparent text-warm-800 focus:border-warm-400 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={onReplace}
            disabled={!canReplace || !query || matchCount.total === 0}
            title={t('find.replace')}
            className="p-1 rounded text-warm-500 hover:bg-warm-100 hover:text-warm-700 disabled:opacity-40 disabled:hover:bg-transparent inline-flex items-center justify-center"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onReplaceAll}
            disabled={!canReplace || !query || matchCount.total === 0}
            title={t('find.replaceAll')}
            className="p-1 rounded text-warm-500 hover:bg-warm-100 hover:text-warm-700 disabled:opacity-40 disabled:hover:bg-transparent inline-flex items-center justify-center"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
