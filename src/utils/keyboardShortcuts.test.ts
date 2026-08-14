import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SHORTCUTS,
  loadKeyboardShortcuts,
  matchesShortcut,
  saveKeyboardShortcuts,
  SHORTCUTS_CHANGED_EVENT,
  shortcutFromEvent,
} from './keyboardShortcuts';

const keyEvent = (key: string, options: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key, ...options });

describe('keyboard shortcuts', () => {
  beforeEach(() => localStorage.clear());

  it('normalizes modifier order and letter casing', () => {
    expect(shortcutFromEvent(keyEvent('n', { ctrlKey: true, shiftKey: true }))).toBe(
      'Ctrl+Shift+N',
    );
    expect(matchesShortcut(keyEvent('Tab', { ctrlKey: true }), 'Ctrl+Tab')).toBe(true);
  });

  it('ignores standalone modifier presses', () => {
    expect(shortcutFromEvent(keyEvent('Control', { ctrlKey: true }))).toBeNull();
  });

  it('merges saved overrides with defaults', () => {
    localStorage.setItem('keyboard-shortcuts', JSON.stringify({ newSession: 'Alt+N' }));
    expect(loadKeyboardShortcuts()).toEqual({ ...DEFAULT_SHORTCUTS, newSession: 'Alt+N' });
  });

  it('persists changes and notifies listeners', () => {
    const listener = vi.fn();
    window.addEventListener(SHORTCUTS_CHANGED_EVENT, listener);
    const shortcuts = { ...DEFAULT_SHORTCUTS, settings: 'Alt+S' };

    saveKeyboardShortcuts(shortcuts);

    expect(loadKeyboardShortcuts()).toEqual(shortcuts);
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(SHORTCUTS_CHANGED_EVENT, listener);
  });
});
