import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useI18n } from '../i18n';
import { useToast } from '../hooks/useToast';
import {
  getMcpConnection,
  getMcpClients,
  setMcpClientRegistered,
  type McpConnection,
  type McpClientStatus,
} from '../api/mcp';

interface PanelProps {
  onClose?: () => void;
}

const STATE_DOT: Record<McpClientStatus['state'], string> = {
  registered: 'bg-status-success',
  stale: 'bg-status-warning',
  unregistered: 'bg-status-info',
};

export default function McpSettingsPanel({ onClose }: PanelProps) {
  const { t } = useI18n();
  const { success: toastSuccess, error: toastError } = useToast();
  const [conn, setConn] = useState<McpConnection | null>(null);
  const [clients, setClients] = useState<McpClientStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMcpConnection()
      .then((c) => { if (!cancelled) setConn(c); })
      .catch(() => { /* surfaced via loading state */ });
    getMcpClients()
      .then((list) => { if (!cancelled) setClients(list); })
      .catch(() => { /* the manual section below still works */ });
    return () => { cancelled = true; };
  }, []);

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
      toastSuccess(t('mcp.copied'));
    } catch {
      toastError(t('mcp.copyFailed'));
    }
  };

  const setRegistered = async (ids: string[], registered: boolean) => {
    setBusy(true);
    try {
      // Each call returns the refreshed list, so partial progress shows even if a later one fails.
      for (const id of ids) setClients(await setMcpClientRegistered(id, registered));
      toastSuccess(t(registered ? 'mcp.clients.done' : 'mcp.clients.removed'));
    } catch (error) {
      toastError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const configText = conn ? JSON.stringify(conn.config, null, 2) : '';
  const unregistered = clients.filter((c) => c.installed && c.state !== 'registered').map((c) => c.id);

  const CopyButton = ({ label, text }: { label: string; text: string }) => (
    <button
      type="button"
      onClick={() => copy(label, text)}
      className="btn-ghost text-xs flex items-center gap-1"
    >
      {copied === label ? <Check size={14} /> : <Copy size={14} />}
      {t('mcp.copy')}
    </button>
  );

  const blockStyle = {
    backgroundColor: 'var(--color-bg-hover)',
    color: 'var(--color-text-secondary)',
  } as const;

  return (
    <div className="p-8">
      <h2 className="text-lg font-semibold text-warm-800 mb-1">{t('mcp.title')}</h2>
      <p className="text-xs text-warm-400 mb-6">{t('mcp.description')}</p>

      {!conn ? (
        <p className="text-sm text-warm-400">{t('mcp.loading')}</p>
      ) : (
        <>
          {conn.preferredPort && (
            <p className="text-xs text-amber-500 mb-5">
              {t('mcp.portFallback').replace('{port}', String(conn.preferredPort))}
            </p>
          )}

          {clients.length > 0 && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-warm-600 mb-1">{t('mcp.clients.label')}</label>
              <p className="text-2xs text-warm-400 mb-3">{t('mcp.clients.hint')}</p>
              <button
                type="button"
                disabled={busy || unregistered.length === 0}
                onClick={() => setRegistered(unregistered, true)}
                className="btn-primary btn-md w-full mb-3"
              >
                {t('mcp.clients.registerAll')}
              </button>
              <div className="rounded-lg" style={blockStyle}>
                {clients.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 px-3 py-2 min-h-[44px]">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.installed ? STATE_DOT[c.state] : 'bg-status-info opacity-40'}`} />
                    <span className="text-sm text-warm-700">{c.label}</span>
                    <span className="text-2xs text-warm-400 flex-1">
                      {t(c.installed ? `mcp.clients.state.${c.state}` : 'mcp.clients.notInstalled')}
                    </span>
                    {c.installed && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRegistered([c.id], c.state !== 'registered')}
                        className={`${c.state === 'registered' ? 'btn-danger' : 'btn-secondary'} btn-sm`}
                      >
                        {t(`mcp.clients.action.${c.state}`)}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <details className="mb-5">
            <summary className="text-sm font-medium text-warm-600 cursor-pointer mb-3">{t('mcp.manual.label')}</summary>

            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs text-warm-500">{t('mcp.config.label')}</label>
                <CopyButton label="config" text={configText} />
              </div>
              <pre className="p-3 rounded-lg text-2xs font-mono overflow-x-auto" style={blockStyle}>
                {configText}
              </pre>
            </div>

            <label className="block text-xs text-warm-500 mb-1">{t('mcp.commands.label')}</label>
            <p className="text-2xs text-warm-400 mb-3">{t('mcp.commands.hint')}</p>
            <div className="space-y-3">
              {conn.commands.map((c) => (
                <div key={c.id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-warm-500">{c.label}</span>
                    <CopyButton label={`command:${c.id}`} text={c.command} />
                  </div>
                  <pre className="p-3 rounded-lg text-2xs font-mono overflow-x-auto" style={blockStyle}>
                    {c.command}
                  </pre>
                </div>
              ))}
            </div>
          </details>

          <p className="text-2xs text-warm-400">{t('mcp.tokenNote')}</p>
        </>
      )}

      {onClose && (
        <div className="flex justify-end mt-6">
          <button type="button" onClick={onClose} className="btn-ghost text-sm">{t('mcp.close')}</button>
        </div>
      )}
    </div>
  );
}
