export type CliId = 'claude' | 'antigravity' | 'codex';

export type McpTransport = 'stdio' | 'http' | 'sse';

export interface McpServer {
  alias: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface HarnessSettings {
  model?: string;
  approvalMode?: string;
  sandbox?: string;
}

export interface HarnessFilePaths {
  settings: string;
  memory: string;
  mcp?: string;
  // Claude only: CLAUDE.local.md alongside CLAUDE.md.
  localMemory?: string;
  // File holding the hooks block.
  hooks?: string;
}

// A project-scoped skill: .claude/skills/<name>/SKILL.md (Claude) or
// .agents/skills/<name>/SKILL.md (Codex, Antigravity).
export interface HarnessSkill {
  name: string;
  description?: string;
  path: string;
  content: string;
  // false when SKILL.md is parked as SKILL.md.disabled (Claude won't load it).
  enabled: boolean;
}

// An installed plugin the CLI would load in this project.
export interface HarnessPlugin {
  id: string; // "<name>@<marketplace>" (Antigravity: "<name>")
  scope: string; // user | project | local
  version?: string;
  description?: string;
  enabled: boolean;
}

export interface HarnessSnapshot {
  cli: CliId;
  exists: boolean;
  filePaths: HarnessFilePaths;
  settings: HarnessSettings;
  memory: string;
  mcp: McpServer[];
  warnings: string[];
  // Claude only — undefined for CLIs without these conventions.
  localMemory?: string;
  localMemoryExists?: boolean;
  // Claude/Codex: { Event: [entries] }. Antigravity: { hookName: { enabled?, Event: [...] } }.
  hooks?: Record<string, unknown>;
  // Hook entries parked in hooks.disabled.json (Claude/Codex), keyed by event name.
  disabledHooks?: Record<string, unknown>;
  skills?: HarnessSkill[];
  plugins?: HarnessPlugin[];
}
