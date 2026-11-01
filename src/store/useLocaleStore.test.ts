import { describe, it, expect, beforeEach } from 'vitest';
import { useLocaleStore } from './useLocaleStore';
import { LOCALE_STORAGE_KEY } from '../i18n';

describe('useLocaleStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useLocaleStore.setState({ locale: 'en' });
  });

  it('persists and applies the selected locale', () => {
    useLocaleStore.getState().setLocale('id');
    expect(useLocaleStore.getState().locale).toBe('id');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('id');

    useLocaleStore.getState().setLocale('en');
    expect(useLocaleStore.getState().locale).toBe('en');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });
});
