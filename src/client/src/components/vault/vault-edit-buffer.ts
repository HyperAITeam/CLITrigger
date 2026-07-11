// Live edit buffer shared between the center editor (PreviewPanel, writer) and
// the right-rail "미리보기" tab (PreviewViewPanel, reader). Kept as an external
// store read via useSyncExternalStore so per-keystroke updates re-render only
// the preview panel — not VaultLayout (graph/file tree stay put).
//
// ponytail: process-level singleton. Only one Vault is open at a time, so a
// single instance is enough; make it per-VaultLayout if that ever changes.

export interface EditBufferSnapshot {
  active: boolean;      // editMode && isMarkdown — drives tab visibility
  path: string | null;
  content: string;
}

const EMPTY: EditBufferSnapshot = { active: false, path: null, content: '' };

let snap: EditBufferSnapshot = EMPTY;
const subs = new Set<() => void>();

export const editBuffer = {
  subscribe(cb: () => void) {
    subs.add(cb);
    return () => { subs.delete(cb); };
  },
  // Content subscription — returns a stable reference (new object only on set),
  // as useSyncExternalStore requires to avoid an infinite render loop.
  getSnapshot(): EditBufferSnapshot { return snap; },
  // editMode subscription — boolean primitive so subscribers bail out (no
  // re-render) while only content changes during typing.
  getActive(): boolean { return snap.active; },
  set(next: EditBufferSnapshot) {
    snap = next;
    subs.forEach((f) => f());
  },
  clear() { this.set(EMPTY); },
};
