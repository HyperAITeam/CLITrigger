import path from 'path';
import { execFile } from 'child_process';
import { isModelSupported } from '../db/queries.js';

export type CliTool = 'claude' | 'gemini' | 'codex';
export type CliMode = 'headless' | 'interactive' | 'verbose';
export type SandboxMode = 'strict' | 'permissive';

export interface ProbedModel {
  value: string;
  label: string;
}

const PROBE_TIMEOUT_MS = 5_000;

/**
 * Best-effort parse of a CLI --help dump to extract supported model identifiers.
 *
 * Heuristic: looks for lines that mention the `--model` flag and collects any
 * comma/space-separated identifiers on the same (or next) line that match
 * known model naming patterns (e.g. "claude-sonnet-4-6", "gpt-4.1", "o3",
 * "gemini-2.5-pro"). Returns an empty array if nothing plausible is found;
 * callers should treat empty as "probe failed, use registry".
 */
export function parseHelpForModels(helpText: string): ProbedModel[] {
  if (!helpText || typeof helpText !== 'string') return [];

  // Identifier shape CLI vendors tend to use for model slugs
  const modelIdPattern = /\b(?:claude-[a-z0-9-]+|gpt-[0-9][0-9a-z.-]*|o[0-9][0-9a-z.-]*|gemini-[0-9][0-9a-z.-]*)\b/gi;

  const lines = helpText.split(/\r?\n/);
  const collected = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/--model\b/i.test(line)) continue;
    // Scan current line + next 3 lines (help text often puts choices below)
    const window = lines.slice(i, Math.min(i + 4, lines.length)).join(' ');
    const matches = window.match(modelIdPattern);
    if (matches) {
      for (const m of matches) collected.add(m.toLowerCase());
    }
  }

  return Array.from(collected).map((value) => ({ value, label: value }));
}

function runHelp(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    const opts: { timeout: number; shell?: boolean; maxBuffer: number } = {
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    };
    if (process.platform === 'win32') opts.shell = true;
    execFile(command, ['--help'], opts, (error, stdout, stderr) => {
      if (error && !stdout && !stderr) {
        resolve(null);
        return;
      }
      resolve((stdout || '') + '\n' + (stderr || ''));
    });
  });
}

