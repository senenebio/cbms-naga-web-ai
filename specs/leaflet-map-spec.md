# Feature Spec — Leaflet Barangay Map (Replacing SVG Choropleth)

**Status:** implemented (2026-10-11) — P1–P4 closed on branch `feat/leaflet-barangay-map`
**Date:** 2026-10-11
**Parent spec:** `map-feature-spec.md` (P1–P4 implemented; open item "Map display rework" — this spec addresses it)

## Goal

Replace the hand-rolled inline-SVG choropleth (`BarangayMap.tsx`) with a **Leaflet map**:
real OSM street basemap when online, **graceful fallback to polygons-only** when tiles
are unreachable, keeping the existing interactions (hover tooltip, click-pinned detail
row, legend, metric selector) and theming model.

## Decisions (from 2026-10-11 planning Q&A)

| # | Decision |
|---|---|
| L1 | **Plain Leaflet 1.9.4, imperative** — `L.map` in a `useEffect` on a ref'd `<div>`; **no `react-leaflet`** (v5 requires React 19; project is React 18). `leaflet` + `@types/leaflet` are the only new deps. |
| L2 | **OSM tiles + graceful fallback** — `L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png')` per the OSMF tile usage policy (single URL, HTTPS, visible attribution). If tiles fail (offline / blocked), the tile layer is removed and the map continues as a polygons-only choropleth with a small "Basemap unavailable — polygons only" note. |
| L3 | **Full replacement** — `web/src/components/BarangayMap.tsx` (SVG) and its tests are deleted. The pure core in `src/map/geo.ts` is kept where still relevant (`parseBarangayGeojson`, `matchRows`, `colorScale`); `projectToSvg` (SVG-projection-only) is removed with the SVG component. |
| L4 | **Code-split** — the Leaflet map is a lazy chunk (`React.lazy` + `Suspense`) following the `ChartBlock`/recharts pattern, so the ~140 KB Leaflet JS + 14 KB CSS only load when "Show map" is first opened. |
| L5 | **Data asset unchanged** — reuses `data/naga-barangays.geojson` (9.6 KB, 27 features). No changes to `copy-data.mjs`, no new assets, no new query path. |
| L6 | **Theming** — map fills/legend/detail keep the existing `theme.ts` JS palette; Leaflet's own CSS (controls, attribution, tooltip) gets light/dark styling on top of the existing CSS custom properties. |
| L7 | **Placement unchanged** — the "Show map" trigger stays where it is (per-result `result-block`); the placement question is a *separate* open item in the parent spec and is explicitly out of scope here. |

## OSM Tile Usage Policy compliance (verified 2026-10-11)

