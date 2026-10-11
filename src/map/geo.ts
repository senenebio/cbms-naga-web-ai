/**
 * Pure map core for the barangay choropleth (spec P2).
 *
 * Driver-free: imported by `web/` and by Node tests. No `node:` imports.
 * No external dependencies — only built-in TypeScript/JS.
 *
 * Functions:
 * - `parseBarangayGeojson` — parse a GeoJSON FeatureCollection into typed features
 * - `matchRows` — match warehouse result rows to features by code
 * - `colorScale` — sequential light→dark color scale for choropleth fills
 * - `shouldDropTileLayer` — basemap tile-failure decision (Leaflet map)
 * - `isMapApplicable` — result-shape check (key column + numeric metric)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BarangayFeature {
  /** Barangay code (matches warehouse `barangay.code`). */
  code: string;
  /** Display name. */
  name: string;
  /**
   * Rings: array of polygon rings.
   * Each ring is an array of `[lon, lat]` points.
   * For MultiPolygon geometries, all rings from all sub-polygons are
   * flattened into this single array (each ring → one SVG subpath).
   */
  rings: number[][][];
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class MapGeoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapGeoError';
  }
}

// ---------------------------------------------------------------------------
// parseBarangayGeojson
// ---------------------------------------------------------------------------

/**
 * Parse a GeoJSON FeatureCollection string into typed barangay features.
 *
 * Supports `Polygon` and `MultiPolygon` geometries.
 * Each feature must have `properties.code` and `properties.barangay`
 * (non-blank strings).
 *
 * @throws {MapGeoError} on any malformed input.
 */
export function parseBarangayGeojson(text: string): BarangayFeature[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MapGeoError('invalid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new MapGeoError('top level must be a JSON object');
  }

  const fc = parsed as Record<string, unknown>;
  if (fc.type !== 'FeatureCollection') {
    throw new MapGeoError('GeoJSON must be a FeatureCollection');
  }

  if (!Array.isArray(fc.features)) {
    throw new MapGeoError('FeatureCollection must have a "features" array');
  }

  const rawFeatures = fc.features as unknown[];

  return rawFeatures.map((raw, i) => parseFeature(raw, i));
}

function parseFeature(raw: unknown, idx: number): BarangayFeature {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new MapGeoError(`features[${idx}] must be an object`);
  }
  const feat = raw as Record<string, unknown>;

  if (feat.type !== 'Feature') {
    throw new MapGeoError(`features[${idx}].type must be "Feature"`);
  }

  // --- properties ---
  const props = feat.properties;
  if (typeof props !== 'object' || props === null) {
    throw new MapGeoError(`features[${idx}].properties must be an object`);
  }
  const p = props as Record<string, unknown>;

  const code = p.code;
  if (typeof code !== 'string' || code.trim() === '') {
    throw new MapGeoError(`features[${idx}].properties.code must be a non-blank string`);
  }

  const name = p.barangay;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new MapGeoError(`features[${idx}].properties.barangay must be a non-blank string`);
  }

  // --- geometry ---
  const geom = feat.geometry;
  if (typeof geom !== 'object' || geom === null) {
    throw new MapGeoError(`features[${idx}].geometry must be an object`);
  }
  const g = geom as Record<string, unknown>;

  let rings: number[][][];

  if (g.type === 'Polygon') {
    const coords = g.coordinates;
    if (!Array.isArray(coords)) {
      throw new MapGeoError(`features[${idx}]: Polygon coordinates must be an array`);
    }
    rings = validateRings(coords, idx);
  } else if (g.type === 'MultiPolygon') {
    const coords = g.coordinates;
    if (!Array.isArray(coords)) {
      throw new MapGeoError(`features[${idx}]: MultiPolygon coordinates must be an array`);
    }
    rings = [];
    for (const poly of coords as unknown[]) {
      if (!Array.isArray(poly)) {
        throw new MapGeoError(`features[${idx}]: each MultiPolygon polygon must be an array of rings`);
      }
      rings.push(...validateRings(poly, idx));
    }
  } else {
    throw new MapGeoError(
      `features[${idx}].geometry.type must be "Polygon" or "MultiPolygon", got ${JSON.stringify(g.type)}`,
    );
  }

  return { code: code.trim(), name: name.trim(), rings };
}

