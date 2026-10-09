# Task: Migrate cbms-demo to run entirely in the browser (zero-server)

## Objective

Convert this app from a Node/Express backend into a **pure static site** that runs entirely in the browser. End state:

- DuckDB runs in the browser via **duckdb-wasm** (full build, in a Web Worker), reading the 3 pre-built parquet files loaded into an in-memory filesystem.
- The LLM is called **directly from the browser** with a `fetch` to an OpenAI-compatible `/chat/completions` endpoint (tool/function calling).
- There is **no Express server at runtime**. The only "server" that remains is the one-time build step that produces the parquet + dictionary static assets.
- LLM provider config is **BYOK**: the user's API key is stored in `localStorage` and sent straight to the provider. No server-held key.

## Decisions (planning conversation — supersedes where in conflict)

Resolved during planning; these override the original text below where they differ.

1. **Working location.** Work happens in the present directory (`cbms-naga-web-ai`) as a **slim copy** adapted from `cbms-demo`. `cbms-demo` is the **read-only source of truth** and is NOT modified.
2. **Slim copy.** Copy only what the static app needs: `src/` (refactored driver-free core), `web/` (Vite React, **chat + settings only** — the workspace panel is dropped, decision 11), `test/`, `data/warehouse/*.parquet` (pre-built) and `data/2024-CBMS-Data-Dictionary.json`, plus fresh `package.json` / `tsconfig.json` / `web/vite.config.ts`. Do NOT copy `scripts/*.mjs` (the parquets are already built), the ingestion-from-DB pipeline, `dist/`, `graphify-out/`, `vercel.json`, `Dockerfile*`, `Makefile`, `.env`, `demo.txt`, or the old `src/public/` UI.
3. **WASM engine only (single engine).** There is exactly ONE real `SqlEngine`: `WasmSqlEngine` (duckdb-wasm), used in the **browser AND in the Node-based tests** (duckdb-wasm runs under Node). Drop `NodeSqlEngine` and the `@duckdb/node-api` dependency, the Node warehouse builder, and `src/cli.ts`. The `SqlEngine` interface is kept so `runSelect` stays unit-testable with a fake engine. This supersedes the "two engines" wording in the architecture section below.
4. **No presets.** Remove presets entirely: no `PresetsBar`, no preset calls in `App.tsx`/`ChatPanel.tsx`, no `core/presets`. (Unlike briefing/compare, presets ARE referenced by the v2 UI, so this is an explicit product decision to drop the feature, not dead code.)
5. **Providers.** Settings dialog offers `local` (Ollama / LM Studio / llama.cpp via an OpenAI-compatible endpoint), `openrouter`, and `openai` (direct BYOK). BYOK key stored in `localStorage`, sent straight to the provider. `local` + `openrouter` + `openai` — no `mock` in the UI.
6. **Remove `CBMS_MOCK`.** No runtime/env mock mode. `mock_client.ts` is kept as a **test-only** dependency (imported by the E2E test, never exposed in the UI or provider resolution).
7. **Bundle data.** Build step copies `data/warehouse/*.parquet` and `data/2024-CBMS-Data-Dictionary.json` into `web/public/data/`. The data dictionary is **bundled as a static JSON import** (not a runtime fetch), so `loadDataDictionary()` stays synchronous. Parquets are fetched as ArrayBuffers into the duckdb-wasm in-memory FS at startup.
8. **No `core/queries.ts`.** There is no structured barangay list/detail UI (see decision 11), so `core/queries.ts` does not exist in this project. All data access is LLM-driven through chat via `runSelect` over the WASM views. `insights.ts`, `/api/compare`, and `/api/chart/*` are all out of scope.
9. **No `openai` SDK.** The `openai` Node dependency is dropped; the LLM client is a thin `fetch` implementation of the existing `LLMClient` interface.
10. **Shared core location.** Driver-free shared modules live in root `src/` and are imported by `web/` via relative paths (Vite compiles them). The web app imports only the driver-free subset, so no Node deps leak into the bundle.
11. **Chat + settings only (drop the workspace panel).** Remove the entire right workspace pane: no Overview, no Barangay explorer, no Barangay detail, no presets. The app is a **single chat panel + the Settings dialog** (plus the theme/model header). The five demo-question chips return to the `ChatPanel` (they were Overview-only in v2.1). This makes `core/queries.ts` unnecessary and drops all `BarangaySummary`/`BarangayDetail`/`CityTotals` types and their `api.ts` helpers. The four warehouse views (incl. `v_barangay_summary`) are **kept** — the LLM queries them in chat.

