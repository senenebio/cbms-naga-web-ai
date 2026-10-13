#!/usr/bin/node
/**
 * Build step: copy per-brand data assets into `apps/chat-app/public/data/`
 * so the static bundle ships them at `/data/<brand-id>/...` (fetched at
 * runtime by the duckdb-wasm worker).
 *
 * Source layout (per-brand, data-aware spec D5):
 *   data/<brand-id>/warehouse/{person,household,barangay}.parquet
 *   data/<brand-id>/<Dictionary>.json
 *   data/<brand-id>/<geojson>
 *
 * Dest: `apps/chat-app/public/data/<brand-id>/...` (structure preserved).
 *
 * The script is brand-agnostic: it copies every `data/<dir>/` that contains
 * a `warehouse/` subdirectory. Set `BRAND_ID` to copy only one brand
 * (per-brand deployments); unset = copy all. Unknown `BRAND_ID` → exit 1.
 *
 * `apps/chat-app/public/data/` is gitignored (build-generated). Runs via
 * `pnpm run prebuild` (automatic before `pnpm build`) and via the
 * `copy-brand-data` Vite plugin in `apps/chat-app/vite.config.ts` (so the
 * data is bundled even when a build tool runs `vite build` directly).
 * Can also be run directly:
 *   node scripts/copy-data.mjs
 */
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Copy per-brand data assets into `apps/chat-app/public/data/`.
 *
 * @param brandFilter Optional brand id to copy (e.g. `'cbms'`). When
 *   omitted, falls back to the `BRAND_ID` env var; when still unset,
 *   copies every brand. Unknown brand id → throws.
 */
export function copyBrandData(brandFilter = process.env.BRAND_ID) {
  const dataDir = join(root, 'data');
  const out = join(root, 'apps/chat-app/public/data');

  const dirs = readdirSync(dataDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  if (brandFilter && !dirs.includes(brandFilter)) {
    throw new Error(
      `[copy-data] Unknown BRAND_ID "${brandFilter}". Available: ${dirs.join(', ') || '(none)'}`,
    );
  }

  // Clean and recreate the destination so stale files never linger.
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  for (const name of dirs) {
    if (brandFilter && name !== brandFilter) continue;
    const src = join(dataDir, name);
    if (!readdirSync(src).includes('warehouse')) continue; // not a brand dir
    cpSync(src, join(out, name), { recursive: true });
    console.log(`[copy-data] Copied brand "${name}" → apps/chat-app/public/data/${name}/`);
  }
}

// CLI entry (e.g. `node scripts/copy-data.mjs`); no-op when imported.
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  copyBrandData();
}
