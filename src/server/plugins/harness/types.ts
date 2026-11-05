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
  // File holding the hooks block (Claude settings.json, Codex .codex/hooks.json,
  // Antigravity .agents/hooks.json).
  hooks?: string;
}

// A project-scoped skill: .claude/skills/<name>/SKILL.md (Claude) or
// .agents/skills/<name>/SKILL.md (Codex, Antigravity).
export interface HarnessSkill {
  name: string;
  description?: string;
  path: string;
  content: string;
  // false when SKILL.md is parked as SKILL.md.disabled (the CLI won't load it).
  enabled: boolean;
}

// An installed plugin the CLI would load in this project. Claude plugins can
// be user/project/local scoped; Codex and Antigravity plugins are user-wide.
export interface HarnessPlugin {
  id: string; // "<name>@<marketplace>" (Antigravity: "<name>")
  scope: string; // user | project | local
  version?: string;
  description?: string;
  // Effective enabled state as the CLI resolves it.
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

export interface HarnessAdapter {
  cli: CliId;
  read(projectPath: string): Promise<HarnessSnapshot>;
  writeSettings(projectPath: string, patch: HarnessSettings): Promise<void>;
  writeMemory(projectPath: string, content: string): Promise<void>;
  upsertMcp(projectPath: string, server: McpServer): Promise<void>;
  removeMcp(projectPath: string, alias: string): Promise<void>;
  // Optional capabilities. Routes return 400 when the adapter doesn't
  // implement them.
  writeLocalMemory?(projectPath: string, content: string): Promise<void>;
  writeHooks?(projectPath: string, hooks: Record<string, unknown> | null): Promise<void>;
  writeSkill?(projectPath: string, name: string, content: string): Promise<void>;
  // Claude/Codex: move hooks[event][index] to the disabled file (enabled=false)
  // or disabledHooks[event][index] back (enabled=true). Antigravity: `event` is
  // the hook name and its native `enabled` flag is set; `index` is ignored.
  toggleHook?(projectPath: string, event: string, index: number, enabled: boolean): Promise<void>;
  toggleSkill?(projectPath: string, name: string, enabled: boolean): Promise<void>;
  togglePlugin?(projectPath: string, id: string, enabled: boolean): Promise<void>;
}
