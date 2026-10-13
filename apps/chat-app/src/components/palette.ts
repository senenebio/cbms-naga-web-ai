/**
 * Theme palettes for chart and map rendering (B5 token pass).
 *
 * SVG paint attributes can't reference `var()` directly, so the palettes are
 * resolved from the CSS custom properties defined in `@workspace/ui`'s
 * `globals.css` (`--chart-*`) at render time. In non-DOM environments
 * (react-test-renderer) the static fallbacks are used, which mirror the CSS
 * values.
 */
import type { Theme } from '../theme.js';

export interface Palette {
  ink: string;
  muted: string;
  border: string;
  panel: string;
  surface: string;
  /** Multi-series / pie palette (brand accent first, then stable companions). */
  series: string[];
}

/** Fallback values — mirror the `--chart-*` custom properties in globals.css. */
const FALLBACKS: Record<Theme, Palette> = {
  light: {
    ink: '#1f2430',
    muted: '#6b7280',
    border: '#e2e5ea',
    panel: '#ffffff',
    surface: '#fbfcfe',
    series: ['#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6'],
  },
  dark: {
    ink: '#e8ecf2',
    muted: '#9aa3b2',
    border: '#2a3140',
    panel: '#171c24',
    surface: '#1a2029',
    series: ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a78bfa'],
  },
};

const TOKENS: Array<[string, keyof Palette]> = [
  ['--chart-ink', 'ink'],
  ['--chart-muted', 'muted'],
  ['--chart-border', 'border'],
  ['--chart-panel', 'panel'],
  ['--chart-surface', 'surface'],
];

const SERIES_TOKENS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'];

/**
 * Resolves the palette from the live CSS custom properties (so the brand
 * accent and theme flips are picked up), falling back to the static values
 * when there is no DOM (tests) or a token is missing.
 */
export function resolvePalette(theme: Theme): Palette {
  const base = FALLBACKS[theme];
  if (typeof document === 'undefined' || typeof window === 'undefined') return base;
  try {
    const css = getComputedStyle(document.documentElement);
    const get = (name: string) => css.getPropertyValue(name).trim();
    const out: Palette = { ...base, series: [...base.series] };
    for (const [token, key] of TOKENS) {
      const v = get(token);
      if (v) (out as unknown as Record<string, string>)[key] = v;
    }
    SERIES_TOKENS.forEach((token, i) => {
      const v = get(token);
      if (v) out.series[i] = v;
    });
    return out;
  } catch {
    return base;
  }
}
