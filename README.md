# CBMS Naga City — White-Label AI Chat

A **pure-static, browser-only** white-label chat platform. Brand #1: **2024 CBMS
(Community-Based Monitoring System) — Naga City**. DuckDB runs entirely in the
browser via [`duckdb-wasm`](https://duckdb.org) (in a Web Worker) over three
bundled parquet files, and a BYOK / local LLM is called **directly from the
browser** with tool (function) calling to run **read-only SQL**. There is **no
runtime server** — the app is a static bundle you can host anywhere.

Built on **React 19 + Vite + Tailwind CSS v4 + shadcn/ui** in a **pnpm
workspace monorepo**.

## What it does

- A single **chat panel** with a minimal composer — no workspace pane.
- The LLM is given the warehouse schema and a `run_select` tool. It writes
  `SELECT` queries, the app runs them against in-browser DuckDB, returns the
  (capped) rows, and the LLM narrates the answer in Markdown with charts,
  tables, and maps.
- **Case-insensitive + fuzzy name matching**: the LLM uses `UPPER()` / `LIKE`
  for name columns, and a 0-row retry catches typos automatically.
- **Interactive charts** (bar, line, area, pie, scatter) rendered inline.
- **Barangay choropleth map** — when results include a `code`/`barangay`
  column plus a numeric metric, a Leaflet map renders automatically.
- **BYOK settings** — OpenAI-compatible endpoints (local Ollama, OpenRouter,
  OpenAI, etc.) stored in `localStorage` only.

## Data source

- **2024 CBMS — Naga City**, pre-built into three warehouse parquets under
  `data/warehouse/`: `person`, `household`, `barangay`.
- A **data dictionary** (`data/2024-CBMS-Data-Dictionary.json`) drives the PII
  allowlist. Warehouse views: `barangay`, `household`, `person`,
  `v_barangay_summary`.

## Run it

```bash
pnpm install
```

### Development

```bash
pnpm dev
```

### Production (static)

```bash
pnpm build      # copies data → apps/chat-app/public/data/ then builds
pnpm start      # build + serve with vite preview
```

To deploy, publish the build output (`apps/chat-app/dist/`) to any static host.

### Tests / checks

```bash
pnpm test        # vitest: 205 tests (pure logic, WASM E2E, React components)
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm format      # prettier
```

## Using it

1. `pnpm dev` and open the URL it prints.
2. Click the **⚙️ gear** → **Connection…** to configure a BYOK provider:
   - **local** — Ollama / LM Studio / llama.cpp (any OpenAI-compatible endpoint)
   - **openrouter** — `https://openrouter.ai/api/v1`
   - **openai** — `https://api.openai.com/v1`
3. Chat with the warehouse. The model issues read-only SQL and explains results.

## Architecture

- **DuckDB-WASM worker** — `apps/chat-app/src/wasm/db.worker.ts` owns the
  `DuckDBWASM` engine in a Web Worker.
- **Driver-free core** — `src/` (SQL guardrails, schema, LLM client, PII
  allowlists) has no `node:` imports; imported by both the app and Node tests.
- **BYOK LLM** — thin `fetch` LLMClient (no SDK). Keys in `localStorage` only.
- **UI** — Tailwind v4 + shadcn/ui primitives in `packages/ui/`, chat layout
  in `ChatLayout` + `Composer` + `SettingsMenu`.
- **Brand system** — `packages/brand-config/` defines brand identity (name,
  welcome text, colors, license). Build-time selection; CSS variables for
  instant theme flips.

### Guardrails (do not weaken)

- **Read-only SQL**: single `SELECT` only, enforced by `validateSelectOnly`.
- **Result caps**: 100-row cap, ~50 KB result-text cap.
- **PII allowlist**: only data-dictionary `include=true` columns exposed.

## Project layout

```
apps/chat-app/            # React app (ChatLayout, Composer, SettingsMenu, feed)
packages/ui/              # @workspace/ui: Tailwind globals, shadcn primitives
packages/brand-config/    # @workspace/brand-config: brand types + CBMS brand #1
src/                      # driver-free core (LLM, SQL, schema, map, wasm)
data/                     # source assets (parquets, dictionary, GeoJSON)
specs/                    # feature specs
docs/                     # guardrails + data asset docs
```

## Deployment

- **Vercel**: Framework "Other", Root Directory `apps/chat-app`, Build `pnpm build`
- **GitHub Pages**: set Vite `base` to the repo path; `DATA_BASE` uses
  `import.meta.env.BASE_URL`

## Notes

- Data assets under `apps/chat-app/public/data/` are **build-generated** and gitignored.
- BYOK keys live in `localStorage` only — no server, no telemetry.
- License: MIT
