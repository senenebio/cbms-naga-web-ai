/**
 * Map feature — Leaflet choropleth of a geographic `run_select` result
 * (see specs/leaflet-map-spec.md). Replaces the former inline-SVG map.
 *
 * - Plain Leaflet (imperative `L.map` in an effect; no `react-leaflet` — it
 *   requires React 19). Loaded lazily (this module is a `React.lazy` chunk),
 *   so Leaflet's ~140 KB only ships when "Show map" is first opened.
 * - OSM basemap (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`, per the
 *   OSMF tile usage policy).
 * - Interactions: hover tooltip, click-pins a detail row (name, value,
 *   urban/rural), legend (min/max), metric `<select>` for 2+ numeric columns.
 *   Re-clicking a barangay or clicking the background clears the pin.
 * - Grounding (parent spec invariant): values come only from the
 *   already-returned result rows; the map never queries anything.
 *
 * The `geojson` prop overrides the fetched asset with raw text (tests).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  colorScale,
  keyColumn,
  matchRows,
  numericColumns,
  parseBarangayGeojson,
  shouldDropTileLayer,
  type BarangayFeature,
} from '@repo/map/geo.js';
import { isRural } from '@repo/data.js';
import type { Theme } from '../theme.js';

const GEO_URL = '/data/naga-barangays.geojson';
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
/** Subtle stroke opacity so basemap shows through the borders (fill is adjustable). */
const STROKE_OPACITY = 0.6;

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

/** Mirrors the `:root` / `.dark` custom properties in styles.css. */
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

function formatValue(v: number | null): string {
  return v === null ? 'n/a' : String(v);
}

interface LeafletBarangayMapProps {
  columns: string[];
  rows: unknown[][];
  theme: Theme;
  /** Raw GeoJSON text override (tests). When omitted, the asset is fetched. */
  geojson?: string;
}

export default function LeafletBarangayMap({ columns, rows, theme, geojson }: LeafletBarangayMapProps) {
  const [features, setFeatures] = useState<BarangayFeature[] | null>(null);
  const [fc, setFc] = useState<GeoJSON.FeatureCollection | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [valueCol, setValueCol] = useState('');
  const [tilesOffline, setTilesOffline] = useState(false);
  const [fillOpacity, setFillOpacity] = useState(0.45);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const geoLayerRef = useRef<L.GeoJSON | null>(null);
  const tileStatsRef = useRef({ failed: 0, loaded: 0 });

  const key = keyColumn(columns);
  const numCols = useMemo(() => numericColumns(columns, rows), [columns, rows]);
  const metric = valueCol && numCols.includes(valueCol) ? valueCol : (numCols[0] ?? '');

  // Load the asset (or the injected test fixture) once.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const text = geojson ?? (await loadGeo());
        if (!alive) return;
        setFc(JSON.parse(text) as GeoJSON.FeatureCollection);
        setFeatures(parseBarangayGeojson(text));
      } catch {
        if (alive) setLoadError(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [geojson]);

  // Derived render model (values, fills, min/max) — recomputed when the metric
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
    const byCode = new Map<string, { name: string; value: number | null; fill: string }>();
    features.forEach((f, i) => {
      const v = values[i] ?? null;
      byCode.set(f.code, { name: f.name, value: v, fill: scale(v) });
    });
    const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
    return {
      byCode,
      min: finite.length ? Math.min(...finite) : null,
      max: finite.length ? Math.max(...finite) : null,
    };
  }, [features, key, metric, rows, columns]);

  const palette = PALETTES[theme];

  // Map init: Leaflet map + OSM basemap + choropleth layer. The map is
  // (re)created only when the asset/theme changes — metric/selection changes
  // are applied via `setStyle` below, preserving the user's zoom/pan.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !fc) return;

    const map = L.map(el, { zoomControl: true, attributionControl: true });
    const bounds = L.geoJSON(fc).getBounds();
    map.fitBounds(bounds, { padding: [8, 8] });
    map.setMaxBounds(bounds.pad(3));

    // OSM basemap with graceful fallback: if a batch of tiles fails with no
    // successful loads (offline / blocked), drop the layer and continue as a
    // polygons-only choropleth. Stats are per-mount: re-opening the map
    // re-attempts tiles from scratch.
    const stats = tileStatsRef.current;
    const tile = L.tileLayer(OSM_TILE_URL, {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    tile.on('tileload', () => {
      stats.loaded += 1;
    });
    tile.on('tileerror', () => {
      stats.failed += 1;
      if (shouldDropTileLayer(stats.failed, stats.loaded)) {
        tile.off();
        map.removeLayer(tile);
        setTilesOffline(true);
      }
    });

    const styleFor = (feature: GeoJSON.Feature | undefined): L.PathOptions => {
      const code = String(feature?.properties?.code ?? '');
      const entry = model?.byCode.get(code);
      const selected = selectedCode === code;
      return {
        fillColor: entry?.fill ?? palette.muted,
        color: selected ? palette.ink : palette.border,
        weight: selected ? 2.5 : 1,
        fillOpacity,
        opacity: STROKE_OPACITY,
      };
    };
    const tooltipFor = (feature: GeoJSON.Feature): string => {
      const code = String(feature.properties?.code ?? '');
      const entry = model?.byCode.get(code);
      return entry ? `${entry.name}: ${formatValue(entry.value)}` : String(feature.properties?.barangay ?? '');
    };

    const layer = L.geoJSON(fc, {
      style: styleFor,
      onEachFeature: (feature, l) => {
        l.bindTooltip(tooltipFor(feature), { sticky: true });
        l.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          const code = String(feature.properties?.code ?? '');
          setSelectedCode((cur) => (cur === code ? null : code));
        });
      },
    }).addTo(map);
    geoLayerRef.current = layer;

    // Background click clears the pinned selection.
    map.on('click', () => setSelectedCode(null));

    return () => {
      map.remove();
      geoLayerRef.current = null;
      tileStatsRef.current = { failed: 0, loaded: 0 };
      setTilesOffline(false);
    };
  }, [fc, theme]);

  // Metric / selection / palette changes: restyle the existing layer in place
  // (no map recreation, so the user's zoom/pan is preserved).
  useEffect(() => {
    const layer = geoLayerRef.current;
    if (!layer || !model) return;
    layer.setStyle((feature: GeoJSON.Feature | undefined) => {
      const code = String(feature?.properties?.code ?? '');
      const entry = model.byCode.get(code);
      const selected = selectedCode === code;
      return {
        fillColor: entry?.fill ?? palette.muted,
        color: selected ? palette.ink : palette.border,
        weight: selected ? 2.5 : 1,
        fillOpacity,
        opacity: STROKE_OPACITY,
      };
    });
    layer.eachLayer((l) => {
      const fl = l as L.Path & { feature?: GeoJSON.Feature };
      const code = String(fl.feature?.properties?.code ?? '');
      const entry = model.byCode.get(code);
      if (entry) l.setTooltipContent(`${entry.name}: ${formatValue(entry.value)}`);
    });
  }, [model, selectedCode, palette, fillOpacity]);

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
      <label className="map-fill-opacity">
        Fill opacity:
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={fillOpacity}
          onChange={(e) => setFillOpacity(Number(e.target.value))}
        />
      </label>
      <div className="map-leaflet" ref={containerRef} />
      {tilesOffline && <div className="map-note">Basemap unavailable — polygons only.</div>}
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
        © OpenStreetMap contributors · PSGC © PSA · Boundaries © Christian Blanquera / OSSPhilippines (MIT)
      </div>
    </div>
  );
}
