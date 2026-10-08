/**
 * Advanced charts (Phase P3) — `<ChartBlock />` smoke tests.
 *
 * Uses react-test-renderer (no DOM): Recharts' `ResponsiveContainer` renders
 * an empty placeholder without a real layout, so these tests assert the
 * wrapper/title/fallback render without crashing — not the SVG internals.
 *
 * `<ChartBlock />` loads the Recharts renderer lazily (`React.lazy`), so the
 * chart tests flush the dynamic `import()` before asserting (see `flush`).
 */
import { describe, it, expect } from 'vitest';
import React, { act } from 'react';
import createRenderer from 'react-test-renderer';
import ChartBlock from './ChartBlock';
import type { ChartSpec } from '../../../src/llm/chart.js';

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
    const tree = createRenderer.create(
      React.createElement(ChartBlock, { spec, theme: 'light' }),
    );
    expect(JSON.stringify(tree.toJSON())).toContain('No chart data to display.');
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
    const tree = createRenderer.create(
      React.createElement(ChartBlock, { spec, theme: 'light' }),
    );
    // The title is in the wrapper (renders immediately, before the lazy load).
    expect(JSON.stringify(tree.toJSON())).toContain('Households by barangay');
    // Flush the lazy Recharts renderer; the chart body must render without crashing.
    await flush();
    expect(tree.toJSON()).not.toBeNull();
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
      const tree = createRenderer.create(
        React.createElement(ChartBlock, { spec, theme: 'dark' }),
      );
      await flush();
      expect(tree.toJSON()).not.toBeNull();
    }
  }, 10000);
});