## Hard constraints (do NOT weaken)

- Keep the SQL guardrails in `src/llm/sql_tool.ts` identical: single read-only `SELECT` only, `validateSelectOnly` keyword blocklist, 100-row cap, ~50 KB result-text cap, and the binary-search shrink. All LLM SQL must go through `runSelect`.
- Preserve the PII allowlists: the data-dictionary `include=true` columns are the only ones exposed; ean/bsn/husn/hsn/coordinates/contact stay out. Keep `DEMO_COLUMNS` and `RURAL_BARANGAYS` intact.
- Preserve the read-only warehouse views (`barangay`, `household`, `person`, `v_barangay_summary`) with the same column sets.
- Do not change the ingestion pipeline (`src/ingest/load_dump.ts`) or the `scripts/*.mjs` demo-column scripts — they remain the build-time producers of the parquet files. **Clarified (decision 2/3):** in the slim copy we do not ship the ingestion pipeline or `scripts/*.mjs`; the parquets are pre-built in `cbms-demo` and copied in. Only the small set of shared constants (`REPO_ROOT`-free `TABLES`/`TableName`/`parquetPath`) that the core needs is retained. The guardrails/PII/view-shape constraints above are unchanged.
- Keep `npm test` green at the end of every phase.

## Key architectural decision: a driver-agnostic SQL engine

Introduce a minimal adapter so the guardrailed `runSelect` is engine-agnostic.

**WASM engine only (decision 3):** `WasmSqlEngine` (duckdb-wasm) is the single real engine, used in the browser AND in the Node-based tests (duckdb-wasm runs under Node). There is no `NodeSqlEngine` and no `@duckdb/node-api`.

```ts
export interface SqlEngine {
  query(sql: string): Promise<{ columns: string[]; rows: unknown[][] }>;
}
```

- `WasmSqlEngine` wraps a duckdb-wasm `Connection` (uses `ArrowDataArray` → columns + rows). A throwaway fake `SqlEngine` is used in unit tests.
- Rewrite `runSelect(engine, sql, ...)` to take `SqlEngine`. The pure parts (`validateSelectOnly`, `serializeResult`, caps) are unchanged.

## File map

Create (browser core — must have NO `node:` or `@duckdb/node-api` imports):

- `web/src/wasm/db.worker.ts` — Web Worker owning `DuckDBWASM` (Vite `?worker` import). Loads parquet via in-memory `FileSystem.putFileByPath` from fetched ArrayBuffers, then creates the same views with `read_parquet`.
- `web/src/wasm/engine.ts` — `WasmSqlEngine` + `openWarehouseWasm()`.
- `web/src/core/llm.ts` — `fetch`-based `LLMClient` (reuses `toApiMessages`, `RUN_SELECT_TOOL_SPEC`, `trimHistory`).
- `web/src/core/provider.ts` — resolution: localStorage BYOK → unconfigured (mock is **test-only**, never in the UI). ~~Providers: `local`, `openrouter`, `openai`. Reuses `normalizeProviderConfig`, `maskKey`, `PROVIDER_PRESETS`.~~ → **superseded by [openai-endpoint-spec.md](openai-endpoint-spec.md)**: single OpenAI-compatible endpoint mode (`{ baseUrl, apiKey?, model }`), no provider presets.
- `web/src/core/chat.ts` — ports `streamQuestion`/`systemForQuestion` (reuses `askQuestion`, `runSelect`).

Refactor to be driver-free (importable by both Node and browser):

