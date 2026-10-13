/**
 * Applies a brand's theming tokens to the document as CSS custom properties.
 *
 * `applyBrand` sets the brand's **light** token set on `<html>` and returns a
 * cleanup function that restores the previous inline values (useful in tests
 * and for hot-swapping brands). The app's theme manager swaps the active
 * palette (light/dark) by re-applying the chosen token set.
 */
import type { Brand, BrandTokens } from './types.js';

/** camelCase token key → `--kebab-case` CSS custom property name. */
export function tokenName(key: string): string {
  return `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** Convert a token set to a `{ '--x': value }` map. */
export function tokensToVars(tokens: BrandTokens): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tokens).map(([k, v]) => [tokenName(k), v]),
  );
}

/**
 * Apply `brand`'s light tokens to `target` (default: `<html>`).
 * Returns a function that restores the previous inline values.
 */
export function applyBrand(
  brand: Brand,
  target: HTMLElement = document.documentElement,
): () => void {
  const prev = new Map<string, string>();
  const vars = tokensToVars(brand.tokens.light);
  for (const [name, value] of Object.entries(vars)) {
    prev.set(name, target.style.getPropertyValue(name));
    target.style.setProperty(name, value);
  }
  return () => {
    for (const [name, oldValue] of prev) {
      if (oldValue === '') target.style.removeProperty(name);
      else target.style.setProperty(name, oldValue);
    }
  };
}

/**
 * Swap the active palette (light/dark) for an already-applied brand.
 * The app's theme manager calls this when the user flips the theme.
 */
export function applyThemeTokens(
  tokens: BrandTokens,
  target: HTMLElement = document.documentElement,
): void {
  for (const [name, value] of Object.entries(tokensToVars(tokens))) {
    target.style.setProperty(name, value);
  }
}
