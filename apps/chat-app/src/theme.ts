/**
 * Phase F — dark/light theme (ported from the reference UI).
 *
 * - Choice persisted in localStorage under `cbms-theme`.
 * - First visit follows the system `prefers-color-scheme`.
 * - All component colors read CSS custom properties (see `styles.css`), so
 *   toggling the `.dark` class on `<html>` flips the whole UI (the
 *   shadcn/Tailwind dark-mode convention).
 */
export type Theme = 'light' | 'dark' | 'cyber';

const STORAGE_KEY = 'cbms-theme';

/** Initial theme: stored choice → system preference → light. */
export function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'cyber') return stored;
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

/** Applies the theme to <html> as classes (shadcn dark mode + cyber variant). */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark' || theme === 'cyber');
  root.classList.toggle('cyber', theme === 'cyber');
}

/** Persists the choice. */
export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* privacy mode: ignore */
  }
}
