/**
 * Filters TUI chrome noise from Claude CLI interactive mode PTY output.
 * Only active for interactive mode — headless/verbose use structured JSON.
 */

export interface PtyFilterState {
  lineBuffer: string;
  recentLines: string[];
  inResponseBlock: boolean;
}

export function createPtyFilterState(): PtyFilterState {
  return { lineBuffer: '', recentLines: [], inResponseBlock: false };
}

// ── Noise detection patterns ──

const NOISE_PATTERNS: RegExp[] = [
  // Box drawing / separator lines (allow trailing prompt chars like > $ %)
  /^[\s─━│┃╭╮╰╯┌┐└┘┬┴├┤┼╋═║╔╗╚╝╠╣╦╩╬░█▓▒>$%›]+$/,
  // Claude banner frame
  /╭.*Claude|╰─/,
  // Status bar: model/team info (with or without brackets)
  /^\[.*(?:Haiku|Sonnet|Opus|Claude).*\]\s*│/i,
  /(?:Haiku|Sonnet|Opus)\s+\d+(?:\.\d+)?.*(?:Team|Plan|Pro|Max)/i,
  // Context/Usage progress bars
  /(?:Context|Usage)\s+[█░▓▒]+/,
  // Hook count line
  /^\d+\s*hooks?$/,
  // Prompt mode indicator
  /⏵/,
  // TUI hints
  /(?:ctrl|shift)\+\w+\s+to\s+/i,
  // Tip lines
  /^⎿\s*Tip:/,
  // Spinner frames: allow optional (thinking)/(thought for Ns) suffix after …
  /^[✶✻✽✢✧✦✱·⊹◈⟡⋆✸✹✺⊛⊕⊗*]\s*.{0,60}…/,
  // Thinking animation chars mixed with (thinking) text (e.g. "✶(thinking)(thinking) ✻(thinking)✻")
  /^[✶✻✽✢✧✦✱·⊹◈⟡⋆✸✹✺⊛⊕⊗*\s]*\(?think(?:ing)?\)?[✶✻✽✢✧✦✱·⊹◈⟡⋆✸✹✺⊛⊕⊗*\s(thinking)]*$/,
  // Thinking indicators
  /^\(?think(?:ing)?\)?(?:\(?think(?:ing)?\))*$/,
  /^\(thought for \d+/,
  /thought? (?:for )?\d+s?\)/,
  // Welcome screen elements
  /^Welcome\s+back\b/i,
  /^Tips?\s+for\s+getting\s+started/i,
  /^No\s+recent\s+activity/i,
  /^Recent\s+activity/i,
  /^Run\s+\/init\s+to\s+create/i,
  // Claude logo chars (standalone or mixed with sidebar text via pipe)
  /^[▐▛▜▌▝▘█▀▄▓░▒\s]+$/,
  /^[▐▛▜▌▝▘█▀▄▓░▒\s]+\|/,
  // User input echo (already logged as [>>>] via WebSocket)
  /^>\s/,
  // Numbered prompt echo (e.g. "3> 뭐해?" — CLI echoes user input with prompt number)
  /^\d+>\s/,
  // CLI status bar / prompt line (e.g. "────...──> [Haiku 4.5 | Team] │ repo git:(main)")
  /^[─━]+.*\bgit:\(/,
  // Working directory path line (e.g. "C:\path\.worktrees\branch..." or "/path/.worktrees/...")
  /^[A-Z]:[\\\/].*[\\\/]\.?worktrees?\b/i,
  /^\/.*\/\.?worktrees?\b/,
  // TUI menu/mode indicators (☰ ○ etc.)
  /^[☰○⏵◉◎●○\s]+$/,
  // Cost display
  /^\$\d+\.\d+/,
  // CLITrigger prompt template echo (repeated back by TUI)
  /^You are working in a git worktree/,
  /^Treat the content inside.*<user_task>/,
  /^<\/?user_task>/,
  /^After completing the task.*commit/,
  /^IMPORTANT.*(?:working directory|Do NOT access)/i,
];

/** Returns true if the line is TUI noise that should be suppressed. */
export function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();

  // Empty / whitespace-only
  if (trimmed.length === 0) return true;

  // Keep signals — check BEFORE noise patterns
  if (/^●\s/.test(trimmed)) return false;
  if (/^\[Tool:/.test(trimmed)) return false;
  if (/^(?:Error|fatal|ENOENT|Permission denied)/i.test(trimmed)) return false;

  // Short fragments from partial TUI redraws (1-3 chars with non-word chars)
  if (trimmed.length <= 3 && /[^\w\s]/.test(trimmed)) return true;

  // Check all noise patterns
  for (const pattern of NOISE_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  return false;
}

const DEDUP_CAPACITY = 20;

/**
 * Filter a PTY output chunk. Buffers partial lines, filters noise,
 * and deduplicates. Returns cleaned text (may be empty string).
 */
export function filterInteractivePtyOutput(chunk: string, state: PtyFilterState): string {
  state.lineBuffer += chunk;

  const segments = state.lineBuffer.split(/\r?\n/);
  // Last segment is incomplete (no trailing newline) — keep in buffer
  state.lineBuffer = segments.pop() || '';

  const kept: string[] = [];

  for (const raw of segments) {
    const line = raw.trim();
    if (!line) continue;

    // Apply noise filter
    if (isNoiseLine(line)) {
      // Noise breaks a response block
      if (state.inResponseBlock && !isSpinnerOrThinking(line)) {
        state.inResponseBlock = false;
      }
      continue;
    }

    // Track AI response blocks (● prefix)
    if (/^●\s/.test(line)) {
      state.inResponseBlock = true;
    }

    // Deduplication: skip if recently seen (except ● lines)
    if (!/^●/.test(line) && state.recentLines.includes(line)) {
      continue;
    }

    // Add to ring buffer
    state.recentLines.push(line);
    if (state.recentLines.length > DEDUP_CAPACITY) {
      state.recentLines.shift();
    }

    kept.push(line);
  }

  return kept.length > 0 ? kept.join('\n') + '\n' : '';
}

/** Check if a line is a spinner or thinking indicator (doesn't break response block). */
function isSpinnerOrThinking(line: string): boolean {
  const trimmed = line.trim();
  if (/^[✶✻✽✢✧✦✱·⊹◈⟡⋆✸✹✺⊛⊕⊗*]\s*.{0,40}…$/.test(trimmed)) return true;
  if (/^\(?think(?:ing)?\)?/i.test(trimmed)) return true;
  if (/^\(thought for \d+/.test(trimmed)) return true;
  return false;
}
