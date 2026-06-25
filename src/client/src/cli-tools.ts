export type CliTool = 'claude' | 'gemini' | 'codex' | 'raw-shell';

export interface CliToolConfig {
  value: CliTool;
  label: string;
  supportsInteractive: boolean;
}

// Model selection was removed from the product — every execution runs on the
// CLI's default model, so this registry only describes the tools themselves.
const DEFAULT_CLI_TOOLS: CliToolConfig[] = [
  { value: 'claude', label: 'Claude Code', supportsInteractive: true },
  { value: 'gemini', label: 'Gemini CLI', supportsInteractive: true },
  { value: 'codex', label: 'Codex CLI', supportsInteractive: true },
  { value: 'raw-shell', label: 'Raw Shell', supportsInteractive: true },
];

export const CLI_TOOLS = DEFAULT_CLI_TOOLS;

export function getToolConfig(tool: CliTool): CliToolConfig {
  return DEFAULT_CLI_TOOLS.find((t) => t.value === tool) ?? DEFAULT_CLI_TOOLS[0];
}
