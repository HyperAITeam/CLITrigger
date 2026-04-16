// Shared tag color definitions for Planner components
export const TAG_COLOR_MAP: Record<string, { bg: string; text: string; swatch: string }> = {
  default: { bg: 'bg-warm-200/50', text: 'text-warm-500', swatch: 'bg-warm-300' },
  gray:    { bg: 'bg-gray-500/20', text: 'text-gray-400', swatch: 'bg-gray-400' },
  brown:   { bg: 'bg-amber-800/20', text: 'text-amber-600', swatch: 'bg-amber-700' },
  orange:  { bg: 'bg-orange-500/20', text: 'text-orange-400', swatch: 'bg-orange-500' },
  yellow:  { bg: 'bg-yellow-500/20', text: 'text-yellow-400', swatch: 'bg-yellow-500' },
  green:   { bg: 'bg-emerald-500/20', text: 'text-emerald-400', swatch: 'bg-emerald-500' },
  blue:    { bg: 'bg-blue-500/20', text: 'text-blue-400', swatch: 'bg-blue-500' },
  purple:  { bg: 'bg-purple-500/20', text: 'text-purple-400', swatch: 'bg-purple-500' },
  pink:    { bg: 'bg-pink-500/20', text: 'text-pink-400', swatch: 'bg-pink-500' },
  red:     { bg: 'bg-red-500/20', text: 'text-red-400', swatch: 'bg-red-500' },
};

export const TAG_COLOR_KEYS = Object.keys(TAG_COLOR_MAP);

export function getTagStyle(color: string): string {
  const c = TAG_COLOR_MAP[color] || TAG_COLOR_MAP.default;
  return `${c.bg} ${c.text}`;
}
