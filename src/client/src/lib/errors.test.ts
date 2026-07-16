import { getErrorMessage } from './errors';
import { describe, expect, it } from 'vitest';

describe('getErrorMessage', () => {
  it('uses an Error message when available', () => {
    expect(getErrorMessage(new Error('Request failed'), 'Fallback')).toBe('Request failed');
  });

  it('uses the fallback for empty or unknown values', () => {
    expect(getErrorMessage(new Error(''), 'Fallback')).toBe('Fallback');
    expect(getErrorMessage({ reason: 'unknown' }, 'Fallback')).toBe('Fallback');
  });
});