/** Validate an array of rings (number[][] → [lon, lat] points). */
function validateRings(raw: unknown, featIdx: number): number[][][] {
  if (!Array.isArray(raw)) {
    throw new MapGeoError(`features[${featIdx}]: rings must be an array`);
  }
  const result: number[][][] = [];
  for (let ri = 0; ri < raw.length; ri++) {
    const ringRaw = raw[ri];
    if (!Array.isArray(ringRaw)) {
      throw new MapGeoError(`features[${featIdx}]: ring ${ri} must be an array of points`);
    }
    const ring: number[][] = [];
    for (let pi = 0; pi < ringRaw.length; pi++) {
      const ptRaw = ringRaw[pi];
      if (!Array.isArray(ptRaw) || ptRaw.length < 2) {
        throw new MapGeoError(`features[${featIdx}]: ring ${ri} point ${pi} must be [lon, lat]`);
      }
      const x = ptRaw[0];
      const y = ptRaw[1];
      if (typeof x !== 'number' || !Number.isFinite(x)) {
        throw new MapGeoError(`features[${featIdx}]: ring ${ri} point ${pi} lon must be a finite number`);
      }
      if (typeof y !== 'number' || !Number.isFinite(y)) {
        throw new MapGeoError(`features[${featIdx}]: ring ${ri} point ${pi} lat must be a finite number`);
      }
      ring.push([x, y]);
    }
    result.push(ring);
  }
  return result;
}

// ---------------------------------------------------------------------------
// matchRows
// ---------------------------------------------------------------------------

/**
 * Match warehouse result rows to features by code, falling back to name.
 *
 * A feature is matched when the row's key value equals the feature's `code`
 * OR its `barangay` name. Queries may group by `code` (the warehouse key) or
 * by `barangay` (the name); either way the row's key column holds the value
 * to match. Normalization: `String(value).trim()` on both sides. No numeric
 * normalization — `'01'` does NOT match `'1'`. This is deliberate: the
 * warehouse `barangay.code` and the GeoJSON `code` asset must use the same
 * format, and the names are consistently cased (uppercase) in both sources.
 *
 * @returns Array (same length as `features`) of numeric values;
 *          `null` for unmatched features or non-numeric values.
 */
export function matchRows(
  features: BarangayFeature[],
  rows: Array<Record<string, unknown>>,
  keyCol: string,
  valueCol: string,
): Array<number | null> {
  // Build a lookup: normalized key → raw value (first row wins on dupes).
  const lookup = new Map<string, unknown>();
  for (const row of rows) {
    const key = String(row[keyCol] ?? '').trim();
    if (key !== '' && !lookup.has(key)) {
      lookup.set(key, row[valueCol]);
    }
  }

  return features.map((f) => {
    // Match by code first, then by name (a query may group by either).
    const byCode = lookup.get(f.code.trim());
    if (byCode !== undefined) return coerceFinite(byCode);
    const byName = lookup.get(f.name.trim());
    if (byName !== undefined) return coerceFinite(byName);
    return null;
  });
}

