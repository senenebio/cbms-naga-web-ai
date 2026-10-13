/**
 * Phase F — dark/light theme (ported from the reference UI).
 *
 * - Choice persisted in localStorage under `cbms-theme`.
 * - First visit follows the system `prefers-color-scheme`.
 * - All component colors read CSS custom properties, so setting `data-theme`
 *   on `<html>` flips the whole UI. The active palette (light/dark) comes
 *   from the app's brand tokens (`@workspace/brand-config`).
 */
import { applyThemeTokens } from '@workspace/brand-config';
import { BRAND } from './brand.js';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'cbms-theme';

/** Initial theme: stored choice → system preference → light. */
export function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* SSR / privacy mode: no localStorage */
  }
  try {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
  } catch {
    /* SSR */
  }
  return 'light';
}

/**
 * Applies the theme to <html>: the `data-theme` attribute (CSS hooks) plus
 * the brand's token palette for the active theme (CSS variables).
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  applyThemeTokens(theme === 'dark' ? BRAND.tokens.dark : BRAND.tokens.light);
}

/** Persists the choice. */
export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* privacy mode: ignore */
  }
}
