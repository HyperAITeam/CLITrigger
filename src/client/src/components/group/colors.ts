// 8-color palette for session tab accent colors. Cycles with hash fallback
// when palette is exhausted within the same group.

export const TAB_PALETTE = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#eab308', // yellow
  '#ef4444', // red
  '#a855f7', // purple
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
] as const;

export function assignColor(used: string[]): string {
  for (const c of TAB_PALETTE) {
    if (!used.includes(c)) return c;
  }
  return TAB_PALETTE[used.length % TAB_PALETTE.length];
}
