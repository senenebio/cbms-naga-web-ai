/**
 * Applies a brand to the document: writes the brand accent CSS custom
 * properties onto `<html>` and sets `document.title`.
 *
 * `globals.css` maps `--brand-primary`/`--brand-primary-foreground` into
 * Tailwind theme tokens, so applying a brand is a pure CSS-variable repaint —
 * no re-render. Returns a cleanup function that restores the previous state
 * (used by tests).
 */
import type { Brand } from './types.js';

const BRAND_VARS = ['--brand-primary', '--brand-primary-foreground'] as const;

export function applyBrand(
  brand: Brand,
  target: HTMLElement = document.documentElement,
): () => void {
  const prevTitle =
    typeof document !== 'undefined' ? document.title : undefined;
  const prev = new Map<string, string>();
  const values: Record<string, string> = {
    '--brand-primary': brand.colors.primary,
    '--brand-primary-foreground': brand.colors.primaryForeground,
  };
  for (const [name, value] of Object.entries(values)) {
    prev.set(name, target.style.getPropertyValue(name));
    target.style.setProperty(name, value);
  }
  if (typeof document !== 'undefined') {
    document.title = brand.name;
  }
  return () => {
    for (const [name, oldValue] of prev) {
      if (oldValue === '') target.style.removeProperty(name);
      else target.style.setProperty(name, oldValue);
    }
    if (typeof document !== 'undefined' && prevTitle !== undefined) {
      document.title = prevTitle;
    }
  };
}

export { BRAND_VARS };
