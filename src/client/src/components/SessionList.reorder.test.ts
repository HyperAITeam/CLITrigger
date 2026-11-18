import { describe, it, expect } from 'vitest';
import { moveBlock } from './SessionList';

// Blocks: a single row, a two-session window group, another single row.
const blocks = [['a'], ['b1', 'b2'], ['c']];

describe('moveBlock', () => {
  it('moves a block down past later blocks', () => {
    expect(moveBlock(blocks, 0, 2)).toEqual(['b1', 'b2', 'a', 'c']);
    expect(moveBlock(blocks, 0, 3)).toEqual(['b1', 'b2', 'c', 'a']);
  });

  it('moves a block up, keeping a window group together', () => {
    expect(moveBlock(blocks, 2, 0)).toEqual(['c', 'a', 'b1', 'b2']);
    expect(moveBlock(blocks, 1, 0)).toEqual(['b1', 'b2', 'a', 'c']);
    expect(moveBlock(blocks, 1, 3)).toEqual(['a', 'c', 'b1', 'b2']);
  });

  it('returns null for the gaps right around the source block', () => {
    expect(moveBlock(blocks, 1, 1)).toBeNull();
    expect(moveBlock(blocks, 1, 2)).toBeNull();
  });
});
