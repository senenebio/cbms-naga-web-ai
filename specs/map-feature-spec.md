# Feature Spec — Barangay Map (SVG Choropleth)

**Status:** P1–P4 implemented (2026-10-09). The map *display* was reworked to **Leaflet** (2026-10-11 — see `leaflet-map-spec.md`); the "Show map" placement remains an open question (see Open items).
**Date:** 2026-10-08 (P1 closed 2026-10-09; P3 + P4 closed 2026-10-09; display rework + placement flagged 2026-10-09; display rework resolved 2026-10-11 via Leaflet)
**Parent spec:** `browser-only-spec.md` (complete; this is a follow-on feature)

## Goal

Show a **choropleth map of Naga City's 27 barangays** when a chat answer is
grounded in barangay-level SQL results — rendered as hand-rolled SVG, fully
offline, with **no new dependencies**.

## Decisions (from 2026-10-08 planning Q&A)

| # | Decision |
|---|---|
| M1 | **Hand-rolled SVG choropleth** — no map library. Recharts (added by `advanced-charts-spec`) has no geo/choropleth component, so the map is hand-rolled SVG. *(Under reconsideration 2026-10-09 — the owner may shift to **Leaflet**; see Open items.)* |
| M2 | **Explicit affordance** — a "Show map" control appears on applicable results; the map is hidden until requested (no auto-render). |
| M3 | **Hover + click detail** — hover shows a tooltip (name + value); click pins a barangay and shows a detail row (name, value, urban/rural). No chat-driving filter. |
| M4 | **New static data asset** — `data/naga-barangays.geojson` (simplified GeoJSON, committed, served like the parquets). |

## Relationship to `make_chart` (advanced-charts-spec)

The project now has an LLM `make_chart` tool (Recharts: bar/line/area/pie/scatter,
code-split, renders after the answer text). The map is **complementary, not competing**:

- **`make_chart` = non-spatial** (rankings, trends, share, correlations — the LLM
  decides). **Map = spatial** (where in Naga City) — it adds the geographic context
  Recharts cannot express. Both may appear in the same answer: the chart inline
  after the text, the map behind the per-result "Show map" toggle.
- The map is **UI-driven, not an LLM tool** — no prompt changes, no new tool spec.
  The trigger is purely the result's columns (`code`/`barangay` + numeric col).
- **Theming follows the `ChartBlock` pattern:** `BarangayMap` takes a `theme` prop
  (JS palette mirroring the CSS custom properties, forwarded from `ChatPanel`),
  keeping it testable under react-test-renderer.
- No code-splitting needed for the map itself (no new bundle weight); it stays a
  normal import — small compared to the ~446 KB chart chunk.

## Data

### New asset: `data/naga-barangays.geojson`

