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
  /** Matches output the agent emits only while generating or running a tool. */
  working: RegExp;
  /** Matches a dialog that needs a human answer. Wins over `working` within one chunk. */
  blocked: RegExp;
}

export interface DetectorState {
  state: AgentState;
  lastWorkingAt: number;
  reason: string;
}

// ponytail: calibration knob; raise if the Ink renderer pauses >1s mid-turn and flaps working→blocked
export const QUIET_MS = 1000;

export function initialState(hints: AgentStateHints | undefined, nowMs: number): DetectorState {
  // ponytail: idle only at spawn; every later prompt-wait is reported as blocked
  return { state: hints ? 'idle' : 'unknown', lastWorkingAt: nowMs, reason: 'spawn' };
}

/** Pure transition. `chunk === null` is a quiet-timer tick. */
export function step(prev: DetectorState, chunk: string | null, nowMs: number, hints: AgentStateHints): DetectorState {
  if (prev.state === 'done') return prev;
  if (chunk === null) {
    if (prev.state === 'working' && nowMs - prev.lastWorkingAt >= QUIET_MS) {
      return { state: 'blocked', lastWorkingAt: prev.lastWorkingAt, reason: 'quiet' };
    }
    return prev;
  }
  const clean = stripAnsi(chunk);
  if (hints.blocked.test(clean)) return { state: 'blocked', lastWorkingAt: prev.lastWorkingAt, reason: 'dialog' };
  if (hints.working.test(clean)) return { state: 'working', lastWorkingAt: nowMs, reason: 'spinner' };
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
    this.apply(step(this.current, chunk, Date.now(), this.hints));
  }

  exit(reason: 'exit' | 'stopped'): void {
    this.clearTimer();
    this.apply({ state: 'done', lastWorkingAt: this.current.lastWorkingAt, reason });
  }

  private apply(next: DetectorState): void {
    const changed = next.state !== this.current.state;
    this.current = next;
    if (next.state === 'working') this.armTimer();
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
