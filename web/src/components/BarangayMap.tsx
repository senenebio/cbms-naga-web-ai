/**
 * Map feature (P3) — choropleth of a geographic `run_select` result.
 *
 * Renders the 27 Naga City barangays as SVG `<path>`s from the committed
 * `data/naga-barangays.geojson` (fetched once, module-cached) and colors them
 * by a numeric metric column from the result rows.
 *
 * - Hover shows a tooltip (name + value); click pins a detail row
 *   (name, value, urban/rural). Re-click or clicking an empty area clears.
 * - A metric `<select>` appears when the result has 2+ numeric columns.
 * - A legend shows the min/max of the metric.
 *
 * Grounding (M1): the map is grounded in an already-returned result. It only
 * appears for applicable results (a `code`/`barangay` key column + a numeric
 * column), toggled by the "Show map" control (`<MapSection />`) in the result
 * section — per-result state, collapsed by default.
 *
 * Theming (T3.8): a JS palette mirrors the CSS custom properties in
 * styles.css (SVG paint attributes can't reference `var()`), which also keeps
 * this testable without a DOM (react-test-renderer).
 *
 * The optional `geojson` prop overrides the fetched asset with raw text (used
 * by tests to avoid the network); when omitted the asset is fetched from
 * `/data/naga-barangays.geojson`.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  colorScale,
  matchRows,
  parseBarangayGeojson,
  projectToSvg,
  type BarangayFeature,
} from '../../../src/map/geo.js';
import { isRural } from '../../../src/data.js';
import type { Theme } from '../theme.js';

const MAP_W = 420;
const MAP_H = 150;

/** Mirrors the `:root` / `[data-theme='dark']` custom properties in styles.css. */
interface MapPalette {
  ink: string;
  muted: string;
  border: string;
  panel: string;
  surface: string;
}
const PALETTES: Record<Theme, MapPalette> = {
  light: { ink: '#1f2430', muted: '#6b7280', border: '#e2e5ea', panel: '#ffffff', surface: '#fbfcfe' },
  dark: { ink: '#e8ecf2', muted: '#9aa3b2', border: '#2a3140', panel: '#171c24', surface: '#1a2029' },
};

const GEO_URL = '/data/naga-barangays.geojson';

/** Module cache: fetch the GeoJSON asset once for the lifetime of the page. */
let geoPromise: Promise<string> | null = null;
function loadGeo(): Promise<string> {
  if (!geoPromise) {
    geoPromise = fetch(GEO_URL).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    });
  }
  return geoPromise;
}

/** A result is mappable when it has a code/barangay key column + a numeric metric. */
export function isMapApplicable(columns: string[], rows: unknown[][]): boolean {
  return keyColumn(columns) !== null && numericColumns(columns, rows).length > 0;
}

/** Prefer the `code` column, else the `barangay` name column. */
function keyColumn(columns: string[]): string | null {
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
function numericColumns(columns: string[], rows: unknown[][]): string[] {
  const key = keyColumn(columns);
  return columns
    .filter((c) => c !== key)
    .filter((c) => {
      const i = columns.indexOf(c);
      return rows.some((r) => isNumericValue(r[i]));
    });
}

function formatValue(v: number | null): string {
  return v === null ? 'n/a' : String(v);
}

interface BarangayMapProps {
  columns: string[];
  rows: unknown[][];
  theme: Theme;
  /** Raw GeoJSON text override (tests). When omitted, the asset is fetched. */
  geojson?: string;
}

export default function BarangayMap({ columns, rows, theme, geojson }: BarangayMapProps) {
  const [features, setFeatures] = useState<BarangayFeature[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [hoverCode, setHoverCode] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [valueCol, setValueCol] = useState<string>('');

  const key = keyColumn(columns);
  const numCols = useMemo(() => numericColumns(columns, rows), [columns, rows]);
  const metric = valueCol && numCols.includes(valueCol) ? valueCol : (numCols[0] ?? '');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const text = geojson ?? (await loadGeo());
        if (alive) setFeatures(parseBarangayGeojson(text));
      } catch {
        if (alive) setLoadError(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [geojson]);

  const palette = PALETTES[theme];

  // Derived render model (paths, fills, values) — recomputed when the metric
  // changes or the asset finishes loading.
  const model = useMemo(() => {
    if (!features || !key || !metric) return null;
    const rowObjs = rows.map((r) => {
      const o: Record<string, unknown> = {};
      columns.forEach((c, i) => {
        o[c] = r[i];
      });
      return o;
    });
    const values = matchRows(features, rowObjs, key, metric);
    const scale = colorScale(values);
    const paths = projectToSvg(features, { width: MAP_W, height: MAP_H });
    const byCode = new Map<string, { name: string; d: string; value: number | null; fill: string }>();
    features.forEach((f, i) => {
      const v = values[i] ?? null;
      byCode.set(f.code, { name: f.name, d: paths[i] ?? '', value: v, fill: scale(v) });
    });
    const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
    return {
      byCode,
      min: finite.length ? Math.min(...finite) : null,
      max: finite.length ? Math.max(...finite) : null,
    };
  }, [features, key, metric, rows, columns]);

  if (loadError) {
    return (
      <div className="barangay-map">
        <div className="note">Map unavailable.</div>
      </div>
    );
  }
  if (!model || !key) {
    return (
      <div className="barangay-map">
        <div className="note">Loading map…</div>
      </div>
    );
  }

  const hover = hoverCode ? model.byCode.get(hoverCode) : undefined;
  const selected = selectedCode ? model.byCode.get(selectedCode) : undefined;

  return (
    <div className="barangay-map">
      {numCols.length >= 2 && (
        <label className="map-metric">
          Metric:
          <select value={metric} onChange={(e) => setValueCol(e.target.value)}>
            {numCols.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="map-wrap">
        <svg
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          width="100%"
          height={MAP_H}
          role="img"
          aria-label="Choropleth map of Naga City barangays"
        >
          {/* Transparent backdrop: clicking empty area clears the selection. */}
          <rect
            x={0}
            y={0}
            width={MAP_W}
            height={MAP_H}
            fill="transparent"
            onClick={() => setSelectedCode(null)}
          />
          {[...model.byCode.entries()].map(([code, p]) => (
            <path
              key={code}
              d={p.d}
              fill={p.fill}
              stroke={palette.panel}
              strokeWidth={0.5}
              className={selectedCode === code ? 'map-region selected' : 'map-region'}
              onMouseEnter={() => setHoverCode(code)}
              onMouseLeave={() => setHoverCode(null)}
              onClick={() => setSelectedCode((cur) => (cur === code ? null : code))}
            />
          ))}
        </svg>
        {hover && (
          <div className="map-tooltip">
            {hover.name}: {formatValue(hover.value)}
          </div>
        )}
      </div>
      {selected && (
        <div className="map-detail">
          <strong>{selected.name}</strong>: {formatValue(selected.value)} {metric} ·{' '}
          {isRural(selected.name) ? 'Rural' : 'Urban'}
        </div>
      )}
      <div className="map-legend">
        <span>{formatValue(model.min)}</span>
        <div className="map-legend-ramp" aria-hidden="true" />
        <span>{formatValue(model.max)}</span>
      </div>
      <div className="map-attr">
        PSGC © PSA · Boundaries © NAMRIA · Data: Manuel Balmeo / bettergov.ph (MIT)
      </div>
    </div>
  );
}
