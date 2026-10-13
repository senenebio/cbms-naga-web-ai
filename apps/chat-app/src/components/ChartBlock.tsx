/**
 * Advanced charts (Phase P3) — wrapper for a validated `ChartSpec`.
 *
 * Renders the title, the empty-data fallback, and — when there is data — the
 * Recharts renderer, which is **loaded on demand** (`React.lazy` + dynamic
 * `import()`) so Recharts (~110 KB gzip) lives in its own chunk and is not
 * part of the main bundle (see the build chunk-size warning).
 *
 * Theming: the palette mirrors the CSS custom properties in styles.css (a JS
 * palette because SVG paint attributes can't reference `var()`; the prop also
 * keeps this testable without a DOM — react-test-renderer).
 */
import { Suspense, lazy } from 'react';
import type { ChartSpec } from '@repo/llm/chart.js';
import type { Theme } from '../theme.js';
import type { Palette } from './ChartRenderer.js';

const ChartRenderer = lazy(() => import('./ChartRenderer.js'));

/** Mirrors the `:root` / `.dark` custom properties in styles.css. */
const PALETTES: Record<Theme, Palette> = {
  light: { ink: '#1f2430', muted: '#6b7280', border: '#e2e5ea', panel: '#ffffff', surface: '#fbfcfe' },
  dark: { ink: '#e8ecf2', muted: '#9aa3b2', border: '#2a3140', panel: '#171c24', surface: '#1a2029' },
};

interface ChartBlockProps {
  spec: ChartSpec;
  theme: Theme;
}

export default function ChartBlock({ spec, theme }: ChartBlockProps) {
  const palette = PALETTES[theme];
  const data = spec.data;
  const title = spec.title ? (
    <figcaption className="mb-2 text-xs font-medium">{spec.title}</figcaption>
  ) : null;

  if (data.length === 0) {
    return (
      <figure className="my-2.5 rounded-md border bg-muted/30 p-2.5">
        {title}
        <div className="text-xs text-muted-foreground">No chart data to display.</div>
      </figure>
    );
  }

  return (
    <figure className="my-2.5 rounded-md border bg-muted/30 p-2.5">
      {title}
      <div className="w-full p-1" style={{ background: palette.surface, borderRadius: 8 }}>
        <Suspense fallback={<div className="text-xs text-muted-foreground">Loading chart…</div>}>
          <ChartRenderer
            type={spec.type}
            data={data}
            xKey={spec.xKey}
            series={spec.series}
            stacked={spec.stacked ?? false}
            palette={palette}
          />
        </Suspense>
      </div>
    </figure>
  );
}
