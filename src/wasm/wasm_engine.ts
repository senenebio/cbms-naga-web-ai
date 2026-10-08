/**
 * Phase C — the single real `SqlEngine`: `WasmSqlEngine` (duckdb-wasm).
 *
 * Wraps a duckdb-wasm connection and converts Arrow result tables into the
 * driver-free `{ columns, rows }` shape. Browser-compatible: no `node:`
 * imports. The connection may come from the async (Web Worker) build
 * (`AsyncDuckDBConnection`, `query` is async) or the blocking Node build
 * (`DuckDBConnection`, `query` is sync) — both satisfy `WasmConnection`.
 */
import type { SqlEngine } from '../llm/types.js';

/**
 * The subset of an `apache-arrow` `Table` that the engine needs. Typed
 * structurally so this module does not import `apache-arrow` directly.
 */
export interface ArrowQueryResult {
  readonly schema: { readonly names: readonly (string | number)[] };
  toArray(): Array<Record<string, unknown>>;
}

/**
 * A duckdb-wasm connection: the async (worker) variant returns promises,
 * the blocking (Node) variant returns values directly.
 */
export interface WasmConnection {
  query(text: string): Promise<ArrowQueryResult> | ArrowQueryResult;
  close(): Promise<void> | void;
}

/** A driver-free SELECT executor backed by a duckdb-wasm connection. */
export class WasmSqlEngine implements SqlEngine {
  private readonly conn: WasmConnection;

  constructor(conn: WasmConnection) {
    this.conn = conn;
  }

  async query(sql: string): Promise<{ columns: string[]; rows: unknown[][] }> {
    const table = await Promise.resolve(this.conn.query(sql));
    const columns: string[] = table.schema.names.map((name) => String(name));
    const rows: unknown[][] = table.toArray().map((row) => columns.map((c) => row[c]));
    return { columns, rows };
  }
}
