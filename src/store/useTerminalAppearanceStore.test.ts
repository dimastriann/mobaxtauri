import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTerminalAppearanceStore } from './useTerminalAppearanceStore';
import type { TerminalTheme } from '../types/terminalTheme';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const nord: TerminalTheme = {
  id: 'nord',
  name: 'Nord',
  dark: true,
  background: '#2e3440',
  foreground: '#d8dee9',
  cursor: '#d8dee9',
  cursorAccent: '#2e3440',
  selection: 'rgba(76, 86, 106, 0.6)',
  black: '#3b4252',
  red: '#bf616a',
  green: '#a3be8c',
  yellow: '#ebcb8b',
  blue: '#81a1c1',
  magenta: '#b48ead',
  cyan: '#88c0d0',
  white: '#e5e9f0',
  brightBlack: '#4c566a',
  brightRed: '#bf616a',
  brightGreen: '#a3be8c',
  brightYellow: '#ebcb8b',
  brightBlue: '#81a1c1',
  brightMagenta: '#b48ead',
  brightCyan: '#8fbcbb',
  brightWhite: '#eceff4',
};

describe('useTerminalAppearanceStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useTerminalAppearanceStore.setState({
      themes: [],
      selectedThemeId: null,
      isLoadingThemes: false,
      fontPreferences: {
        family: '"Cascadia Code", Menlo, "Courier New", monospace',
        size: 14,
        lineHeight: 1,
        weight: 'normal',
      },
    });
    vi.clearAllMocks();
  });

  it('fetches the catalogue from the backend', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValueOnce([nord]);

    await useTerminalAppearanceStore.getState().fetchThemes();

    expect(invoke).toHaveBeenCalledWith('terminal_themes');
    expect(useTerminalAppearanceStore.getState().themes).toHaveLength(1);
    expect(useTerminalAppearanceStore.getState().themes[0].id).toBe('nord');
    expect(useTerminalAppearanceStore.getState().isLoadingThemes).toBe(false);
  });

  it('persists the selected theme', () => {
    useTerminalAppearanceStore.getState().selectTheme('nord');
    expect(useTerminalAppearanceStore.getState().selectedThemeId).toBe('nord');
    expect(localStorage.getItem('terminal-theme-id')).toBe('nord');

    useTerminalAppearanceStore.getState().selectTheme(null);
    expect(useTerminalAppearanceStore.getState().selectedThemeId).toBeNull();
    expect(localStorage.getItem('terminal-theme-id')).toBeNull();
  });

  it('clamps font preference updates and persists them', () => {
    const store = useTerminalAppearanceStore.getState();
    store.updateFontPreferences({ size: 99, lineHeight: 0.1 });
    expect(useTerminalAppearanceStore.getState().fontPreferences.size).toBe(32);
    expect(useTerminalAppearanceStore.getState().fontPreferences.lineHeight).toBe(1);

    store.updateFontPreferences({ family: 'Fira Code, monospace', weight: 'bold' });
    expect(useTerminalAppearanceStore.getState().fontPreferences.family).toBe(
      'Fira Code, monospace',
    );
    expect(localStorage.getItem('terminal-font-family')).toBe('Fira Code, monospace');
    expect(localStorage.getItem('terminal-font-weight')).toBe('bold');
  });

  it('surfaces a fetch failure without dropping the catalogue', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    useTerminalAppearanceStore.setState({ themes: [nord] });
    vi.mocked(invoke).mockRejectedValueOnce('backend unavailable');

    await useTerminalAppearanceStore.getState().fetchThemes();

    expect(useTerminalAppearanceStore.getState().themes).toHaveLength(1);
    expect(useTerminalAppearanceStore.getState().isLoadingThemes).toBe(false);
  });
});
