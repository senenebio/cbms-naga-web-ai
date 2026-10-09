# cbms-naga-web-ai

Pure-static, browser-only AI interpretation demo for CBMS 2024 (Naga City) data: DuckDB runs in the browser via `duckdb-wasm` (Web Worker) over 3 bundled parquet files, and a BYOK / local LLM runs read-only SQL via tool (function) calling. UI is chat + settings only. No runtime server, no `/api` calls.

## Commands

- Install: `npm install`
- Dev: `npm run dev:web`
- Build: `npm run build:web` (`prebuild:web` copies `data/` → `web/public/data/`)
- Preview: `npm start` (build + `vite preview web`)
- Test: `npm test` · Lint/Format: `npm run lint` / `npm run format`

## Layout (capabilities, not a path map)

- `src/` — driver-free core: no `node:` / `@duckdb/node-api` imports; imported by both `web/` and Node tests
- `web/` — React app (chat + settings) + browser core; the Web Worker owns DuckDB
- `data/` — source assets (parquets + data dictionary); `web/public/data/` is build-generated and gitignored

## Invariants

- All LLM SQL goes through `runSelect` — no ad-hoc query paths. Details in [docs/GUARDRAILS.md](docs/GUARDRAILS.md).
- No runtime server, no `fetch('/api/...')`, no `/api` proxy in `web/vite.config.ts`.
- Never modify the bundled data assets or warehouse view shapes — see [docs/DATA-ASSETS.md](docs/DATA-ASSETS.md).
- Never modify the read-only reference repo `/home/senen/experiments/cbms-demo`.
- Do not commit directly to `main`.

## Ask first

- Installing new dependencies, or modifying `package.json` / `tsconfig.json` / `web/vite.config.ts`

## Further reading

- [docs/GUARDRAILS.md](docs/GUARDRAILS.md) — SQL / PII guardrails + LLM client constraints
- [docs/DATA-ASSETS.md](docs/DATA-ASSETS.md) — data asset rules and build flow
- Feature specs live in `specs/` — check the relevant spec's status before working in its area:
  - `browser-only-spec.md` (complete), `advanced-charts-spec.md` (complete),
    `map-feature-spec.md` (implemented; display under reconsideration),
    `openai-endpoint-spec.md` (implemented — single OpenAI-compatible endpoint)
