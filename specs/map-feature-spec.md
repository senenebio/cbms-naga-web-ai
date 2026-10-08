# Feature Spec — Barangay Map (SVG Choropleth)

**Status:** planned (no implementation)
**Date:** 2026-10-08
**Parent spec:** `browser-only-spec.md` (complete; this is a follow-on feature)

## Goal

Show a **choropleth map of Naga City's 27 barangays** when a chat answer is
grounded in barangay-level SQL results — rendered as hand-rolled SVG, fully
offline, with **no new dependencies**.

## Decisions (from 2026-10-08 planning Q&A)

| # | Decision |
|---|---|
| M1 | **Hand-rolled SVG choropleth** — no map/chart library (extends the I4 "no chart lib" decision from the parent spec). |
| M2 | **Explicit affordance** — a "Show map" control appears on applicable results; the map is hidden until requested (no auto-render). |
| M3 | **Hover + click detail** — hover shows a tooltip (name + value); click pins a barangay and shows a detail row (name, value, urban/rural). No chat-driving filter. |
| M4 | **New static data asset** — `data/naga-barangays.geojson` (simplified GeoJSON, committed, served like the parquets). |

## Data

### New asset: `data/naga-barangays.geojson`

- GeoJSON `FeatureCollection`, one Feature per barangay (27).
- `properties`: `code` (string, **must match** warehouse `barangay.code`) and `barangay` (display name).
- Simplified geometry (target ≤ ~150 points per polygon; total ≤ ~200 KB).
- Sourced from PSA geoadmin / OCHA / LGU GIS (verify license + attribution in P1).
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

- No new dependencies; no `package.json` changes.
- SQL guardrails, PII allowlists, and view shapes unchanged.
- No `node:` imports in `src/map/*` (browser-bundled).
- Map reads only data the LLM tool loop already returned — never queries itself.

## Phases (each independently shippable)

1. **P1 — Asset:** source + simplify the GeoJSON; commit `data/naga-barangays.geojson`;
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

### P1 — Asset
- [ ] **T1.1 Source GeoJSON** — obtain Naga City barangay boundaries (PSA geoadmin / OCHA / LGU GIS); confirm 27 features; note license + attribution line.
- [ ] **T1.2 Write `data/naga-barangays.geojson`** — simplify to ≤ ~200 KB; `properties: {code, barangay}` where `code` matches warehouse `barangay.code` (verify against `SELECT code FROM barangay` — fix mismatches in the asset, not the warehouse).
- [ ] **T1.3 Extend `scripts/copy-data.mjs`** — copy the GeoJSON to `web/public/data/` alongside the parquets.
- [ ] **T1.4 Asset-integrity test** — `test/map_asset.test.ts` (WASM): 27 features, codes ⊆ warehouse codes, no duplicate codes, all names non-empty.

### P2 — Core (`src/map/geo.ts`, pure, no `node:`)
- [ ] **T2.1 `parseBarangayGeojson(text)`** — typed features (code, name, rings); rejects malformed input (not a FeatureCollection, missing properties).
- [ ] **T2.2 `projectToSvg(features, viewBox)`** — bbox fit → per-feature SVG `d` strings (multi-polygon supported); deterministic output.
- [ ] **T2.3 `matchRows(features, rows, keyCol, valueCol)`** — per-code numeric values; string-normalized codes; unmatched codes → null (not NaN).
- [ ] **T2.4 `colorScale(values)`** — sequential fills; edge cases: single value, all-equal, negatives, zeros, all-null.
- [ ] **T2.5 Unit tests** — `test/map_geo.test.ts` covering T2.1–T2.4 incl. edge cases (inline fixture GeoJSON, no network).

### P3 — UI
- [ ] **T3.1 `BarangayMap.tsx` skeleton** — fetch `/data/naga-barangays.geojson` once (module cache); render 27 `<path>`s keyed by code; graceful no-op on fetch failure.
- [ ] **T3.2 Hover tooltip** — name + value on hover; cleared on leave.
- [ ] **T3.3 Click selection + detail row** — pin a barangay; detail shows name, value, urban/rural; re-click or empty-area click clears.
- [ ] **T3.4 Legend** — min/max labels under the map.
- [ ] **T3.5 Metric selector** — when the result has 2+ numeric columns, native `<select>` picks the mapped column; 1 column → no selector.
- [ ] **T3.6 "Show map" trigger** — ChatPanel result section: detect applicable results (`code`/`barangay` + numeric col); per-result toggle, map inline, collapsed by default.
- [ ] **T3.7 Component tests** — fixture GeoJSON: 27 paths render; click updates detail row; non-geographic result shows no trigger (react-test-renderer, no network).
- [ ] **T3.8 CSS** — fills, tooltip, selection outline, detail row, legend (light + dark via `theme.ts`).

### P4 — Polish
- [ ] **T4.1 Dark-mode tuning** — verify contrast of fills/legend/detail in both themes.
- [ ] **T4.2 Attribution footer** — source line from T1.1 rendered under the map.
- [ ] **T4.3 Docs** — README map section; this spec → done; resolve the 3 open items in writing.
- [ ] **T4.4 Final gate** — `npm test`, `npm run lint`, `npm run build:web`, manual browser check (map on a real barangay-level answer).

## Open items (resolve in P1)

- GeoJSON source, license, and attribution line (display in map footer).
- Exact "Show map" placement within the result section (above vs below the table).
- Metric selector styling when a result has 2+ numeric columns.
