import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import * as tunnelApi from '../api/tunnel';
import type { TunnelStatus } from '../api/tunnel';
import { useToast } from '../hooks/useToast';
import Modal from './Modal';

interface TunnelSettingsProps {
  open: boolean;
  onClose: () => void;
}

const HOSTNAME_PATTERN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

interface PanelProps {
  onClose?: () => void;
}

export function TunnelSettingsPanel({ onClose }: PanelProps) {
  const { t } = useI18n();
  const { error: toastError, success: toastSuccess } = useToast();
  const [tunnelName, setTunnelName] = useState('');
  const [customHostname, setCustomHostname] = useState('');
  const [initialName, setInitialName] = useState('');
  const [initialHostname, setInitialHostname] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [status, setStatus] = useState<TunnelStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([tunnelApi.getTunnelConfig(), tunnelApi.getTunnelStatus()])
      .then(([config, st]) => {
        if (cancelled) return;
        setTunnelName(config.tunnelName);
        setCustomHostname(config.customHostname);
        setInitialName(config.tunnelName);
        setInitialHostname(config.customHostname);
        setStatus(st);
      })
      .catch(() => { /* swallowed; surfaced through save/test attempts */ });
    return () => { cancelled = true; };
  }, []);

  const trimmedName = tunnelName.trim();
  const trimmedHost = customHostname.trim();
  const dirty = trimmedName !== initialName.trim() || trimmedHost !== initialHostname.trim();

  const hostnameInvalid = !!trimmedHost && (
    !HOSTNAME_PATTERN.test(trimmedHost) ||
    trimmedHost.toLowerCase() === 'localhost' ||
    trimmedHost.toLowerCase() === '127.0.0.1'
  );
  const needsTunnelName = !!trimmedHost && !trimmedName;
  const canSave = dirty && !saving && !hostnameInvalid && !needsTunnelName;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const updated = await tunnelApi.updateTunnelConfig({
        tunnelName: trimmedName,
        customHostname: trimmedHost,
      });
      setInitialName(updated.tunnelName);
      setInitialHostname(updated.customHostname);
      setTunnelName(updated.tunnelName);
      setCustomHostname(updated.customHostname);
      toastSuccess(t('tunnel.saved'));
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('tunnel.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    try {
      try { await tunnelApi.stopTunnel(); } catch { /* ignore stop errors */ }
      const result = await tunnelApi.startTunnel();
      setStatus({ status: 'running', url: result.url });
      toastSuccess(t('tunnel.restarted'));
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('tunnel.restartFailed'));
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="p-8">
      <h2 className="text-lg font-semibold text-warm-800 mb-1">{t('tunnel.title')}</h2>
      <p className="text-xs text-warm-400 mb-6">{t('tunnel.description')}</p>

      {status && (
        <div className="mb-5 p-3 rounded-lg text-xs flex items-center gap-2"
          style={{ backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-text-tertiary)' }}>
          <span className={`w-2 h-2 rounded-full ${status.status === 'running' ? 'bg-status-success' : status.status === 'error' ? 'bg-status-error' : 'bg-status-pending'}`} />
          <span className="font-medium">{t(`tunnel.status.${status.status}`)}</span>
          {status.url && (
            <a href={status.url} target="_blank" rel="noreferrer" className="ml-auto font-mono truncate hover:underline" style={{ color: 'var(--color-accent)' }}>
              {status.url}
            </a>
          )}
        </div>
      )}

      <div className="mb-4">
        <label className="block text-sm font-medium text-warm-600 mb-2">
          {t('tunnel.name.label')}
        </label>
        <input
          type="text"
          value={tunnelName}
          onChange={(e) => setTunnelName(e.target.value)}
          placeholder={t('tunnel.name.placeholder')}
          className="input-field text-sm font-mono"
        />
        <p className="mt-1 text-2xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('tunnel.name.hint')}
        </p>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-warm-600 mb-2">
          {t('tunnel.hostname.label')}
        </label>
        <input
          type="text"
          value={customHostname}
          onChange={(e) => setCustomHostname(e.target.value)}
          placeholder={t('tunnel.hostname.placeholder')}
          className="input-field text-sm font-mono"
        />
        <p className="mt-1 text-2xs" style={{ color: 'var(--color-text-muted)' }}>
          {t('tunnel.hostname.hint')}
        </p>
        {hostnameInvalid && (
          <p className="mt-1 text-2xs text-status-error">{t('tunnel.hostname.invalid')}</p>
        )}
        {needsTunnelName && (
          <p className="mt-1 text-2xs text-status-error">{t('tunnel.hostname.needsName')}</p>
        )}
      </div>

      <div className="mb-5">
        <button
          type="button"
          onClick={() => setShowGuide(!showGuide)}
          className="flex items-center gap-1 text-xs text-accent-dark hover:text-accent transition-colors"
        >
          <span className={`inline-block transition-transform ${showGuide ? 'rotate-90' : ''}`}>&#9654;</span>
          {t('tunnel.guide.toggle')}
        </button>

        {showGuide && (
          <div className="mt-3 p-3 bg-warm-50 border border-warm-150 rounded-lg text-xs text-warm-600 space-y-2">
            <p className="font-semibold text-warm-700 mb-1">{t('tunnel.guide.heading')}</p>
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li><code className="font-mono">cloudflared tunnel login</code></li>
              <li><code className="font-mono">cloudflared tunnel create my-app</code></li>
              <li><code className="font-mono">cloudflared tunnel route dns my-app app.your-domain.com</code></li>
              <li>{t('tunnel.guide.step4')}</li>
            </ol>
            <p className="text-2xs text-warm-400 pt-1">{t('tunnel.guide.note')}</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleRestart}
          disabled={restarting}
          className="btn-ghost text-sm disabled:opacity-50"
        >
          {restarting
            ? (status?.status === 'running' ? t('tunnel.restarting') : t('tunnel.starting'))
            : (status?.status === 'running' ? t('tunnel.restart') : t('tunnel.start'))}
        </button>
        <div className="flex gap-3">
          {onClose && (
            <button type="button" onClick={onClose} className="btn-ghost text-sm">
              {t('tunnel.close')}
            </button>
          )}
          <button type="button" onClick={handleSave} disabled={!canSave} className="btn-primary text-sm">
            {saving ? t('tunnel.saving') : t('tunnel.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TunnelSettings({ open, onClose }: TunnelSettingsProps) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} size="lg">
      <div className="card shadow-2xl rounded-2xl">
        <TunnelSettingsPanel onClose={onClose} />
      </div>
    </Modal>
  );
}
