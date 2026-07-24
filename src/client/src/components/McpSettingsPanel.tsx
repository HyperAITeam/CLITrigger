import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useI18n } from '../i18n';
import { useToast } from '../hooks/useToast';
import { getMcpConnection, type McpConnection } from '../api/mcp';

interface PanelProps {
  onClose?: () => void;
}

export default function McpSettingsPanel({ onClose }: PanelProps) {
  const { t } = useI18n();
  const { success: toastSuccess, error: toastError } = useToast();
  const [conn, setConn] = useState<McpConnection | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMcpConnection()
      .then((c) => { if (!cancelled) setConn(c); })
      .catch(() => { /* surfaced via loading state */ });
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

  const configText = conn ? JSON.stringify(conn.config, null, 2) : '';

  const CopyButton = ({ label, text }: { label: string; text: string }) => (
    <button
      type="button"
      onClick={() => copy(label, text)}
      className="btn-ghost text-xs flex items-center gap-1"
    >
      {copied === label ? <Check size={13} /> : <Copy size={13} />}
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
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-warm-600">{t('mcp.config.label')}</label>
              <CopyButton label="config" text={configText} />
            </div>
            <pre className="p-3 rounded-lg text-2xs font-mono overflow-x-auto" style={blockStyle}>
              {configText}
            </pre>
          </div>

          <div className="mb-5">
            <label className="block text-sm font-medium text-warm-600 mb-1">{t('mcp.commands.label')}</label>
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
          </div>

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
