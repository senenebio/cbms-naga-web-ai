/**
 * P2 — Unit tests for the pure map core (`src/map/geo.ts`).
 *
 * Inline fixture GeoJSON (no network, no data files).
 * Covers: parse, projection, matchRows, colorScale.
 */
import { describe, it, expect } from 'vitest';
import {
  parseBarangayGeojson,
  matchRows,
  colorScale,
  isMapApplicable,
  shouldDropTileLayer,
  MapGeoError,
  type BarangayFeature,
} from '../src/map/geo.js';

// ---------------------------------------------------------------------------
// Inline fixtures
// ---------------------------------------------------------------------------

/** Two valid features: one Polygon, one MultiPolygon. */
const VALID_FC = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { code: '01', barangay: 'Poblacion' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [123.9, 13.6],
            [123.95, 13.6],
            [123.95, 13.65],
            [123.9, 13.65],
            [123.9, 13.6],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { code: '02', barangay: 'San Pedro' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [123.96, 13.66],
              [123.98, 13.66],
              [123.98, 13.68],
              [123.96, 13.68],
              [123.96, 13.66],
            ],
          ],
          [
            [
              [123.99, 13.69],
              [123.995, 13.69],
              [123.995, 13.695],
              [123.99, 13.69],
              [123.99, 13.695],
            ],
          ],
        ],
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// parseBarangayGeojson
// ---------------------------------------------------------------------------

describe('parseBarangayGeojson', () => {
  it('parses a valid FeatureCollection with Polygon and MultiPolygon', () => {
    const features = parseBarangayGeojson(VALID_FC);
    expect(features).toHaveLength(2);

    // Feature 0: Polygon
    expect(features[0]).toEqual({
      code: '01',
      name: 'Poblacion',
      rings: [
        [
          [123.9, 13.6],
          [123.95, 13.6],
          [123.95, 13.65],
          [123.9, 13.65],
          [123.9, 13.6],
        ],
      ],
    });

    // Feature 1: MultiPolygon → rings flattened
    const f1 = features[1]!;
    expect(f1.code).toBe('02');
    expect(f1.name).toBe('San Pedro');
    expect(f1.rings).toHaveLength(2); // 2 sub-polygons, 1 ring each
    expect(f1.rings[0]).toEqual([
      [123.96, 13.66],
      [123.98, 13.66],
      [123.98, 13.68],
      [123.96, 13.68],
      [123.96, 13.66],
    ]);
    expect(f1.rings[1]).toEqual([
      [123.99, 13.69],
      [123.995, 13.69],
      [123.995, 13.695],
      [123.99, 13.69],
      [123.99, 13.695],
    ]);
  });

  it('trims code and name whitespace', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { code: ' 07 ', barangay: '  Rizal  ' },
          geometry: {
            type: 'Polygon',
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
          },
        },
      ],
    });
    const features = parseBarangayGeojson(geojson);
    expect(features[0]!.code).toBe('07');
    expect(features[0]!.name).toBe('Rizal');
  });

  // --- rejection cases ---

  it('rejects invalid JSON', () => {
    expect(() => parseBarangayGeojson('not json')).toThrow(MapGeoError);
  });

  it('rejects non-FeatureCollection', () => {
    expect(() => parseBarangayGeojson(JSON.stringify({ type: 'Feature' }))).toThrow(MapGeoError);
    expect(() => parseBarangayGeojson(JSON.stringify({ type: 'GeometryCollection' }))).toThrow(
      MapGeoError,
    );
  });

  it('rejects missing features array', () => {
    expect(() => parseBarangayGeojson(JSON.stringify({ type: 'FeatureCollection' }))).toThrow(
      MapGeoError,
    );
  });

  it('rejects a feature missing code', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { barangay: 'No Code' },
          geometry: {
            type: 'Polygon',
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
          },
        },
      ],
    });
    expect(() => parseBarangayGeojson(geojson)).toThrow(MapGeoError);
  });

  it('rejects a feature with blank code', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { code: '   ', barangay: 'Blank' },
          geometry: {
            type: 'Polygon',
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
          },
        },
      ],
    });
    expect(() => parseBarangayGeojson(geojson)).toThrow(MapGeoError);
  });

  it('rejects a feature missing barangay name', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { code: '01' },
          geometry: {
            type: 'Polygon',
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
          },
        },
      ],
    });
    expect(() => parseBarangayGeojson(geojson)).toThrow(MapGeoError);
  });

  it('rejects an unsupported geometry type (LineString)', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { code: '01', barangay: 'X' },
          geometry: {
            type: 'LineString',
            coordinates: [[0, 0], [1, 1]],
          },
        },
      ],
    });
    expect(() => parseBarangayGeojson(geojson)).toThrow(MapGeoError);
  });

  it('rejects a non-array top level', () => {
    expect(() => parseBarangayGeojson(JSON.stringify('hello'))).toThrow(MapGeoError);
    expect(() => parseBarangayGeojson(JSON.stringify(42))).toThrow(MapGeoError);
  });
});

