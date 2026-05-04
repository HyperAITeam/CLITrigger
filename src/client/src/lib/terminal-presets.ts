// Per-session terminal color presets. Each preset defines a full xterm.js
// ITheme (background/foreground/cursor + ANSI 16). Brand-themed: products
// from voltagent/awesome-design-md picked for terminal-readable contrast.
//
// `custom` is a synthetic 9th slot that lets the user override 5 core colors
// (background/foreground/cursor/selection/accent) while inheriting the rest
// of `default`'s ANSI 16. Resolved by `resolveTerminalTheme` in
// `useSessionTheme.ts`.

import type { ITheme } from '@xterm/xterm';

export type TerminalPresetId =
  | 'default'
  | 'claude'
  | 'vercel'
  | 'supabase'
  | 'stripe'
  | 'spotify'
  | 'ferrari'
  | 'nvidia';

export interface TerminalPreset {
  id: TerminalPresetId;
  name: string;
  accent: string; // signature brand color, used for swatch dot
  theme: ITheme;
}

const DEFAULT_THEME: ITheme = {
  background: '#0c0c0c',
  foreground: '#cccccc',
  cursor: '#f2f2f2',
  cursorAccent: '#0c0c0c',
  selectionBackground: '#264f78',
  black: '#0c0c0c',
  red: '#f14c4c',
  green: '#16c60c',
  yellow: '#cca700',
  blue: '#3b78ff',
  magenta: '#b4009e',
  cyan: '#61d6d6',
  white: '#cccccc',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#16c60c',
  brightYellow: '#f9f1a5',
  brightBlue: '#569cd6',
  brightMagenta: '#b4009e',
  brightCyan: '#9cdcfe',
  brightWhite: '#f2f2f2',
};

