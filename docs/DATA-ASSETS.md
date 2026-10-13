# Data assets

## Per-brand layout

Each brand's dataset lives under its own directory — `data/<brand-id>/`:

```
data/cbms/
├── warehouse/
│   ├── person.parquet
│   ├── household.parquet
│   └── barangay.parquet
├── 2024-CBMS-Data-Dictionary.json
└── naga-barangays.geojson
```

The app fetches them at runtime from `/data/<brand-id>/...` (the duckdb-wasm
worker loads the parquets; the map fetches the geojson).

## Never modify

- `data/<brand-id>/warehouse/*.parquet` — pre-built upstream in `cbms-demo`;
  not regenerated here
- `data/<brand-id>/*-Data-Dictionary.json`
- Warehouse view names/shapes: `barangay`, `household`, `person`,
  `v_barangay_summary` (canonical across all brands)

## Build flow

`apps/chat-app/public/data/` is build-generated — copied from `data/` by
`prebuild` (`scripts/copy-data.mjs`) — and is gitignored. Edit `data/`, never
the generated copy.

- The copy script is brand-agnostic: it copies every `data/<dir>/` that
  contains a `warehouse/` subdirectory (dest is cleaned + recreated).
- `BRAND_ID=<id>` copies only that brand (per-brand deployments); an unknown
  id exits 1 with the available list.

## Adding a brand (checklist)

1. `data/<id>/` — warehouse parquets + data dictionary + geojson.
2. `packages/brand-config/src/datasets/<id>.ts` — the `Dataset` descriptor
   (the dictionary JSON is statically imported here — single dictionary
   owner).
3. `packages/brand-config/src/brands/<id>.ts` — the `Brand` entry
   (`dataset` references the descriptor); add it to the `BRANDS` map.
4. `vercel.json` — a project entry with `"env": { "VITE_BRAND_ID": "<id>" }`.
5. Build with `VITE_BRAND_ID=<id> pnpm build` (Vite inlines the brand at
   build time — one brand per deployment, no runtime picker).

## Deployment (Vercel)

One Vercel project per brand, all from this repo (see `vercel.json`):

| Setting | Value |
|---|---|
| Root Directory | *(repo root)* |
| Build Command | `pnpm build` |
| Output Directory | `apps/chat-app/dist` |

The brand is selected per project via the `VITE_BRAND_ID` env var. The app
is pure-static (no serverless, no runtime secrets — BYOK keys live in the
visitor's `localStorage`), so each deploy is a plain static site.
