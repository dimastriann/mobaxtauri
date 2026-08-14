export type ShortcutAction =
  | 'newSession'
  | 'closeTab'
  | 'nextTab'
  | 'previousTab'
  | 'sessionSearch'
  | 'commandPalette'
  | 'settings';

export type KeyboardShortcuts = Record<ShortcutAction, string>;

export const SHORTCUTS_STORAGE_KEY = 'keyboard-shortcuts';
export const SHORTCUTS_CHANGED_EVENT = 'keyboard-shortcuts-changed';

export const DEFAULT_SHORTCUTS: KeyboardShortcuts = {
  newSession: 'Ctrl+Shift+N',
  closeTab: 'Ctrl+W',
  nextTab: 'Ctrl+Tab',
  previousTab: 'Ctrl+Shift+Tab',
  sessionSearch: 'Ctrl+Shift+F',
  commandPalette: 'Ctrl+K',
  settings: 'Ctrl+,',
};

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  newSession: 'New session',
  closeTab: 'Close active tab',
  nextTab: 'Next tab',
  previousTab: 'Previous tab',
  sessionSearch: 'Search sessions',
  commandPalette: 'Command palette',
  settings: 'Open settings',
};

export const loadKeyboardShortcuts = (): KeyboardShortcuts => {
  try {
    const saved = JSON.parse(localStorage.getItem(SHORTCUTS_STORAGE_KEY) ?? '{}');
    return { ...DEFAULT_SHORTCUTS, ...saved };
  } catch {
    return DEFAULT_SHORTCUTS;
  }
};

const normalizedKey = (event: KeyboardEvent | React.KeyboardEvent) => {
  if (event.key === ' ') return 'Space';
  if (event.key.length === 1) return event.key.toLocaleUpperCase();
  return event.key[0].toLocaleUpperCase() + event.key.slice(1);
};

export const shortcutFromEvent = (event: KeyboardEvent | React.KeyboardEvent): string | null => {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.metaKey) parts.push('Meta');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(normalizedKey(event));
  return parts.join('+');
};

export const matchesShortcut = (event: KeyboardEvent, shortcut: string) =>
  shortcutFromEvent(event) === shortcut;

export const saveKeyboardShortcuts = (shortcuts: KeyboardShortcuts) => {
  localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(shortcuts));
  window.dispatchEvent(new CustomEvent(SHORTCUTS_CHANGED_EVENT, { detail: shortcuts }));
};
