import { useCallback } from 'react';
import { create } from 'zustand';
import {
  detectLocale,
  LOCALE_STORAGE_KEY,
  translate,
  type Locale,
  type TranslationParams,
} from '../i18n';
import type { TranslationKey } from '../i18n/en';

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: detectLocale(),
  setLocale: (locale) => {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    set({ locale });
  },
}));

/**
 * Translation hook: `t('settings.tab.ssh')` renders the localized string
 * and re-renders the component when the language changes.
 */
export const useTranslation = () => {
  const locale = useLocaleStore((state) => state.locale);
  const setLocale = useLocaleStore((state) => state.setLocale);
  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(locale, key, params),
    [locale],
  );
  return { t, locale, setLocale };
};
