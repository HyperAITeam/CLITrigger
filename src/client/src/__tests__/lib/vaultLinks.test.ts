import { describe, it, expect } from 'vitest';
import { collectLinkedPaths } from '../../lib/vaultLinks';

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
