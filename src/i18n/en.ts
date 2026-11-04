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

  'sftp.files': 'SFTP files',
  'sftp.filter': 'Filter files',
  'sftp.filterPlaceholder': 'Filter this folder…',
  'sftp.clearFilter': 'Clear filter',
  'sftp.noMatches': 'No files match “{query}”.',
  'sftp.downloadSelected': 'Download {count} items',
  'sftp.downloadManyResult': 'Downloaded {downloaded} items',
  'sftp.downloadManyFailed': 'Some items could not be downloaded',
  'sftp.delete': 'Delete',
  'sftp.deleteSelected': 'Delete {count} items',
  'sftp.deleteManyTitle': 'Delete Selected Items',
  'sftp.deleteManyConfirm': 'Delete {count} selected items? This cannot be undone.',
  'sftp.deleteManyResult': 'Deleted {removed} items',
  'sftp.deleteManyFailed': 'Some items could not be deleted',
  'sftp.menu.properties': 'Properties',
  'sftp.properties.title': 'Properties',
  'sftp.properties.type': 'Type',
  'sftp.properties.type.folder': 'Folder',
  'sftp.properties.type.file': 'File',
  'sftp.properties.size': 'Size',
  'sftp.properties.owner': 'Owner:Group',
  'sftp.properties.modified': 'Last modified',
  'sftp.properties.currentPermissions': 'Current permissions',
  'sftp.properties.permissions': 'Change permissions',
  'sftp.properties.octal': 'Octal',
  'sftp.properties.invalidMode': 'Use an octal value between 0000 and 7777.',
  'sftp.properties.saved': 'Permissions updated',
  'sftp.properties.saveFailed': 'Failed to update permissions',
  'sftp.properties.save': 'Save Permissions',
  'sftp.permissions.owner': 'Owner',
  'sftp.permissions.group': 'Group',
  'sftp.permissions.other': 'Other',
  'sftp.permissions.read': 'Read',
  'sftp.permissions.write': 'Write',
  'sftp.permissions.execute': 'Execute',

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
