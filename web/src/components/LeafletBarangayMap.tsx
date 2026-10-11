/**
 * Map feature — Leaflet choropleth of a geographic `run_select` result
 * (see specs/leaflet-map-spec.md). Replaces the former inline-SVG map.
 *
 * - Plain Leaflet (imperative `L.map` in an effect; no `react-leaflet` — it
 *   requires React 19). Loaded lazily (this module is a `React.lazy` chunk),
 *   so Leaflet's ~140 KB only ships when "Show map" is first opened.
 * - OSM basemap (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`, per the
 *   OSMF tile usage policy).
 *
 * P1 (skeleton): map + OSM tiles fitted to the Naga City bbox. Choropleth,
 * interactions, and the tile fallback land in P2/P3.
 *
 * The `geojson` prop overrides the fetched asset with raw text (tests).
 */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { parseBarangayGeojson, type BarangayFeature } from '../../../src/map/geo.js';
import type { Theme } from '../theme.js';

const GEO_URL = '/data/naga-barangays.geojson';
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

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

interface LeafletBarangayMapProps {
  columns: string[];
  rows: unknown[][];
  theme: Theme;
  /** Raw GeoJSON text override (tests). When omitted, the asset is fetched. */
  geojson?: string;
}

export default function LeafletBarangayMap({ geojson }: LeafletBarangayMapProps) {
  const [features, setFeatures] = useState<BarangayFeature[] | null>(null);
  const [fc, setFc] = useState<GeoJSON.FeatureCollection | null>(null);
  const [loadError, setLoadError] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  // Map init: Leaflet map + OSM basemap, fitted to the feature-collection bbox.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !fc) return;

    const map = L.map(el, { zoomControl: true, attributionControl: true });
    const bounds = L.geoJSON(fc).getBounds();
    map.fitBounds(bounds, { padding: [8, 8] });
    map.setMaxBounds(bounds.pad(3));

    L.tileLayer(OSM_TILE_URL, {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    return () => {
      map.remove();
    };
  }, [fc]);

  if (loadError) {
    return (
      <div className="barangay-map">
        <div className="note">Map unavailable.</div>
      </div>
    );
  }
  if (!features) {
    return (
      <div className="barangay-map">
        <div className="note">Loading map…</div>
      </div>
    );
  }

  return (
    <div className="barangay-map">
      <div className="map-leaflet" ref={containerRef} />
    </div>
  );
}
