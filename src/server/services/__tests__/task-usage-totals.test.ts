import { describe, it, expect } from 'vitest';
import { taskUsageTotals } from '../orchestrator.js';
import type { TokenUsage } from '../log-streamer.js';

const round: TokenUsage = {
  input_tokens: 10, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 700,
  total_cost: 1.5, duration_ms: null, num_turns: null, context_window: null,
};

describe('taskUsageTotals', () => {
  it('counts cache tokens and replaces the totals on round 1', () => {
    expect(taskUsageTotals({ total_cost_usd: 9, total_tokens: 999 }, round, 1)).toEqual({ total_cost_usd: 1.5, total_tokens: 5910 });
  });

  it('adds to the totals on later rounds (loop, Continue)', () => {
    expect(taskUsageTotals({ total_cost_usd: 2, total_tokens: 90 }, round, 2)).toEqual({ total_cost_usd: 3.5, total_tokens: 6000 });
  });
});
