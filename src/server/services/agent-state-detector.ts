/**
 * Heuristic agent-state detector for interactive PTY sessions.
 *
 * Classifies raw terminal output into working / blocked / idle / done so the
 * UI and MCP clients know when an agent needs a human — Herdr-style sidebar
 * semantics with zero configuration and no CLI hooks. Interactive sessions
 * run with permissions skipped, so the realistic `blocked` triggers are: the
 * turn finished (prompt waiting), AskUserQuestion, and plan-approval dialogs.
 */
import { stripAnsi } from './pty-output-filter.js';

export type AgentState = 'working' | 'blocked' | 'idle' | 'done' | 'unknown';

export interface AgentStateHints {
  /** Matches output the agent emits only while generating or running a tool. Fallback when no title rule has matched yet. */
  working: RegExp;
  /** Matches a dialog that needs a human answer. Wins over everything else within one chunk. */
  blocked: RegExp;
  /**
   * Terminal-title (OSC 0/2) rules, tested against the last title set in a
   * chunk. Same idea as herdr's `osc_title_*` manifest rules: the CLI reports
   * its own turn boundaries here, so once a title has matched it is the
   * authority — screen `working` rules and the quiet timer are switched off.
   */
  title?: { working: RegExp; idle: RegExp };
}

export interface DetectorState {
  state: AgentState;
  lastWorkingAt: number;
  reason: string;
  /** A `title` rule matched at least once for this PTY (see AgentStateHints.title). */
  titleSeen: boolean;
}

const OSC_TITLE = /\x1b\](?:0|2);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

function lastTitle(chunk: string): string | null {
  let title: string | null = null;
  for (const match of chunk.matchAll(OSC_TITLE)) title = match[1];
  return title;
}

// ponytail: calibration knob; raise if the Ink renderer pauses >1s mid-turn and flaps working→blocked
export const QUIET_MS = 1000;

export function initialState(hints: AgentStateHints | undefined, nowMs: number): DetectorState {
  // ponytail: idle only at spawn; every later prompt-wait is reported as blocked
  return { state: hints ? 'idle' : 'unknown', lastWorkingAt: nowMs, reason: 'spawn', titleSeen: false };
}

/** Pure transition. `chunk === null` is a quiet-timer tick. */
export function step(prev: DetectorState, chunk: string | null, nowMs: number, hints: AgentStateHints): DetectorState {
  if (prev.state === 'done') return prev;
  if (chunk === null) {
    // Quiet timer only guesses for PTYs whose CLI never told us its turn boundaries.
    if (!prev.titleSeen && prev.state === 'working' && nowMs - prev.lastWorkingAt >= QUIET_MS) {
      return { ...prev, state: 'blocked', reason: 'quiet' };
    }
    return prev;
  }
  const clean = stripAnsi(chunk);
  if (hints.blocked.test(clean)) return { ...prev, state: 'blocked', reason: 'dialog' };
  const title = hints.title ? lastTitle(chunk) : null;
  if (title !== null && hints.title) {
    if (hints.title.working.test(title)) return { state: 'working', lastWorkingAt: nowMs, reason: 'title', titleSeen: true };
    if (hints.title.idle.test(title)) {
      // Idle title while not working (startup "✳ Claude Code") is not news — only a finished turn is.
      return prev.state === 'working'
        ? { ...prev, state: 'blocked', reason: 'title', titleSeen: true }
        : { ...prev, titleSeen: true };
    }
  }
  // Screen spinner rules: the only signal without titles; with titles they may
  // only lift a dialog block (the title stays "working" across a dialog, so it
  // cannot tell us the user answered). Never from an idle title — a summary line
  // such as "✻ Baked for 6m 45s" would otherwise stick us in working.
  if ((!prev.titleSeen || prev.reason === 'dialog') && hints.working.test(clean)) {
    return { ...prev, state: 'working', lastWorkingAt: nowMs, reason: 'spinner' };
  }
  return prev;
}

/**
 * Stateful wrapper around `step` for one PTY. Emits `onChange` only on state
 * transitions and owns the single quiet timer that turns a stalled `working`
 * into `blocked`.
 */
export class AgentStateTracker {
  private current: DetectorState;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Unterminated `ESC ]` tail of the previous chunk, so a title split by the PTY is still seen whole. */
  private carry = '';

  constructor(
    private readonly hints: AgentStateHints | undefined,
    private readonly onChange: (state: AgentState, reason: string) => void,
  ) {
    this.current = initialState(hints, Date.now());
  }

  get state(): AgentState {
    return this.current.state;
  }

  feed(chunk: string): void {
    if (!this.hints) return;
    const data = this.carry + chunk;
    // ponytail: only an unterminated OSC tail is carried over; a real VT parser if titles still get lost
    const oscStart = data.lastIndexOf('\x1b]');
    const unterminated = oscStart !== -1 && !/\x07|\x1b\\/.test(data.slice(oscStart));
    this.carry = unterminated ? data.slice(oscStart, oscStart + 256) : '';
    this.apply(step(this.current, unterminated ? data.slice(0, oscStart) : data, Date.now(), this.hints));
  }

  exit(reason: 'exit' | 'stopped'): void {
    this.clearTimer();
    this.apply({ ...this.current, state: 'done', reason });
  }

  private apply(next: DetectorState): void {
    const changed = next.state !== this.current.state;
    this.current = next;
    if (next.state === 'working' && !next.titleSeen) this.armTimer();
    else this.clearTimer();
    if (changed) this.onChange(next.state, next.reason);
  }

  /** One timer per working stretch; re-armed from the tick if output kept flowing. */
  private armTimer(): void {
    if (this.timer) return;
    const delay = Math.max(0, this.current.lastWorkingAt + QUIET_MS - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.hints) return;
      this.apply(step(this.current, null, Date.now(), this.hints));
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
