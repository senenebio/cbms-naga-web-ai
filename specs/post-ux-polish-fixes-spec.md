# Post-UX-Polish Fixes Spec

**Status:** DONE
**Branch:** (uncommitted working tree — no commits made)
**Parent spec:** `ux-polish-spec.md` (U1 reading-width + U3 phase-indicator follow-through)
**Date:** 2026-10-15 (session)

This spec documents a batch of fixes and polish landed together in one session.
Five independent workstreams, each verified by the suite (216 tests passing,
typecheck clean):

| # | Area | Change |
|---|------|--------|
| G1 | Data asset | GeoJSON merged: high-precision geometry + `{code, barangay}` join fields + faeldon metadata |
| B1 | Map UI | Basemap toggle — OpenStreetMap + OpenTopoMap (Esri rejected) |
| R1 | Map UI | `ResizeObserver` → `map.invalidateSize()` so the canvas tracks the responsive bubble |
| P1 | Chat UI | Message bubbles `max-w-3xl` (768px cap) → `w-[88%]` (scale with the panel) |
| E1 | LLM core | `askQuestion` → async generator yielding real-time `AskEvent`s (fixes stuck "Thinking Xs") |

---

## Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | GeoJSON geometry | Keep the **higher-precision** raw-geoph dump geometry (1714 pts) | Better shape fidelity than the previous 662-pt asset |
| D2 | GeoJSON properties | Minimal `{code, barangay}` | Matches the app contract in `packages/core/src/map/geo.ts`; dropped `psgc_code` + 19 geoph fields |
| D3 | GeoJSON source | **faeldon/philippines-json-maps (MIT)** | The geometry's actual upstream; attribution corrected in 3 places |
| D4 | Basemap set | OpenStreetMap + **OpenTopoMap** | Both open (OSM data); OpenTopoMap is a volunteer server → `maxZoom` capped at 17 |
| D5 | Satellite basemap | **Rejected** Esri World Imagery | Licensing/attribution; user explicitly opted out |
| D6 | Map resize | `ResizeObserver` on the container → `invalidateSize()` | Leaflet does not auto-re-rasterize on container resize |
| D7 | Bubble width | `w-[88%]` of the panel (was `max-w-3xl` 768px) | Bubbles scale with the window; nested chart/SQL/map grow with them |
| D8 | Phase events | `askQuestion` yields events **in real time** (generator) | A blocking `Promise` buffered phases until the turn finished → UI stuck on "Thinking Xs" |

---

## G1 — GeoJSON merge (`data/cbms/naga-barangays.geojson`)

**Problem:** The bundled asset had two competing lineages — a higher-precision
raw-geoph dump (good geometry, but 19 raw fields and **no `code`/`barangay`
join keys**) and a join-ready file (had the keys, but lower precision). The app
contract (`parseBarangayGeojson`) requires `properties.code` (non-blank string)
and `properties.barangay` (exact warehouse name casing), so the high-precision
file alone would not join.

**Fix:** Merged by **name** (all 27 `adm4_en` names matched the warehouse
`barangay` column case-insensitively, zero overrides) into one file:
- High-precision geometry (1714 points across 27 features).
- `properties` reduced to `{code, barangay}` only.
- A `metadata` block recording the true source.
- Written compact (no pretty-print) → **37.5 KB** (down from 76.6 KB for the
  over-fielded merge).

**Contract:** `code` is the join key — `geojson.properties.code` ↔
`barangay.parquet.code` ↔ `household.parquet.barangay_code`. Code gaps at 5, 15,
16, 21, 22 are expected (no barangay at those numbers).

**Verification:** `test/map_asset.test.ts` — 6/6 map-integrity tests pass
(join completeness, name casing, code uniqueness, geometry validity).

**Files:**
- `data/cbms/naga-barangays.geojson` — merged asset

---

## B1 — Basemap toggle (`apps/chat-app/src/components/LeafletBarangayMap.tsx`)

**Problem:** The map hardcoded a single OSM tile layer. Users wanted an
alternative basemap.

**Fix:**
- Added a `BASEMAPS` record: `osm` (OpenStreetMap, maxZoom 19) and `opentopo`
  (OpenTopoMap, maxZoom 17 — good-citizen cap for a volunteer-run server).
- Extracted `addTileLayer(map, id, stats, onOffline)` so both basemaps share the
  same offline-fallback behavior (drop the tile layer → polygons-only choropleth
  if a batch of tiles fails with no successful loads).
- New `basemap` state + a `select` in the control row. Changing it swaps the
  tile layer **in place** (no map recreation, so the user's zoom/pan is
  preserved) and resets the offline-fallback stats.
- Attribution corrected to **faeldon/philippines-json-maps (MIT)**.

**Browser-only invariant:** tile layers are plain URLs — no `/api`, no runtime
server.

**Files:**
- `apps/chat-app/src/components/LeafletBarangayMap.tsx` — `BASEMAPS`, `addTileLayer`, basemap state + swap effect, attribution
- `apps/chat-app/src/components/LeafletBarangayMap.test.tsx` — new test asserting the basemap selector offers both OpenStreetMap and OpenTopoMap; attribution assertion updated to faeldon

