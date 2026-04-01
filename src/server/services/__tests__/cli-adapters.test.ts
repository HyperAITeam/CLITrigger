import { describe, expect, it } from 'vitest';
import { getAdapter } from '../cli-adapters.js';

describe('cli-adapters', () => {
  it('uses non-interactive exec mode for Codex', () => {
    const adapter = getAdapter('codex');
    const args = adapter.buildArgs({
      mode: 'headless',
      prompt: 'Fix the login disclaimer',
      model: 'o3',
      extraOptions: '--color=never',
    });

    expect(adapter.requiresTty).toBeUndefined();
    expect(args).toEqual(['exec', '--full-auto', '--model', 'o3', '--color=never']);
  });

  it('sends Codex prompts over stdin', () => {
    const adapter = getAdapter('codex');

    expect(adapter.needsStdin('headless')).toBe(true);
    expect(adapter.formatStdinPrompt('hello')).toBe('hello\n');
  });
});
