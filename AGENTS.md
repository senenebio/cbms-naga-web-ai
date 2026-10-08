# Project Overview

- **Name:** cbms-naga-web-static
- **Stack:** Vite + React 18 + TypeScript, `duckdb-wasm` (Web Worker), Vitest, react-markdown. **No runtime server** — pure static site.
- **Description:** A pure-static, browser-only AI interpretation demo for CBMS 2024 (Naga City) data. DuckDB runs in the browser via `duckdb-wasm` over 3 bundled parquet files; a BYOK / local LLM is called directly from the browser with tool (function) calling to run read-only SQL. The UI is **chat + settings only** (no workspace panel).

## Project state

**Complete.** All phases (A–G) of `specs/browser-only-spec.md` are done and the suite is
green. The app is a **pure-static, browser-only** site: DuckDB via `duckdb-wasm` in a Web
Worker, BYOK / local LLM via `fetch`, **no runtime server**. This directory is a slim copy
adapted from the read-only reference at `/home/senen/experiments/cbms-demo` (never modify
that repo).

## Key file map

- `src/` — **driver-free core** (imported by `web/` and by Node tests; no `node:` / `@duckdb/node-api`):
  - `src/llm/sql_tool.ts` — `runSelect` + `validateSelectOnly` + caps + binary-search shrink
  - `src/llm/client.ts` — `toApiMessages`, `RUN_SELECT_TOOL_SPEC`, `trimHistory`, message types
  - `src/llm/provider.ts` — `normalizeProviderConfig` / `maskKey` / `PROVIDER_PRESETS`
  - `src/llm/mock_client.ts` — **test-only** (never in the UI path)
  - `src/llm/types.ts` — `SqlEngine` + `LLMClient` interfaces
  - `src/schema.ts` — `buildSchemaBlock` / `tableFacts` / `observedColumnValues`
  - `src/data.ts` — dictionary import, `DEMO_COLUMNS`, `RURAL_BARANGAYS`, PII allowlists
  - `src/wasm/` — `WasmSqlEngine` + `openWarehouseWasm()` (single real engine)
- `web/` — React app (chat + settings only) + browser core:
  - `web/src/App.tsx`, `web/src/components/` (`ChatPanel`, `SettingsDialog`, `AnswerMarkdown`, `ResultTable`)
  - `web/src/wasm/db.worker.ts` (owns DuckDB), `web/src/wasm/engine.ts` (browser `SqlEngine`)
  - `web/src/core/` (`llm.ts`, `provider.ts` — localStorage BYOK, `chat.ts`)
  - `web/public/data/` — **build-generated** (copied parquets + dictionary; gitignored)
- `data/` — source assets: `warehouse/{person,household,barangay}.parquet`, `2024-CBMS-Data-Dictionary.json`
- `scripts/copy-data.mjs` — build step: source data → `web/public/data/` (runs via `prebuild:web`)
- `specs/browser-only-spec.md` — full spec + decisions + phase plan

## Essential Commands

Run these exact commands for development, linting, and testing:

- **Install:** `npm install`
- **Dev Server:** `npm run dev:web` (Vite dev server for `web/`)
- **Build:** `npm run build:web` → `prebuild:web` copies `data/` → `web/public/data/`, then `vite build web`
- **Start (static preview):** `npm start` → `npm run build:web && vite preview web`
- **Data copy (direct):** `node scripts/copy-data.mjs` (also runs automatically as `prebuild:web`)
- **Test:** `npm test` (vitest: pure logic + WASM E2E under Node + React tests)
- **Lint / Format:** `npm run lint` / `npm run format`

## Code Style & Conventions

- Use functional and declarative patterns; avoid unnecessary classes.
- Prefer explicit TypeScript types over `any`; do not suppress errors with `@ts-ignore`.
- File naming: kebab-case for files/folders, PascalCase for React components/classes.
- **Driver-free core:** modules in root `src/` must have **no** `node:` or `@duckdb/node-api`
  imports — they are imported by `web/` and bundled for the browser. Only the `duckdb-wasm`
  path touches a database engine.
- **All LLM SQL goes through `runSelect`** (see SQL guardrails below). No ad-hoc query paths.
- No `openai` SDK — the LLM client is a thin `fetch` implementation of the `LLMClient`
  interface.

## Boundaries (Three-Tier Rules)

- **Always do:**
  - Run `npm run lint` and `npm test` before finalizing changes; keep the suite green.
  - Update the corresponding tests when modifying logic.
  - Keep the SQL guardrails identical: single read-only `SELECT`, `validateSelectOnly`
    keyword blocklist, 100-row cap, ~50 KB result-text cap, binary-search shrink.
  - Keep the PII allowlists: only data-dictionary `include=true` columns are exposed
    (ean/bsn/husn/hsn/coordinates/contact stay out); keep `DEMO_COLUMNS` and
    `RURAL_BARANGAYS` intact.
- **Ask first:**
  - Before installing new external dependencies, or modifying `package.json` / `tsconfig.json` / `web/vite.config.ts`.
  - Before altering the warehouse view shapes (`barangay`, `household`, `person`, `v_barangay_summary`) or the bundled data assets (`data/warehouse/*.parquet`, the data dictionary JSON).
- **Never do:**
  - Never commit directly to `main`.
  - Never hardcode secrets or API keys (BYOK keys live in `localStorage` only).
  - Never drop a failing test to bypass a check.
  - Never bypass `runSelect` or weaken the SQL guardrails / PII allowlists.
  - Never ship a runtime server or a `fetch('/api/...')` call — the app is pure static.
  - Never modify `web/vite.config.ts` to add a `/api` proxy, or add a runtime server.

## Never-modify list

- `web/vite.config.ts` — pure-static config; **no `/api` proxy**.
- `data/warehouse/*.parquet` and `data/2024-CBMS-Data-Dictionary.json` — pre-built source
  assets (produced upstream in `cbms-demo`; not regenerated here).
- The warehouse view shapes: `barangay`, `household`, `person`, `v_barangay_summary`.
- The SQL guardrails (`src/llm/sql_tool.ts`) and PII allowlists (`src/data.ts`).
- The read-only reference repo `/home/senen/experiments/cbms-demo`.

## Progressive Disclosure & Pointers

For deeper context, read the relevant docs on demand:

- **Full spec + decisions + implementation phases (A–G):** `specs/browser-only-spec.md`
- **Data assets:** `data/warehouse/{person,household,barangay}.parquet`, `data/2024-CBMS-Data-Dictionary.json`
- **Data copy build step:** `scripts/copy-data.mjs` (source `data/` → `web/public/data/`; runs as `prebuild:web`)
- **Read-only reference implementation:** `/home/senen/experiments/cbms-demo` (source of the
  driver-free core, the LLM tool loop, the schema block, and the React components)
