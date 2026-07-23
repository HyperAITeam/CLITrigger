import { useState } from 'react';
import { KeyRound, Cloud, TerminalSquare, Plug } from 'lucide-react';
import { useI18n } from '../i18n';
import Modal from './Modal';
import { TunnelSettingsPanel } from './TunnelSettings';
import PasswordSettingsPanel from './PasswordSettingsPanel';
import SessionSettingsPanel from './SessionSettingsPanel';
import McpSettingsPanel from './McpSettingsPanel';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type Tab = 'account' | 'session' | 'tunnel' | 'mcp';

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('account');

  if (!open) return null;

  const tabs: { id: Tab; label: string; icon: typeof KeyRound }[] = [
    { id: 'account', label: t('settings.tabs.account'), icon: KeyRound },
    { id: 'session', label: t('settings.tabs.session'), icon: TerminalSquare },
    { id: 'tunnel', label: t('settings.tabs.tunnel'), icon: Cloud },
    { id: 'mcp', label: t('settings.tabs.mcp'), icon: Plug },
  ];

  return (
    <Modal open={open} onClose={onClose} size="xl">
      <div className="card shadow-2xl rounded-2xl overflow-hidden">
        <div className="flex" style={{ minHeight: 460 }}>
          <aside className="w-44 shrink-0 border-r flex flex-col" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-hover)' }}>
            <div className="px-4 pt-5 pb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
              {t('settings.title')}
            </div>
            <nav className="flex flex-col">
              {tabs.map(({ id, label, icon: Icon }) => {
                const active = tab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm transition-colors text-left"
                    style={{
                      color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                      backgroundColor: active ? 'var(--color-bg-primary)' : 'transparent',
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    <Icon size={14} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </nav>
            <div
              className="px-4 py-3 mt-auto text-[11px] tracking-wide"
              style={{ color: 'var(--color-text-muted)' }}
            >
              v{__APP_VERSION__}
            </div>
          </aside>
          <div className="flex-1 min-w-0">
            {tab === 'account' && <PasswordSettingsPanel onClose={onClose} />}
            {tab === 'session' && <SessionSettingsPanel onClose={onClose} />}
            {tab === 'tunnel' && <TunnelSettingsPanel onClose={onClose} />}
            {tab === 'mcp' && <McpSettingsPanel onClose={onClose} />}
          </div>
        </div>
      </div>
    </Modal>
  );
}
