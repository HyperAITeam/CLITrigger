import { EyeOff, MousePointerClick, GitBranch, type LucideIcon } from 'lucide-react';
import Modal from '../Modal';
import Button from '../Button';
import { useI18n } from '../../i18n';

interface Props {
  saving: boolean;
  onIgnoreAll: () => void;
  onShowAll: () => void;
}

// First-visit gate for the Vault tab. Large projects choke on the initial
// scan + force-directed graph, so before anything renders we offer to start
// from an "ignore everything" .vaultignore and teach the unhide flow.
// Rendering begins only after a choice; the choice is remembered per project
// (vault:onboarded:<projectId>) and a pre-existing .vaultignore skips this
// entirely.
export function VaultOnboardingModal({ saving, onIgnoreAll, onShowAll }: Props) {
  const { t } = useI18n();

  const Step = ({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) => (
    <div className="flex items-start gap-2.5">
      <Icon className="w-4 h-4 mt-0.5 text-warm-400 flex-shrink-0" />
      <p className="leading-relaxed">
        <span className="font-semibold text-warm-700">{title}</span>
        {' · '}
        {body}
      </p>
    </div>
  );

  return (
    <Modal open onClose={() => {}} size="xl" disableEscClose disableBackdropClose>
      <div className="bg-theme-card border border-theme-border rounded-2xl shadow-elevated max-h-[85vh] overflow-y-auto flex flex-col">
        <div className="px-5 py-4 border-b border-warm-200">
          <div className="text-sm font-semibold text-warm-800">{t('vault.onboarding.title')}</div>
          <p className="mt-1.5 text-xs text-warm-500 leading-relaxed">{t('vault.onboarding.intro')}</p>
        </div>

        <div className="px-5 py-4 space-y-3 text-xs text-warm-600">
          <Step icon={EyeOff} title={t('vault.onboarding.step1Title')} body={t('vault.onboarding.step1Body')} />
          <Step icon={MousePointerClick} title={t('vault.onboarding.step2Title')} body={t('vault.onboarding.step2Body')} />
          <Step icon={GitBranch} title={t('vault.onboarding.step3Title')} body={t('vault.onboarding.step3Body')} />
        </div>

        <div className="flex flex-col gap-2 px-5 py-4 border-t border-warm-200">
          <Button
            variant="primary"
            size="sm"
            onClick={onIgnoreAll}
            disabled={saving}
            className="w-full"
          >
            {saving ? t('vault.onboarding.saving') : t('vault.onboarding.startIgnoreAll')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onShowAll}
            disabled={saving}
            className="w-full"
          >
            {t('vault.onboarding.startShowAll')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