async function probeViaHelp(command: string): Promise<ProbedModel[] | null> {
  try {
    const help = await runHelp(command);
    if (!help) return null;
    const parsed = parseHelpForModels(help);
    return parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

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

/**
 * A rule for auto-responding to a CLI's in-process prompt (trust dialog,
 * update notice, etc). Matched against PTY stdout after ANSI stripping.
 */
export interface AutoRespondRule {
  /** Label for logs */
  name: string;
  /** Regex to match the prompt in the stripped PTY output */
  pattern: RegExp;
  /** Exact string written to PTY in response (include trailing \r to submit) */
  response: string;
  /**
   * If true, defer initial-prompt delivery until this rule's pattern stops
   * matching AND the ready indicator appears. Use for trust dialogs that
   * steal stdin. Non-blocking rules (e.g. update prompts) get dismissed in
   * place without holding up the initial prompt.
   */
  blocksInitialPrompt?: boolean;
}

export interface CliAdapter {
  /** Executable command name */
  command: string;
  /** Display name for logs */
  displayName: string;
  /** Whether this CLI supports long-lived interactive sessions */
  supportsInteractive?: boolean;
  /** Build the args array for spawning */
  buildArgs(opts: { mode: CliMode; prompt: string; model?: string; extraOptions?: string; maxTurns?: number; workDir?: string; projectPath?: string; sandboxMode?: SandboxMode; continueSession?: boolean }): string[];
  /** Whether this mode needs stdin pipe */
  needsStdin(mode: CliMode): boolean;
  /** Format prompt for stdin delivery */
  formatStdinPrompt(prompt: string, mode?: CliMode): string;
  /** Whether this CLI requires a TTY (pseudo-terminal) to run */
  requiresTty?: boolean;
  /** Output format: 'stream-json' for structured JSON lines, 'text' for plain text */
  outputFormat?: 'text' | 'stream-json';
  /**
   * Defer writing the initial prompt to PTY stdin until the CLI's ready
   * indicator appears (or a fallback timeout elapses). Prevents the prompt
   * from being consumed by startup banners or trust dialogs.
   */
  delayStdinUntilReady?: boolean;
  /**
   * Regex that matches the CLI's "ready for input" state in stripped PTY
   * output. Used both to time initial-prompt delivery and to detect the
   * end of a blocking auto-respond rule (e.g. trust dialog dismissed).
   */
  readyIndicatorPattern?: RegExp;
  /** Ordered list of prompts to auto-respond to while the PTY runs */
  autoRespondRules?: AutoRespondRule[];
  /**
   * Byte sequence written to PTY stdin to submit a line of user input.
   * Replaces a trailing '\n' in writes going through the interactive relay
   * and the initial-prompt delivery. Default: '\r'. Some TUIs (e.g. Gemini)
   * only treat '\r\n' as Enter; others need '\n'.
   */
  stdinSubmitSequence?: string;
  /**
   * Best-effort probe for currently supported models. Returns null when the
   * CLI is unreachable or its help output yields no recognizable model ids;
   * callers should fall back to the bundled registry.
   */
  probeModels?(): Promise<ProbedModel[] | null>;
}

const TASK_COMPLETION_SUFFIX = `

IMPORTANT: Work efficiently and stop when done.
- Use grep/glob to find target files. Do NOT read every file or use Explore agents for simple tasks.
- Only read files you need to modify. Make edits directly without re-reading.
- Once complete, commit all changes and stop. No additional refactoring, testing, or review.`;

const claudeAdapter: CliAdapter = {
  command: 'claude',
  displayName: 'Claude CLI',
  supportsInteractive: true,
  outputFormat: 'stream-json',
  delayStdinUntilReady: true,
  readyIndicatorPattern: /Welcome\s*back|›|>\s*$/,
  autoRespondRules: [
    {
      name: 'claude-trust',
      pattern: /Yes,\s*I\s*trust\s*this/i,
      response: '\r',
      blocksInitialPrompt: true,
    },
  ],
  buildArgs({ mode, prompt, model, extraOptions, maxTurns, sandboxMode, continueSession }) {
    const normalizedModel = normalizeModel(model, 'claude');
    const args: string[] = [];
    if (sandboxMode === 'strict') {
      args.push('--permission-mode', 'dontAsk');
    } else {
      args.push('--dangerously-skip-permissions');
    }
    if (mode !== 'interactive') {
      args.push('--print', '--verbose', '--output-format', 'stream-json');
    }
    if (continueSession) args.push('--continue');
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
  formatStdinPrompt(prompt, mode) {
    if (mode === 'interactive') return prompt + '\n';
    return prompt + TASK_COMPLETION_SUFFIX + '\n';
  },
  probeModels() {
    return probeViaHelp('claude');
  },
};

const geminiAdapter: CliAdapter = {
  command: 'gemini',
  displayName: 'Gemini CLI',
  supportsInteractive: true,
  delayStdinUntilReady: true,
  // Gemini's TUI only treats \r\n (CRLF) as Enter; a lone \r leaves the
  // character in the input box without submitting.
  stdinSubmitSequence: '\r\n',
  // Gemini welcome screen fixed tokens shown after trust dialog is dismissed
  readyIndicatorPattern: /Type your message|Shortcuts|ctrl\+y/i,
  autoRespondRules: [
    {
      name: 'gemini-trust-folder',
      // First-run folder trust dialog. Option 1 = "Trust folder" (current dir only)
      pattern: /Do you trust the files in this folder\?|Trust folder/i,
      response: '1\r',
      blocksInitialPrompt: true,
    },
    {
      // Provisional pattern; refine once the actual update prompt is captured in logs.
      // Decline updates to avoid unexpected CLI version changes mid-session.
      name: 'gemini-update-prompt',
      pattern: /update available.*\(y\/n\)|install.*new.*version.*\?/i,
      response: 'n\r',
    },
  ],
  buildArgs({ mode, prompt, model, extraOptions, continueSession }) {
    // Gemini CLI: --yolo auto-approves all tool actions (file writes, shell commands)
    // --prompt= enables headless mode with empty value; actual prompt delivered via stdin pipe.
    // Must use --prompt= (single arg) instead of -p '' because Windows cmd.exe drops empty string args.
    const normalizedModel = normalizeModel(model, 'gemini');
    const args = ['--yolo'];
    if (mode !== 'interactive') args.push('--prompt=');
    if (continueSession) args.push('--resume', 'latest');
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
  probeModels() {
    return probeViaHelp('gemini');
  },
};

const codexAdapter: CliAdapter = {
  command: 'codex',
  displayName: 'Codex CLI',
  supportsInteractive: true,
  delayStdinUntilReady: true,
  // Typical Codex TUI input-cursor glyphs. 5s fallback in claude-manager handles miss.
  readyIndicatorPattern: /▍|›|>\s*$/,
  // No auto-respond rules yet — add once real startup/update prompts are captured.
  autoRespondRules: [],
  buildArgs({ mode, prompt, model, extraOptions, workDir, projectPath, sandboxMode, continueSession }) {
    const normalizedModel = normalizeModel(model, 'codex');
    const args: string[] = [];
    if (mode !== 'interactive') {
      args.push('exec');
      if (continueSession) {
        args.push('resume', '--last');
      }
    }
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
  probeModels() {
    return probeViaHelp('codex');
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

export function supportsInteractiveMode(tool: CliTool): boolean {
  return !!getAdapter(tool).supportsInteractive;
}