// ---------------------------------------------------------------------------
// matchRows
// ---------------------------------------------------------------------------

describe('matchRows', () => {
  const features: BarangayFeature[] = [
    { code: '01', name: 'Poblacion', rings: [] },
    { code: '02', name: 'San Pedro', rings: [] },
    { code: '03', name: 'Rizal', rings: [] },
  ];

  it('matches rows to features by code', () => {
    const rows = [
      { code: '01', value: 100 },
      { code: '02', value: 200 },
    ];
    const result = matchRows(features, rows, 'code', 'value');
    expect(result).toEqual([100, 200, null]);
  });

  it('returns null for unmatched codes', () => {
    const rows = [{ code: '99', value: 42 }];
    const result = matchRows(features, rows, 'code', 'value');
    expect(result).toEqual([null, null, null]);
  });

  it('returns null for non-numeric values', () => {
    const rows = [
      { code: '01', value: 'not a number' },
      { code: '02', value: null },
      { code: '03', value: undefined },
    ];
    const result = matchRows(features, rows, 'code', 'value');
    expect(result).toEqual([null, null, null]);
  });

  it('coerces numeric strings', () => {
    const rows = [
      { code: '01', value: '123' },
    ];
    const result = matchRows(features, rows, 'code', 'value');
    expect(result[0]).toBe(123);
  });

  it('normalizes codes with trim (String + trim on both sides)', () => {
    const rows = [
      { code: ' 01 ', value: 50 },
    ];
    const result = matchRows(features, rows, 'code', 'value');
    expect(result[0]).toBe(50);
  });

  it('does NOT normalize numerically (01 ≠ 1)', () => {
    const rows = [
      { code: '1', value: 10 },
    ];
    const result = matchRows(features, rows, 'code', 'value');
    expect(result[0]).toBeNull(); // '01' ≠ '1'
  });

  it('handles empty rows array', () => {
    const result = matchRows(features, [], 'code', 'value');
    expect(result).toEqual([null, null, null]);
  });

  it('first row wins on duplicate keys', () => {
    const rows = [
      { code: '01', value: 10 },
      { code: '01', value: 99 },
    ];
    const result = matchRows(features, rows, 'code', 'value');
    expect(result[0]).toBe(10);
  });

  it('returns null for NaN values', () => {
    const rows = [{ code: '01', value: NaN }];
    const result = matchRows(features, rows, 'code', 'value');
    expect(result[0]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// colorScale
// ---------------------------------------------------------------------------

describe('colorScale', () => {
  it('returns a function', () => {
    const scale = colorScale([1, 2, 3]);
    expect(typeof scale).toBe('function');
  });

  it('produces distinct colors for distinct values', () => {
    const scale = colorScale([0, 50, 100]);
    const c0 = scale(0);
    const c50 = scale(50);
    const c100 = scale(100);
    expect(c0).not.toBe(c50);
    expect(c50).not.toBe(c100);
  });

  it('maps lower values lighter and higher values darker', () => {
    const scale = colorScale([0, 100]);
    const low = scale(0)!;
    const high = scale(100)!;

    // Parse rgb values
    const parseRgb = (s: string) => {
      const m = s.match(/\d+/g);
      return m ? m.map(Number) : [0, 0, 0];
    };
    const [r1, g1, b1] = parseRgb(low);
    const [r2, g2, b2] = parseRgb(high);
    // Darker = lower RGB values
    expect(r2).toBeLessThan(r1);
    expect(g2).toBeLessThan(g1);
    expect(b2).toBeLessThan(b1);
  });

  it('handles null → neutral no-data fill', () => {
    const scale = colorScale([10, 20, null]);
    const cNull = scale(null);
    const cNum = scale(10);
    expect(cNull).toBe('#d4d4d4');
    expect(cNull).not.toBe(cNum);
  });

  it('handles a single value (min === max) → mid color', () => {
    const scale = colorScale([42]);
    const c = scale(42);
    expect(c).toMatch(/^rgb\(/);
    // Should not be the no-data color
    expect(c).not.toBe('#d4d4d4');
  });

  it('handles all-equal values → same color for all', () => {
    const scale = colorScale([7, 7, 7]);
    expect(scale(7)).toBe(scale(7));
    expect(scale(7)).not.toBe('#d4d4d4');
  });

  it('handles negative values', () => {
    const scale = colorScale([-10, 0, 10]);
    expect(scale(-10)).toMatch(/^rgb\(/);
    expect(scale(0)).toMatch(/^rgb\(/);
    expect(scale(10)).toMatch(/^rgb\(/);
    // Distinct
    expect(scale(-10)).not.toBe(scale(0));
    expect(scale(0)).not.toBe(scale(10));
  });

  it('handles zeros', () => {
    const scale = colorScale([0, 0, 10]);
    expect(scale(0)).toMatch(/^rgb\(/);
    expect(scale(10)).toMatch(/^rgb\(/);
    expect(scale(0)).not.toBe(scale(10));
  });

  it('handles all-null input (does not throw, returns neutral)', () => {
    const scale = colorScale([null, null, null]);
    expect(scale(null)).toBe('#d4d4d4');
    expect(scale(5)).toBe('#d4d4d4'); // even a number gets no-data since no range
  });

  it('handles empty array (does not throw)', () => {
    const scale = colorScale([]);
    expect(scale(null)).toBe('#d4d4d4');
  });

  it('produces valid CSS color strings', () => {
    const scale = colorScale([1, 2, 3]);
    for (const v of [1, 2, 3, null]) {
      const c = scale(v);
      expect(c).toMatch(/^(#[\da-fA-F]{6}|rgb\(\d+, \d+, \d+\))$/);
    }
  });
});

describe('isMapApplicable', () => {
  it('is true for a code column + a numeric metric', () => {
    expect(isMapApplicable(['code', 'barangay', 'hh'], [[1, 'A', 10]])).toBe(true);
  });

  it('is true for a barangay key (no code column) + a numeric metric', () => {
    expect(isMapApplicable(['barangay', 'hh'], [['A', 10]])).toBe(true);
  });

  it('is false when there is no key column', () => {
    expect(isMapApplicable(['name', 'hh'], [['A', 10]])).toBe(false);
  });

  it('is false when the key column is the only numeric column', () => {
    expect(isMapApplicable(['code', 'barangay'], [[1, 'A']])).toBe(false);
  });

  it('accepts numeric strings as metric values', () => {
    expect(isMapApplicable(['code', 'hh'], [[1, '10']])).toBe(true);
  });
});

describe('shouldDropTileLayer', () => {
  it('keeps the basemap while no errors have occurred', () => {
    expect(shouldDropTileLayer(0, 0)).toBe(false);
  });

  it('keeps the basemap below the failure threshold (zero loads)', () => {
    expect(shouldDropTileLayer(1, 0)).toBe(false);
    expect(shouldDropTileLayer(3, 0)).toBe(false);
  });

  it('drops the basemap at the failure threshold (zero loads)', () => {
    expect(shouldDropTileLayer(4, 0)).toBe(true);
    expect(shouldDropTileLayer(99, 0)).toBe(true);
  });

  it('never drops once a tile has loaded successfully (sticky)', () => {
    expect(shouldDropTileLayer(4, 1)).toBe(false);
    expect(shouldDropTileLayer(50, 3)).toBe(false);
  });
});
