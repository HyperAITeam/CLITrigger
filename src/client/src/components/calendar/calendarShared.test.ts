import { describe, it, expect } from 'vitest';
import { diffDays, resolveDrag } from './calendarShared';

describe('diffDays', () => {
  it('counts whole days between date keys', () => {
    expect(diffDays('2026-07-07', '2026-07-10')).toBe(3);
    expect(diffDays('2026-07-10', '2026-07-07')).toBe(-3);
    expect(diffDays('2026-07-07', '2026-07-07')).toBe(0);
    expect(diffDays('2026-07-31', '2026-08-01')).toBe(1); // crosses month
  });
});

describe('resolveDrag', () => {
  const orig = { startKey: '2026-07-07', endKey: '2026-07-09' };

  it('resize-end extends the end, clamped to not precede start', () => {
    expect(resolveDrag('resize-end', orig, '2026-07-12', '2026-07-07')).toEqual({ startKey: '2026-07-07', endKey: '2026-07-12' });
    // dragging the end before the start collapses to a single day
    expect(resolveDrag('resize-end', orig, '2026-07-05', '2026-07-09')).toEqual({ startKey: '2026-07-07', endKey: '2026-07-07' });
  });

  it('resize-start moves the start, clamped to not pass the end', () => {
    expect(resolveDrag('resize-start', orig, '2026-07-05', '2026-07-07')).toEqual({ startKey: '2026-07-05', endKey: '2026-07-09' });
    expect(resolveDrag('resize-start', orig, '2026-07-15', '2026-07-07')).toEqual({ startKey: '2026-07-09', endKey: '2026-07-09' });
  });

  it('move shifts both ends by the grabbed→hovered delta', () => {
    expect(resolveDrag('move', orig, '2026-07-10', '2026-07-07')).toEqual({ startKey: '2026-07-10', endKey: '2026-07-12' }); // +3
    expect(resolveDrag('move', orig, '2026-07-05', '2026-07-07')).toEqual({ startKey: '2026-07-05', endKey: '2026-07-07' }); // -2
  });
});
