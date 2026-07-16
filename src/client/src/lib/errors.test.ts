import { getErrorMessage, isResizeObserverLoopError } from './errors';
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

describe('isResizeObserverLoopError', () => {
  it('recognizes both browser ResizeObserver loop diagnostics', () => {
    expect(isResizeObserverLoopError('ResizeObserver loop limit exceeded')).toBe(true);
    expect(isResizeObserverLoopError(new Error('ResizeObserver loop completed with undelivered notifications.'))).toBe(true);
  });

  it('does not suppress real errors', () => {
    expect(isResizeObserverLoopError(new Error('ResizeObserver callback crashed'))).toBe(false);
  });
});
