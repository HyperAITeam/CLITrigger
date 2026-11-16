import { exec } from 'child_process';
import os from 'os';
import path from 'path';
import TOML from '@iarna/toml';
import { readJsonOrEmpty, readTextOrEmpty, atomicWriteText } from '../plugins/harness/io.js';
import { getToolStatus } from './cli-status.js';

// One-click registration of CLITrigger's own MCP endpoint in each AI CLI's
// user-level config (the "MCP 연결" settings card).
//
// Writes go through the CLI's own `mcp` command where it can carry the auth
// header (Claude, agy) — ~/.claude.json in particular is rewritten constantly
// by running sessions. Codex's `mcp add` has no header flag, so its
// config.toml is edited directly. Status is always read from the config file:
// `claude mcp get` health-checks the server and takes seconds.

const NAME = 'clitrigger';

export type McpClientState = 'registered' | 'stale' | 'unregistered';

export interface McpClientStatus {
  id: string;
  label: string;
  installed: boolean;
  /** 'stale' = registered, but with another address or token (e.g. the port changed). */
  state: McpClientState;
}

interface Registration {
  url?: string;
  authorization?: string;
}

interface McpClient {
  /** Matches the cli-status tool id. */
  id: string;
  label: string;
  /** Copy-paste registration text: a shell command, or a config snippet for Codex. */
  manual(url: string, token: string): string;
  /** What this CLI's user-level config currently holds for clitrigger. */
  read(): Promise<Registration | undefined>;
  register(url: string, token: string): Promise<void>;
  unregister(): Promise<void>;
}

// A shell is required: on Windows the CLIs can be .cmd shims. Callers only
// interpolate the values registerMcpClient has validated.
function run(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: 30_000, windowsHide: true }, (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve();
    });
  });
}

interface JsonMcpFile<Entry> {
  mcpServers?: Record<string, Entry>;
}

const claude: McpClient = {
  id: 'claude',
  label: 'Claude Code',
  // --scope user: the default (local) scope only registers it for the folder the command ran in.
  manual: (url, token) =>
    `claude mcp add --scope user --transport http ${NAME} ${url} --header "Authorization: Bearer ${token}"`,
  async read() {
    // Honors CLAUDE_CONFIG_DIR like Claude Code does.
    const file = path.join(process.env.CLAUDE_CONFIG_DIR || os.homedir(), '.claude.json');
    const entry = (await readJsonOrEmpty<JsonMcpFile<{ url?: string; headers?: Record<string, string> }>>(file))
      .mcpServers?.[NAME];
    return entry && { url: entry.url, authorization: entry.headers?.Authorization };
  },
  async register(url, token) {
    // `mcp add` refuses an existing name, so drop any previous entry first.
    await run(`claude mcp remove --scope user ${NAME}`).catch(() => {});
    await run(claude.manual(url, token));
  },
  unregister: () => run(`claude mcp remove --scope user ${NAME}`),
};

const antigravity: McpClient = {
  id: 'antigravity',
  label: 'Antigravity (agy)',
  // agy rejects flags placed after the name; http is inferred from the URL.
  manual: (url, token) => `agy mcp add --header "Authorization: Bearer ${token}" ${NAME} ${url}`,
  async read() {
    const file = path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
    const entry = (await readJsonOrEmpty<JsonMcpFile<{ serverUrl?: string; headers?: Record<string, string> }>>(file))
      .mcpServers?.[NAME];
    return entry && { url: entry.serverUrl, authorization: entry.headers?.Authorization };
  },
  // `agy mcp add` is an upsert.
  register: (url, token) => run(antigravity.manual(url, token)),
  unregister: () => run(`agy mcp remove ${NAME}`),
};

interface CodexConfig {
  mcp_servers?: Record<string, { url?: string; http_headers?: Record<string, string> }>;
}

// Honors CODEX_HOME like Codex does.
function codexConfigFile(): string {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
}

function codexBlock(url: string, token: string): string {
  return `[mcp_servers.${NAME}]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${token}" }`;
}

/**
 * config.toml text with the clitrigger server table (and its sub-tables)
 * dropped and `block` appended. Edits the text instead of re-serializing so
 * the rest of the user's file keeps its comments and layout.
 */
export function replaceCodexServer(text: string, block: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let skipping = false;
  const kept = text.split(/\r?\n/).filter((line) => {
    const header = line.match(/^\s*\[+([^\]]+)\]+/);
    if (header) skipping = /^mcp_servers\.clitrigger(\.|$)/.test(header[1].replace(/["'\s]/g, ''));
    return !skipping;
  });
  const parts = [kept.join('\n').trimEnd(), block].filter(Boolean);
  return parts.length > 0 ? (parts.join('\n\n') + '\n').replace(/\n/g, eol) : '';
}

async function writeCodexServer(block: string, expectedUrl: string | undefined): Promise<void> {
  const file = codexConfigFile();
  const next = replaceCodexServer(await readTextOrEmpty(file), block);
  // Never write a config.toml Codex could not load: parse the result first.
  // ponytail: a clitrigger entry written as an inline table or dotted keys is
  // not recognized by the text edit — it lands here as a duplicate-key error.
  let written: CodexConfig;
  try {
    written = TOML.parse(next) as CodexConfig;
  } catch (error) {
    throw new Error(`Could not edit ${file} automatically: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (written.mcp_servers?.[NAME]?.url !== expectedUrl) {
    throw new Error(`Could not edit ${file} automatically`);
  }
  await atomicWriteText(file, next);
}

const codex: McpClient = {
  id: 'codex',
  label: 'Codex',
  manual: (url, token) => `# Append to ~/.codex/config.toml\n${codexBlock(url, token)}`,
  async read() {
    try {
      const entry = (TOML.parse(await readTextOrEmpty(codexConfigFile())) as CodexConfig).mcp_servers?.[NAME];
      return entry && { url: entry.url, authorization: entry.http_headers?.Authorization };
    } catch {
      return undefined;
    }
  },
  register: (url, token) => writeCodexServer(codexBlock(url, token), url),
  unregister: () => writeCodexServer('', undefined),
};

const CLIENTS: McpClient[] = [claude, antigravity, codex];

function stateOf(found: Registration | undefined, url: string, token: string): McpClientState {
  if (!found?.url) return 'unregistered';
  // localhost and 127.0.0.1 reach the same server.
  const sameUrl = found.url.replace('//localhost:', '//127.0.0.1:') === url;
  return sameUrl && found.authorization === `Bearer ${token}` ? 'registered' : 'stale';
}

export function isMcpClient(id: string): boolean {
  return CLIENTS.some((client) => client.id === id);
}

export function mcpClientManuals(url: string, token: string): { id: string; label: string; command: string }[] {
  return CLIENTS.map((client) => ({ id: client.id, label: client.label, command: client.manual(url, token) }));
}

export async function listMcpClients(url: string, token: string): Promise<McpClientStatus[]> {
  return Promise.all(
    CLIENTS.map(async (client) => ({
      id: client.id,
      label: client.label,
      installed: (await getToolStatus(client.id))?.installed ?? false,
      state: stateOf(await client.read().catch(() => undefined), url, token),
    })),
  );
}

export async function registerMcpClient(id: string, url: string, token: string): Promise<void> {
  // Both values end up in a shell command line and in TOML.
  if (!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(url) || !/^[\w-]+$/.test(token)) {
    throw new Error('Unexpected MCP address or token');
  }
  await CLIENTS.find((client) => client.id === id)?.register(url, token);
}

export async function unregisterMcpClient(id: string): Promise<void> {
  await CLIENTS.find((client) => client.id === id)?.unregister();
}
