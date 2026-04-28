import { useState } from 'react';
import { useI18n } from '../../i18n';
import McpServerForm from './McpServerForm';
import type { McpServer } from './types';

interface McpServerListProps {
  servers: McpServer[];
  saving: boolean;
  onUpsert: (server: McpServer) => Promise<void>;
  onRemove: (alias: string) => Promise<void>;
}

function maskValue(value: string): string {
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}${'*'.repeat(Math.min(value.length - 4, 8))}${value.slice(-2)}`;
}

function summarize(server: McpServer): string {
  if (server.transport === 'stdio') {
    const args = server.args ? ' ' + server.args.join(' ') : '';
    return `${server.command ?? ''}${args}`.trim() || '—';
  }
  return server.url ?? '—';
}

export default function McpServerList({ servers, saving, onUpsert, onRemove }: McpServerListProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const handleAdd = () => {
    setEditing(null);
    setOpen(true);
  };

  const handleEdit = (server: McpServer) => {
    setEditing(server);
    setOpen(true);
  };

  const handleSave = async (server: McpServer) => {
    await onUpsert(server);
    setOpen(false);
    setEditing(null);
  };

  const handleRemove = async (alias: string) => {
    if (!confirm(t('harness.mcp.confirmRemove').replace('{alias}', alias))) return;
    setRemoving(alias);
    try {
      await onRemove(alias);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-3 p-4 border border-warm-200 rounded-xl">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-warm-700">{t('harness.section.mcp')}</h4>
        <button
          type="button"
          onClick={handleAdd}
          className="px-3 py-1 text-xs rounded-lg bg-accent text-white hover:bg-accent-dark transition-colors"
        >
          + {t('harness.mcp.add')}
        </button>
      </div>

      {servers.length === 0 ? (
        <p className="text-xs text-warm-400">{t('harness.mcp.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {servers.map((server) => {
            const hasSecrets = !!(server.env && Object.keys(server.env).length > 0)
              || !!(server.headers && Object.keys(server.headers).length > 0);
            return (
              <li
                key={server.alias}
                className="p-3 border border-warm-150 rounded-lg bg-warm-50 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-xs font-semibold text-warm-700">{server.alias}</code>
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-warm-200 text-warm-500">
                      {server.transport}
                    </span>
                    {hasSecrets && (
                      <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-warm-150 text-warm-500">
                        env
                      </span>
                    )}
                  </div>
                  <code className="text-xs font-mono text-warm-500 break-all">
                    {summarize(server)}
                  </code>
                  {server.env && Object.keys(server.env).length > 0 && (
                    <div className="mt-1 text-[10px] font-mono text-warm-400 space-y-0.5">
                      {Object.entries(server.env).map(([k, v]) => (
                        <div key={k}>{k}={maskValue(v)}</div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleEdit(server)}
                    className="px-2 py-1 text-xs rounded bg-warm-100 text-warm-600 hover:bg-warm-200 transition-colors"
                  >
                    {t('harness.edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(server.alias)}
                    disabled={removing === server.alias}
                    className="px-2 py-1 text-xs rounded bg-warm-100 text-status-error hover:bg-status-error/10 disabled:opacity-50 transition-colors"
                  >
                    {removing === server.alias ? '…' : t('harness.delete')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <McpServerForm
        open={open}
        initial={editing}
        existingAliases={servers.map((s) => s.alias)}
        saving={saving}
        onCancel={() => { setOpen(false); setEditing(null); }}
        onSave={handleSave}
      />
    </div>
  );
}
