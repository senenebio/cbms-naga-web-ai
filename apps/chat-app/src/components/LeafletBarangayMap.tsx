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
import { BRAND } from '../brand.js';

/** Rural classification from the brand's dataset descriptor (D7). */
const isRural = (name: string): boolean =>
  BRAND.dataset.ruralBarangays.includes(name.toUpperCase());
import { resolvePalette } from './palette.js';
import type { Theme } from '../theme.js';

const GEO_URL = `/data/${BRAND.dataset.id}/${BRAND.dataset.geojson}?v=${__DATA_VERSION__}`;

/**
 * Basemap options. All are open (OpenStreetMap data). OpenTopoMap is a
 * volunteer-run server, so we cap its zoom to be a good citizen. The Landuse
 * option is a WMS (see `WMS_BASEMAPS`), kept as a separate path because it's
 * drawn on request rather than served as a tile cache.
 */
type BasemapId = 'osm' | 'opentopo' | 'landuse';

/** XYZ (tile-cache) basemaps — plain `{z}/{x}/{y}` image tiles. */
const XYZ_BASEMAPS: Record<
  'osm' | 'opentopo',
  { label: string; url: string; attribution: string; maxZoom: number }
> = {
  osm: {
    label: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  },
  opentopo: {
    label: 'OpenTopoMap',
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)',
    maxZoom: 17,
  },
};

/**
 * WMS basemaps — drawn on request (not a tile cache). osmlanduse.org's
 * MapProxy XYZ cache is dead (404), so we talk to the WMS directly. Coarse
 * thematic landuse/landcover: renders at low zoom, is blank at street zoom,
 * and has no coverage over Naga / the Philippines. See landuse-basemap-spec.
 */
const WMS_BASEMAPS: Record<
  'landuse',
  { label: string; url: string; layers: string; attribution: string; maxZoom: number }
> = {
  landuse: {
    label: 'OSM Landuse',
    url: 'https://maps.heigit.org/osmlanduse/service',
    layers: 'osmlanduse:osm_lulc_combined_osm4eo',
    attribution: 'OSM Landuse © OpenStreetMap contributors &amp; GIScience Heidelberg (ODbL)',
    maxZoom: 12,
  },
};

/** All basemap options, in selector order (XYZ first, then WMS). */
const BASEMAP_OPTIONS: [BasemapId, string][] = [
  ...Object.entries(XYZ_BASEMAPS).map(([id, b]) => [id, b.label] as [BasemapId, string]),
  ...Object.entries(WMS_BASEMAPS).map(([id, b]) => [id, b.label] as [BasemapId, string]),
];

