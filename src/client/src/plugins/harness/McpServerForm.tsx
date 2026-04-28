import { useState, useEffect } from 'react';
import Modal from '../../components/Modal';
import { useI18n } from '../../i18n';
import type { McpServer, McpTransport } from './types';

interface McpServerFormProps {
  open: boolean;
  initial: McpServer | null;
  existingAliases: string[];
  saving: boolean;
  onCancel: () => void;
  onSave: (server: McpServer) => Promise<void>;
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function stringifyEnv(env: Record<string, string> | undefined): string {
  if (!env) return '';
  return Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
}

export default function McpServerForm({
  open,
  initial,
  existingAliases,
  saving,
  onCancel,
  onSave,
}: McpServerFormProps) {
  const { t } = useI18n();
  const [alias, setAlias] = useState('');
  const [transport, setTransport] = useState<McpTransport>('stdio');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [envText, setEnvText] = useState('');
  const [url, setUrl] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAlias(initial?.alias ?? '');
    setTransport(initial?.transport ?? 'stdio');
    setCommand(initial?.command ?? '');
    setArgsText((initial?.args ?? []).join(' '));
    setEnvText(stringifyEnv(initial?.env));
    setUrl(initial?.url ?? '');
    setHeadersText(stringifyEnv(initial?.headers));
    setError(null);
  }, [open, initial]);

  const editing = !!initial;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!alias.trim()) { setError(t('harness.mcp.errAlias')); return; }
    if (!editing && existingAliases.includes(alias.trim())) {
      setError(t('harness.mcp.errAliasExists'));
      return;
    }

    const server: McpServer = {
      alias: alias.trim(),
      transport,
    };

    if (transport === 'stdio') {
      if (!command.trim()) { setError(t('harness.mcp.errCommand')); return; }
      server.command = command.trim();
      const args = argsText.trim() ? argsText.trim().split(/\s+/) : [];
      if (args.length > 0) server.args = args;
      const env = parseEnv(envText);
      if (Object.keys(env).length > 0) server.env = env;
    } else {
      if (!url.trim()) { setError(t('harness.mcp.errUrl')); return; }
      server.url = url.trim();
      const headers = parseEnv(headersText);
      if (Object.keys(headers).length > 0) server.headers = headers;
    }

    try {
      await onSave(server);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal open={open} onClose={onCancel} size="lg">
      <form
        onSubmit={handleSubmit}
        className="bg-warm-0 rounded-2xl shadow-elevated p-5 space-y-4"
      >
        <h3 className="text-base font-semibold text-warm-700">
          {editing ? t('harness.mcp.editTitle') : t('harness.mcp.addTitle')}
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-warm-500 block mb-1">{t('harness.mcp.alias')}</label>
            <input
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              disabled={editing}
              placeholder="memory"
              className="w-full px-3 py-1.5 text-xs border border-warm-200 rounded-lg bg-warm-50 text-warm-700 focus:ring-1 focus:ring-accent focus:border-accent disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-xs text-warm-500 block mb-1">{t('harness.mcp.transport')}</label>
            <select
              value={transport}
              onChange={(e) => setTransport(e.target.value as McpTransport)}
              className="w-full px-3 py-1.5 text-xs border border-warm-200 rounded-lg bg-warm-50 text-warm-700 focus:ring-1 focus:ring-accent focus:border-accent"
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
              <option value="sse">sse</option>
            </select>
          </div>
        </div>

        {transport === 'stdio' ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-warm-500 block mb-1">{t('harness.mcp.command')}</label>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx"
                className="w-full px-3 py-1.5 text-xs font-mono border border-warm-200 rounded-lg bg-warm-50 text-warm-700 focus:ring-1 focus:ring-accent focus:border-accent"
              />
            </div>
            <div>
              <label className="text-xs text-warm-500 block mb-1">{t('harness.mcp.args')}</label>
              <input
                type="text"
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                placeholder="-y @modelcontextprotocol/server-memory"
                className="w-full px-3 py-1.5 text-xs font-mono border border-warm-200 rounded-lg bg-warm-50 text-warm-700 focus:ring-1 focus:ring-accent focus:border-accent"
              />
            </div>
            <div>
              <label className="text-xs text-warm-500 block mb-1">{t('harness.mcp.env')}</label>
              <textarea
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                placeholder={"API_KEY=...\nDEBUG=1"}
                rows={3}
                className="w-full px-3 py-1.5 text-xs font-mono border border-warm-200 rounded-lg bg-warm-50 text-warm-700 focus:ring-1 focus:ring-accent focus:border-accent resize-y"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-warm-500 block mb-1">{t('harness.mcp.url')}</label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/mcp"
                className="w-full px-3 py-1.5 text-xs font-mono border border-warm-200 rounded-lg bg-warm-50 text-warm-700 focus:ring-1 focus:ring-accent focus:border-accent"
              />
            </div>
            <div>
              <label className="text-xs text-warm-500 block mb-1">{t('harness.mcp.headers')}</label>
              <textarea
                value={headersText}
                onChange={(e) => setHeadersText(e.target.value)}
                placeholder={"Authorization=Bearer ..."}
                rows={3}
                className="w-full px-3 py-1.5 text-xs font-mono border border-warm-200 rounded-lg bg-warm-50 text-warm-700 focus:ring-1 focus:ring-accent focus:border-accent resize-y"
              />
            </div>
          </div>
        )}

        {error && <p className="text-xs text-status-error">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-warm-150">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-3 py-1.5 text-xs rounded-lg bg-warm-100 text-warm-600 hover:bg-warm-200 disabled:opacity-50 transition-colors"
          >
            {t('harness.cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent-dark disabled:opacity-50 transition-colors"
          >
            {saving ? t('harness.saving') : t('harness.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
