import { describe, expect, it, beforeEach } from 'vitest';
import {
  clampFontSize,
  clampLineHeight,
  DEFAULT_FONT_FAMILY,
  loadFontPreferences,
  loadSelectedThemeId,
  normalizeFontWeight,
  resolveTerminalTheme,
  saveFontPreferences,
  saveSelectedThemeId,
  toXtermTheme,
} from './terminalAppearance';
import type { TerminalTheme } from '../types/terminalTheme';

const theme: TerminalTheme = {
  id: 'dracula',
  name: 'Dracula',
  dark: true,
  background: '#282a36',
  foreground: '#f8f8f2',
  cursor: '#f8f8f0',
  cursorAccent: '#282a36',
  selection: 'rgba(68, 71, 90, 0.6)',
  black: '#21222c',
  red: '#ff5555',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  blue: '#bd93f9',
  magenta: '#ff79c6',
  cyan: '#8be9fd',
  white: '#f8f8f2',
  brightBlack: '#6272a4',
  brightRed: '#ff6e6e',
  brightGreen: '#69ff94',
  brightYellow: '#ffffa5',
  brightBlue: '#d6acff',
  brightMagenta: '#ff92df',
  brightCyan: '#a4ffff',
  brightWhite: '#ffffff',
};

const lightTheme: TerminalTheme = { ...theme, id: 'mobaxtauri-light', name: 'Light', dark: false };

describe('terminalAppearance', () => {
  beforeEach(() => localStorage.clear());

  it('maps every palette entry onto the xterm theme', () => {
    const mapped = toXtermTheme(theme);
    expect(mapped).toMatchObject({
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f0',
      cursorAccent: '#282a36',
      selectionBackground: 'rgba(68, 71, 90, 0.6)',
      black: '#21222c',
      red: '#ff5555',
      brightWhite: '#ffffff',
    });
  });

  it('resolves the explicit selection before the app mode', () => {
    const themes = [theme, lightTheme];
    expect(resolveTerminalTheme(themes, 'dracula', 'light')?.id).toBe('dracula');
    expect(resolveTerminalTheme(themes, null, 'light')?.id).toBe('mobaxtauri-light');
    // A stale selection falls back to the scheme for the UI mode; when the
    // catalogue lacks that scheme the caller keeps its built-in default.
    expect(resolveTerminalTheme(themes, 'missing', 'light')?.id).toBe('mobaxtauri-light');
    expect(resolveTerminalTheme(themes, 'missing', 'dark')).toBeNull();
    expect(resolveTerminalTheme([], 'dracula', 'dark')).toBeNull();
  });

  it('clamps font size and line height', () => {
    expect(clampFontSize(4)).toBe(8);
    expect(clampFontSize(99)).toBe(32);
    expect(clampFontSize(Number.NaN)).toBe(14);
    expect(clampLineHeight(0.2)).toBe(1);
    expect(clampLineHeight(3)).toBe(2);
  });

  it('normalizes the font weight', () => {
    expect(normalizeFontWeight('bold')).toBe('bold');
    expect(normalizeFontWeight('normal')).toBe('normal');
    expect(normalizeFontWeight(null)).toBe('normal');
    expect(normalizeFontWeight('900')).toBe('normal');
  });

  it('round-trips font preferences through localStorage', () => {
    const defaults = loadFontPreferences();
    expect(defaults.family).toBe(DEFAULT_FONT_FAMILY);
    expect(defaults.size).toBe(14);

    saveFontPreferences({
      family: 'Fira Code, monospace',
      size: 18,
      lineHeight: 1.3,
      weight: 'bold',
    });
    expect(loadFontPreferences()).toEqual({
      family: 'Fira Code, monospace',
      size: 18,
      lineHeight: 1.3,
      weight: 'bold',
    });
  });

  it('persists and clears the selected theme', () => {
    expect(loadSelectedThemeId()).toBeNull();
    saveSelectedThemeId('nord');
    expect(loadSelectedThemeId()).toBe('nord');
    saveSelectedThemeId(null);
    expect(loadSelectedThemeId()).toBeNull();
  });
});