- `src/llm/sql_tool.ts` → takes `SqlEngine`.
- `src/schema.ts` → `tableFacts`/`observedColumnValues`/`buildSchemaBlock` take an `SqlEngine` instead of opening throwaway Node connections.
- `src/llm/client.ts` → keep pure `toApiMessages`, `Message` types, tool spec.
- `src/llm/provider.ts` → extract the pure helpers (normalize/mask/presets).
- `DEMO_COLUMNS`/`RURAL_BARANGAYS`/`allowedColumns` → shared, no Node deps.

Data → static assets:

- Add a build step copying `data/warehouse/*.parquet` and `2024-CBMS-Data-Dictionary.json` into `web/public/data/`.
- The data dictionary is **bundled as a static JSON import** (decision 7), so `loadDataDictionary()` stays synchronous.

Delete / drop in the port:

- `src/server.ts` (Express) — remove (never copied into the slim project).
- `src/insights.ts` (briefing) — do NOT port (no UI ref).
- `src/cli.ts` — drop (WASM engine only; no `NodeSqlEngine`).
- `src/ingest/load_dump.ts` MariaDB ingestion — drop; keep only the shared `TABLES`/`TableName`/`parquetPath` constants the core needs.
- `web/src/api.ts` fetch helpers — replace with direct `core/` calls.
- **Workspace panel (decision 11):** `OverviewTab.tsx`, `ExplorerTab.tsx`, `BarangayTab.tsx`, `PresetsBar.tsx`, and the App state for tab / workspace-visibility / activeBarangay / lastQuestion. The app is a single `ChatPanel` + `SettingsDialog`; the 5 demo-question chips move into the `ChatPanel`.
- **Presets** — drop entirely (decision 4).

## LLM refactor specifics

- Replace the `openai` Node SDK with a thin `fetch` client implementing the existing `LLMClient` interface (`chat(messages, tools)`). The `askQuestion` tool loop stays provider-agnostic and unchanged.
  - **Deviation (2026-10-08, post-G):** weak models can exceed the 4-tool-round cap without answering. `askQuestion` now responds to the cap by pushing a "query limit reached" nudge and making **one final call with no tools**; only if that returns no content does it throw. The system prompt also gained Rule 7 ("be economical: at most 3 `run_select` calls, then answer"). SQL guardrails and the cap value are unchanged.
  - **Deviation (2026-10-08, chart legibility):** chart requests rendered unreadably (ASCII art in stripped code fences, unbounded wide tables). (A) `ANSWER_STYLE` gained Rule 6: the only supported chart is the 2-column comparison table (≤5 rows, renders as bars); no ASCII art / code fences / emoji / mermaid. (B) `AnswerMarkdown` now renders plain (non-bar) markdown tables through a capped `PlainTable` (`MAX_TABLE_ROWS_SHOWN = 15`, "showing X of Y" note) inside a scrollable `.table-scroll` container.
- `process.env` does not exist in the browser: drop the "env" source. The Settings dialog writes to `localStorage`. Keep `maskKey` for display.
- **`CBMS_MOCK` is removed entirely** (decision 6): no runtime/env mock mode. `mock_client.ts` is a test-only dependency. Effective resolution is localStorage BYOK → unconfigured.
- OpenAI, OpenRouter, and local OpenAI-compatible servers (Ollama / LM Studio / llama.cpp) all allow browser (CORS) calls — target those.

## Testing

- Pure logic tests (sql_tool, schema rendering, provider normalize, maskKey, toApiMessages) run in Node/vitest unchanged.
- `runSelect`: unit-test with a fake `SqlEngine`; integration-test the **WASM engine only** (duckdb-wasm runs under Node, so no browser needed in CI). There is no Node engine to test (decision 3).
- Re-point `test/end_to_end_mock.test.ts` from "boot Express" to "init WASM warehouse in a Node harness → mock client → assert SQL + answer".
- React component tests stay; replace `api.test.ts` with tests for `core/`.

## Implementation phases (each independently shippable)

Each phase is a self-contained unit: it touches a known set of files, depends only on the
**interface contracts** of earlier phases (not their internals), and ends with its own green
test gate. Phases marked with the same letter can be implemented **in parallel** once the
contract they share is in place.

**Shared contracts (define these first; they are what make the phases independent):**

