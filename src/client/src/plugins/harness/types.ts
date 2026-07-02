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
}

// A project-scoped skill: .claude/skills/<name>/SKILL.md (Claude only).
export interface HarnessSkill {
  name: string;
  description?: string;
  path: string;
  content: string;
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
  hooks?: Record<string, unknown>;
  skills?: HarnessSkill[];
}
