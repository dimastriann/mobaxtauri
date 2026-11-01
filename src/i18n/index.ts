/**
 * Lightweight localization infrastructure.
 *
 * - Dictionaries are flat typed key sets (`en.ts` is the source of truth).
 * - `translate` interpolates `{name}` placeholders and falls back to
 *   English, then to the key itself, so a missing string never renders as
 *   `undefined`.
 * - The chosen locale persists in localStorage and defaults to the browser
 *   language.
 *
 * To add a locale: copy `en.ts`, translate the values, import it here, and
 * append it to `LOCALES`.
 */
import { en, type TranslationKey } from './en';
import { id } from './id';

export type Locale = 'en' | 'id';

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'app-locale';

export interface LocaleOption {
  id: Locale;
  /** Name shown in the picker, in the language itself. */
  label: string;
}

export const LOCALES: LocaleOption[] = [
  { id: 'en', label: 'English' },
  { id: 'id', label: 'Bahasa Indonesia' },
];

export const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = {
  en,
  id,
};

export type TranslationParams = Record<string, string | number>;

/** Maps a browser/language tag onto a supported locale (prefix match). */
export const normalizeLocale = (value: string | null | undefined): Locale => {
  if (!value) return DEFAULT_LOCALE;
  const base = value.toLowerCase().split(/[-_]/)[0];
  return LOCALES.some((locale) => locale.id === base) ? (base as Locale) : DEFAULT_LOCALE;
};

export const detectLocale = (): Locale => {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (stored) return normalizeLocale(stored);
  return normalizeLocale(typeof navigator !== 'undefined' ? navigator.language : null);
};

/**
 * Replaces `{name}` placeholders in `template`; unknown placeholders stay
 * verbatim so a missing parameter is visible instead of rendering `undefined`.
 */
export const interpolate = (template: string, params: TranslationParams): string =>
  template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );

/**
 * Resolves `key` for `locale`, interpolating `{name}` placeholders.
 * Missing translations fall back to English, then to the key.
 */
export const translate = (
  locale: Locale,
  key: TranslationKey,
  params?: TranslationParams,
): string => {
  const template = DICTIONARIES[locale]?.[key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? key;
  return params ? interpolate(template, params) : template;
};
