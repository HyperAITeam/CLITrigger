// Per-project tag color. If the project has an explicit `color` set, use it;
// otherwise hash the id to a stable palette index so new projects already
// look distinct in the sidebar / dock tray before the user picks one.

export const PROJECT_COLOR_PALETTE: ReadonlyArray<string> = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
];

function hashStringToIndex(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % mod;
}

export function resolveProjectColor(project: { id: string; color?: string | null }): string {
  if (project.color && /^#[0-9a-f]{6}$/i.test(project.color)) return project.color;
  return PROJECT_COLOR_PALETTE[hashStringToIndex(project.id, PROJECT_COLOR_PALETTE.length)];
}

export function isValidProjectColor(c: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(c);
}
