import type { HarnessSkill } from './types.js';

// Porting Claude project config to Antigravity/Codex: both targets read the
// same AGENTS.md at the project root and have no native skill/hook mechanism,
// so the port inlines CLAUDE.md + .claude/skills/ into AGENTS.md as a
// marker-delimited block. Hooks are NOT ported — the target CLIs cannot
// execute them. Re-porting replaces the block, preserving user content
// outside the markers.

export const PORT_BLOCK_START = '<!-- clitrigger:port-from-claude:start -->';
export const PORT_BLOCK_END = '<!-- clitrigger:port-from-claude:end -->';

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

export function buildPortedBlock(memory: string, skills: HarnessSkill[]): string {
  const parts: string[] = [
    PORT_BLOCK_START,
    '<!-- Auto-generated from CLAUDE.md and .claude/skills/. Edits inside this block are overwritten on re-port. -->',
  ];
  if (memory.trim()) parts.push(memory.trim());
  for (const skill of skills) {
    const body = stripFrontmatter(skill.content).trim();
    if (!body) continue;
    const heading = skill.description
      ? `## Skill: ${skill.name}\n\n${skill.description}`
      : `## Skill: ${skill.name}`;
    parts.push(heading, body);
  }
  parts.push(PORT_BLOCK_END);
  return parts.join('\n\n');
}

export function mergePortedMemory(existing: string, block: string): string {
  const start = existing.indexOf(PORT_BLOCK_START);
  const end = existing.indexOf(PORT_BLOCK_END);
  if (start !== -1 && end > start) {
    return existing.slice(0, start) + block + existing.slice(end + PORT_BLOCK_END.length);
  }
  if (!existing.trim()) return block + '\n';
  return existing.trimEnd() + '\n\n' + block + '\n';
}
