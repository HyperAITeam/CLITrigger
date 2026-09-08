import { describe, it, expect } from 'vitest';
import {
  dockTab,
  makeStack,
  allSessionIds,
  applyLayoutPreset,
  neighborStack,
  type LayoutNode,
  type LayoutSplit,
} from '../../components/group/groupTree';

describe('neighborStack', () => {
  const h = (children: LayoutNode[], sizes?: number[]): LayoutSplit =>
    ({ kind: 'split', orientation: 'horizontal', children, sizes: sizes ?? children.map(() => 100 / children.length) });
  const v = (children: LayoutNode[], sizes?: number[]): LayoutSplit =>
    ({ kind: 'split', orientation: 'vertical', children, sizes: sizes ?? children.map(() => 100 / children.length) });
  const s = (id: string) => makeStack([id]);

  it('moves between columns and stops at the edge', () => {
    const root = h([s('a'), s('b')]);
    expect(neighborStack(root, [0], 'right')).toEqual([1]);
    expect(neighborStack(root, [1], 'left')).toEqual([0]);
    expect(neighborStack(root, [0], 'left')).toBeNull();
    expect(neighborStack(root, [0], 'up')).toBeNull();
  });

  it('in a 2x2 grid picks the pane overlapping the source, not the first child', () => {
    const grid = v([h([s('a'), s('b')]), h([s('c'), s('d')])]);
    expect(neighborStack(grid, [1, 1], 'up')).toEqual([0, 1]);   // d → b
    expect(neighborStack(grid, [0, 0], 'down')).toEqual([1, 0]); // a → c
    expect(neighborStack(grid, [0, 1], 'right')).toBeNull();     // b is the right edge
  });

  it('climbs past a same-axis dead end to reach an outer sibling', () => {
    // H[A, V(30/70)[B, H[C, D]]]
    const root = h([s('A'), v([s('B'), h([s('C'), s('D')])], [30, 70])]);
    expect(neighborStack(root, [1, 1, 0], 'left')).toEqual([0]);      // C → A
    expect(neighborStack(root, [0], 'right')).toEqual([1, 1, 0]);     // A (centre 0.5 lands in the 70% child) → C
    expect(neighborStack(root, [1, 1, 0], 'up')).toEqual([1, 0]);     // C → B
  });

  it('returns null for a single stack root', () => {
    expect(neighborStack(makeStack(['a', 'b']), [], 'right')).toBeNull();
  });
});

describe('dockTab', () => {
  it('splits a stack by side-docking one of its own tabs', () => {
    const root = makeStack(['a', 'b'], 'a');
    const result = dockTab(root, 'a', [], 'right');
    expect(result).not.toBeNull();
    const split = result as LayoutSplit;
    expect(split.kind).toBe('split');
    expect(split.orientation).toBe('horizontal');
    expect(split.children).toHaveLength(2);
    expect(split.children[0]).toMatchObject({ kind: 'stack', tabs: ['b'] });
    expect(split.children[1]).toMatchObject({ kind: 'stack', tabs: ['a'], activeTab: 'a' });
  });

  it('uses vertical orientation for top/bottom sides', () => {
    const root = makeStack(['a', 'b'], 'a');
    const result = dockTab(root, 'b', [], 'top') as LayoutSplit;
    expect(result.orientation).toBe('vertical');
    expect(result.children[0]).toMatchObject({ kind: 'stack', tabs: ['b'] });
    expect(result.children[1]).toMatchObject({ kind: 'stack', tabs: ['a'] });
  });

  it('returns null for center dock onto the own stack', () => {
    const root = makeStack(['a', 'b'], 'a');
    expect(dockTab(root, 'a', [], 'center')).toBeNull();
  });

  it('returns null when a single-tab stack is docked onto itself', () => {
    const root = makeStack(['a'], 'a');
    expect(dockTab(root, 'a', [], 'right')).toBeNull();
  });

  it('moves a tab into another stack with center dock', () => {
    const root: LayoutNode = {
      kind: 'split',
      orientation: 'horizontal',
      children: [makeStack(['a', 'b'], 'a'), makeStack(['c'], 'c')],
      sizes: [50, 50],
    };
    const result = dockTab(root, 'a', [1], 'center') as LayoutSplit;
    expect(result.kind).toBe('split');
    expect(result.children[0]).toMatchObject({ kind: 'stack', tabs: ['b'] });
    expect(result.children[1]).toMatchObject({ kind: 'stack', tabs: ['c', 'a'], activeTab: 'a' });
  });

  it('survives the sibling-split collapse when the source stack empties', () => {
    // Removing 'a' (sole tab of the first child) collapses the root split,
    // invalidating the original dstPath [1] — the anchor recompute must
    // still find stack(b,c) and split it.
    const root: LayoutNode = {
      kind: 'split',
      orientation: 'horizontal',
      children: [makeStack(['a'], 'a'), makeStack(['b', 'c'], 'b')],
      sizes: [50, 50],
    };
    const result = dockTab(root, 'a', [1], 'bottom') as LayoutSplit;
    expect(result.kind).toBe('split');
    expect(result.orientation).toBe('vertical');
    expect(result.children[0]).toMatchObject({ kind: 'stack', tabs: ['b', 'c'] });
    expect(result.children[1]).toMatchObject({ kind: 'stack', tabs: ['a'] });
    expect(allSessionIds(result).sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns null when dstPath is not a stack', () => {
    const root = makeStack(['a', 'b'], 'a');
    expect(dockTab(root, 'a', [3], 'right')).toBeNull();
  });
});

describe('applyLayoutPreset', () => {
  const root: LayoutNode = {
    kind: 'split',
    orientation: 'horizontal',
    children: [makeStack(['a', 'b'], 'b'), makeStack(['c', 'd'], 'c')],
    sizes: [50, 50],
  };

  it('combines every session into one tab stack', () => {
    expect(applyLayoutPreset(root, 'single')).toMatchObject({
      kind: 'stack',
      tabs: ['a', 'b', 'c', 'd'],
      activeTab: 'b',
    });
  });

  it('creates two equal columns while preserving every session', () => {
    const result = applyLayoutPreset(root, 'columns') as LayoutSplit;
    expect(result.orientation).toBe('horizontal');
    expect(result.sizes).toEqual([50, 50]);
    expect(allSessionIds(result).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('creates a two-by-two grid while preserving every session', () => {
    const result = applyLayoutPreset(root, 'grid') as LayoutSplit;
    expect(result.orientation).toBe('vertical');
    expect(result.children).toHaveLength(2);
    expect(allSessionIds(result).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
