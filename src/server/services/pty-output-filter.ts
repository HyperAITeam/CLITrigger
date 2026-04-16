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

const SPINNER_CHARS = '✶✻✽✢✧✦✱·⊹◈⟡⋆✸✹✺⊛⊕⊗*';

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
  // Ink status sub-line (⎿ followed by short status word: Tip, Hmm, Loading, etc.)
  /^⎿\s*(?:Tip|Hmm|Loading|Processing|Running|Waiting|Thinking|Done|Working)/i,
  // Ink short status line on its own (Hmm…, Loading…)
  /^(?:Hmm|Thinking|Loading|Processing|Running|Waiting|Working)\s*…?$/i,
  // Spinner frames: allow optional (thinking)/(thought for Ns) suffix after …
  /^[✶✻✽✢✧✦✱·⊹◈⟡⋆✸✹✺⊛⊕⊗*]\s*.{0,60}…/,
  // Thinking animation chars mixed with (thinking) text (e.g. "✶(thinking)(thinking) ✻(thinking)✻")
  /^[✶✻✽✢✧✦✱·⊹◈⟡⋆✸✹✺⊛⊕⊗*\s]*\(?think(?:ing)?\)?[✶✻✽✢✧✦✱·⊹◈⟡⋆✸✹✺⊛⊕⊗*\s(thinking)]*$/,
  // Thinking indicators
  /^\(?think(?:ing)?\)?(?:\s*\(?think(?:ing)?\)?)*$/,
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

/**
 * Detects lines that are animation-frame collisions — typically produced when
 * multiple spinner refreshes concatenate without a real line break. Such lines
 * are composed almost entirely of spinner chars, "(thinking)" markers,
 * whitespace, `…`, and short character fragments.
 */
function isAnimationCollision(line: string): boolean {
  // Strip all pure-noise tokens and see what meaningful content remains.
  const stripped = line
    .replace(/\(thought for \d+s?\)/gi, '')
    .replace(/\(?think(?:ing)?\)?/gi, '')
    .replace(new RegExp(`[${SPINNER_CHARS}…\\s]`, 'g'), '');
  // If nothing or only punctuation remains, it's pure noise.
  if (stripped.length === 0) return true;
  // Keep lines with real response signals.
  if (/[●\[\]]/.test(line)) return false;
  // Multiple "(thinking)" occurrences on one line = animation collision.
  const thinkingCount = (line.match(/\(thinking\)/gi) || []).length;
  if (thinkingCount >= 2) return true;
  // Three or more spinner chars interspersed with text = collision.
  const spinnerCount = (line.match(new RegExp(`[${SPINNER_CHARS}]`, 'g')) || []).length;
  if (spinnerCount >= 3) return true;
  // Single leading spinner char followed by fragmented short-word content
  // (e.g. "✶ r P ec", "* t i a n" — spinner frames where cursor repositioning
  // became spaces). Require ≥3 tokens, all ≤3 chars, to avoid catching real
  // markdown bullets like "* First item".
  const spinnerLeadMatch = line.match(
    new RegExp(`^[${SPINNER_CHARS}]\\s+(.+)$`),
  );
  if (spinnerLeadMatch) {
    const tokens = spinnerLeadMatch[1].trim().split(/\s+/);
    if (tokens.length >= 3 && tokens.every((t) => t.length <= 3)) return true;
    // Shorter fragments (≥2 tokens) need a stricter bound to avoid
    // swallowing real markdown bullets like "* Go now".
    if (tokens.length >= 2 && tokens.every((t) => t.length <= 2)) return true;
  }
  return false;
}

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

  // Detect concatenated animation frames (multiple spinners / (thinking) on one line)
  if (isAnimationCollision(trimmed)) return true;

  return false;
}

const DEDUP_CAPACITY = 20;

/**
 * Filter a PTY output chunk. Buffers partial lines, filters noise,
 * and deduplicates. Returns cleaned text (may be empty string).
 */
export function filterInteractivePtyOutput(chunk: string, state: PtyFilterState): string {
  state.lineBuffer += chunk;

  // Split on any line boundary — including bare \r, which TUI animations use
  // to overwrite the current line. Without this, spinner frames concatenate
  // into one long line and bypass the per-line noise filter.
  const segments = state.lineBuffer.split(/\r\n|\r|\n/);
  // Last segment is incomplete (no trailing separator) — keep in buffer
  state.lineBuffer = segments.pop() || '';

  // Runaway buffer guard: if no line break has arrived in a very long time,
  // force-process the buffer so we don't accumulate indefinitely.
  if (state.lineBuffer.length > 4096) {
    segments.push(state.lineBuffer);
    state.lineBuffer = '';
  }

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