export const TERMINAL_PRESETS: Record<TerminalPresetId, TerminalPreset> = {
  default: {
    id: 'default',
    name: 'Default',
    accent: '#cccccc',
    theme: DEFAULT_THEME,
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    accent: '#d97757',
    theme: {
      background: '#1a1614',
      foreground: '#ebe5dc',
      cursor: '#d97757',
      cursorAccent: '#1a1614',
      selectionBackground: '#3a2a20',
      black: '#1a1614',
      red: '#e36049',
      green: '#a8b545',
      yellow: '#d9a657',
      blue: '#7ea5d4',
      magenta: '#c688be',
      cyan: '#82b3a3',
      white: '#d6cfc4',
      brightBlack: '#7a6e63',
      brightRed: '#ed7c5e',
      brightGreen: '#bdc869',
      brightYellow: '#e8b76e',
      brightBlue: '#d97757',
      brightMagenta: '#dba5d4',
      brightCyan: '#9bc8b8',
      brightWhite: '#f5ede0',
    },
  },
  vercel: {
    id: 'vercel',
    name: 'Vercel',
    accent: '#ffffff',
    theme: {
      background: '#000000',
      foreground: '#ededed',
      cursor: '#ffffff',
      cursorAccent: '#000000',
      selectionBackground: '#333333',
      black: '#000000',
      red: '#ff6363',
      green: '#7eb38a',
      yellow: '#f0ce6e',
      blue: '#52a9ff',
      magenta: '#f771b9',
      cyan: '#79ffe1',
      white: '#a1a1a1',
      brightBlack: '#666666',
      brightRed: '#ff8888',
      brightGreen: '#a3d4ad',
      brightYellow: '#ffe27a',
      brightBlue: '#79c8ff',
      brightMagenta: '#ff97cf',
      brightCyan: '#79ffe1',
      brightWhite: '#ffffff',
    },
  },
  supabase: {
    id: 'supabase',
    name: 'Supabase',
    accent: '#3ecf8e',
    theme: {
      background: '#1c1c1c',
      foreground: '#ededed',
      cursor: '#3ecf8e',
      cursorAccent: '#1c1c1c',
      selectionBackground: '#1f4738',
      black: '#1c1c1c',
      red: '#ed7777',
      green: '#3ecf8e',
      yellow: '#e0c367',
      blue: '#5a9bf2',
      magenta: '#bd80de',
      cyan: '#8edbe1',
      white: '#cfcfcf',
      brightBlack: '#525252',
      brightRed: '#f49191',
      brightGreen: '#65e0a3',
      brightYellow: '#f0d480',
      brightBlue: '#82b6f7',
      brightMagenta: '#d2a3e8',
      brightCyan: '#a8e8ed',
      brightWhite: '#ffffff',
    },
  },
  stripe: {
    id: 'stripe',
    name: 'Stripe',
    accent: '#635bff',
    theme: {
      background: '#0a2540',
      foreground: '#f6f9fc',
      cursor: '#635bff',
      cursorAccent: '#0a2540',
      selectionBackground: '#2c3e60',
      black: '#0a2540',
      red: '#ff5c8a',
      green: '#5ad6a4',
      yellow: '#f9c46b',
      blue: '#7a73ff',
      magenta: '#a87dff',
      cyan: '#5fbed9',
      white: '#cfd7e3',
      brightBlack: '#425466',
      brightRed: '#ff7ca6',
      brightGreen: '#7ee0b6',
      brightYellow: '#ffd58a',
      brightBlue: '#9b94ff',
      brightMagenta: '#c5a4ff',
      brightCyan: '#88d3e8',
      brightWhite: '#ffffff',
    },
  },
  spotify: {
    id: 'spotify',
    name: 'Spotify',
    accent: '#1db954',
    theme: {
      background: '#121212',
      foreground: '#ffffff',
      cursor: '#1db954',
      cursorAccent: '#121212',
      selectionBackground: '#1d4d2e',
      black: '#121212',
      red: '#e07a7a',
      green: '#1db954',
      yellow: '#d4b35a',
      blue: '#5099d6',
      magenta: '#b58fd0',
      cyan: '#7dccd9',
      white: '#b3b3b3',
      brightBlack: '#535353',
      brightRed: '#f08e8e',
      brightGreen: '#1ed760',
      brightYellow: '#e8c977',
      brightBlue: '#74b1e3',
      brightMagenta: '#caaae0',
      brightCyan: '#9adde6',
      brightWhite: '#ffffff',
    },
  },
  ferrari: {
    id: 'ferrari',
    name: 'Ferrari',
    accent: '#ff2800',
    theme: {
      background: '#0d0d0d',
      foreground: '#f5f5f5',
      cursor: '#ff2800',
      cursorAccent: '#0d0d0d',
      selectionBackground: '#4a1410',
      black: '#0d0d0d',
      red: '#ff2800',
      green: '#a5b65f',
      yellow: '#e0c14a',
      blue: '#4d8fc9',
      magenta: '#c772a8',
      cyan: '#6cbac7',
      white: '#cfcfcf',
      brightBlack: '#5e5e5e',
      brightRed: '#ff5a3d',
      brightGreen: '#bdcc7d',
      brightYellow: '#f0d56b',
      brightBlue: '#6ea8db',
      brightMagenta: '#dc92be',
      brightCyan: '#8ad0db',
      brightWhite: '#ffffff',
    },
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA',
    accent: '#76b900',
    theme: {
      background: '#000000',
      foreground: '#ffffff',
      cursor: '#76b900',
      cursorAccent: '#000000',
      selectionBackground: '#2d3d10',
      black: '#000000',
      red: '#e26060',
      green: '#76b900',
      yellow: '#d4b03e',
      blue: '#5097cc',
      magenta: '#b87aac',
      cyan: '#6ec3c5',
      white: '#bdbdbd',
      brightBlack: '#4a4a4a',
      brightRed: '#f08080',
      brightGreen: '#94d624',
      brightYellow: '#e6c861',
      brightBlue: '#6fb0e0',
      brightMagenta: '#d29ac8',
      brightCyan: '#90dde0',
      brightWhite: '#ffffff',
    },
  },
};

export const PRESET_IDS: TerminalPresetId[] = [
  'default', 'claude', 'vercel', 'supabase', 'stripe', 'spotify', 'ferrari', 'nvidia',
];

export const DEFAULT_PRESET_ID: TerminalPresetId = 'default';

export function getPreset(id: TerminalPresetId): TerminalPreset {
  return TERMINAL_PRESETS[id] ?? TERMINAL_PRESETS.default;
}
