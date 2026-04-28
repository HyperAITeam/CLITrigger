export type CliId = 'claude' | 'gemini' | 'codex';

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
}

export interface HarnessSnapshot {
  cli: CliId;
  exists: boolean;
  filePaths: HarnessFilePaths;
  settings: HarnessSettings;
  memory: string;
  mcp: McpServer[];
  warnings: string[];
}
