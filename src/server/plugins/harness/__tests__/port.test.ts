import { describe, it, expect } from 'vitest';
import { buildPortedBlock, mergePortedMemory, PORT_BLOCK_START, PORT_BLOCK_END } from '../port.js';
import type { HarnessSkill } from '../types.js';

function skill(name: string, content: string, description?: string): HarnessSkill {
  return { name, description, path: `.claude/skills/${name}/SKILL.md`, content };
}

describe('buildPortedBlock', () => {
  it('wraps memory and skills between markers, stripping skill frontmatter', () => {
    const block = buildPortedBlock('# Project rules\n\nUse tabs.', [
      skill('deploy', '---\nname: deploy\ndescription: Deploy the app\n---\nRun npm run deploy.', 'Deploy the app'),
    ]);
    expect(block.startsWith(PORT_BLOCK_START)).toBe(true);
    expect(block.endsWith(PORT_BLOCK_END)).toBe(true);
    expect(block).toContain('# Project rules');
    expect(block).toContain('## Skill: deploy');
    expect(block).toContain('Deploy the app');
    expect(block).toContain('Run npm run deploy.');
    expect(block).not.toContain('name: deploy');
  });

  it('skips skills whose body is empty after frontmatter removal', () => {
    const block = buildPortedBlock('memory', [skill('empty', '---\nname: empty\n---\n')]);
    expect(block).not.toContain('## Skill: empty');
  });
});

describe('mergePortedMemory', () => {
  const block = buildPortedBlock('ported content', []);

  it('returns just the block for an empty target', () => {
    expect(mergePortedMemory('', block)).toBe(block + '\n');
  });

  it('appends to existing content without touching it', () => {
    const merged = mergePortedMemory('# My AGENTS.md\n\nKeep me.\n', block);
    expect(merged.startsWith('# My AGENTS.md')).toBe(true);
    expect(merged).toContain('Keep me.');
    expect(merged).toContain(PORT_BLOCK_START);
  });

  it('replaces an existing block on re-port, preserving surrounding content', () => {
    const first = mergePortedMemory('before\n', block);
    const withSuffix = first + '\nafter\n';
    const newBlock = buildPortedBlock('updated content', []);
    const merged = mergePortedMemory(withSuffix, newBlock);
    expect(merged).toContain('before');
    expect(merged).toContain('after');
    expect(merged).toContain('updated content');
    expect(merged).not.toContain('ported content');
    expect(merged.split(PORT_BLOCK_START).length).toBe(2);
  });
});
