import type { ITheme } from '@xterm/xterm';
import type {
  TerminalFontPreferences,
  TerminalFontWeight,
  TerminalTheme,
} from '../types/terminalTheme';

export const DEFAULT_FONT_FAMILY = '"Cascadia Code", Menlo, "Courier New", monospace';
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 32;
export const MIN_LINE_HEIGHT = 1;
export const MAX_LINE_HEIGHT = 2;

const STORAGE_KEYS = {
  themeId: 'terminal-theme-id',
  fontSize: 'terminal-font-size',
  fontFamily: 'terminal-font-family',
  lineHeight: 'terminal-line-height',
  fontWeight: 'terminal-font-weight',
} as const;

export const clampFontSize = (value: number): number =>
  Number.isFinite(value) ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value))) : 14;

export const clampLineHeight = (value: number): number =>
  Number.isFinite(value) ? Math.min(MAX_LINE_HEIGHT, Math.max(MIN_LINE_HEIGHT, value)) : 1;

export const normalizeFontWeight = (value: string | null): TerminalFontWeight =>
  value === 'bold' ? 'bold' : 'normal';

/** Maps a backend theme onto the xterm color options. */
export const toXtermTheme = (theme: TerminalTheme): ITheme => ({
  background: theme.background,
  foreground: theme.foreground,
  cursor: theme.cursor,
  cursorAccent: theme.cursorAccent,
  selectionBackground: theme.selection,
  black: theme.black,
  red: theme.red,
  green: theme.green,
  yellow: theme.yellow,
  blue: theme.blue,
  magenta: theme.magenta,
  cyan: theme.cyan,
  white: theme.white,
  brightBlack: theme.brightBlack,
  brightRed: theme.brightRed,
  brightGreen: theme.brightGreen,
  brightYellow: theme.brightYellow,
  brightBlue: theme.brightBlue,
  brightMagenta: theme.brightMagenta,
  brightCyan: theme.brightCyan,
  brightWhite: theme.brightWhite,
});

/**
 * Resolves the scheme to render: the user's explicit choice wins; otherwise
 * the application's default scheme matching the light/dark UI mode.
 */
export const resolveTerminalTheme = (
  themes: TerminalTheme[],
  selectedThemeId: string | null,
  colorMode: string,
): TerminalTheme | null => {
  if (selectedThemeId) {
    const selected = themes.find((theme) => theme.id === selectedThemeId);
    if (selected) return selected;
  }
  const fallbackId = colorMode === 'light' ? 'mobaxtauri-light' : 'mobaxtauri-dark';
  return themes.find((theme) => theme.id === fallbackId) ?? null;
};

export const loadFontPreferences = (): TerminalFontPreferences => ({
  family: localStorage.getItem(STORAGE_KEYS.fontFamily) || DEFAULT_FONT_FAMILY,
  size: clampFontSize(parseInt(localStorage.getItem(STORAGE_KEYS.fontSize) || '14', 10)),
  lineHeight: clampLineHeight(parseFloat(localStorage.getItem(STORAGE_KEYS.lineHeight) || '1')),
  weight: normalizeFontWeight(localStorage.getItem(STORAGE_KEYS.fontWeight)),
});

export const saveFontPreferences = (preferences: TerminalFontPreferences): void => {
  localStorage.setItem(STORAGE_KEYS.fontFamily, preferences.family);
  localStorage.setItem(STORAGE_KEYS.fontSize, String(preferences.size));
  localStorage.setItem(STORAGE_KEYS.lineHeight, String(preferences.lineHeight));
  localStorage.setItem(STORAGE_KEYS.fontWeight, preferences.weight);
};

export const loadSelectedThemeId = (): string | null => localStorage.getItem(STORAGE_KEYS.themeId);

export const saveSelectedThemeId = (themeId: string | null): void => {
  if (themeId) {
    localStorage.setItem(STORAGE_KEYS.themeId, themeId);
  } else {
    localStorage.removeItem(STORAGE_KEYS.themeId);
  }
};
