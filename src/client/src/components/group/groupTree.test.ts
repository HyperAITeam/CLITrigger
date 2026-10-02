import { describe, it, expect } from 'vitest';
import { dedupeGroups, insertSessionsAt, makeStack, type LayoutNode } from './groupTree';

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

describe('dedupeGroups', () => {
  const group = (id: string, tabs: string[]) => ({
    id,
    root: makeStack(tabs, tabs[0]),
    colors: Object.fromEntries(tabs.map(t => [t, 'c'])),
    intents: Object.fromEntries(tabs.map(t => [t, { intent: 'open', nonce: 0 }])),
  });

  it('keeps the first occurrence and prunes later copies with their colors/intents', () => {
    const out = dedupeGroups([group('g1', ['a', 'b']), group('g2', ['b', 'c'])]);
    expect(out.map(g => g.id)).toEqual(['g1', 'g2']);
    expect(out[1].root).toEqual({ kind: 'stack', tabs: ['c'], activeTab: 'c' });
    expect(Object.keys(out[1].colors)).toEqual(['c']);
    expect(Object.keys(out[1].intents)).toEqual(['c']);
  });

  it('drops a group whose every session is already held elsewhere', () => {
    const out = dedupeGroups([group('g1', ['a']), group('g2', ['a'])]);
    expect(out.map(g => g.id)).toEqual(['g1']);
  });

  it('returns groups untouched when there is no overlap', () => {
    const input = [group('g1', ['a']), group('g2', ['b'])];
    expect(dedupeGroups(input)).toEqual(input);
  });
});
