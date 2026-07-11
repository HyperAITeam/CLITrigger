// Per-file unsaved-edit drafts, persisted to localStorage so switching
// projects/tabs (which unmounts the Vault editor) or opening another file
// doesn't lose in-progress work. Cleared on save and on explicit discard.

function key(projectId: string, path: string): string {
  return `vault:draft:${projectId}:${path}`;
}

export function getDraft(projectId: string, path: string): string | null {
  try { return localStorage.getItem(key(projectId, path)); } catch { return null; }
}

export function saveDraft(projectId: string, path: string, content: string): void {
  try { localStorage.setItem(key(projectId, path), content); } catch { /* quota / unavailable */ }
}

export function clearDraft(projectId: string, path: string): void {
  try { localStorage.removeItem(key(projectId, path)); } catch { /* ignore */ }
}
