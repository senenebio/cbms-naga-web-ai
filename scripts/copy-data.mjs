#!/usr/bin/env node
/**
 * Build step: copy the source data assets into `web/public/data/` so the
 * static bundle ships them at `/data/...` (fetched at runtime by the
 * duckdb-wasm worker).
 *
 * Source:  data/warehouse/{person,household,barangay}.parquet
 *          data/2024-CBMS-Data-Dictionary.json
 * Dest:    web/public/data/{person,household,barangay}.parquet
 *          web/public/data/2024-CBMS-Data-Dictionary.json
 *
 * `web/public/data/` is gitignored (build-generated). Run via
 * `npm run prebuild:web` (automatic before `build:web`) or directly:
 *   node scripts/copy-data.mjs
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'data', 'warehouse');
const dictSource = join(root, 'data', '2024-CBMS-Data-Dictionary.json');
const destDir = join(root, 'web', 'public', 'data');

const files = ['person.parquet', 'household.parquet', 'barangay.parquet'];

async function main() {
  // Clean and recreate the destination so stale files don't linger.
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });

  for (const file of files) {
    await cp(join(sourceDir, file), join(destDir, file));
  }

  await cp(dictSource, join(destDir, '2024-CBMS-Data-Dictionary.json'));

  console.log(`[copy-data] Copied ${files.length} parquet files + dictionary → web/public/data/`);
}

main().catch((err) => {
  console.error('[copy-data] failed:', err);
  process.exit(1);
});
