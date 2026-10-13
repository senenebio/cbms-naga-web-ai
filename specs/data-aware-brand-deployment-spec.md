# Spec: Data-Aware Brands + Deployment

**Status:** implemented (Vercel live, verified 2026-10-13 — see B3 incident notes)
**Date:** 2026-10-13
**Parent spec:** `monorepo-whitelabel-spec.md` (complete)

## Goal

Make a `Brand` **data-aware** (each brand carries its dataset descriptor) and
establish a **deployment pipeline** (Vercel, one project per brand) so that
adding a white-label brand with *different data* is a data + descriptor change,
not a code change — and deploying it is a Vercel project entry, not a new repo.

Brand #1 (CBMS Naga 2024) keeps byte-identical behavior throughout.

---

## Part A — Data-Aware Brand

### Decisions

| # | Decision |
|---|----------|
| D1 | **Build-time pairing.** A brand statically references its `Dataset`. One brand per build (no runtime dataset picker). |
| D2 | **`Dataset` type lives in `@workspace/brand-config`**, alongside `Brand`; `Brand` gains a required `dataset: Dataset` field. |
| D3 | **Single dictionary owner.** The CBMS dictionary JSON is statically imported exactly once — by the dataset descriptor in `packages/brand-config/src/datasets/cbms.ts`. The existing static imports in `packages/core/src/data.ts` and `packages/core/src/wasm/open_warehouse.ts` are deleted; core modules receive the dictionary via the `Dataset` parameter. |
| D4 | **View names stay canonical** (`person`, `household`, `barangay`, `v_barangay_summary`) across all brands — a data-asset invariant. Brands differ in rows, dictionary, context text, and assets, not in view shapes. |
| D5 | **Data layout becomes per-brand:** `data/<brand-id>/warehouse/*.parquet`, `data/<brand-id>/…-Data-Dictionary.json`, `data/<brand-id>/…-geojson`. `scripts/copy-data.mjs` copies **every** `data/<brand-id>/` directory into `public/data/<brand-id>/` (no brand knowledge in the script); the runtime fetches `/data/<brandId>/…`. |
| D6 | **Demo questions move into the dataset** (`dataset.demoQuestions`); `apps/chat-app/src/demoQuestions.ts` is deleted. |
| D7 | **`DEMO_COLUMNS` / `RURAL_BARANGAYS` live in the dataset only.** The copies in `packages/core/src/data.ts` and `packages/core/src/wasm/open_warehouse.ts` are deleted (single source of truth). |
| D8 | **No new dependencies, no runtime server.** Guardrails (`runSelect`, PII allowlist, caps) untouched. |

### `Dataset` type

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
app and root `packages/core/` unit tests.

### Core threading (`packages/core/`)

| Module | Change |
|---|---|
| `data.ts` | Delete `loadDataDictionary()` + static JSON import + `DEMO_COLUMNS` + `RURAL_BARANGAYS`. `allowedColumns(table, columns, dataset)`. |
| `schema.ts` | `selectColumns(question, dataset)`, `buildSchemaBlock(engine, dataset, selected?)`, `observedColumnValues(engine, table, columns, dataset)`. |
| `llm/prompts.ts` | `buildSystemPrompt(schemaBlock, dataset)` — `DATASET_CONTEXT` constant deleted, replaced by `dataset.context`. |
| `llm/chat.ts` | `systemForQuestion(question, fullSystem, engine, dataset)`. |
| `llm/client.ts` | Unchanged (tool description names the canonical views — D4). |
| `wasm/open_warehouse.ts` | `openWarehouseWasm(db, parquets, dataset)`; delete dictionary import + `DEMO_COLUMNS` + `RURAL_BARANGAYS`. |
| `llm/sql_tool.ts`, `chart.ts`, `provider.ts` | Unchanged. |

### App threading (`apps/chat-app/`)

- `brand.ts` — unchanged import; `BRAND` now carries the dataset.
- `core/chat.ts` — `createChatSession(engine, dataset)`; the session object
  carries the dataset so `chatQuestion` stays as-is.
- Worker boot — fetch `/data/<id>/{person,household,barangay}.parquet` from
  `BRAND.dataset.tables`; pass the dataset to `openWarehouseWasm`.
- Map — geojson fetch path from `dataset.geojson`.
- `demoQuestions.ts` — deleted; chips render from `BRAND.dataset.demoQuestions`.

### Data layout + build

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

---

## Part B — Deployment (Vercel)

### Facts (why this is easy)

