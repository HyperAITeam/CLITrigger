export type CliTool = 'claude' | 'gemini' | 'codex';
export type CliMode = 'headless' | 'interactive' | 'streaming';

// Allowed CLI option patterns (flags that are safe to pass through)
const ALLOWED_OPTION_PATTERN = /^--?[a-zA-Z][a-zA-Z0-9_-]*(?:=\S+)?$/;

// Dangerous shell characters that could enable injection
const DANGEROUS_CHARS = /[;&|`$(){}[\]<>!#~'"\\]/;

/**
 * Validate and sanitize extra CLI options from user input.
 * Only allows simple flags like --flag or --flag=value.
 */
export function sanitizeExtraOptions(extraOptions: string): string[] {
  if (!extraOptions || typeof extraOptions !== 'string') return [];

  const parts = extraOptions.split(/\s+/).filter(Boolean);
  const sanitized: string[] = [];

  for (const part of parts) {
    if (DANGEROUS_CHARS.test(part)) {
      console.warn(`Rejected dangerous CLI option: ${part}`);
      continue;
    }
    if (!ALLOWED_OPTION_PATTERN.test(part)) {
      console.warn(`Rejected invalid CLI option format: ${part}`);
      continue;
    }
    sanitized.push(part);
  }

  return sanitized;
}

export interface CliAdapter {
  /** Executable command name */
  command: string;
  /** Display name for logs */
  displayName: string;
  /** Build the args array for spawning */
  buildArgs(opts: { mode: CliMode; prompt: string; model?: string; extraOptions?: string; maxTurns?: number }): string[];
  /** Whether this mode needs stdin pipe */
  needsStdin(mode: CliMode): boolean;
  /** Format prompt for stdin delivery */
  formatStdinPrompt(prompt: string): string;
  /** Whether this CLI requires a TTY (pseudo-terminal) to run */
  requiresTty?: boolean;
}

const TASK_COMPLETION_SUFFIX = `

IMPORTANT: Once the task is complete, stop immediately. Do not perform additional refactoring, optimization, testing, or verification beyond what was explicitly requested. Do not review your own changes or add improvements that were not part of the original task.`;

const claudeAdapter: CliAdapter = {
  command: 'claude',
  displayName: 'Claude CLI',
  buildArgs({ mode, prompt, model, extraOptions, maxTurns }) {
    const args = ['--dangerously-skip-permissions'];
    if (model) args.push('--model', model);
    if (maxTurns && maxTurns > 0) args.push('--max-turns', String(maxTurns));
    if (extraOptions) {
      args.push(...sanitizeExtraOptions(extraOptions));
    }
    // Headless: prompt is delivered via stdin pipe (avoids shell escaping issues with newlines)
    return args;
  },
  needsStdin(_mode) {
    return true;
  },
  formatStdinPrompt(prompt) {
    return prompt + TASK_COMPLETION_SUFFIX + '\n';
  },
};

const geminiAdapter: CliAdapter = {
  command: 'gemini',
  displayName: 'Gemini CLI',
  buildArgs({ mode, prompt, model, extraOptions }) {
    const args = ['--sandbox=permissive'];
    if (model) args.push('--model', model);
    if (extraOptions) {
      args.push(...sanitizeExtraOptions(extraOptions));
    }
    // Headless: prompt is delivered via stdin pipe (avoids shell escaping issues with newlines)
    return args;
  },
  needsStdin(_mode) {
    return true;
  },
  formatStdinPrompt(prompt) {
    return prompt + '\n';
  },
};

const codexAdapter: CliAdapter = {
  command: 'codex',
  displayName: 'Codex CLI',
  requiresTty: true,
  buildArgs({ mode, prompt, model, extraOptions }) {
    const args = ['--full-auto'];
    if (model) args.push('--model', model);
    if (extraOptions) {
      args.push(...sanitizeExtraOptions(extraOptions));
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
