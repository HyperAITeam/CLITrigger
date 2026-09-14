import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { claudeProjectSlug, claudeConversationPath, hasClaudeConversation } from '../claude-conversations.js';

describe('claudeProjectSlug', () => {
  it('replaces every non-alphanumeric character with a dash', () => {
    expect(claudeProjectSlug('F:\\OSgoodYZ\\CLITrigger')).toBe('F--OSgoodYZ-CLITrigger');
    expect(claudeProjectSlug('C:\\Users\\osgood')).toBe('C--Users-osgood');
    expect(claudeProjectSlug('/home/u/my.proj')).toBe('-home-u-my-proj');
  });
});

describe('claudeConversationPath', () => {
  it('points into ~/.claude/projects/<slug>/<id>.jsonl', () => {
    const id = randomUUID();
    const normalized = claudeConversationPath(tmpdir(), id).split('\\').join('/');
    expect(normalized).toMatch(new RegExp(`/\\.claude/projects/[A-Za-z0-9-]+/${id}\\.jsonl$`));
  });
});

describe('hasClaudeConversation', () => {
  it('is false for a session id that was never persisted', () => {
    expect(hasClaudeConversation(tmpdir(), randomUUID())).toBe(false);
  });
});
