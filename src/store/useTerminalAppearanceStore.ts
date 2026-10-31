import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { TerminalFontPreferences, TerminalTheme } from '../types/terminalTheme';
import {
  clampFontSize,
  clampLineHeight,
  loadFontPreferences,
  loadSelectedThemeId,
  saveFontPreferences,
  saveSelectedThemeId,
} from '../utils/terminalAppearance';

interface TerminalAppearanceState {
  /** Scheme catalogue from the backend; empty until fetched. */
  themes: TerminalTheme[];
  /** Explicit user choice, or null to follow the light/dark UI mode. */
  selectedThemeId: string | null;
  fontPreferences: TerminalFontPreferences;
  isLoadingThemes: boolean;

  fetchThemes: () => Promise<void>;
  selectTheme: (themeId: string | null) => void;
  updateFontPreferences: (changes: Partial<TerminalFontPreferences>) => void;
}

export const useTerminalAppearanceStore = create<TerminalAppearanceState>((set, get) => ({
  themes: [],
  selectedThemeId: loadSelectedThemeId(),
  fontPreferences: loadFontPreferences(),
  isLoadingThemes: false,

  fetchThemes: async () => {
    if (get().isLoadingThemes) return;
    set({ isLoadingThemes: true });
    try {
      const themes = await invoke<TerminalTheme[]>('terminal_themes');
      set({ themes, isLoadingThemes: false });
    } catch (error) {
      console.error('Failed to load terminal themes', error);
      set({ isLoadingThemes: false });
    }
  },

  selectTheme: (themeId) => {
    saveSelectedThemeId(themeId);
    set({ selectedThemeId: themeId });
  },

  updateFontPreferences: (changes) => {
    const current = get().fontPreferences;
    const next: TerminalFontPreferences = {
      ...current,
      ...changes,
      size: clampFontSize(changes.size ?? current.size),
      lineHeight: clampLineHeight(changes.lineHeight ?? current.lineHeight),
    };
    saveFontPreferences(next);
    set({ fontPreferences: next });
  },
}));
