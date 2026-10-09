/**
 * Map feature (P3, T3.7) — `<BarangayMap />` component tests.
 *
 * Uses react-test-renderer (no DOM, no network): the GeoJSON is injected via
 * the `geojson` prop as a 27-feature fixture, so no fetch happens. Asserts:
 * - one `<path>` renders per barangay (27).
 * - clicking a region updates the detail row (name appears).
 */
import { describe, it, expect } from 'vitest';
import React, { act } from 'react';
import createRenderer, { type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import BarangayMap from './BarangayMap';

/** A 27-feature fixture GeoJSON (simple unit squares, codes "1".."27"). */
function fixtureGeo(n = 27): string {
  const features = Array.from({ length: n }, (_, i) => ({
    type: 'Feature',
    properties: { code: String(i + 1), barangay: `BQ ${i + 1}` },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    },
  }));
  return JSON.stringify({ type: 'FeatureCollection', features });
}

/** Render and flush the async load effect (the injected `geojson` resolves). */
async function renderMap(props: {
  columns: string[];
  rows: unknown[][];
  theme: 'light' | 'dark';
  geojson: string;
}): Promise<ReactTestRenderer> {
  const tree = createRenderer.create(React.createElement(BarangayMap, props));
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  return tree;
}

describe('<BarangayMap />', () => {
  it('renders one <path> per barangay (27)', async () => {
    const columns = ['code', 'barangay', 'hh'];
    const rows = Array.from({ length: 27 }, (_, i) => [String(i + 1), `BQ ${i + 1}`, i * 10]);
    const tree = await renderMap({ columns, rows, theme: 'light', geojson: fixtureGeo() });
    // 27 region paths (the transparent backdrop <rect> is not a <path>).
    const paths = tree.root.findAllByType('path');
    expect(paths).toHaveLength(27);
  });

  it('clicking a region updates the detail row', async () => {
    const columns = ['code', 'barangay', 'hh'];
    const rows: unknown[][] = [
      [1, 'BQ 1', 100],
      [2, 'BQ 2', 200],
    ];
    const tree = await renderMap({ columns, rows, theme: 'light', geojson: fixtureGeo() });
    // No detail row before a click.
    expect(JSON.stringify(tree.toJSON())).not.toContain('map-detail');
    // Click the first region (code "1" → "BQ 1").
    const path = tree.root.findAllByType('path')[0];
    if (!path) throw new Error('expected a region path');
    act(() => {
      (path as ReactTestInstance).props.onClick();
    });
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('map-detail');
    expect(text).toContain('BQ 1');
  });

  it('shows a metric selector when there are 2+ numeric columns', async () => {
    const columns = ['code', 'barangay', 'hh', 'pop'];
    const rows: unknown[][] = [
      [1, 'BQ 1', 100, 5000],
      [2, 'BQ 2', 200, 6000],
    ];
    const tree = await renderMap({ columns, rows, theme: 'light', geojson: fixtureGeo() });
    expect(JSON.stringify(tree.toJSON())).toContain('Metric:');
  });

  it('renders without a metric selector for a single numeric column', async () => {
    const columns = ['code', 'barangay', 'hh'];
    const rows: unknown[][] = [[1, 'BQ 1', 100]];
    const tree = await renderMap({ columns, rows, theme: 'light', geojson: fixtureGeo() });
    expect(JSON.stringify(tree.toJSON())).not.toContain('Metric:');
  });
});
