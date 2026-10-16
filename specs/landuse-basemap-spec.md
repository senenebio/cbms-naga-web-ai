# Feature Spec — OSM Landuse Basemap (WMS)

**Status:** implemented (2026-10-16)
**Date:** 2026-10-16
**Parent spec:** `leaflet-map-spec.md` (Leaflet choropleth) / `map-feature-spec.md` (parent)
**Related:** `post-ux-polish-fixes-spec.md` (B1 — basemap toggle that introduced `BASEMAPS`)

## Goal

Add a third **Landuse** basemap option to the barangay map, alongside
**OpenStreetMap** and **OpenTopoMap**, sourced from the osmlanduse.org WMS
(HeiGIT / Heidelberg GIScience). It renders OSM-derived landuse/landcover
categories (forest, cropland, settlement, water, …) as a colored thematic
layer.

**Positioning (agreed 2026-10-16):** this is a **low-zoom thematic basemap**.
The source is a coarse landuse/landcover service — it renders real colors at
global/low zoom and is **blank over Naga City / the Philippines at street
zoom**. We accept that and document it; the option is a thematic "how is this
land used" view, not a street-level map.

## Source facts (verified live 2026-10-16, primary evidence)

- **Type:** WMS 1.3.0, **not** XYZ tiles. The MapProxy XYZ tile cache
  (`https://maps.heigit.org/osmlanduse/tiles/…`) is **dead (404)** — do not use.
- **Endpoint:** `https://maps.heigit.org/osmlanduse/service`
  (`GetCapabilities` OK; `GetMap` OK with the params below).
- **Layer:** `osmlanduse:osm_lulc_combined_osm4eo` (gap-filled combined landuse
  + OSM4EO — the layer the site shows by default, and the only one that
  responded stably in repeated tests). **The namespaced `osmlanduse:` prefix
  is required** — the unprefixed `osm_lulc_combined_osm4eo` returns
  `500 unknown layer`. The two-layer combo `osm_lulc,osm4eo` flaps with
  `500 unknown layer: osm4eo`; the plain `osm_lulc` layer is sparser.
