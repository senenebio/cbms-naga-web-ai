/**
 * P1 T1.4 — map asset integrity (WASM).
 *
 * Loads the committed `data/naga-barangays.geojson` and the real warehouse
 * via `openWarehouseWasm()`, then asserts:
 *   - the asset has exactly 27 features,
 *   - every asset `code` exists in the warehouse `barangay` view (⊆),
 *   - no duplicate codes,
 *   - every `barangay` name is non-empty,
 *   - and (bonus) the names match the warehouse exactly (same casing).
 *
 * The asset is parsed through the real `parseBarangayGeojson` so the test
 * also proves the P2 core can consume the committed file.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as duckdb from '@duckdb/duckdb-wasm/blocking';
import { openWarehouseWasm, type WarehouseHandle } from '../src/wasm/open_warehouse.js';
import { parseBarangayGeojson } from '../src/map/geo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DUCKDB_DIST = path.join(here, '..', 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');

function toArrayBuffer(file: string): ArrayBuffer {
  const buf = readFileSync(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

let wh: WarehouseHandle | null = null;
let features: ReturnType<typeof parseBarangayGeojson> = [];
let warehouse: { code: string; name: string }[] = [];

beforeAll(async () => {
  const db = await duckdb.createDuckDB(
    {
      mvp: { mainModule: path.join(DUCKDB_DIST, 'duckdb-mvp.wasm'), mainWorker: '' },
      eh: { mainModule: path.join(DUCKDB_DIST, 'duckdb-eh.wasm'), mainWorker: '' },
    },
    new duckdb.ConsoleLogger(),
    duckdb.NODE_RUNTIME,
  );
  await db.instantiate();
  wh = await openWarehouseWasm(db, {
    person: toArrayBuffer(path.join(here, '..', 'data', 'warehouse', 'person.parquet')),
    household: toArrayBuffer(path.join(here, '..', 'data', 'warehouse', 'household.parquet')),
    barangay: toArrayBuffer(path.join(here, '..', 'data', 'warehouse', 'barangay.parquet')),
  });
  features = parseBarangayGeojson(
    readFileSync(path.join(here, '..', 'data', 'naga-barangays.geojson'), 'utf8'),
  );
  const r = await wh.engine.query('SELECT code, barangay FROM barangay ORDER BY code');
  warehouse = r.rows.map((row) => ({ code: String(row[0]), name: String(row[1]) }));
}, 60_000);

describe('map asset integrity (data/naga-barangays.geojson vs warehouse)', () => {
  it('has exactly 27 features', () => {
    expect(features).toHaveLength(27);
  });

  it('has no duplicate codes', () => {
    const codes = features.map((f) => f.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('codes ⊆ warehouse barangay codes', () => {
    const whCodes = new Set(warehouse.map((b) => b.code));
    const missing = features
      .map((f) => f.code)
      .filter((code) => !whCodes.has(code));
    expect(missing).toEqual([]);
  });

  it('every name is non-empty', () => {
    for (const f of features) {
      expect(f.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('names match the warehouse exactly (same casing)', () => {
    const byCode = new Map(warehouse.map((b) => [b.code, b.name]));
    for (const f of features) {
      expect(f.name).toBe(byCode.get(f.code));
    }
  });

  it('every feature has at least one ring with ≥ 3 points', () => {
    for (const f of features) {
      expect(f.rings.length).toBeGreaterThan(0);
      for (const ring of f.rings) {
        expect(ring.length).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
