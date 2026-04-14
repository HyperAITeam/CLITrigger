import { describe, expect, it } from 'vitest';
import { getAdapter, supportsInteractiveMode } from '../cli-adapters.js';

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
    expect(args).toEqual(['exec', '--dangerously-bypass-approvals-and-sandbox', '--model', 'o3', '--color=never']);
  });

  it('adds headless flag for Gemini in non-interactive mode', () => {
    const adapter = getAdapter('gemini');
    const args = adapter.buildArgs({
      mode: 'headless',
      prompt: 'Fix the login disclaimer',
    });

    expect(args).toEqual(['--yolo', '--prompt=']);
  });

  it('sends Codex prompts over stdin', () => {
    const adapter = getAdapter('codex');

    expect(adapter.needsStdin('headless')).toBe(true);
    expect(adapter.formatStdinPrompt('hello')).toBe('hello\n');
  });

  it('only enables interactive mode for Claude', () => {
    expect(supportsInteractiveMode('claude')).toBe(true);
    expect(supportsInteractiveMode('gemini')).toBe(false);
    expect(supportsInteractiveMode('codex')).toBe(false);
  });
});
