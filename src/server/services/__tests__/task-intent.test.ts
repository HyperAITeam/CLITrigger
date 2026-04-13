import { describe, expect, it } from 'vitest';
import { validateTaskIntent } from '../task-intent.js';

describe('task-intent', () => {
  it('always returns valid', () => {
    expect(validateTaskIntent('안녕')).toEqual({ valid: true });
    expect(validateTaskIntent('hello')).toEqual({ valid: true });
    expect(validateTaskIntent('Fix the failing login test')).toEqual({ valid: true });
    expect(validateTaskIntent('')).toEqual({ valid: true });
  });
});
