import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getCliUsage } from '../cli-usage.js';

describe('cli-usage', () => {
  it('reads the last Codex rate_limits from the newest rollout, skipping a cut-off line', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-usage-'));
    process.env.CLAUDE_CONFIG_DIR = root; // no .credentials.json → claude null
    process.env.CODEX_HOME = root;
    fs.mkdirSync(path.join(root, 'sessions', '2026', '11', '23'), { recursive: true });
    fs.writeFileSync(path.join(root, 'sessions', '2026', '11', '23', 'rollout-old.jsonl'), '');
    const day = path.join(root, 'sessions', '2026', '11', '24');
    fs.mkdirSync(day, { recursive: true });
    const event = (percent: number) => JSON.stringify({
      timestamp: '2026-11-24T01:00:00.000Z',
      payload: { type: 'token_count', rate_limits: {
        primary: { used_percent: percent, window_minutes: 300, resets_at: 1795445425 },
        secondary: { used_percent: 12, window_minutes: 10080, resets_at: 1795674544 },
      } },
    });
    fs.writeFileSync(path.join(day, 'rollout-a.jsonl'), [
      '"rate_limits":{ cut-off partial line',
      event(40),
      event(66),
      JSON.stringify({ payload: { type: 'agent_message' } }),
    ].join('\n'));

    const usage = await getCliUsage();
    expect(usage.claude).toBeNull();
    expect(usage.codex).toEqual({
      fiveHour: { percent: 66, resetsAt: 1795445425 },
      weekly: { percent: 12, resetsAt: 1795674544 },
      updatedAt: Date.parse('2026-11-24T01:00:00.000Z'),
    });
    fs.rmSync(root, { recursive: true, force: true });
  });
});
