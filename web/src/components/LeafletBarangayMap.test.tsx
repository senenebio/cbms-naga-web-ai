/**
 * Map feature (P2, T2.4) — `<LeafletBarangayMap />` + `<MapSection />`
 * wrapper tests.
 *
 * Uses react-test-renderer (no DOM, no network): the GeoJSON is injected via
 * the `geojson` prop as a 27-feature fixture. Leaflet's map container ref is
 * null under the test renderer, so `L.map` is never instantiated — these tests
 * cover the HTML surface (metric selector, legend, detail-row state, loading
 * / unavailable notes) and the lazy "Show map" wiring. Leaflet rendering
 * itself is verified manually (spec P4 gate).
 */
import { describe, it, expect, vi } from 'vitest';
import React, { act } from 'react';

// Leaflet's bundle references `window` at import time (node test env); the
// component never calls into it here (container ref is null), so stub it.
vi.mock('leaflet', () => ({
  default: {
    map: vi.fn(),
    geoJSON: vi.fn(),
    tileLayer: vi.fn(),
    DomEvent: { stopPropagation: vi.fn() },
  },
}));

import createRenderer, { type ReactTestRenderer } from 'react-test-renderer';
import LeafletBarangayMap from './LeafletBarangayMap';
import MapSection from './MapSection';

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
  const tree = createRenderer.create(React.createElement(LeafletBarangayMap, props));
  await act(async () => {
    await new Promise((r) => setImmediate(r));
  });
  return tree;
}

describe('<LeafletBarangayMap />', () => {
  it('shows a metric selector when there are 2+ numeric columns', async () => {
    const columns = ['code', 'barangay', 'hh', 'pop'];
    const rows: unknown[][] = [
      [1, 'BQ 1', 100, 5000],
      [2, 'BQ 2', 200, 6000],
    ];
    const tree = await renderMap({ columns, rows, theme: 'light', geojson: fixtureGeo() });
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('Metric:');
    expect(text).toContain('hh');
    expect(text).toContain('pop');
  });

  it('renders without a metric selector for a single numeric column', async () => {
    const columns = ['code', 'barangay', 'hh'];
    const rows: unknown[][] = [[1, 'BQ 1', 100]];
    const tree = await renderMap({ columns, rows, theme: 'light', geojson: fixtureGeo() });
    const text = JSON.stringify(tree.toJSON());
    expect(text).not.toContain('Metric:');
  });

  it('renders the legend with the metric min/max', async () => {
    const columns = ['code', 'barangay', 'hh'];
    const rows: unknown[][] = [
      [1, 'BQ 1', 100],
      [2, 'BQ 2', 900],
    ];
    const tree = await renderMap({ columns, rows, theme: 'light', geojson: fixtureGeo() });
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('map-legend');
    expect(text).toContain('100');
    expect(text).toContain('900');
  });

  it('shows the OSM + PSA + boundary-source attribution footer', async () => {
    const columns = ['code', 'barangay', 'hh'];
    const rows: unknown[][] = [[1, 'BQ 1', 100]];
    const tree = await renderMap({ columns, rows, theme: 'light', geojson: fixtureGeo() });
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('OpenStreetMap contributors');
    expect(text).toContain('OSSPhilippines');
  });

  it('renders "Map unavailable." for malformed GeoJSON', async () => {
    const columns = ['code', 'barangay', 'hh'];
    const rows: unknown[][] = [[1, 'BQ 1', 100]];
    const tree = await renderMap({ columns, rows, theme: 'light', geojson: 'not a FeatureCollection' });
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('Map unavailable.');
  });
});

describe('<MapSection /> (lazy "Show map" wiring)', () => {
  it('hides the map until toggled, then resolves the lazy Leaflet module', async () => {
    // The MapSection path fetches the asset (no `geojson` prop) — serve the fixture.
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, text: () => Promise.resolve(fixtureGeo()) }) as unknown as typeof fetch;
    try {
      const columns = ['code', 'barangay', 'hh'];
      const rows: unknown[][] = [[1, 'BQ 1', 100]];
      const tree = createRenderer.create(
        React.createElement(MapSection, { columns, rows, theme: 'light' }),
      );
      let text = JSON.stringify(tree.toJSON());
      expect(text).toContain('Show map');
      expect(text).not.toContain('map-leaflet');

      const btn = tree.root.findAllByType('button')[0];
      if (!btn) throw new Error('expected a toggle button');
      await act(async () => {
        btn.props.onClick();
        // Let the lazy import + Suspense + geojson effect settle.
        await new Promise((r) => setImmediate(r));
      });
      text = JSON.stringify(tree.toJSON());
      expect(text).toContain('Hide map');
      expect(text).toContain('map-leaflet');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
