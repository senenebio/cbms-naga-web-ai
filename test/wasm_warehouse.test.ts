// @vitest-environment node
/**
 * Phase C gate — the WASM warehouse under Node/vitest.
 *
 * Instantiates duckdb-wasm (blocking Node build, main thread), loads the 3
 * real parquet files from `data/warehouse/` via `openWarehouseWasm()`, and
 * asserts the four views exist with the reference column sets and that
 * queries return correct `{ columns, rows }`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as duckdb from '@duckdb/duckdb-wasm/blocking';
import { openWarehouseWasm, TABLES, type WarehouseHandle } from '../src/wasm/open_warehouse.js';
import type { SqlEngine } from '../src/llm/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DUCKDB_DIST = path.join(here, '..', 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');

function toArrayBuffer(file: string): ArrayBuffer {
  const buf = readFileSync(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

let wh: WarehouseHandle | null = null;
let engine: SqlEngine | null = null;

async function count(sql: string): Promise<number> {
  const r = await engine!.query(sql);
  return Number(r.rows[0]?.[0]);
}

async function viewColumns(view: string): Promise<string[]> {
  const r = await engine!.query(`SELECT * FROM "${view}" LIMIT 0`);
  return r.columns;
}

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
  engine = wh.engine;
}, 60_000);

describe('WasmSqlEngine + openWarehouseWasm (duckdb-wasm under Node)', () => {
  it('engine returns { columns, rows } for a trivial query', async () => {
    const r = await engine!.query("SELECT 42 AS answer, 'naga' AS city");
    expect(r.columns).toEqual(['answer', 'city']);
    expect(r.rows).toEqual([[42, 'naga']]);
  });

  it('creates the 4 views plus the 3 raw tables', async () => {
    const r = await engine!.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'main' ORDER BY table_name`,
    );
    const names = r.rows.map((row) => String(row[0]));
    for (const name of [
      'barangay',
      'household',
      'person',
      'v_barangay_summary',
      ...TABLES.map((t) => `raw_${t}`),
    ]) {
      expect(names).toContain(name);
    }
  });

  it('loads the real parquet row counts', async () => {
    expect(await count('SELECT COUNT(*) FROM person')).toBe(181197);
    expect(await count('SELECT COUNT(*) FROM household')).toBe(44892);
    expect(await count('SELECT COUNT(*) FROM barangay')).toBe(27);
  });

  it('exposes the reference column sets (PII allowlist)', async () => {
    const person = await viewColumns('person');
    const household = await viewColumns('household');
    const barangay = await viewColumns('barangay');

    expect(person).toContain('uuid');
    expect(person).toContain('a05_age');
    for (const pii of ['ean', 'bsn', 'husn', 'hsn', 'case_id']) {
      expect(person).not.toContain(pii);
      expect(household).not.toContain(pii);
    }
    expect(household).toEqual(expect.arrayContaining(['address', 'lat', 'lon']));
    expect(barangay).toEqual(['code', 'barangay', 'lat', 'lon']);
  });

  it('v_barangay_summary aggregates match the raw views', async () => {
    const rows = await engine!.query('SELECT * FROM v_barangay_summary ORDER BY code');
    expect(rows.columns).toEqual([
      'code',
      'barangay',
      'urban_rural',
      'population',
      'household_count',
    ]);
    expect(rows.rows).toHaveLength(27);

    expect(await count('SELECT SUM(population) FROM v_barangay_summary')).toBe(181197);
    expect(await count('SELECT SUM(household_count) FROM v_barangay_summary')).toBe(44892);
    expect(await count(`SELECT COUNT(*) FROM v_barangay_summary WHERE urban_rural = 'rural'`)).toBe(
      6,
    );

    const first = rows.rows[0] as unknown[];
    expect(first?.[0]).toBe(1);
    expect(['urban', 'rural']).toContain(String(first?.[2]));
  });

  it('warehouse handle closes without error', async () => {
    await wh!.close();
  });
});
