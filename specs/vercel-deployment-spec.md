# Spec: Vercel Deployment (CBMS brand + per-brand deployments)

**Status:** draft
**Date:** 2026-10-13
**Related spec:** `data-aware-brand-spec.md` (draft)

## Goal

Deploy the CBMS brand to Vercel as a pure-static site, with a clear path to
add **separate deployments** for additional brands — one deployment per
brand, each deployable independently.

## Facts (why this is easy)

- The app is pure-static: 47 MB build output, zero serverless, zero env
  secrets at runtime (BYOK keys live in the visitor's `localStorage`).
- The duckdb-wasm engine + dispatcher worker are already emitted as hashed
  static assets by Vite (`?worker` / `?url` imports in
  `apps/chat-app/src/wasm/engine.ts`, `db.worker.ts`).
- Data assets are served from `/data/...` (parquets, dictionary, geojson).
- No client-side routing → no SPA rewrites needed.

## Part 1 — Deploy the CBMS brand

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
4. **Verify on the live URL:**
   - Warehouse boots (parquets + duckdb wasm load)
   - BYOK endpoint configured in Settings → demo question runs
     (SQL, chart, map all render)
   - Deploy size ~47 MB static

**Optional:** custom domain, `{ "cleanUrls": true }` in `vercel.json`.

## Part 2 — Separate deployment per additional brand

**Vercel Project Matrix**: one repo, multiple named projects, each with its
own build, subdomain, and env vars.

### Prerequisite (small code change)

`apps/chat-app/src/brand.ts` currently hardcodes `BRANDS.cbms`. Make it
env-driven:

```ts
const id = (import.meta.env.VITE_BRAND_ID ?? 'cbms') as BrandId;
export const BRAND = BRANDS[id] ?? BRANDS.cbms;
```

Each Vercel project sets `VITE_BRAND_ID` — Vite inlines it at build time, so
the brand is baked into that deployment (build-time pairing, per
`data-aware-brand-spec.md` D1).

### `vercel.json` (one project per deployed brand)

```json
{
  "projects": [
    {
      "name": "cbms-naga",
      "rootDirectory": ".",
      "buildCommand": "pnpm build",
      "outputDirectory": "apps/chat-app/dist",
      "env": { "VITE_BRAND_ID": "cbms" }
    }
  ]
}
```

Per brand you get: its own deployment + subdomain/custom domain, its own env
vars, its own preview deploys per PR.

### Deploy only one brand, leave the others alone

- **Vercel only deploys what is configured as a project.** A brand in the
  repo (`BRANDS` entry + `data/<id>/`) with no project entry is inert —
  nothing builds or ships it.
- **Add a brand to `vercel.json` only when you want it live.** From that
  push on, it deploys independently of the others.
- **Ships only its own data:** `scripts/copy-data.mjs` filters to the active
  brand:

  ```mjs
  const brandId = process.env.BRAND_ID ?? 'cbms';
  // copy only data/<brandId>/ → public/data/<brandId>/
  ```

  with `BRAND_ID` set alongside `VITE_BRAND_ID` (per-project env in
  `vercel.json`; local `.env` for dev). Each deployment contains exactly one
  brand's assets.
- **Note:** Project Matrix rebuilds *all* configured projects on every push
  to the default branch — there is no "skip this project" flag. Pausing a
  deployment = removing its project entry (or accepting rebuilds).

### Brand state model

| Brand | In repo | Has `data/<id>/` | In `vercel.json` | Deployed |
|---|---|---|---|---|
| cbms | ✅ | ✅ | ✅ | ✅ |
| future brand | ✅ | ✅ | ❌ | ❌ (inert) |
| future brand, later | ✅ | ✅ | ✅ (added) | ✅ |

## Caveats

- Each matrix project rebuilds the same app bundle (different `BRAND`) —
  expect ~2× build minutes as projects are added; Vercel cache mitigates.
- Brand selection is **build-time** — one deployment cannot serve two brands
  (by design, D1).
- Both projects in a matrix build from the same `main` — a brand that is not
  yet ready for production should not get a project entry.

## Invariants

- No runtime server, no `/api`, no new dependencies.
- Guardrails, PII allowlist, data-asset rules untouched.
