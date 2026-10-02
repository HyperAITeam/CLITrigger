import { useI18n } from '../i18n';
import type { LoopConfig } from '../types';

/** String-backed form state so number inputs stay controlled while typing. */
export interface LoopDraft {
  maxRounds: string;
  check: string;
  donePhrase: string;
  rules: string;
  maxCostUsd: string;
  stopWhenNoChanges: boolean;
  resume: boolean;
}

export function draftFromConfig(config: LoopConfig | null | undefined): LoopDraft {
  return {
    maxRounds: config?.maxRounds?.toString() ?? '10',
    check: config?.check ?? '',
    donePhrase: config?.donePhrase ?? '',
    rules: config?.rules ?? '',
    maxCostUsd: config?.maxCostUsd?.toString() ?? '',
    stopWhenNoChanges: config?.stopWhenNoChanges ?? true,
    resume: config?.resume ?? false,
  };
}

export function configFromDraft(draft: LoopDraft): LoopConfig {
  const maxCostUsd = parseFloat(draft.maxCostUsd);
  return {
    maxRounds: Math.min(50, Math.max(1, parseInt(draft.maxRounds, 10) || 10)),
    check: draft.check.trim() || undefined,
    donePhrase: draft.donePhrase.trim() || undefined,
    rules: draft.rules.trim() || undefined,
    maxCostUsd: maxCostUsd > 0 ? maxCostUsd : undefined,
    stopWhenNoChanges: draft.stopWhenNoChanges,
    resume: draft.resume,
  };
}

interface LoopRulesFieldsProps {
  draft: LoopDraft;
  onChange: (next: LoopDraft) => void;
  /** The stall guard compares git HEAD, so hide it for non-git projects. */
  showStallGuard: boolean;
}

/** Shared loop rule inputs for the todo form and the project default template. */
export default function LoopRulesFields({ draft, onChange, showStallGuard }: LoopRulesFieldsProps) {
  const { t } = useI18n();
  const set = <K extends keyof LoopDraft>(key: K, value: LoopDraft[K]) => onChange({ ...draft, [key]: value });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <div>
          <label className="block text-2xs font-medium text-warm-500 mb-1">{t('todoForm.loopMaxRounds')}</label>
          <input
            type="number"
            min="1"
            max="50"
            value={draft.maxRounds}
            onChange={(e) => set('maxRounds', e.target.value)}
            className="input-field text-sm w-24"
          />
        </div>
        <div>
          <label className="block text-2xs font-medium text-warm-500 mb-1">{t('todoForm.loopMaxCost')}</label>
          <input
            type="number"
            min="0"
            step="0.5"
            placeholder={t('todoForm.loopMaxCostPlaceholder')}
            value={draft.maxCostUsd}
            onChange={(e) => set('maxCostUsd', e.target.value)}
            className="input-field text-sm w-28"
          />
        </div>
      </div>
      <div>
        <label className="block text-2xs font-medium text-warm-500 mb-1">{t('todoForm.loopCheck')}</label>
        <input
          type="text"
          placeholder="npm test && npm run typecheck"
          value={draft.check}
          onChange={(e) => set('check', e.target.value)}
          className="input-field text-sm w-full font-mono"
        />
        <p className="text-2xs text-warm-400 mt-1">{t('todoForm.loopCheckHint')}</p>
      </div>
      <div>
        <label className="block text-2xs font-medium text-warm-500 mb-1">{t('todoForm.loopDonePhrase')}</label>
        <input
          type="text"
          placeholder="<promise>DONE</promise>"
          value={draft.donePhrase}
          onChange={(e) => set('donePhrase', e.target.value)}
          className="input-field text-sm w-full font-mono"
        />
        <p className="text-2xs text-warm-400 mt-1">{t('todoForm.loopDonePhraseHint')}</p>
      </div>
      {!draft.check.trim() && !draft.donePhrase.trim() && (
        <p className="text-2xs text-status-warning">{t('todoForm.loopNoDoneRule')}</p>
      )}
      <div>
        <label className="block text-2xs font-medium text-warm-500 mb-1">{t('todoForm.loopRules')}</label>
        <textarea
          rows={3}
          placeholder={t('todoForm.loopRulesPlaceholder')}
          value={draft.rules}
          onChange={(e) => set('rules', e.target.value)}
          className="input-field text-sm w-full resize-y"
        />
        <p className="text-2xs text-warm-400 mt-1">{t('todoForm.loopRulesHint')}</p>
      </div>
      {showStallGuard && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.stopWhenNoChanges}
            onChange={(e) => set('stopWhenNoChanges', e.target.checked)}
            className="rounded-md border-warm-300"
          />
          <span className="text-xs text-warm-600">{t('todoForm.loopStopWhenNoChanges')}</span>
        </label>
      )}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.resume}
            onChange={(e) => set('resume', e.target.checked)}
            className="rounded-md border-warm-300"
          />
          <span className="text-xs text-warm-600">{t('todoForm.loopResume')}</span>
        </label>
        <p className="text-2xs text-warm-400 mt-1">{t('todoForm.loopResumeHint')}</p>
      </div>
    </div>
  );
}
