import { existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

// Claude Code keeps one conversation per ~/.claude/projects/<cwd slug>/<sessionId>.jsonl;
// the slug is the cwd with every non-alphanumeric character replaced by '-'
// (F:\OSgoodYZ\CLITrigger → F--OSgoodYZ-CLITrigger). The file is created on the
// first message, so a session that was stopped before any message has nothing
// to resume.
export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

export function claudeConversationPath(cwd: string, sessionId: string): string {
  // ponytail: path.resolve normalizes slashes and trailing separators; a drive
  // letter whose case differs from Claude's process.cwd() is not handled.
  return path.join(homedir(), '.claude', 'projects', claudeProjectSlug(path.resolve(cwd)), `${sessionId}.jsonl`);
}

export function hasClaudeConversation(cwd: string, sessionId: string): boolean {
  return existsSync(claudeConversationPath(cwd, sessionId));
}
