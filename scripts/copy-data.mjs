#!/usr/bin/env node
/**
 * Build step: copy the source data assets into `apps/chat-app/public/data/`
 * so the static bundle ships them at `/data/...` (fetched at runtime by the
 * duckdb-wasm worker).
 *
 * Source:  data/warehouse/{person,household,barangay}.parquet
 *          data/2024-CBMS-Data-Dictionary.json
 *          data/naga-barangays.geojson   (optional; skipped if absent)
 * Dest:    apps/chat-app/public/data/{person,household,barangay}.parquet
 *          apps/chat-app/public/data/2024-CBMS-Data-Dictionary.json
 *          apps/chat-app/public/data/naga-barangays.geojson
 *
 * `apps/chat-app/public/data/` is gitignored (build-generated). Run via
 * `pnpm run prebuild` (automatic before `pnpm build`) or directly:
 *   node scripts/copy-data.mjs
 */
import { access, cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'data', 'warehouse');
const dictSource = join(root, 'data', '2024-CBMS-Data-Dictionary.json');
const destDir = join(root, 'apps', 'chat-app', 'public', 'data');

const files = ['person.parquet', 'household.parquet', 'barangay.parquet'];

async function main() {
  // Clean and recreate the destination so stale files don't linger.
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });

  for (const file of files) {
    await cp(join(sourceDir, file), join(destDir, file));
  }

  await cp(dictSource, join(destDir, '2024-CBMS-Data-Dictionary.json'));

  console.log(`[copy-data] Copied ${files.length} parquet files + dictionary → apps/chat-app/public/data/`);

  // Barangay boundaries for the SVG choropleth (map feature, T1.3). The asset
  // is committed in T1.2; until then this is a no-op so the build stays green.
  const geojsonSource = join(root, 'data', 'naga-barangays.geojson');
  try {
    await access(geojsonSource);
    await cp(geojsonSource, join(destDir, 'naga-barangays.geojson'));
    console.log('[copy-data] Copied naga-barangays.geojson → apps/chat-app/public/data/');
  } catch {
    console.log('skip: data/naga-barangays.geojson not present (expected until T1.2)');
  }
}

main().catch((err) => {
  console.error('[copy-data] failed:', err);
  process.exit(1);
});