- GeoJSON `FeatureCollection`, one Feature per barangay (27).
- `properties`: `code` (string, **must match** warehouse `barangay.code`) and `barangay` (display name).
- Simplified geometry (target ≤ ~150 points per polygon; total ≤ ~200 KB).
- Sourced from [bettergov.ph #23](https://data.bettergov.ph/datasets/23) (MIT; PSA PSGC + NAMRIA boundaries); attribution line in the asset `metadata`.
- **Static asset only** — it is *not* loaded into DuckDB and never a query
  target; PII story and SQL guardrails are untouched.

### Build

- `scripts/copy-data.mjs` copies it to `web/public/data/naga-barangays.geojson`
  alongside the parquets (dest already cleaned per build).

### Value source

- Map values come **only from an already-returned `run_select` result**
  (the rows shown in a result section). No new query path, no new SQL.
- Applicable result: columns include `code` (or `barangay`) **and** at least
  one numeric column. If multiple numeric columns exist, a small metric
  selector (native `<select>`) chooses which one to map.

## Components

### Core (driver-free, `src/map/geo.ts` — pure, unit-testable)

- `parseBarangayGeojson(text: string)` → typed features (code, name, ring coords).
- `projectToSvg(features, viewBox)` → per-feature SVG path `d` strings (simple
  equirectangular fit to the feature-collection bbox — hand-rolled, no projection library).
- `matchRows(features, rows, keyCol, valueCol)` → per-code values from result rows
  (string-normalized codes; unmatched codes → null).
- `colorScale(values)` → sequential light→dark fill per value (handles
  zero/negative/NaN; single-value and all-equal edge cases).

### UI (`web/src/components/BarangayMap.tsx`)

- Fetches `/data/naga-barangays.geojson` once (module-level cache).
- Renders `<svg>` with one `<path>` per barangay (keyed by code), legend
  (min/max labels), and the M3 interactions:
  - **Hover** → tooltip (barangay name + value), follows the focused path.
  - **Click** → pins selection; detail row below the map (name, value, urban/rural
    derived from the existing `RURAL_BARANGAYS` constant in `src/data.ts` —
    always available, independent of which columns the result carries).
- **Graceful degradation:** if the fetch fails, a code has no matching row,
  or the result isn't geographic, the "Show map" control is simply absent.
- Theming via existing `theme.ts` (light + dark fills).

### Trigger (ChatPanel result section)

- Next to/below an applicable result table, a **"Show map"** button toggles
  the map inline (collapsible, M2). State is per-result, not global.

## Constraints

- No new dependencies beyond `recharts` (already present via `advanced-charts-spec`);
  no `package.json` changes for this feature.
- SQL guardrails, PII allowlists, and view shapes unchanged.
- No `node:` imports in `src/map/*` (browser-bundled).
- Map reads only data the LLM tool loop already returned — never queries itself.

## Phases (each independently shippable)

1. **P1 — Asset ✅ (2026-10-09):** source + simplify the GeoJSON; commit `data/naga-barangays.geojson`;
   extend `copy-data.mjs`; **test:** all 27 GeoJSON codes match warehouse `barangay.code`
   (WASM test against the real data).
2. **P2 — Core:** `src/map/geo.ts` pure functions + unit tests (parse, projection,
   matching, color scale edge cases).
3. **P3 — UI:** `BarangayMap.tsx` + tooltip/selection/legend + tests
   (react-test-renderer, fixture GeoJSON: 27 paths render, click updates detail);
   wire "Show map" into the result section.
4. **P4 — Polish:** dark-mode tuning, legend/scale sanity, README + this spec status.

## Testing

- **Unit:** geo parse/match/scale/projection (pure, no DOM).
- **Component:** fixture GeoJSON → 27 paths; hover/click state updates detail row.
- **Asset integrity (WASM test):** GeoJSON codes ⊆ warehouse codes, no dupes.
- Full gate: `npm test` + `npm run lint` green before each phase closes.

## Task breakdown (working checklist)

Each task is ≤ ~1 hour; every task ends with the file(s) named done and `npm test` + `npm run lint` green.

### P1 — Asset ✅ done 2026-10-09
- [x] **T1.1 Source GeoJSON** — obtain Naga City barangay boundaries (PSA geoadmin / OCHA / LGU GIS); confirm 27 features; note license + attribution line. *(source: [bettergov.ph dataset 23](https://data.bettergov.ph/datasets/23) ← `bendlikeabamboo/barangay-boundaries-repository` (MIT) ← PSA PSGC 2023-10-24 + NAMRIA v2023-11-06. Attribution: “PSGC © PSA · Boundaries © NAMRIA · Data: Manuel Balmeo / bettergov.ph (MIT)”.)*
- [x] **T1.2 Write `data/naga-barangays.geojson`** — simplify to ≤ ~200 KB; `properties: {code, barangay}` where `code` matches warehouse `barangay.code` (verify against `SELECT code FROM barangay` — fix mismatches in the asset, not the warehouse). *(9.6 KB, 27 features, 134 points; `properties: {code, barangay, psgc_code}`; names uppercase to match warehouse.)*
- [x] **T1.3 Extend `scripts/copy-data.mjs`** — copy the GeoJSON to `web/public/data/` alongside the parquets. *(done 2026-10-08; verified copying the real asset 2026-10-09.)*
- [x] **T1.4 Asset-integrity test** — `test/map_asset.test.ts` (WASM): 27 features, codes ⊆ warehouse codes, no duplicate codes, all names non-empty. *(6 tests incl. name-casing + ring sanity.)*

### P2 — Core (`src/map/geo.ts`, pure, no `node:`) ✅ done 2026-10-08 (39/39 tests green)
- [x] **T2.1 `parseBarangayGeojson(text)`** — typed features (code, name, rings); rejects malformed input (not a FeatureCollection, missing properties).
- [x] **T2.2 `projectToSvg(features, viewBox)`** — bbox fit → per-feature SVG `d` strings (multi-polygon supported); deterministic output.
- [x] **T2.3 `matchRows(features, rows, keyCol, valueCol)`** — per-code numeric values; string-normalized codes; unmatched codes → null (not NaN).
- [x] **T2.4 `colorScale(values)`** — sequential fills; edge cases: single value, all-equal, negatives, zeros, all-null.
- [x] **T2.5 Unit tests** — `test/map_geo.test.ts` covering T2.1–T2.4 incl. edge cases (inline fixture GeoJSON, no network).

### P3 — UI ✅ done 2026-10-09
- [x] **T3.1 `BarangayMap.tsx` skeleton** — fetch `/data/naga-barangays.geojson` once (module cache); render 27 `<path>`s keyed by code; graceful no-op on fetch failure.
- [x] **T3.2 Hover tooltip** — name + value on hover; cleared on leave.
- [x] **T3.3 Click selection + detail row** — pin a barangay; detail shows name, value, urban/rural; re-click or empty-area click clears.
- [x] **T3.4 Legend** — min/max labels under the map.
- [x] **T3.5 Metric selector** — when the result has 2+ numeric columns, native `<select>` picks the mapped column; 1 column → no selector. *(key column excluded from the metric list so a bare integer `code` isn't offered.)*
- [x] **T3.6 "Show map" trigger** — ChatPanel result section: detect applicable results (`code`/`barangay` + numeric col); per-result toggle, map inline, collapsed by default. *(Below the table, inside the per-result `result-block`.)*
- [x] **T3.7 Component tests** — fixture GeoJSON: 27 paths render; click updates detail row; non-geographic result shows no trigger (react-test-renderer, no network). *(Plus: metric-selector present/absent.)*
- [x] **T3.8 CSS + theme prop** — fills, tooltip, selection outline, detail row, legend; `theme` prop with JS palette mirroring CSS vars (same pattern as `ChartBlock`), light + dark.

### P4 — Polish ✅ done 2026-10-09
- [x] **T4.1 Dark-mode tuning** — verify contrast of fills/legend/detail in both themes. *(The `theme` palette supplies ink/muted/border/panel/surface; the `colorScale` blue ramp reads on both, and the legend ramp + detail use theme colors.)*
- [x] **T4.2 Attribution footer** — source line from T1.1 rendered under the map.
- [x] **T4.3 Docs** — README map section; this spec → done; open items resolved.
- [x] **T4.4 Final gate** — `npm test` (190), `npm run lint`, `npm run build:web` all green. *(Manual browser check left to the owner: `npm start` → ask a per-barangay question → "Show map".)*

## Open items

- ~~GeoJSON source, license, and attribution line (display in map footer).~~ **Resolved 2026-10-09:** bettergov.ph #23 (MIT) ← PSA PSGC + NAMRIA. Footer line: “PSGC © PSA · Boundaries © NAMRIA · Data: Manuel Balmeo / bettergov.ph (MIT)”.
- ~~**Map display rework (OPEN — flagged 2026-10-09):** the owner is unhappy with the current inline-SVG choropleth rendering and **may shift to Leaflet** in the future.~~ **Resolved 2026-10-11:** replaced with a **Leaflet** choropleth — see `specs/leaflet-map-spec.md`. The hand-rolled SVG `BarangayMap` was removed.
- **"Show map" placement (OPEN — reopened 2026-10-09):** the trigger currently sits in the per-result `result-block` (below the raw-rows table; decoupled from the Show SQL toggle since 2026-10-09), which reads as part of the SQL/rows area. Candidate placements: (A) promote to a first-class visualization after the answer/chart, (B) keep it in the rows block but visually separate from the raw-rows `<details>`, (C) attach it to the chart. *No decision yet.*
- ~~Metric selector styling when a result has 2+ numeric columns.~~ **Resolved 2026-10-09:** a small native `<select>` labeled "Metric:" above the map; the bare integer `code` key column is excluded from the options.
