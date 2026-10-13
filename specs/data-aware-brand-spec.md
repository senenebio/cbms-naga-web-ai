# Spec: Data-Aware Brands

**Status:** draft
**Date:** 2026-10-13
**Parent spec:** `monorepo-whitelabel-spec.md` (complete)

## Goal

Make a `Brand` **data-aware**: each brand carries the descriptor of the
dataset it ships, so adding a white-label brand with *different data* is a
data + descriptor change, not a code change. Brand #1 (CBMS Naga 2024) keeps
byte-identical behavior.

## Decisions

| # | Decision |
|---|----------|
| D1 | **Build-time pairing.** A brand statically references its `Dataset`. One brand per build (no runtime dataset picker). |
| D2 | **`Dataset` type lives in `@workspace/brand-config`**, alongside `Brand`; `Brand` gains a required `dataset: Dataset` field. |
| D3 | **Single dictionary owner.** The CBMS dictionary JSON is statically imported exactly once — by the dataset descriptor in `packages/brand-config/src/datasets/cbms.ts`. The two existing static imports (`src/data.ts`, `src/wasm/open_warehouse.ts`) are deleted; core modules receive the dictionary via the `Dataset` parameter. |
| D4 | **View names stay canonical** (`person`, `household`, `barangay`, `v_barangay_summary`) across all brands — a data-asset invariant. Brands differ in rows, dictionary, context text, and assets, not in view shapes. |
| D5 | **Data layout becomes per-brand:** `data/<brand-id>/warehouse/*.parquet`, `data/<brand-id>/…-Data-Dictionary.json`, `data/<brand-id>/…-geojson`. `scripts/copy-data.mjs` copies **every** `data/<brand-id>/` directory into `public/data/<brand-id>/` (no brand knowledge in the script); the runtime fetches `/data/<brandId>/…`. |
| D6 | **Demo questions move into the dataset** (`dataset.demoQuestions`); `apps/chat-app/src/demoQuestions.ts` is deleted. |
| D7 | **`DEMO_COLUMNS` / `RURAL_BARANGAYS` live in the dataset only.** The copies in `src/data.ts` and `src/wasm/open_warehouse.ts` are deleted (single source of truth). |
| D8 | **No new dependencies, no runtime server.** Guardrails (`runSelect`, PII allowlist, caps) untouched. |

## `Dataset` type

```ts
// packages/brand-config/src/types.ts
export interface Dataset {
  /** Stable id; also the asset directory name under /data/. */
  id: string;
  /** Dataset context text injected into the system prompt (replaces DATASET_CONTEXT). */
  context: string;
  /** Data-dictionary entries (static import; the PII allowlist = include=true). */
  dictionary: DictEntry[];
  /** Parquet asset filenames under /data/<id>/warehouse/. */
  tables: { person: string; household: string; barangay: string };
  /** Demo columns exposed beyond the dictionary allowlist, per table. */
  demoColumns: Record<'household' | 'barangay', string[]>;
  /** Barangay names classified rural (v_barangay_summary). */
  ruralBarangays: string[];
  /** GeoJSON asset filename under /data/<id>/. */
  geojson: string;
  /** Suggested demo-question chips. */
  demoQuestions: string[];
}

export interface Brand {
  /* …existing identity fields… */
  dataset: Dataset;
}
```

`CBMS_DATASET` (concrete descriptor) lives in
`packages/brand-config/src/datasets/cbms.ts` and is exported for both the
app and root `src/` unit tests.

## Core threading (driver-free `src/`)

| Module | Change |
|---|---|
| `src/data.ts` | Delete `loadDataDictionary()` + static JSON import + `DEMO_COLUMNS` + `RURAL_BARANGAYS`. `allowedColumns(table, columns, dataset)`. |
| `src/schema.ts` | `selectColumns(question, dataset)`, `buildSchemaBlock(engine, dataset, selected?)`, `observedColumnValues(engine, table, columns, dataset)`. |
| `src/llm/prompts.ts` | `buildSystemPrompt(schemaBlock, dataset)` — `DATASET_CONTEXT` constant deleted, replaced by `dataset.context`. |
| `src/llm/chat.ts` | `systemForQuestion(question, fullSystem, engine, dataset)`. |
| `src/llm/client.ts` | Unchanged (tool description names the canonical views — D4). |
| `src/wasm/open_warehouse.ts` | `openWarehouseWasm(db, parquets, dataset)`; delete dictionary import + `DEMO_COLUMNS` + `RURAL_BARANGAYS`. |
| `src/llm/sql_tool.ts`, `chart.ts`, `provider.ts` | Unchanged. |

## App threading (`apps/chat-app/`)

- `brand.ts` — unchanged import; `BRAND` now carries the dataset.
- `core/chat.ts` — `createChatSession(engine, dataset)`; the session object
  carries the dataset so `chatQuestion` stays as-is.
- Worker boot — fetch `/data/<id>/{person,household,barangay}.parquet` from
  `BRAND.dataset.tables`; pass the dataset to `openWarehouseWasm`.
- Map — geojson fetch path from `dataset.geojson`.
- `demoQuestions.ts` — deleted; chips render from `BRAND.dataset.demoQuestions`.

## Data layout + build

```
data/
  cbms/
    warehouse/{person,household,barangay}.parquet
    2024-CBMS-Data-Dictionary.json
    naga-barangays.geojson
apps/chat-app/public/data/cbms/…   # build-generated (gitignored)
```

`scripts/copy-data.mjs`: for each `data/<dir>/` that contains
`warehouse/`, copy it to `public/data/<dir>/`. No brand-id constant in the
script.

## Phases (each ends green: `pnpm test` + `pnpm typecheck` + `pnpm lint`)

**Phase 1 — Descriptor + data move (no core signature changes)**
1. `Dataset` type + `CBMS_DATASET` in `packages/brand-config` (dictionary
   import moves here from `src/data.ts` — `src/data.ts` temporarily keeps a
   re-export of `loadDataDictionary()` backed by `CBMS_DATASET` to stay green).
2. `Brand` gains `dataset`; `CBMS` brand entry updated.
3. `git mv data/* data/cbms/`; `copy-data.mjs` → per-brand-dir copy; worker
   fetch paths → `/data/cbms/…`.
   *Gate: tests + build green; bundle assets byte-identical.*

**Phase 2 — Core threading**
4. Parameterize `schema.ts`, `data.ts`, `prompts.ts`, `chat.ts`,
   `open_warehouse.ts` per the table; delete the duplicate
   `DEMO_COLUMNS`/`RURAL_BARANGAYS` and the second dictionary import.
5. Update root unit tests to pass `CBMS_DATASET`.
   *Gate: tests green; CBMS system prompt and schema block byte-identical
   (existing prompt/schema tests pin this).*

**Phase 3 — App wiring**
6. Session/worker/map/demo-chip wiring per the app table; delete
   `demoQuestions.ts`.
   *Gate: tests green; `pnpm build` + manual smoke.*

**Phase 4 — Docs**
7. `AGENTS.md` + `README.md` + `docs/DATA-ASSETS.md`: per-brand data layout
   and the "add a brand" checklist (BRANDS entry + `data/<id>/` + one line
   in `brand.ts`).

## Invariants

- All LLM SQL through `runSelect`; guardrails, PII allowlist, caps unchanged.
- Warehouse view names/shapes canonical (D4).
- No runtime server, no `/api`, no new dependencies.
- CBMS brand #1 behavior byte-identical after every phase.

## Out of scope

- Runtime dataset picker / multi-dataset single build.
- Per-brand LLM prompt style differences (answer-style rules stay global).
- Auto-generating a dictionary from raw parquets.
