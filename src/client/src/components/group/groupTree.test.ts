import { describe, it, expect } from 'vitest';
import { insertSessionsAt, makeStack, type LayoutNode } from './groupTree';

describe('insertSessionsAt', () => {
  const root: LayoutNode = makeStack(['a', 'b'], 'a');

  it('center appends the batch as tabs and activates activeId', () => {
    const out = insertSessionsAt(root, [], 'center', ['x', 'y'], 'x');
    expect(out).toEqual({ kind: 'stack', tabs: ['a', 'b', 'x', 'y'], activeTab: 'x' });
  });

  it('a side wraps the batch in a new stack beside the target', () => {
    const out = insertSessionsAt(root, [], 'right', ['x', 'y']);
    expect(out.kind).toBe('split');
    if (out.kind !== 'split') return;
    expect(out.orientation).toBe('horizontal');
    expect(out.children[0]).toEqual({ kind: 'stack', tabs: ['a', 'b'], activeTab: 'a' });
    // No activeId → the last id is active.
    expect(out.children[1]).toEqual({ kind: 'stack', tabs: ['x', 'y'], activeTab: 'y' });
  });

  it('ignores an activeId that is not part of the batch', () => {
    const out = insertSessionsAt(root, [], 'center', ['x'], 'zzz');
    expect(out).toEqual({ kind: 'stack', tabs: ['a', 'b', 'x'], activeTab: 'x' });
  });
});
