/** Mirrors Rust `terminal_theme::TerminalTheme` (serde camelCase). */
export interface TerminalTheme {
  id: string;
  name: string;
  dark: boolean;
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selection: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export type TerminalFontWeight = 'normal' | 'bold';

export interface TerminalFontPreferences {
  family: string;
  size: number;
  lineHeight: number;
  weight: TerminalFontWeight;
}
