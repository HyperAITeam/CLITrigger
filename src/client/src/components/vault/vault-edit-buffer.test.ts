import { describe, it, expect, vi } from 'vitest';
import { editBuffer } from './vault-edit-buffer';

describe('editBuffer', () => {
  it('reflects set() in getSnapshot and notifies subscribers', () => {
    const cb = vi.fn();
    const unsub = editBuffer.subscribe(cb);
    editBuffer.set({ active: true, path: 'a.md', content: '# hi' });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(editBuffer.getSnapshot()).toEqual({ active: true, path: 'a.md', content: '# hi' });
    expect(editBuffer.getActive()).toBe(true); // boolean primitive → useSyncExternalStore bail-out
    unsub();
    editBuffer.set({ active: false, path: null, content: '' });
    expect(cb).toHaveBeenCalledTimes(1); // no longer notified after unsub
  });

  it('getSnapshot returns a stable reference until the next set()', () => {
    editBuffer.set({ active: true, path: 'x', content: 'y' });
    expect(editBuffer.getSnapshot()).toBe(editBuffer.getSnapshot()); // required to avoid render loop
    editBuffer.clear();
    expect(editBuffer.getActive()).toBe(false);
  });
});
