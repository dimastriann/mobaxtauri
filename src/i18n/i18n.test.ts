import { describe, expect, it, beforeEach } from 'vitest';
import {
  DICTIONARIES,
  DEFAULT_LOCALE,
  detectLocale,
  interpolate,
  LOCALE_STORAGE_KEY,
  LOCALES,
  normalizeLocale,
  translate,
} from './index';
import { en } from './en';

describe('i18n', () => {
  beforeEach(() => localStorage.clear());

  it('registers both starter locales', () => {
    expect(LOCALES.map((locale) => locale.id).sort()).toEqual(['en', 'id']);
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('every locale defines exactly the English key set', () => {
    const englishKeys = Object.keys(en).sort();
    for (const [locale, dictionary] of Object.entries(DICTIONARIES)) {
      expect(Object.keys(dictionary).sort(), `${locale} key drift`).toEqual(englishKeys);
    }
  });

  it('translates and interpolates placeholders', () => {
    expect(translate('en', 'settings.tab.terminal')).toBe('Terminal');
    expect(translate('id', 'settings.tab.terminal')).toBe('Terminal');
    expect(translate('id', 'settings.tab.appearance')).toBe('Tampilan');
    const template = translate('en', 'common.cancel');
    expect(template).toBe('Cancel');
  });

  it('interpolates provided params and leaves unknown ones intact', () => {
    expect(interpolate('Hello {name}!', { name: 'Ada' })).toBe('Hello Ada!');
    expect(interpolate('{used} and {unused}', { used: 3 })).toBe('3 and {unused}');
    // Keys without placeholders pass params through untouched.
    expect(translate('en', 'terminal.weight.normal', { name: 'x' })).toBe('Normal');
  });

  it('falls back to the key for unknown entries', () => {
    expect(translate('en', 'does.not.exist' as never)).toBe('does.not.exist');
  });

  it('normalizes language tags onto supported locales', () => {
    expect(normalizeLocale('id')).toBe('id');
    expect(normalizeLocale('id-ID')).toBe('id');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('fr-FR')).toBe('en');
    expect(normalizeLocale(null)).toBe('en');
  });

  it('prefers the stored locale over the browser language', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'id');
    expect(detectLocale()).toBe('id');

    localStorage.setItem(LOCALE_STORAGE_KEY, 'bogus');
    expect(detectLocale()).toBe('en');
  });
});
