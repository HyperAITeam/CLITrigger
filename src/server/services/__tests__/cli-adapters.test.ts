import { describe, expect, it } from 'vitest';
import { getAdapter, supportsInteractiveMode, parseHelpForModels } from '../cli-adapters.js';

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

  it('uses --resume latest for Gemini when continuing a session', () => {
    const adapter = getAdapter('gemini');
    const args = adapter.buildArgs({
      mode: 'headless',
      prompt: 'Follow up',
      continueSession: true,
    });

    expect(args).toEqual(['--yolo', '--prompt=', '--resume', 'latest']);
  });

  it('omits exec subcommand for Codex in interactive mode', () => {
    const adapter = getAdapter('codex');
    const args = adapter.buildArgs({
      mode: 'interactive',
      prompt: '',
      model: 'o3',
      sandboxMode: 'permissive',
    });

    expect(args).not.toContain('exec');
    expect(args).toEqual(['--dangerously-bypass-approvals-and-sandbox', '--model', 'o3']);
  });

  it('uses exec resume --last for Codex when continuing a session', () => {
    const adapter = getAdapter('codex');
    const args = adapter.buildArgs({
      mode: 'headless',
      prompt: 'Follow up',
      model: 'o3',
      continueSession: true,
    });

    expect(args).toEqual(['exec', 'resume', '--last', '--dangerously-bypass-approvals-and-sandbox', '--model', 'o3']);
  });

  it('sends Codex prompts over stdin', () => {
    const adapter = getAdapter('codex');

    expect(adapter.needsStdin('headless')).toBe(true);
    expect(adapter.formatStdinPrompt('hello')).toBe('hello\n');
  });

  it('enables interactive mode for all CLI tools', () => {
    expect(supportsInteractiveMode('claude')).toBe(true);
    expect(supportsInteractiveMode('gemini')).toBe(true);
    expect(supportsInteractiveMode('codex')).toBe(true);
  });

  describe('parseHelpForModels', () => {
    it('extracts claude model ids from help with --model flag', () => {
      const help = [
        'Usage: claude [options]',
        '',
        'Options:',
        '  --model <name>      Model to use',
        '                      Choices: claude-opus-4-7, claude-sonnet-4-6,',
        '                      claude-haiku-4-5',
      ].join('\n');
      const models = parseHelpForModels(help);
      const values = models.map((m) => m.value).sort();
      expect(values).toEqual(['claude-haiku-4-5', 'claude-opus-4-7', 'claude-sonnet-4-6']);
    });

    it('extracts codex model ids with mixed formats', () => {
      const help = [
        'codex exec [options]',
        '  --model   <name>  e.g. gpt-4.1, gpt-4.1-mini, o3, o4-mini',
      ].join('\n');
      const models = parseHelpForModels(help);
      const values = models.map((m) => m.value).sort();
      expect(values).toContain('gpt-4.1');
      expect(values).toContain('gpt-4.1-mini');
      expect(values).toContain('o3');
      expect(values).toContain('o4-mini');
    });

    it('returns empty when --model flag is absent', () => {
      const help = 'Usage: foo [options]\n  --color <when>  Colorize output';
      expect(parseHelpForModels(help)).toEqual([]);
    });

    it('returns empty for non-string input', () => {
      expect(parseHelpForModels('')).toEqual([]);
      // @ts-expect-error intentional
      expect(parseHelpForModels(null)).toEqual([]);
    });

    it('deduplicates repeated ids', () => {
      const help = '--model  gpt-4.1 / gpt-4.1 / gpt-4.1';
      const models = parseHelpForModels(help);
      expect(models.length).toBe(1);
      expect(models[0].value).toBe('gpt-4.1');
    });
  });
});