- **WMS version:** confirmed working under both **1.1.1** (`srs=EPSG:3857`,
  which is Leaflet `L.tileLayer.wms`'s default) and **1.3.0** (`crs=`) with the
  namespaced layer name. 200 with real image data across repeated calls.
- **CRS:** `EPSG:3857` only (`EPSG:4326` → `500`).
- **Required params:** `styles=` (empty) is **required** (omitting it → `500`);
  `transparent=false` (opaque landuse colors). The site also sends `buffer=25` (a
  seam-reduction hint) but Leaflet's `L.tileLayer.wms` options don't expose it,
  so we omit it (optional).
- **Coverage:** renders data at global/low zoom (e.g. 157 colors at z2);
  **blank/white at street zoom (z7+)** and **blank over Naga / the Philippines**
  (transparent tiles, no data) — a known limitation, see Positioning.
- **Reliability:** flaky — intermittent `500`s across repeated calls.
- **Attribution** (from the site's own layer config):
  *Gap filled overlay data by OpenStreetMap contributors and GIScience
  Heidelberg, under ODbL.* The WMS `GetCapabilities` `AccessConstraints` also
  state *CC BY-SA 2.0* and *"intended for private and evaluation use only"* —
  the ODbL vs CC BY-SA discrepancy is an open item (see Open items).

## Decisions (from 2026-10-16 planning Q&A)

| # | Decision |
|---|---|
| D1 | **Scope** — spec it as a **low-zoom thematic basemap**; accept the blank-over-Naga-at-street-zoom limitation and document it. |
| D2 | **Integration — separate WMS path.** Keep `BASEMAPS` as pure XYZ; add a distinct WMS basemap definition and branch on it in the component. (Chosen over folding WMS into `addTileLayer()`'s single config.) |
| D3 | **Layer** — pin `osm_lulc_combined_osm4eo`. |
| D4 | **Reliability** — rely on the **existing tile-failure fallback** (`shouldDropTileLayer` / `tileerror` drop → polygons-only). No new reliability machinery. |

## Integration design

### `apps/chat-app/src/components/LeafletBarangayMap.tsx`

- Extend the id union: `type BasemapId = 'osm' | 'opentopo' | 'landuse'`.
- **Keep `BASEMAPS` unchanged** (pure XYZ: `osm`, `opentopo`).
- **New `WMS_BASEMAPS`** record (separate path, D2):

  ```ts
  const WMS_BASEMAPS: Record<'landuse', {
    label: string; url: string; layers: string; attribution: string; maxZoom: number;
  }> = {
    landuse: {
      label: 'OSM Landuse',
      url: 'https://maps.heigit.org/osmlanduse/service',
      layers: 'osmlanduse:osm_lulc_combined_osm4eo',
      attribution:
        'OSM Landuse © OpenStreetMap contributors &amp; GIScience Heidelberg (ODbL)',
      maxZoom: 12, // coarse thematic layer; good-citizen cap (volunteer WMS)
    },
  };
  ```

- **`addTileLayer(map, id, stats, onOffline)`** branches on the record the id
  lives in:
  - WMS ids → `L.tileLayer.wms(url, { layers, attribution, maxZoom, format: 'image/png', transparent: false })`.
    (`crs` is `EPSG:3857`, the `L.tileLayer.wms` default — no need to set;
    `styles` defaults to `''`, matching the required empty param.)
  - XYZ ids → existing `L.tileLayer(b.url, { attribution, maxZoom })`.
  - **Shared fallback wiring is unchanged** for both: `tileload`/`tileerror`
    counters feed `shouldDropTileLayer`; on drop, remove the layer +
    `onOffline()` → polygons-only (D4).
- **Selector** — combine both records into the option list so `landuse`
  appears in the same `<select>`, e.g. derive
  `const BASEMAP_OPTIONS: [BasemapId, string][] =
  [...Object.entries(BASEMAPS), ...Object.entries(WMS_BASEMAPS)]` and map over
  that (order: OSM, OpenTopoMap, OSM Landuse).
- **Swap effect** — unchanged; it already swaps in place by id and resets the
  offline stats, so it works for the WMS id with no change.
- **Attribution control** — Leaflet's built-in attribution control already
  carries the active basemap's `attribution`; no change.

### No changes needed

- `packages/core/src/map/geo.ts` — `shouldDropTileLayer` is basemap-agnostic.
- The swap effect, the choropleth layer, theming, and the offline note.

## Constraints

- **Browser-only** — the WMS is fetched by the browser directly from
  `maps.heigit.org` (HTTPS). No runtime server, no `fetch('/api/...')`, no Vite
  proxy.
- **OSMF / tile courtesy** — single HTTPS URL, visible attribution (built-in
  control, not hidden), no bulk download/prefetch (Leaflet fetches only the
  visible viewport). `maxZoom` capped as a good citizen (coarse layer +
  volunteer-run WMS).
- SQL guardrails, PII allowlists, view shapes, data assets: unchanged.
- No new dependencies; no `node:` imports in the map components.

## Known limitations (documented, accepted per D1)

- **Blank over Naga City / the Philippines** at street zoom — the landuse data
  has no coverage there. The choropleth polygons remain the primary,
  always-present layer; the landuse basemap is a supplementary thematic view.
- **Coarse / blank at high zoom** — cap `maxZoom` (proposed 12) so users don't
  zoom into blankness.
- **Flaky WMS** — intermittent `500`s; the existing tile-failure fallback
  degrades to polygons-only (D4).

## Testing

- **Component** (`LeafletBarangayMap.test.tsx`) — extend the existing basemap
  selector test to assert the **three** options (OpenStreetMap, OpenTopoMap,
  OSM Landuse).
- **Unit** — no new pure logic expected; `shouldDropTileLayer` is unchanged and
  already covered. (If the WMS-vs-XYZ branch is extracted as a pure helper, add
  a unit test for it.)
- **Manual (final gate)** — open the map, switch to OSM Landuse: tiles load at
  low zoom (online), attribution shows the landuse credit, switching back/forth
  preserves zoom/pan, and killing the network drops to polygons-only.
- Full gate: `pnpm test` + `pnpm typecheck` + `pnpm lint` green.

## Phases (each independently shippable)

1. **P1 — WMS basemap option:** add `WMS_BASEMAPS` + `BasemapId` extension;
   branch `addTileLayer()` for WMS; add `landuse` to the selector options.
   Gate: selector offers all three; Landuse tiles render at low zoom (manual).
2. **P2 — Tests + docs:** extend the selector test (three options); update this
   spec → implemented; note the Naga-coverage limitation in the README map
   section. Gate: full gate green + manual browser check.

## Open items

- **Attribution license text (ODbL vs CC BY-SA):** the site's config says
  ODbL; the WMS `GetCapabilities` says CC BY-SA 2.0 + "private and evaluation
  use only." Confirm the correct credit string before shipping. *(Proposed
  interim: use the site's own ODbL attribution.)*
- **`maxZoom` value:** proposed 12 (coarse layer, good citizen). Confirm.
- **Reliability acceptance:** the WMS flaps. If it proves too flaky in practice,
  the fallback covers it — confirm that's acceptable, or add a note in the UI.

## Task breakdown (working checklist)

- [x] **T1.1** Extend `BasemapId` to include `'landuse'`; add `WMS_BASEMAPS`
  record with the verified WMS params (D3).
- [x] **T1.2** Branch `addTileLayer()` for WMS ids (`L.tileLayer.wms`,
  `transparent:false`); keep shared fallback wiring (D4).
- [x] **T1.3** Add `landuse` to the selector options (combine `BASEMAPS` +
  `WMS_BASEMAPS`), preserving order OSM → OpenTopoMap → OSM Landuse.
- [ ] **T1.4** Gate: `pnpm test` + `pnpm typecheck` + `pnpm lint` green; manual
  low-zoom tile render.
- [x] **T2.1** Extend `LeafletBarangayMap.test.tsx` to assert three basemap
  options.
- [x] **T2.2** Docs: README note (thematic, blank over Naga at street zoom);
  this spec → implemented.
- [ ] **T2.3** Final gate: full gate green + manual (online low zoom, attribution,
  swap preserves zoom/pan, offline → polygons-only).
