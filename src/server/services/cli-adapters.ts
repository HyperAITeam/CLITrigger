export type CliTool = 'claude' | 'gemini' | 'codex';
export type CliMode = 'headless' | 'interactive' | 'streaming';

export interface CliAdapter {
  /** Executable command name */
  command: string;
  /** Display name for logs */
  displayName: string;
  /** Build the args array for spawning */
  buildArgs(opts: { mode: CliMode; prompt: string; model?: string; extraOptions?: string }): string[];
  /** Whether this mode needs stdin pipe */
  needsStdin(mode: CliMode): boolean;
  /** Format prompt for stdin delivery */
  formatStdinPrompt(prompt: string): string;
}

const claudeAdapter: CliAdapter = {
  command: 'claude',
  displayName: 'Claude CLI',
  buildArgs({ mode, prompt, model, extraOptions }) {
    const args = ['--dangerously-skip-permissions'];
    if (model) args.push('--model', model);
    if (extraOptions) {
      args.push(...extraOptions.split(/\s+/).filter(Boolean));
    }
    if (mode === 'headless') {
      args.push('-p', prompt);
    }
    return args;
  },
  needsStdin(mode) {
    return mode === 'interactive' || mode === 'streaming';
  },
  formatStdinPrompt(prompt) {
    return prompt + '\n';
  },
};

const geminiAdapter: CliAdapter = {
  command: 'gemini',
  displayName: 'Gemini CLI',
  buildArgs({ mode, prompt, model, extraOptions }) {
    const args = ['--sandbox=permissive'];
    if (model) args.push('--model', model);
    if (extraOptions) {
      args.push(...extraOptions.split(/\s+/).filter(Boolean));
    }
    if (mode === 'headless') {
      args.push('-p', prompt);
    }
    return args;
  },
  needsStdin(mode) {
    return mode === 'interactive' || mode === 'streaming';
  },
  formatStdinPrompt(prompt) {
    return prompt + '\n';
  },
};

const codexAdapter: CliAdapter = {
  command: 'codex',
  displayName: 'Codex CLI',
  buildArgs({ mode, prompt, model, extraOptions }) {
    const args = ['--full-auto'];
    if (model) args.push('--model', model);
    if (extraOptions) {
      args.push(...extraOptions.split(/\s+/).filter(Boolean));
    }
    if (mode === 'headless') {
      args.push(prompt);
    }
    return args;
  },
  needsStdin(mode) {
    return mode === 'interactive' || mode === 'streaming';
  },
  formatStdinPrompt(prompt) {
    return prompt + '\n';
  },
};

const adapters: Record<CliTool, CliAdapter> = {
  claude: claudeAdapter,
  gemini: geminiAdapter,
  codex: codexAdapter,
};

export function getAdapter(tool: CliTool): CliAdapter {
  return adapters[tool] ?? adapters.claude;
}
