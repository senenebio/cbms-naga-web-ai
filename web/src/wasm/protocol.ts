/**
 * Phase E — message protocol between `engine.ts` (main thread) and
 * `db.worker.ts` (the Web Worker that owns the duckdb-wasm engine).
 *
 * The duckdb-wasm connection lives inside the worker, so the main thread
 * can only talk to it through these messages: one `init` round-trip (the
 * parquet bytes are transferred, not copied), then unbounded
 * `query`/`result`|`error` round-trips keyed by `id`.
 */

/** A parquet payload handed to the worker during init. */
export interface ParquetPayload {
  name: string;
  buffer: ArrayBuffer;
}

/** Main thread → worker. */
export type WorkerInboundMessage =
  | { type: 'init'; parquets: ParquetPayload[] }
  | { type: 'query'; id: number; sql: string }
  | { type: 'close' };

/** Worker → main thread. */
export type WorkerOutboundMessage =
  | { type: 'ready' }
  | { type: 'result'; id: number; columns: string[]; rows: unknown[][] }
  | { type: 'error'; id: number | null; message: string };
