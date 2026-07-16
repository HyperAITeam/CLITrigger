// Per-project tag color. If the project has an explicit `color` set, use it;
// otherwise hash the id to a stable palette index so new projects already
// look distinct in the sidebar / dock tray before the user picks one.

export const PROJECT_COLOR_PALETTE: ReadonlyArray<string> = [
  '#55708F', // slate blue
  '#4F7A68', // forest
  '#9A783F', // ochre
  '#A15F5A', // brick
  '#74658A', // plum
  '#925F73', // berry
  '#477B7D', // mineral teal
  '#747A50', // olive
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
