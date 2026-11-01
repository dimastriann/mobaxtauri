/**
 * English source dictionary.
 *
 * Keys are flat dotted paths. Interpolation uses `{name}` placeholders.
 * Every other locale must define the same key set — the i18n tests fail
 * when a locale drifts from this file. To add a locale: copy this file,
 * translate the values, register it in `index.ts`, and add it to
 * `LOCALES`.
 */
export const en = {
  'common.cancel': 'Cancel',
  'common.close': 'Close',

  'settings.tab.appearance': 'Appearance',
  'settings.tab.terminal': 'Terminal',
  'settings.tab.ssh': 'SSH',
  'settings.tab.shortcuts': 'Shortcuts',
  'settings.tab.snippets': 'Commands',
  'settings.tab.history': 'History',
  'settings.tab.about': 'About',

  'appearance.heading': 'Appearance',
  'appearance.theme.label': 'Theme',
  'appearance.theme.helper': 'Switch between light and dark mode',
  'appearance.theme.dark': 'Dark',
  'appearance.theme.light': 'Light',
  'appearance.language.label': 'Language',
  'appearance.language.helper': 'Interface language of the application',

  'terminal.heading': 'Terminal',
  'terminal.theme.label': 'Color Theme',
  'terminal.theme.matchApp': 'Match app appearance',
  'terminal.fontSize': 'Font Size',
  'terminal.lineHeight': 'Line Height',
  'terminal.weight': 'Weight',
  'terminal.weight.normal': 'Normal',
  'terminal.weight.bold': 'Bold',
  'terminal.fontFamily': 'Font Family',
  'terminal.scrollback': 'Scrollback Lines',
  'terminal.applyNote':
    'Theme and font changes apply immediately. Scrollback applies to new terminal sessions.',
} as const;

export type TranslationKey = keyof typeof en;
