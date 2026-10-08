# CBMS Naga City — browser-only AI interpretation demo

A **pure-static, browser-only** demo that lets you ask questions about the
**2024 CBMS (Community-Based Monitoring System) — Naga City** dataset with a
BYOK / local LLM. DuckDB runs entirely in the browser via
[`duckdb-wasm`](https://duckdb.org) (in a Web Worker) over three bundled
parquet files, and the LLM is called **directly from the browser** with tool
(function) calling to run **read-only SQL**. There is **no runtime server** —
the app is a static bundle you can host anywhere.

## What it does

- A single **chat panel** (+ a **Settings** dialog) — no workspace pane.
- The LLM is given the warehouse schema and a single `run_select` tool. It
  writes `SELECT` queries, the app runs them against the in-browser DuckDB,
  returns the (capped) rows as a tool result, and the LLM narrates the answer
  in Markdown with a small results table.
- Five **demo-question chips** are preloaded to kick things off (e.g. "Rank the
  10 barangays by the share of household members who did not avail medical
  treatment despite being sick.").

## Data source

- **2024 CBMS — Naga City**, pre-built into three warehouse parquets under
  `data/warehouse/`: `person`, `household`, `barangay`.
- A **data dictionary** (`data/2024-CBMS-Data-Dictionary.json`) drives the PII
  allowlist: only its `include=true` columns are exposed, and an explicit
  blocklist keeps `ean`/`bsn`/`husn`/`hsn`/coordinates/contact out of the LLM
  surface. Warehouse views: `barangay`, `household`, `person`,
  `v_barangay_summary`.

## Run it

```bash
npm install
```

### Development

```bash
npm run dev:web      # Vite dev server for web/
```

### Production (static)

```bash
npm run build:web    # copies data → web/public/data/ then builds the static bundle
npm start            # build + serve the bundle with `vite preview`
```

`npm start` serves the built output (a plain static site) locally. To deploy,
publish the build output (`web/dist/`) to any static host — no Node runtime.

### Tests / checks

```bash
npm test             # vitest: pure logic + WASM E2E under Node + React tests
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run format       # prettier (write) / format:check
```

## Using it

1. `npm run dev:web` (or `npm start`) and open the URL it prints.
2. Click the **⚙️ Settings** gear and pick a provider (BYOK — your key is
   stored in `localStorage` only and sent straight to the provider):
   - **local** — Ollama / LM Studio / llama.cpp (any OpenAI-compatible
     endpoint, e.g. `http://localhost:11434/v1`).
   - **openrouter** — `https://openrouter.ai/api/v1` (free tier included).
   - **openai** — `https://api.openai.com/v1` (direct BYOK).
3. Chat with the warehouse. Ask anything; the model issues read-only SQL
   against the DuckDB views and explains the results.

## Architecture overview

- **DuckDB-WASM worker** — `web/src/wasm/db.worker.ts` owns the `DuckDBWASM`
  engine in a Web Worker. It loads the three parquets (fetched as
  `ArrayBuffer`s) into an in-memory filesystem and creates the four views via
  `read_parquet`.
- **Driver-free core** — the shared logic in root `src/` (SQL guardrails,
  schema block, LLM client/provider helpers, PII allowlists) has **no**
  `node:` or `@duckdb/node-api` imports, so it is imported by `web/` and
  bundled for the browser. Only the `duckdb-wasm` path touches a database
  engine. The same core is exercised by the Node-based WASM E2E test.
- **BYOK LLM** — a thin `fetch` implementation of the `LLMClient` interface
  (no `openai` SDK). Provider config is normalized from `localStorage`; keys
  are masked in the UI and never logged.
- **UI** — chat + settings only (`web/src/App.tsx`, `ChatPanel`,
  `SettingsDialog`, `AnswerMarkdown`, `ResultTable`).

### Guardrails (do not weaken)

- **Read-only SQL**: a single `SELECT` only, enforced by a `validateSelectOnly`
  keyword blocklist. All LLM SQL goes through `runSelect`.
- **Result caps**: 100-row cap, ~50 KB result-text cap, with a binary-search
  shrink when a query exceeds the cap.
- **PII allowlist**: only data-dictionary `include=true` columns are exposed;
  `ean`/`bsn`/`husn`/`hsn`/coordinates/contact stay out. `DEMO_COLUMNS` and
  `RURAL_BARANGAYS` are kept intact.

## Project layout

```
src/                      # driver-free shared core (imported by web/ + tests)
  llm/                    #   sql_tool, client, provider, mock_client (test-only), types
  schema.ts               #   schema block / table facts
  data.ts                 #   dictionary import, PII allowlists, DEMO_COLUMNS, RURAL_BARANGAYS
  wasm/                   #   WasmSqlEngine + openWarehouseWasm (Node + browser)
web/
  src/                    # React app (chat + settings), browser core (worker, llm, provider)
  public/data/            # build-generated: copied parquets + dictionary (gitignored)
data/
  warehouse/*.parquet     # source warehouse assets (person, household, barangay)
  2024-CBMS-Data-Dictionary.json
scripts/copy-data.mjs     # build step: source data → web/public/data/
specs/browser-only-spec.md
```

## Notes

- The data assets under `web/public/data/` are **build-generated** (copied
  from `data/` by `scripts/copy-data.mjs`) and are gitignored.
- BYOK keys live in `localStorage` only — nothing is sent to a server, and
  there is no server.
