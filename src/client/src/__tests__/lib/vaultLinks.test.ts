import { describe, it, expect } from 'vitest';
import { collectLinkedPaths, linkAliasFromFolder } from '../../lib/vaultLinks';

describe('linkAliasFromFolder', () => {
  it('uses the last folder name, replacing characters the server rejects', () => {
    expect(linkAliasFromFolder('D:\\공용 문서\\팀 위키 (2026)\\')).toBe('팀-위키-2026-');
    expect(linkAliasFromFolder('/home/user/shared_docs.v2')).toBe('shared_docs.v2');
  });
});

describe('collectLinkedPaths', () => {
  it('follows transitive outgoing links, excluding the start node', () => {
    const edges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }];
    expect(collectLinkedPaths(edges, 'A')).toEqual(['B', 'C']);
  });

  it('terminates on cycles', () => {
    const edges = [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }];
    expect(collectLinkedPaths(edges, 'A')).toEqual(['B']);
  });

  it('returns [] when the start node has no outgoing links', () => {
    expect(collectLinkedPaths([{ from: 'X', to: 'Y' }], 'A')).toEqual([]);
  });
});
