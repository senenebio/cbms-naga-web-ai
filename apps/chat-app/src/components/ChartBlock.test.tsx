/**
 * Advanced charts (Phase P3) — `<ChartBlock />` smoke tests.
 *
 * Recharts' `ResponsiveContainer` renders an empty placeholder in jsdom
 * (no real layout), so these tests assert the wrapper/title/fallback render
 * without crashing — not the SVG internals.
 *
 * `<ChartBlock />` loads the Recharts renderer lazily (`React.lazy`), so the
 * chart tests flush the dynamic `import()` before asserting (see `flush`).
 */
import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { render, screen } from '@testing-library/react';
import ChartBlock from './ChartBlock';
import type { ChartSpec } from '@repo/llm/chart.js';

/** Flush the lazy `import()` of the Recharts renderer. */
function flush() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setImmediate(r));
  });
}

describe('<ChartBlock />', () => {
  it('renders a note (no chart) when the spec has no data', () => {
    const spec: ChartSpec = { type: 'bar', data: [], xKey: 'name', series: ['value'] };
    render(<ChartBlock spec={spec} theme="light" />);
    expect(screen.getByText('No chart data to display.')).toBeInTheDocument();
  });

  it('renders the title for a bar chart (smoke test)', async () => {
    const spec: ChartSpec = {
      type: 'bar',
      title: 'Households by barangay',
      data: [
        { name: 'A', value: 1 },
        { name: 'B', value: 2 },
      ],
      xKey: 'name',
      series: ['value'],
      stacked: false,
    };
    render(<ChartBlock spec={spec} theme="light" />);
    // The title is in the wrapper (renders immediately, before the lazy load).
    expect(screen.getByText('Households by barangay')).toBeInTheDocument();
    // Flush the lazy Recharts renderer; the chart body must render without crashing.
    await flush();
  }, 10000);

  it('renders without crashing for each chart type', async () => {
    const rows = [
      { name: 'A', value: 1, y: 2 },
      { name: 'B', value: 2, y: 3 },
    ];
    const types: ChartSpec['type'][] = ['bar', 'line', 'area', 'pie', 'scatter'];
    for (const type of types) {
      const series = ['value'];
      const spec: ChartSpec = {
        type,
        data: rows,
        xKey: type === 'scatter' ? 'value' : 'name',
        series,
        stacked: false,
      };
      render(<ChartBlock spec={spec} theme="dark" />);
      await flush();
    }
  }, 10000);
});
