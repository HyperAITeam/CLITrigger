import { describe, it, expect, vi, afterEach } from 'vitest';
import { step, initialState, QUIET_MS, AgentStateTracker, type DetectorState } from '../agent-state-detector.js';
import { getAdapter } from '../cli-adapters.js';

const hints = getAdapter('claude').agentStateHints!;
const at = (state: DetectorState['state'], lastWorkingAt = 0): DetectorState => ({ state, lastWorkingAt, reason: 'test' });

describe('agent-state-detector', () => {
  describe('step', () => {
    it('spinner wrapped in ANSI → working/spinner', () => {
      const next = step(at('idle'), '\x1b[2K\x1b[G✻ Thinking… (esc to interrupt)', 100, hints);
      expect(next.state).toBe('working');
      expect(next.reason).toBe('spinner');
      expect(next.lastWorkingAt).toBe(100);
    });

    it('"esc to interrupt" alone → working', () => {
      expect(step(at('idle'), 'Running tests… (esc to interrupt)', 1, hints).state).toBe('working');
    });

    it('glyph-only repaint frames (Claude Code 2.1.x) → working', () => {
      // Real frames: cursor-positioned single glyph, sometimes with recoloured letters of the verb.
      expect(step(at('idle'), '\x1b[?25l\x1b[38;2;215;119;87m\x1b[31;1H✻\x1b[34;3H\x1b[?25h\x1b[m', 1, hints).state).toBe('working');
      expect(step(at('idle'), '\x1b[31;1H✽\x1b[38;2;235;159;127m\x1b[5Cd\x1b[38;2;215;119;87m\x1b[2Cg\x1b[34;3H', 1, hints).state).toBe('working');
      expect(step(at('idle'), '\x1b[31;1H*\x1b[34;3H', 1, hints).state).toBe('working');
    });

    it('status/banner lines with "·" and "…" are not spinner paints', () => {
      const prev = at('idle');
      expect(step(prev, '⚠ Transcript saving is off — inherited marker · restart with CLAUDE_CODE_FORCE_SESSION_PE…', 1, hints)).toBe(prev);
      expect(step(prev, '▝▜██████▀ Fable 5.1 with xhigh effort · Claude Team', 1, hints)).toBe(prev);
    });

    it('response bullet while idle → unchanged (● is not a spinner glyph)', () => {
      const prev = at('idle');
      expect(step(prev, '● Here is the answer…', 1, hints)).toBe(prev);
    });

    it('markdown bullet while blocked → unchanged (ASCII * excluded)', () => {
      const prev = at('blocked');
      expect(step(prev, '* item one…', 1, hints)).toBe(prev);
    });

    it('dialog from working → blocked/dialog', () => {
      const next = step(at('working', 5), 'Do you want to proceed?\n❯ 1. Yes', 10, hints);
      expect(next.state).toBe('blocked');
      expect(next.reason).toBe('dialog');
    });

    it('spinner and dialog in one chunk → blocked wins', () => {
      const next = step(at('idle'), '✻ Thinking… (esc to interrupt)\nWould you like to proceed?', 1, hints);
      expect(next.state).toBe('blocked');
    });

    it('quiet tick flips working → blocked only after QUIET_MS', () => {
      const working = at('working', 0);
      expect(step(working, null, QUIET_MS - 1, hints)).toBe(working);
      const next = step(working, null, QUIET_MS, hints);
      expect(next.state).toBe('blocked');
      expect(next.reason).toBe('quiet');
    });

    it('quiet tick while blocked or idle → unchanged', () => {
      const blocked = at('blocked');
      const idle = at('idle');
      expect(step(blocked, null, 99_999, hints)).toBe(blocked);
      expect(step(idle, null, 99_999, hints)).toBe(idle);
    });

    it('done is terminal', () => {
      const done = at('done');
      expect(step(done, '✻ Thinking… (esc to interrupt)', 1, hints)).toBe(done);
    });

    it('initialState is idle with hints, unknown without', () => {
      expect(initialState(hints, 0).state).toBe('idle');
      expect(initialState(undefined, 0).state).toBe('unknown');
    });
  });

  describe('AgentStateTracker', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('emits once per transition and turns quiet working into blocked', () => {
      vi.useFakeTimers();
      const emits: Array<[string, string]> = [];
      const tracker = new AgentStateTracker(hints, (s, r) => emits.push([s, r]));
      expect(tracker.state).toBe('idle');

      for (let i = 0; i < 6; i++) {
        tracker.feed('✻ Thinking… (esc to interrupt)');
        vi.advanceTimersByTime(100);
      }
      expect(emits).toEqual([['working', 'spinner']]);

      vi.advanceTimersByTime(QUIET_MS);
      expect(emits).toEqual([['working', 'spinner'], ['blocked', 'quiet']]);
      expect(tracker.state).toBe('blocked');

      tracker.exit('exit');
      tracker.exit('exit');
      expect(emits).toEqual([['working', 'spinner'], ['blocked', 'quiet'], ['done', 'exit']]);
    });

    it('without hints stays unknown until exit', () => {
      const emits: string[] = [];
      const tracker = new AgentStateTracker(undefined, (s) => emits.push(s));
      tracker.feed('✻ Thinking… (esc to interrupt)');
      expect(tracker.state).toBe('unknown');
      expect(emits).toEqual([]);
      tracker.exit('stopped');
      expect(emits).toEqual(['done']);
    });
  });
});