- **URL:** exactly `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (no a/b/c subdomains, no HTTP).
- **Attribution:** visible `© OpenStreetMap contributors` — Leaflet's built-in attribution control satisfies this; do not hide it.
- **Headers:** browser sends `Referer` automatically (do **not** add a restrictive `Referrer-Policy` meta tag); no `Cache-Control: no-cache` overrides; the browser caches tiles per HTTP caching headers natively.
- **No bulk download / prefetch** — tiles are fetched on demand only for the visible viewport (this is why the self-hosted-tiles option was rejected during planning).
- Attribution footer under the map becomes: `© OpenStreetMap contributors · PSGC © PSA · Boundaries © NAMRIA · Data: Manuel Balmeo / bettergov.ph (MIT)`.

## Components

### New: `web/src/components/LeafletBarangayMap.tsx` (lazy-loaded)

- Mounts `<div ref>` → `L.map(el, { attributionControl: true, zoomControl: true, minZoom: <fit>, maxBounds: <Naga bbox + margin> })` in `useEffect`; `map.remove()` on unmount.
- Fits the view to the GeoJSON bounds (`L.geoJSON(...).getBounds()` → `fitBounds`).
- **Tile layer:** added first; `tileerror` events are counted — when the first batch of a zoom level fails (all tiles at a given zoom fail, or ≥ 50 % of them), the tile layer is removed, `tilesOffline` state is set, and the note is shown. Re-showing the map re-attempts tiles (fresh state per mount).
- **Choropleth layer:** `L.geoJSON` styled from `colorScale` values (fill per code, stroke from theme); unmatched codes → neutral fill.
- **Interactions (preserved from the SVG version):**
  - Hover → Leaflet `tooltip` (barangay name + value).
  - Click → pins selection (`setStyle` weight/fill highlight); detail row below the map (name, value, urban/rural from `RURAL_BARANGAYS`); re-click or background click clears.
  - Legend (min/max labels) + metric `<select>` (2+ numeric columns) stay as HTML *outside* the map (themeable, testable) — not Leaflet controls.
- Fetches `/data/naga-barangays.geojson` (keep the module-level cache from the SVG version).
- **Graceful degradation (unchanged contract):** fetch failure → no map rendered (trigger hidden), exactly as today.

### Changed: `web/src/components/MapSection.tsx` (or equivalent trigger site)

- Wraps the lazy map in `React.lazy`/`<Suspense fallback={…}>`; passes `theme`, rows, metric state.
- Per-result "Show map" toggle state stays per-result (M2 of parent spec).

### Deleted

- `web/src/components/BarangayMap.tsx` + `BarangayMap.test.tsx` (SVG implementation and its component tests).
- `projectToSvg` + its tests from `src/map/geo.ts` (pure `parseBarangayGeojson`, `matchRows`, `colorScale` stay).

### CSS

- `leaflet.css` imported inside the lazy module (bundled with the chunk).
- Dark-mode overrides for `.leaflet-control-zoom`, `.leaflet-control-attribution`, `.leaflet-tooltip`, and map-pane background (offline state gets a neutral panel background, not the default Leaflet gray).

## Constraints

- Browser-only; tiles are fetched by the browser directly from `tile.openstreetmap.org` — **no** runtime server, **no** `fetch('/api/...')`, no Vite proxy.
- New deps: `leaflet`, `@types/leaflet` (dev) — the only `package.json` change in this feature; requires the AGENTS.md "ask first" step (owner approval at spec-approval time).
- SQL guardrails, PII allowlists, view shapes, data assets: unchanged.
- No `node:` imports in `src/map/*` or the map components.
- Map reads only data the LLM tool loop already returned — never queries itself (parent-spec invariant).

## Testing

- **Unit (kept):** `parseBarangayGeojson`, `matchRows`, `colorScale` — existing `test/map_geo.test.ts` (minus projection tests).
- **Unit (new, pure):** tile-failure decision logic extracted as a pure function (`shouldDropTileLayer(errors, total)`) — testable without a DOM.
- **Component:** jsdom cannot size a Leaflet container, so Leaflet init is **not** tested in `react-test-renderer`; component tests cover the wrapper only (lazy trigger present/absent, fallback note rendering given `tilesOffline`, detail-row state). Leaflet rendering verified by manual browser check in the final gate.
- **Asset integrity (kept):** WASM test that GeoJSON codes ⊆ warehouse codes.
- Full gate: `npm test` + `npm run lint` + `npm run build:web` green per phase.

## Phases (each independently shippable)

1. **P1 — Skeleton:** add deps; lazy `LeafletBarangayMap` renders an empty Leaflet map fitted to the Naga bbox with OSM tiles; wired into the existing "Show map" trigger behind a `Suspense` fallback. SVG map still present.
2. **P2 — Choropleth + interactions:** GeoJSON layer, hover tooltip, click-pinned detail row, legend, metric selector — parity with the SVG version's M3 interactions.
3. **P3 — Fallback + theming:** `tileerror`-driven tile-layer removal + "Basemap unavailable" note; light/dark CSS for Leaflet controls; attribution footer line.
4. **P4 — Cutover + docs:** delete SVG `BarangayMap` + `projectToSvg` + stale tests; README map section; parent spec open item → resolved (display), placement item untouched; final gate (tests, lint, build, manual browser check online + offline).

## Task breakdown (working checklist)

### P1 — Skeleton
- [x] **T1.1 Deps** — `npm i leaflet` + `npm i -D @types/leaflet` (owner-approved per L1).
- [x] **T1.2 `LeafletBarangayMap.tsx`** — lazy module: div+ref, `L.map` init/cleanup, `fitBounds` from GeoJSON, OSM `tileLayer` with policy-compliant URL + attribution.
- [x] **T1.3 Wire trigger** — `MapSection`/result-section uses `React.lazy` + `Suspense` (loading spinner); fetch-GeoJSON failure still hides the map entirely.
- [x] **T1.4 Gate** — `npm test` + `npm run lint` green; manual: map opens, tiles load, zoom/pan.

### P2 — Choropleth + interactions
- [x] **T2.1 Choropleth layer** — `L.geoJSON` fills from `colorScale`; unmatched codes neutral; hover `tooltip` (name + value).
- [x] **T2.2 Selection** — click pins (highlight style), detail row (name, value, urban/rural via `RURAL_BARANGAYS`); re-click/background clears.
- [x] **T2.3 Legend + metric selector** — HTML below the map; `<select>` for 2+ numeric columns (key column excluded); single column → no selector.
- [x] **T2.4 Tests** — wrapper tests (trigger, detail-row state, selector presence); `npm test` + `npm run lint` green.

### P3 — Fallback + theming
- [x] **T3.1 Tile fallback** — pure `shouldDropTileLayer` + `tileerror` wiring; tile layer removed; "Basemap unavailable — polygons only" note; fresh retry per mount.
- [x] **T3.2 CSS theming** — light/dark: zoom control, attribution, tooltip, offline pane background; `theme` palette for legend/detail.
- [x] **T3.3 Attribution footer** — combined OSM + PSA/NAMRIA/bettergov line.
- [x] **T3.4 Gate** — `npm test` + `npm run lint` green; manual: kill network → tiles drop cleanly, map still usable.

### P4 — Cutover + docs
- [x] **T4.1 Remove SVG** — delete `BarangayMap.tsx` (+test), `projectToSvg` (+tests); fix imports.
- [x] **T4.2 Docs** — README map section updated; `map-feature-spec.md` "Map display rework" → resolved (point to this spec); "Show map" placement stays OPEN.
- [x] **T4.3 Final gate** — `npm test` + `npm run lint` + `npm run build:web` green; manual: online + offline, both themes, per-barangay chat question → "Show map".

## Open items

- **"Show map" placement** — remains open (parent spec); explicitly out of scope for this spec (L7).
- **Tile retry policy** — spec proposes "drop on first failed zoom level, fresh retry per mount"; exact threshold (all vs ≥50 %) to be finalized in P3.
- **Bundle size check** — confirm the lazy chunk stays in the same class as the recharts chunk (~140 KB Leaflet expected) in P1.