---

## R1 — Map resize handling (`apps/chat-app/src/components/LeafletBarangayMap.tsx`)

**Problem:** The bubble width became a percentage (P1), so the map's container
grows as the browser widens. Leaflet does **not** auto-re-rasterize its canvas
when the container resizes → the map stays at the old pixel size.

**Fix:**
- Register a `ResizeObserver` on the map container in the init effect; on each
  size change call `map.invalidateSize()`.
- `resizeObserver.disconnect()` in the cleanup.
- Test mock: `globalThis.ResizeObserver` stub with `observe`/`unobserve`/
  `disconnect` (jsdom has no `ResizeObserver`).

**Files:**
- `apps/chat-app/src/components/LeafletBarangayMap.tsx` — ResizeObserver + cleanup
- `apps/chat-app/src/components/LeafletBarangayMap.test.tsx` — ResizeObserver mock

---

## P1 — Responsive message bubbles (`apps/chat-app/src/components/ChatPanel.tsx`)

**Problem:** Message bubbles were capped at `max-w-3xl` (768px), so they did not
widen as the browser did — on wide screens the chat stayed a narrow column while
the panel grew.

**Fix:** Replaced the fixed cap with a responsive width:
- User bubble: `max-w-3xl` → `w-[88%]` (keeps its `ml-[12%]` offset).
- Assistant bubble: `max-w-3xl` → `w-[88%]`.

Bubbles now scale with the panel and keep ~breathing room on each side. Nested
blocks (chart, SQL/table, map) inherit the wider bubble and grow with it.

**Files:**
- `apps/chat-app/src/components/ChatPanel.tsx` — bubble widths

---

## E1 — Real-time phase events (`packages/core/src/llm/client.ts`, `chat.ts`)

**Problem:** The UI stayed stuck on "Thinking Xs" for the entire turn. Root
cause: `askQuestion` was a blocking `Promise<AskOutcome>` — it ran the whole
turn (LLM calls, SQL, charts) and only returned at the end. `streamQuestion`
buffered phase events via an `onPhase` callback and yielded them in a burst
*after* completion, so the UI never saw "Running query…" until everything was
already done.

**Fix:**
- `askQuestion` is now an `async function*` yielding an `AskEvent` union in real
  time:
  ```ts
  export type AskEvent =
    | { type: 'phase'; phase: 'thinking' | 'querying' | 'writing' }
    | { type: 'sql'; sql: string }
    | { type: 'rows'; columns: string[]; rows: unknown[][]; truncated: boolean }
    | { type: 'chart'; n: number; spec: ChartSpec }
    | { type: 'answer'; answer: string; history: Message[] };
  ```
  Yields `phase: 'thinking'` at round 0, `phase: 'querying'` before each SQL,
  `sql` + `rows` per query, `chart` per validated chart, and the final `answer`.
- Removed the now-obsolete `onPhase` option, `AskOutcome`, and `SqlCallRecord`.
- `streamQuestion` does `for await (const e of askQuestion(...))` — re-yields
  `phase`/`sql`/`rows`/`chart` **live**, captures only the `answer` to stream as
  tokens + `done`.
- The `'writing'` phase is still derived from the first token in `use-chat.ts`
  (unchanged); core emits no explicit `writing` event.

**Files:**
- `packages/core/src/llm/client.ts` — generator + `AskEvent`
- `packages/core/src/llm/chat.ts` — live re-yield
- `test/client.test.ts` — `runQuestion` helper (folds events back into the old
  outcome shape) + a new test asserting phases are yielded *before* the answer
  in the correct order
- `test/end_to_end.test.ts` — same `runQuestion` helper
- `apps/chat-app/src/core/chat.test.ts` — abort test now asserts "no `error`/
  `done` event" (a `phase: 'thinking'` may precede the abort) instead of "no
  events at all"

**Verification:**
- Send a question; observe **Thinking… → Running query… → Writing answer…**
  live, with the elapsed-seconds ticker within each phase.
- `test/client.test.ts` — new phase-ordering test passes.

---

## Test & type status

- **Tests:** 216 passing (24 files) — up from 215 (one new phase-ordering test).
- **Typecheck:** clean.
- **No commits** — all changes remain in the working tree per operator
  instruction.

### Files changed

| File | Change |
|------|--------|
| `data/cbms/naga-barangays.geojson` | Merged asset (G1) |
| `apps/chat-app/src/components/LeafletBarangayMap.tsx` | Basemap toggle + resize + attribution (B1, R1) |
| `apps/chat-app/src/components/LeafletBarangayMap.test.tsx` | ResizeObserver mock, basemap test, attribution assertion |
| `apps/chat-app/src/components/ChatPanel.tsx` | Responsive bubbles (P1) |
| `packages/core/src/llm/client.ts` | `askQuestion` → generator (E1) |
| `packages/core/src/llm/chat.ts` | Live re-yield (E1) |
| `test/client.test.ts` | `runQuestion` helper + phase-ordering test (E1) |
| `test/end_to_end.test.ts` | `runQuestion` helper (E1) |
| `apps/chat-app/src/core/chat.test.ts` | Abort-test assertion update (E1) |