/** Coerce a value to a finite number, or `null`. */
function coerceFinite(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// colorScale
// ---------------------------------------------------------------------------

/**
 * Create a sequential light→dark color scale for choropleth fills.
 *
 * - `null` (or non-finite) values → neutral "no data" fill.
 * - Single value / all-equal values → mid-ramp color.
 * - Negatives and zeros work correctly (linear interpolation on the value range).
 * - All-null input → the returned function always returns the neutral fill
 *   (does not throw).
 *
 * Ramp: `#e3f2fd` (light blue) → `#0d47a1` (dark blue).
 */
export function colorScale(values: Array<number | null>): (v: number | null) => string {
  const NO_DATA = '#d4d4d4';

  // Collect finite numbers.
  const nums: number[] = [];
  for (const v of values) {
    if (v !== null && Number.isFinite(v)) nums.push(v);
  }

  if (nums.length === 0) {
    return () => NO_DATA;
  }

  const min = Math.min(...nums);
  const max = Math.max(...nums);

  // Blue ramp endpoints.
  const LIGHT: readonly [number, number, number] = [227, 242, 253]; // #e3f2fd
  const DARK: readonly [number, number, number] = [13, 71, 161]; // #0d47a1

  function lerp(a: number, b: number, t: number): number {
    return Math.round(a + (b - a) * t);
  }

  function rgb(r: number, g: number, b: number): string {
    return `rgb(${r}, ${g}, ${b})`;
  }

  const midR = lerp(LIGHT[0], DARK[0], 0.5);
  const midG = lerp(LIGHT[1], DARK[1], 0.5);
  const midB = lerp(LIGHT[2], DARK[2], 0.5);
  const MID = rgb(midR, midG, midB);

  return (v: number | null) => {
    if (v === null || !Number.isFinite(v)) return NO_DATA;

    if (min === max) {
      return MID;
    }

    const t = (v - min) / (max - min);
    return rgb(
      lerp(LIGHT[0], DARK[0], t),
      lerp(LIGHT[1], DARK[1], t),
      lerp(LIGHT[2], DARK[2], t),
    );
  };
}

/**
 * Basemap tile-failure decision (Leaflet map, P3 — pure, unit-testable).
 *
 * The map keeps its OSM basemap while any tile is loading successfully. Once
 * a batch of tile errors accumulates with zero successful loads (offline /
 * blocked network), the tile layer is dropped and the map continues as a
 * polygons-only choropleth. `loaded > 0` is sticky: a single successful tile
 * means the network path works, so later transient errors are ignored.
 *
 * @param failed  number of `tileerror` events seen for the tile layer
 * @param loaded  number of `tileload` events seen for the tile layer
 * @returns true when the tile layer should be removed
 */
export function shouldDropTileLayer(failed: number, loaded: number): boolean {
  if (loaded > 0) return false;
  return failed >= TILE_FAIL_THRESHOLD;
}

/** Tile errors (with zero successful loads) before the basemap is dropped. */
export const TILE_FAIL_THRESHOLD = 4;

/**
 * Result-shape check: is a `run_select` result mappable?
 *
 * A result is mappable when it has a key column (`code`, else `barangay`)
 * and at least one numeric metric column (the key column itself is excluded
 * — a bare integer `code` is not a metric). Pure; imported by the UI to
 * decide whether to offer the "Show map" affordance, and kept driver-free
 * so it can be tested from Node without pulling in the Leaflet chunk.
 */
export function isMapApplicable(columns: string[], rows: unknown[][]): boolean {
  return keyColumn(columns) !== null && numericColumns(columns, rows).length > 0;
}

/** Prefer the `code` column, else the `barangay` name column. */
export function keyColumn(columns: string[]): string | null {
  if (columns.includes('code')) return 'code';
  if (columns.includes('barangay')) return 'barangay';
  return null;
}

function isNumericValue(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string' && v.trim() !== '') return Number.isFinite(Number(v));
  return false;
}

/**
 * Metric columns: columns with at least one numeric value, excluding the key
 * column (a bare integer `code` is not a mappable metric).
 */
export function numericColumns(columns: string[], rows: unknown[][]): string[] {
  const key = keyColumn(columns);
  return columns
    .filter((c) => c !== key)
    .filter((c) => {
      const i = columns.indexOf(c);
      return rows.some((r) => isNumericValue(r[i]));
    });
}