/** Create a basemap tile layer with the shared offline-fallback behavior. */
function addTileLayer(
  map: L.Map,
  id: BasemapId,
  stats: { failed: number; loaded: number },
  onOffline: () => void,
): L.TileLayer {
  let tile: L.TileLayer;
  const wms = WMS_BASEMAPS[id as 'landuse'];
  if (wms) {
    tile = L.tileLayer.wms(wms.url, {
      layers: wms.layers,
      attribution: wms.attribution,
      maxZoom: wms.maxZoom,
      format: 'image/png',
      transparent: false,
    }).addTo(map);
  } else {
    const xyz = XYZ_BASEMAPS[id as 'osm' | 'opentopo'];
    tile = L.tileLayer(xyz.url, { attribution: xyz.attribution, maxZoom: xyz.maxZoom }).addTo(map);
  }
  tile.on('tileload', () => {
    stats.loaded += 1;
  });
  tile.on('tileerror', () => {
    stats.failed += 1;
    if (shouldDropTileLayer(stats.failed, stats.loaded)) {
      tile.off();
      map.removeLayer(tile);
      onOffline();
    }
  });
  return tile;
}

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
  const [basemap, setBasemap] = useState<BasemapId>('osm');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const geoLayerRef = useRef<L.GeoJSON | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const tileBasemapRef = useRef<BasemapId | null>(null);
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

  const palette = resolvePalette(theme);

  // Map init: Leaflet map + OSM basemap + choropleth layer. The map is
  // (re)created only when the asset/theme changes — metric/selection changes
  // are applied via `setStyle` below, preserving the user's zoom/pan.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !fc) return;

    const map = L.map(el, { zoomControl: true, attributionControl: true });
    mapRef.current = map;

    // Leaflet does not auto-resize its canvas when the container changes
    // (browser resize, or the bubble's percentage width growing). Observe the
    // container and re-rasterize on size change.
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(el);

    const bounds = L.geoJSON(fc).getBounds();
    map.fitBounds(bounds, { padding: [8, 8] });
    map.setMaxBounds(bounds.pad(3));

    // Basemap with graceful fallback: if a batch of tiles fails with no
    // successful loads (offline / blocked), drop the layer and continue as a
    // polygons-only choropleth. Stats are per-mount: re-opening the map
    // re-attempts tiles from scratch.
    tileStatsRef.current = { failed: 0, loaded: 0 };
    tileLayerRef.current = addTileLayer(map, basemap, tileStatsRef.current, () => setTilesOffline(true));
    tileBasemapRef.current = basemap;

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
      resizeObserver.disconnect();
      map.remove();
      geoLayerRef.current = null;
      mapRef.current = null;
      tileLayerRef.current = null;
      tileBasemapRef.current = null;
      tileStatsRef.current = { failed: 0, loaded: 0 };
      setTilesOffline(false);
    };
    // Deliberate: the map is built once per data/theme. Metric/selection/
    // palette changes are applied by the restyle effect below, not by
    // re-running this (re-running would rebuild the map and reset zoom/pan).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fc, theme]);

  // Basemap change: swap the tile layer in place (no map recreation, so the
  // user's zoom/pan is preserved) and reset the offline-fallback state.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || tileBasemapRef.current === basemap) return;
    const prev = tileLayerRef.current;
    if (prev) map.removeLayer(prev);
    tileStatsRef.current = { failed: 0, loaded: 0 };
    setTilesOffline(false);
    tileLayerRef.current = addTileLayer(map, basemap, tileStatsRef.current, () => setTilesOffline(true));
    tileBasemapRef.current = basemap;
  }, [basemap]);

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
      <div className="flex flex-col gap-1.5 pt-2">
        <div className="text-xs text-muted-foreground">Map unavailable.</div>
      </div>
    );
  }
  if (!model || !key) {
    return (
      <div className="flex flex-col gap-1.5 pt-2">
        <div className="text-xs text-muted-foreground">Loading map…</div>
      </div>
    );
  }

  const selected = selectedCode ? model.byCode.get(selectedCode) : undefined;

  return (
    <div className="flex flex-col gap-1.5 pt-2">
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Basemap:
        <select
          value={basemap}
          onChange={(e) => setBasemap(e.target.value as BasemapId)}
          className="rounded-md border bg-background px-1.5 py-1 text-xs"
        >
          {BASEMAP_OPTIONS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {numCols.length >= 2 && (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Metric:
          <select
            value={metric}
            onChange={(e) => setValueCol(e.target.value)}
            className="rounded-md border bg-background px-1.5 py-1 text-xs"
          >
            {numCols.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Fill opacity:
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={fillOpacity}
          onChange={(e) => setFillOpacity(Number(e.target.value))}
          className="w-30 accent-brand-primary"
        />
      </label>
      <div className="map-leaflet h-80 overflow-hidden rounded-md border" ref={containerRef} />
      {tilesOffline && (
        <div className="text-xs text-muted-foreground">Basemap unavailable — polygons only.</div>
      )}
      {selected && (
        <div className="text-xs">
          <strong>{selected.name}</strong>: {formatValue(selected.value)} {metric} ·{' '}
          {isRural(selected.name) ? 'Rural' : 'Urban'}
        </div>
      )}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{formatValue(model.min)}</span>
        <div
          className="h-2 flex-1 rounded-sm bg-gradient-to-r from-blue-100 to-blue-900"
          aria-hidden="true"
        />
        <span>{formatValue(model.max)}</span>
      </div>
      <div className="text-[10.5px] text-muted-foreground">
        © OpenStreetMap contributors · PSGC © PSA · Boundaries © Faeldon — faeldon/philippines-json-maps (MIT)
      </div>
    </div>
  );
}