- The app is pure-static: ~47 MB build output, zero serverless, zero env
  secrets at runtime (BYOK keys live in the visitor's `localStorage`).
- The duckdb-wasm engine + dispatcher worker are already emitted as hashed
  static assets by Vite.
- Data assets are served from `/data/...` (parquets, dictionary, geojson).
- No client-side routing → no SPA rewrites needed.

### B1 — Deploy the CBMS brand

1. **Push to Git** (repo currently has no remote):
   `git remote add origin <repo> && git push -u origin main`
2. **Import in Vercel** (Add New → Project → import repo). Vite is not
   auto-configured because the app root is `apps/chat-app`; set manually:

   | Setting | Value |
   |---|---|
   | Framework Preset | Vite (or "Other") |
   | Root Directory | *(repo root, empty)* |
   | Build Command | `pnpm build` |
   | Output Directory | `apps/chat-app/dist` |
   | Install Command | `pnpm install` (auto-detected from `pnpm-lock.yaml`) |
   | Node Version | 20.x+ (build step only) |

3. **No env vars, no `vercel.json` required** for the single-brand case.
   `prebuild` runs `scripts/copy-data.mjs` inside `pnpm build`, so
   `public/data/` is populated and the parquets land in `dist/data/`.
   The `copy-brand-data` Vite plugin (in `apps/chat-app/vite.config.ts`)
   performs the same copy at `buildStart`, so the data is bundled even
   when a build tool invokes `vite build` directly (skipping npm
   lifecycle scripts). Brand filter: `BRAND_ID`, falling back to
   `VITE_BRAND_ID`.
4. **Verify on the live URL:**
   - Warehouse boots (parquets + duckdb wasm load)
   - BYOK endpoint configured in Settings → demo question runs
     (SQL, chart, map all render)
   - Deploy size ~47 MB static

**Optional:** custom domain, `{ "cleanUrls": true }` in `vercel.json`.

### B3 — Data-URL versioning + incident notes (2026-10-13)

**Mechanism: versioned data URLs.** Runtime-fetched assets (`/data/<id>/…`
parquets + geojson) are fetched with a `?v=<build-stamp>` query string,
injected at build time via `__DATA_VERSION__` (`define` in
`apps/chat-app/vite.config.ts`; ambient decl in
`apps/chat-app/src/globals.d.ts`). Every deploy therefore uses fresh
edge-cache keys, so a stale edge-cached 404 from an earlier (broken)
deployment can never break a healthy one.

**Incident: failed builds + stale 404s.** The Vercel project was created
with Root Directory `apps/chat-app` — `pnpm build` run from a directory
with no `package.json` fails (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`), so
every build failed and Vercel kept serving the last (data-less)
deployment while edge PoPs cached the resulting 404s (negative caches
persisted well past the alias swap). Resolution: Root Directory cleared
(repo root), Build Command `pnpm build`, Output `apps/chat-app/dist`;
then B3 versioning so recovery didn't depend on edge-cache expiry.

**Rule: Root Directory must be the repo root** (the `package.json` lives
there). Never set it to `apps/chat-app`.

### B2 — Separate deployment per additional brand

**One Vercel project per brand**, all importing this same repo. A
`vercel.json` cannot express a project matrix (its schema has no
`projects` property) — per-brand config lives in each project's
dashboard settings.

#### Prerequisite (small code change)

`apps/chat-app/src/brand.ts` is env-driven:

```ts
const id = (import.meta.env.VITE_BRAND_ID ?? 'cbms') as BrandId;
export const BRAND = BRANDS[id] ?? BRANDS.cbms;
```

Each Vercel project sets `VITE_BRAND_ID` as an **environment variable in
its project settings** — Vite inlines it at build time, so the brand is
baked into that deployment (build-time pairing, D1).

#### Per-project settings (Vercel dashboard)

| Setting | Value |
|---|---|
| Root Directory | *(repo root, empty — see B3 rule)* |
| Build Command | `pnpm build` |
| Output Directory | `apps/chat-app/dist` |
| Environment Variables | `VITE_BRAND_ID=<brand-id>`, `BRAND_ID=<brand-id>` |

Per brand you get: its own deployment + subdomain/custom domain, its own
env vars, its own preview deploys per PR.

#### Deploy only one brand, leave the others alone

- **Vercel only deploys what is imported as a project.** A brand in the
  repo (`BRANDS` entry + `data/<id>/`) with no Vercel project is inert.
- **Create a Vercel project for a brand only when you want it live.**
- **Ships only its own data:** `scripts/copy-data.mjs` filters to the active
  brand via the `BRAND_ID` env var (set alongside `VITE_BRAND_ID` in the
  project settings). Each deployment contains exactly one brand's assets.

### Brand state model

| Brand | In repo | Has `data/<id>/` | Has a Vercel project | Deployed |
|---|---|---|---|---|
| cbms | ✅ | ✅ | ✅ | ✅ |
| future brand | ✅ | ✅ | ❌ | ❌ (inert) |
| future brand, later | ✅ | ✅ | ✅ (created) | ✅ |

---

## Phases (each ends green: `pnpm test` + `pnpm typecheck` + `pnpm lint`)

**Phase 1 — Descriptor + data move (no core signature changes)**
1. `Dataset` type + `CBMS_DATASET` in `packages/brand-config` (dictionary
   import moves here from `packages/core/src/data.ts` — `data.ts` temporarily
   keeps a re-export of `loadDataDictionary()` backed by `CBMS_DATASET` to
   stay green).
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

**Phase 4 — Brand env + deployment**
7. `brand.ts` → env-driven (`VITE_BRAND_ID`).
8. Per-brand Vercel project config (`VITE_BRAND_ID` env var per project).
9. `copy-data.mjs` → `BRAND_ID` filter (ship only active brand's data).
   *Gate: local `pnpm build` green; Vercel import + live URL verified.*

**Phase 5 — Docs**
10. `AGENTS.md` + `README.md` + `docs/DATA-ASSETS.md`: per-brand data layout,
    the "add a brand" checklist (BRANDS entry + `data/<id>/` + one line in
    `brand.ts` + per-brand Vercel project entry), deployment instructions.

---

## Invariants

- All LLM SQL through `runSelect`; guardrails, PII allowlist, caps unchanged.
- Warehouse view names/shapes canonical (D4).
- No runtime server, no `/api`, no new dependencies.
- CBMS brand #1 behavior byte-identical after every phase.

## Out of scope

- Runtime dataset picker / multi-dataset single build.
- Per-brand LLM prompt style differences (answer-style rules stay global).
- Auto-generating a dictionary from raw parquets.
- CI/CD pipelines beyond Vercel's built-in deploys.
- GitHub Pages deployment (subpath-aware `base` is a separate concern).
