# cbms-naga-web-ai

White-label, browser-only AI interpretation platform. CBMS 2024 (Naga City) is brand #1. DuckDB runs in the browser via `duckdb-wasm` (Web Worker) over 3 bundled parquet files, and a BYOK / local LLM runs read-only SQL via tool (function) calling. UI is a hyper-minimalist chat built on React 19 + Vite + Tailwind CSS v4 + shadcn/ui. No runtime server, no `/api` calls.

## Commands (pnpm workspace)

- Install: `pnpm install`
- Dev: `pnpm dev`
- Build: `pnpm build` (`prebuild` copies `data/` → `apps/chat-app/public/data/`)
- Preview: `pnpm start` (build + `vite preview`)
- Test: `pnpm test` · Typecheck: `pnpm typecheck` · Lint/Format: `pnpm lint` / `pnpm format`

## Layout (pnpm monorepo)

- `apps/chat-app/` — React app (ChatLayout, Composer, SettingsMenu, chat feed, BYOK dialog) + browser core (warehouse, LLM client, provider)
- `packages/core/` — `@workspace/core`: driver-free core (LLM client, SQL guardrails, schema, map logic, wasm engine); no `node:` / `@duckdb/node-api` imports; imported by both `apps/` and Node tests via `@repo/` alias
- `packages/ui/` — `@workspace/ui`: Tailwind v4 globals.css (shadcn tokens), shadcn/ui primitives, ChatLayout, Composer, SettingsMenu, useAutoResize
- `packages/brand-config/` — `@workspace/brand-config`: brand + dataset types, CBMS brand #1 + dataset, `applyBrand()`
- `data/<brand-id>/` — per-brand source assets (`warehouse/*.parquet`, data dictionary, geojson); `apps/chat-app/public/data/` is build-generated and gitignored. See [docs/DATA-ASSETS.md](docs/DATA-ASSETS.md) for the add-a-brand checklist
- `test/` — root-level Node tests (WASM E2E, SQL tool, schema, chart, provider)

## Invariants

- All LLM SQL goes through `runSelect` — no ad-hoc query paths. Details in [docs/GUARDRAILS.md](docs/GUARDRAILS.md).
- No runtime server, no `fetch('/api/...')`, no `/api` proxy in `apps/chat-app/vite.config.ts`.
- Never modify the bundled data assets or warehouse view shapes — see [docs/DATA-ASSETS.md](docs/DATA-ASSETS.md).
- Never modify the read-only reference repo `/home/senen/experiments/cbms-demo`.
- Do not commit directly to `main`.

## Ask first

- Installing new dependencies, or modifying `package.json` / `tsconfig.json` / `apps/chat-app/vite.config.ts`

## Further reading

- [docs/GUARDRAILS.md](docs/GUARDRAILS.md) — SQL / PII guardrails + LLM client constraints
- [docs/DATA-ASSETS.md](docs/DATA-ASSETS.md) — data asset rules and build flow
- Feature specs live in `specs/` — check the relevant spec's status before working in its area:
  - `browser-only-spec.md` (complete), `advanced-charts-spec.md` (complete),
    `map-feature-spec.md` (implemented; display under reconsideration),
    `openai-endpoint-spec.md` (implemented — single OpenAI-compatible endpoint),
    `monorepo-whitelabel-spec.md` (complete — Phase A–E),
    `data-aware-brand-deployment-spec.md` (in progress — brand carries its dataset,
    per-brand Vercel deployments)
