/**
 * Phase C — warehouse bootstrap over duckdb-wasm.
 *
 * `openWarehouseWasm()` loads the 3 pre-built parquet files into the
 * in-memory file registry of an instantiated duckdb-wasm engine and
 * creates the four read-only warehouse views with the exact same column
 * sets as the reference implementation:
 *
 *  - `barangay`            (code, barangay + demo columns when present)
 *  - `household`           (dictionary include=true columns + demo columns)
 *  - `person`              (dictionary include=true columns)
 *  - `v_barangay_summary`  (population, household count, urban/rural)
 *
 * The same code runs in the browser (parquet bytes fetched as
 * ArrayBuffers) and in Node (bytes read from disk in the test harness).
 * Browser-compatible: no `node:` imports.
 *
 * The data dictionary, demo columns, and rural classification come from
 * the brand's `Dataset` descriptor (data-aware spec D3/D7) — no local
 * copies.
 */
import type { Dataset } from '@workspace/brand-config';
import { WasmSqlEngine, type WasmConnection } from './wasm_engine.js';

export type TableName = 'person' | 'household' | 'barangay';

export const TABLES: readonly TableName[] = ['person', 'household', 'barangay'];

/**
 * An instantiated duckdb-wasm engine (the "shared instance"): the async
 * Web-Worker build (`AsyncDuckDB`) in the browser, the blocking build
 * (`DuckDBNodeBindings`) under Node. Only the two methods used here.
 */
export interface WasmDuckDB {
  connect(): Promise<WasmConnection> | WasmConnection;
  registerFileBuffer(name: string, buffer: Uint8Array): Promise<void> | void;
}

export interface WarehouseHandle {
  engine: WasmSqlEngine;
  close(): Promise<void>;
}

/** Columns of a view, in view order (same resolution as the reference). */
function viewColumns(table: TableName, rawColumns: string[], dataset: Dataset): string[] {
  if (table === 'barangay') {
    const demo = (dataset.demoColumns['barangay'] ?? []).filter((c) => rawColumns.includes(c));
    return ['code', 'barangay', ...demo];
  }
  const dictInclude = new Map(dataset.dictionary.map((e) => [e.variable_name, e.include]));
  const dictCols = rawColumns.filter((c) => dictInclude.get(c) === true);
  const demoCols = (dataset.demoColumns[table] ?? []).filter((c) => rawColumns.includes(c));
  return [...dictCols, ...demoCols];
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Loads the parquet ArrayBuffers into `db`, creates the 4 views and
 * returns the `WasmSqlEngine` over a fresh connection.
 */
export async function openWarehouseWasm(
  db: WasmDuckDB,
  parquets: Record<TableName, ArrayBuffer>,
  dataset: Dataset,
): Promise<WarehouseHandle> {
  for (const table of TABLES) {
    const bytes = parquets[table];
    if (!bytes) throw new Error(`Missing parquet bytes for ${table}`);
    await db.registerFileBuffer(`${table}.parquet`, new Uint8Array(bytes));
  }

  const conn = (await Promise.resolve(db.connect())) as WasmConnection;
  try {
    for (const table of TABLES) {
      const raw = `raw_${table}`;
      await Promise.resolve(
        conn.query(
          `CREATE TABLE ${quoteIdent(raw)} AS SELECT * FROM read_parquet('${table}.parquet')`,
        ),
      );
      const sample = await Promise.resolve(conn.query(`SELECT * FROM ${quoteIdent(raw)} LIMIT 0`));
      const cols = viewColumns(
        table,
        sample.schema.names.map((name) => String(name)),
        dataset,
      );
      if (cols.length === 0) throw new Error(`No include=true columns resolved for ${table}`);
      const list = cols.map(quoteIdent).join(', ');
      await Promise.resolve(
        conn.query(
          `CREATE OR REPLACE VIEW ${quoteIdent(table)} AS SELECT ${list} FROM ${quoteIdent(raw)}`,
        ),
      );
    }

    const rural = dataset.ruralBarangays.map((b) => `'${b.replace(/'/g, "''")}'`).join(', ');
    await Promise.resolve(
      conn.query(
        `
      CREATE OR REPLACE VIEW "v_barangay_summary" AS
      SELECT
        b.code AS code,
        b.barangay AS barangay,
        CASE WHEN b.barangay IN (${rural}) THEN 'rural' ELSE 'urban' END AS urban_rural,
        (SELECT COUNT(*) FROM "person" p WHERE p.barangay_code = b.code) AS population,
        (SELECT COUNT(*) FROM "household" h WHERE h.barangay_code = b.code) AS household_count
      FROM "barangay" b
    `,
      ),
    );
  } catch (e) {
    await Promise.resolve(conn.close());
    throw e;
  }

  return {
    engine: new WasmSqlEngine(conn),
    close: () => Promise.resolve(conn.close()),
  };
}