- `SqlEngine` interface — `query(sql) → { columns, rows }` (phase A).
- `LLMClient` interface — `chat(messages, tools) → stream` (phase A).
- The pure core's public API (`runSelect`, `askQuestion`, `buildSchemaBlock`, provider
  helpers) — phase A. Later phases import these names, never reach into internals.

**Status legend:** ✅ done · ❌ not done. Dates are the date the phase's status was last recorded.

| Phase                     | Status      | Recorded   |
| ------------------------- | ----------- | ---------- |
| A — Scaffold + data       | ✅ done     | 2026-10-08 |
| B — Pure driver-free core | ✅ done     | 2026-10-08 |
| C — WASM engine           | ✅ done     | 2026-10-08 |
| D — E2E under Node        | ❌ not done | 2026-10-08 |
| E — Browser core          | ✅ done     | 2026-10-08 |
| F — UI (chat + settings)  | ✅ done     | 2026-10-08 |
| G — Build, assets, docs   | ✅ done     | 2026-10-08 |

---

### Phase A — Scaffold + data (foundation)

- **Status:** ✅ done · 2026-10-08
- **Delivers:** a buildable Node+TS+Vite+vitest project (with lint/format) and the data in
  place.
- **Files:** `package.json` (scripts: `dev:web`, `build:web`, `start`, `test`, `lint`,
  `format`), `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `eslint.config.js`,
  `.prettierrc` (+ prettier ignore); copy `data/warehouse/*.parquet` and
  `data/2024-CBMS-Data-Dictionary.json` into the project; define the `SqlEngine` +
  `LLMClient` interfaces (tiny `src/llm/types.ts`). Tooling: `typescript`, `vite`, `vitest`,
  `react`/`react-dom`, `duckdb-wasm`, `react-markdown`, plus `eslint` + `prettier` (dev).
- **Deps:** none.
- **Done when:** `npm install` succeeds; a trivial vitest test runs green; `npm run lint` and
  `npm run format` pass; the 3 parquets + dictionary are present at their final paths.

### Phase B — Pure driver-free core (no WASM, no browser)

- **Status:** ✅ done · 2026-10-08
- **Delivers:** all engine-agnostic logic, testable with a fake `SqlEngine`.
- **Files:** `src/llm/sql_tool.ts` (validateSelectOnly, runSelect, caps, binary-search
  shrink), `src/llm/client.ts` (fetch `LLMClient`, `toApiMessages`, `RUN_SELECT_TOOL_SPEC`,
  `trimHistory`), `src/llm/provider.ts` (normalize/mask/presets), `src/llm/mock_client.ts`
  (test-only), `src/schema.ts` (`buildSchemaBlock`/`tableFacts`/`observedColumnValues` over
  `SqlEngine`), `src/data.ts` (bundled dictionary import, `DEMO_COLUMNS`, `RURAL_BARANGAYS`,
  `allowedColumns`, `loadDataDictionary`).
- **Deps:** A (project + interfaces).
- **Done when:** pure-logic unit tests green in Node (fake engine, no duckdb-wasm, no
  network).
- **Parallelizable:** yes — independent of C (they share only the `SqlEngine` contract).

### Phase C — WASM engine (duckdb-wasm)

- **Status:** ✅ done · 2026-10-08
- **Delivers:** the single real `SqlEngine` + warehouse bootstrap.
- **Files:** `src/wasm/wasm_engine.ts` (`WasmSqlEngine` wrapping a duckdb-wasm `Connection`),
  `src/wasm/open_warehouse.ts` (`openWarehouseWasm()` → in-memory FS → create the 4 views).
- **Deps:** A (`SqlEngine` interface + parquets). Not B's internals.
- **Done when:** under **Node**, `openWarehouseWasm()` loads the 3 parquets, creates
  `barangay`/`household`/`person`/`v_barangay_summary`, and a `runSelect` over a view
  returns correct `{columns, rows}`. No browser needed.
- **Parallelizable:** yes — alongside B once the `SqlEngine` contract exists.

### Phase D — E2E under Node (mock LLM + real WASM warehouse)

- **Status:** ✅ done · 2026-10-08
- **Delivers:** the full tool-loop integration test without a browser.
- **Files:** `test/end_to_end.test.ts` — boot `openWarehouseWasm()`, drive `askQuestion` with
  `mock_client`, assert the emitted SQL + answer.
- **Deps:** B (`askQuestion`) + C (`openWarehouseWasm`).
- **Done when:** E2E test green under Node/vitest.

### Phase E — Browser core (worker + browser wrappers)

- **Status:** ✅ done · 2026-10-08
- **Delivers:** the browser-facing layer that reuses the pure core.
- **Files:** `web/src/wasm/db.worker.ts` (Vite `?worker`, owns `DuckDBWASM`, loads parquets
  from fetched ArrayBuffers), `web/src/wasm/engine.ts` (browser `WasmSqlEngine` +
  `openWarehouseWasm`), `web/src/core/llm.ts` (fetch client), `web/src/core/provider.ts`
  (localStorage resolution: `local`/`openrouter`/`openai` → unconfigured),
  `web/src/core/chat.ts` (`streamQuestion`/`systemForQuestion`).
- **Deps:** B (pure core API) + C (engine shape). Reuses B/C, adds no Node deps.
- **Done when:** these compile for the browser; a smoke test drives `core/chat.ts` with a
  stub engine + stub LLM (no real network).

### Phase F — UI (chat + settings only)

- **Status:** ✅ done · 2026-10-08
- **Delivers:** the React app.
- **Files:** `web/src/App.tsx` (single `ChatPanel` + `SettingsDialog` + header),
  `ChatPanel.tsx` (+ the 5 demo chips), `SettingsDialog.tsx`, `AnswerMarkdown.tsx`,
  `ResultTable.tsx`, `theme.ts`, `demoQuestions.ts`, `styles.css`, `main.tsx`, `index.html`,
  `web/vite.config.ts` (no `/api` proxy). Drop `api.ts`, `PresetsBar`, and the three tab
  components.
- **Deps:** E (the `core/` API).
- **Done when:** React component tests green (chat send → streaming render → result table);
  app type-checks/builds.
- **Parallelizable (partial):** presentational components (`AnswerMarkdown`, `ResultTable`,
  `theme`, `styles`) can be built against the `core/` API shape before E is fully wired.

### Phase G — Build, assets, docs

- **Status:** ✅ done · 2026-10-08
- **Delivers:** the static bundle + data copy step + docs.
- **Files:** `package.json` scripts (`build:web`, `start` → `vite build && vite preview`);
  build step copying `data/warehouse/*.parquet` + dictionary → `web/public/data/`;
  `AGENTS.md`, `README`.
- **Deps:** F.
- **Done when:** `npm run build:web` emits a static bundle that `vite preview` serves with no
  Node server; full `npm test` green (pure logic + WASM E2E under Node + React tests).

---

**Dependency graph:** `A → {B, C} → D` and `A → {B, C} → E → F → G`.
**Parallel tracks:** B ∥ C (after A); F's presentational components ∥ E. **Critical path:**
A → C → E → F → G.

## Definition of done

- `npm run build:web` produces a static bundle that works with no Node server.
- The chat panel (LLM querying the WASM warehouse) and the Settings dialog work in-browser. The app is **chat + settings only** (no workspace panel).
- `npm test` is green (pure logic + WASM E2E under Node + React tests).
- The SQL guardrails and PII allowlists are byte-for-byte preserved.
- AGENTS.md and README reflect the new static architecture.

## Process rules

- Work phase by phase; run `npm run lint` and `npm test` after each and stop if it goes red.
- If you hit a genuinely ambiguous decision (not covered above), stop and ask before guessing.
- Keep the changes minimal and behavior-preserving; do not refactor unrelated code.

---

## Notes on using this spec

- Run it in phases. Give it to an agent that can run commands, and tell it to stop after each phase for a review — the `npm test` gate is the checkpoint.
- It is self-contained about the plan, but it assumes the agent can read the repo (the file names/paths are real).
- The two "baked-in" choices are **BYOK + local LLM** and **pure-static**; the WASM-engine-only decision is captured in the Decisions section. Edit those if you'd rather not commit to them.
