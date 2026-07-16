import { describe, expect, it } from 'vitest';
import { getSessionTheme, setSessionTheme } from './useSessionTheme';
import { getSessionFontSize, setSessionFontSize } from './useSessionFontSize';

// Popout windows are separate JS contexts — a change made there reaches this
// window only via the 'storage' event. These tests simulate that: populate the
// module cache (stale state), write localStorage directly (as another window
// would), then dispatch the event and expect the cache to be refreshed.

describe('cross-window storage sync', () => {
  it('refreshes a cached session theme when another window writes it', () => {
    setSessionTheme('s1', { presetId: 'default' });
    localStorage.setItem('sessionTheme:s1', JSON.stringify({ presetId: 'claude' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'sessionTheme:s1', storageArea: localStorage }));
    expect(getSessionTheme('s1').presetId).toBe('claude');
  });

  it('refreshes a cached session font size when another window writes it', () => {
    setSessionFontSize('s1', 14);
    localStorage.setItem('sessionFontSize:s1', '18');
    window.dispatchEvent(new StorageEvent('storage', { key: 'sessionFontSize:s1', storageArea: localStorage }));
    expect(getSessionFontSize('s1')).toBe(18);
  });
});
