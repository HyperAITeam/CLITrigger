import path from 'path';
import { isModelSupported } from '../db/queries.js';

export type CliTool = 'claude' | 'gemini' | 'codex';
export type CliMode = 'headless' | 'interactive' | 'verbose';
export type SandboxMode = 'strict' | 'permissive';

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

function normalizeModel(model: string | undefined, cliTool: CliTool): string | undefined {
  if (!model) return undefined;
  if (isModelSupported(cliTool, model)) return model;
  console.warn(`Unsupported ${cliTool} model "${model}" ignored; falling back to default model.`);
  return undefined;
}

export interface CliAdapter {
  /** Executable command name */
  command: string;
  /** Display name for logs */
  displayName: string;
  /** Build the args array for spawning */
  buildArgs(opts: { mode: CliMode; prompt: string; model?: string; extraOptions?: string; maxTurns?: number; workDir?: string; projectPath?: string; sandboxMode?: SandboxMode }): string[];
  /** Whether this mode needs stdin pipe */
  needsStdin(mode: CliMode): boolean;
  /** Format prompt for stdin delivery */
  formatStdinPrompt(prompt: string): string;
  /** Whether this CLI requires a TTY (pseudo-terminal) to run */
  requiresTty?: boolean;
  /** Output format: 'stream-json' for structured JSON lines, 'text' for plain text */
  outputFormat?: 'text' | 'stream-json';
}

const TASK_COMPLETION_SUFFIX = `

IMPORTANT: Work efficiently and stop when done.
- Use grep/glob to find target files. Do NOT read every file or use Explore agents for simple tasks.
- Only read files you need to modify. Make edits directly without re-reading.
- Once complete, commit all changes and stop. No additional refactoring, testing, or review.`;

const claudeAdapter: CliAdapter = {
  command: 'claude',
  displayName: 'Claude CLI',
  outputFormat: 'stream-json',
  buildArgs({ mode, prompt, model, extraOptions, maxTurns, sandboxMode }) {
    const normalizedModel = normalizeModel(model, 'claude');
    const args: string[] = [];
    if (sandboxMode === 'strict') {
      args.push('--permission-mode', 'dontAsk');
    } else {
      args.push('--dangerously-skip-permissions');
    }
    if (mode !== 'interactive') {
      args.push('--print');
    }
    args.push('--verbose', '--output-format', 'stream-json');
    if (normalizedModel) args.push('--model', normalizedModel);
    if (maxTurns && maxTurns > 0) args.push('--max-turns', String(maxTurns));
    if (extraOptions) {
      args.push(...sanitizeExtraOptions(extraOptions));
    }
    // Prompt is delivered via stdin pipe (avoids shell escaping issues with newlines)
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
    // Gemini CLI: --yolo auto-approves all tool actions (file writes, shell commands)
    // -p enables headless (non-interactive) mode; prompt text is delivered via stdin pipe
    const args = ['--yolo'];
    if (model) args.push('--model', model);
    if (extraOptions) {
      args.push(...sanitizeExtraOptions(extraOptions));
    }
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
  buildArgs({ mode, prompt, model, extraOptions, workDir, projectPath, sandboxMode }) {
    const normalizedModel = normalizeModel(model, 'codex');
    const args: string[] = ['exec'];
    if (sandboxMode === 'strict') {
      // Use --full-auto (workspace-write sandbox) with --add-dir to allow git metadata access.
      // Git worktree metadata lives at <projectPath>/.git/worktrees/, so we whitelist the .git dir.
      args.push('--full-auto');
      if (workDir && projectPath && workDir !== projectPath) {
        const gitDir = path.join(projectPath, '.git');
        args.push('--add-dir', gitDir);
      }
    } else {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    }
    if (normalizedModel) args.push('--model', normalizedModel);
    if (extraOptions) {
      args.push(...sanitizeExtraOptions(extraOptions));
    }
    return args;
  },
  needsStdin(_mode) {
    return true;
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
