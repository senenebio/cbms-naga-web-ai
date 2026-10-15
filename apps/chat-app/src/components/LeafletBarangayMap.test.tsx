/**
 * Map feature (P2, T2.4) — `<LeafletBarangayMap />` + `<MapSection />`
 * wrapper tests (jsdom / @testing-library/react).
 *
 * The GeoJSON is injected via the `geojson` prop as a 27-feature fixture.
 * Leaflet is mocked out (no real map tiles in tests); these cover the HTML
 * surface (metric selector, legend, attribution) and the lazy "Show map"
 * wiring. Leaflet rendering itself is verified manually (spec P4 gate).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// Leaflet is mocked out: no real map tiles in tests. The mock returns just
// enough of the Leaflet object graph for the component's init effect to run
// (`L.map(el, ...)` → map object with `fitBounds`/`setMaxBounds`/`on`/`remove`;
// `L.geoJSON(fc, ...)` → layer with `getBounds`/`addTo`/`setStyle`/`eachLayer`).
vi.mock('leaflet', () => {
  const makeMap = () => ({
    fitBounds: vi.fn(),
    setMaxBounds: vi.fn(),
    on: vi.fn(),
    remove: vi.fn(),
    removeLayer: vi.fn(),
  });
  const makeLayer = () => ({
    getBounds: () => ({ pad: () => ({}) }),
    addTo: vi.fn().mockReturnThis(),
    setStyle: vi.fn(),
    eachLayer: vi.fn(),
    bindTooltip: vi.fn(),
    on: vi.fn(),
  });
  return {
    default: {
      map: vi.fn(makeMap),
      geoJSON: vi.fn(makeLayer),
      tileLayer: vi
        .fn()
        .mockImplementation(() => ({ addTo: vi.fn().mockReturnThis(), on: vi.fn(), off: vi.fn() })),
      DomEvent: { stopPropagation: vi.fn() },
    },
  };
});

import LeafletBarangayMap from './LeafletBarangayMap';
import MapSection from './MapSection';

// jsdom lacks ResizeObserver; the map registers one to re-rasterize on
// container resize. Provide a no-op mock so the init effect can register it.
globalThis.ResizeObserver = vi.fn(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));

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

describe('<LeafletBarangayMap />', () => {
  it('shows a metric selector when there are 2+ numeric columns', async () => {
    const columns = ['code', 'barangay', 'hh', 'pop'];
    const rows: unknown[][] = [
      [1, 'BQ 1', 100, 5000],
      [2, 'BQ 2', 200, 6000],
    ];
    render(<LeafletBarangayMap columns={columns} rows={rows} theme="light" geojson={fixtureGeo()} />);
    await waitFor(() => expect(screen.getByText('Metric:')).toBeInTheDocument());
    // The metric select (labeled "Metric:") offers both numeric columns.
    const select = screen.getByLabelText('Metric:');
    expect(select).toBeInTheDocument();
  });

  it('shows a basemap selector with OpenStreetMap and OpenTopoMap', async () => {
    const columns = ['code', 'barangay', 'hh'];
    const rows: unknown[][] = [[1, 'BQ 1', 100]];
    render(<LeafletBarangayMap columns={columns} rows={rows} theme="light" geojson={fixtureGeo()} />);
    const select = screen.getByLabelText('Basemap:');
    expect(select).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'OpenStreetMap' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'OpenTopoMap' })).toBeInTheDocument();
  });

  it('renders without a metric selector for a single numeric column', async () => {
    const columns = ['code', 'barangay', 'hh'];
    const rows: unknown[][] = [[1, 'BQ 1', 100]];
    render(<LeafletBarangayMap columns={columns} rows={rows} theme="light" geojson={fixtureGeo()} />);
    await waitFor(() => expect(screen.queryByText('Metric:')).not.toBeInTheDocument());
  });

  it('renders the legend with the metric min/max', async () => {
    const columns = ['code', 'barangay', 'hh'];
    const rows: unknown[][] = [
      [1, 'BQ 1', 100],
      [2, 'BQ 2', 900],
    ];
    render(<LeafletBarangayMap columns={columns} rows={rows} theme="light" geojson={fixtureGeo()} />);
    // The legend row (min → gradient → max) appears once the geojson resolves.
    await waitFor(() => expect(screen.getByText('900')).toBeInTheDocument());
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('shows the OSM + PSA + boundary-source attribution footer', async () => {
    const columns = ['code', 'barangay', 'hh'];
    const rows: unknown[][] = [[1, 'BQ 1', 100]];
    render(<LeafletBarangayMap columns={columns} rows={rows} theme="light" geojson={fixtureGeo()} />);
    await waitFor(() =>
      expect(screen.getByText(/OpenStreetMap contributors/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/faeldon\/philippines-json-maps/)).toBeInTheDocument();
  });

  it('renders "Map unavailable." for malformed GeoJSON', async () => {
    const columns = ['code', 'barangay', 'hh'];
    const rows: unknown[][] = [[1, 'BQ 1', 100]];
    render(
      <LeafletBarangayMap
        columns={columns}
        rows={rows}
        theme="light"
        geojson="not a FeatureCollection"
      />,
    );
    await waitFor(() => expect(screen.getByText('Map unavailable.')).toBeInTheDocument());
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
      render(
        <MapSection columns={['code', 'barangay', 'hh']} rows={[[1, 'BQ 1', 100]]} theme="light" />,
      );

      expect(screen.getByText('Show map')).toBeInTheDocument();
      expect(screen.queryByText('map-leaflet')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Show map' }));

      // The lazy module resolves and the map surface mounts.
      await waitFor(() => expect(screen.queryByText('Hide map')).toBeInTheDocument());
      expect(screen.queryByText('map-leaflet')).not.toBeInTheDocument();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
