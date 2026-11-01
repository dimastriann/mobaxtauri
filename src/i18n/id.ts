/**
 * Indonesian dictionary. Keep the key set identical to `en.ts`; the i18n
 * tests fail when a locale drifts.
 */
import type { TranslationKey } from './en';

export const id: Record<TranslationKey, string> = {
  'common.cancel': 'Batal',
  'common.close': 'Tutup',

  'settings.tab.appearance': 'Tampilan',
  'settings.tab.terminal': 'Terminal',
  'settings.tab.ssh': 'SSH',
  'settings.tab.shortcuts': 'Pintasan',
  'settings.tab.snippets': 'Perintah',
  'settings.tab.history': 'Riwayat',
  'settings.tab.about': 'Tentang',

  'appearance.heading': 'Tampilan',
  'appearance.theme.label': 'Tema',
  'appearance.theme.helper': 'Beralih antara mode terang dan gelap',
  'appearance.theme.dark': 'Gelap',
  'appearance.theme.light': 'Terang',
  'appearance.language.label': 'Bahasa',
  'appearance.language.helper': 'Bahasa antarmuka aplikasi',

  'terminal.heading': 'Terminal',
  'terminal.theme.label': 'Tema Warna',
  'terminal.theme.matchApp': 'Ikuti tampilan aplikasi',
  'terminal.fontSize': 'Ukuran Font',
  'terminal.lineHeight': 'Tinggi Baris',
  'terminal.weight': 'Ketebalan',
  'terminal.weight.normal': 'Normal',
  'terminal.weight.bold': 'Tebal',
  'terminal.fontFamily': 'Jenis Font',
  'terminal.scrollback': 'Jumlah Baris Gulir',
  'terminal.applyNote':
    'Perubahan tema dan font langsung berlaku. Jumlah baris gulir berlaku untuk sesi terminal baru.',
};
