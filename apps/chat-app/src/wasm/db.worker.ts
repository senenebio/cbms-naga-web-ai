/**
 * Phase E — the Web Worker that owns the async duckdb-wasm engine.
 *
 * Boot sequence (browser build of `@duckdb/duckdb-wasm` 1.33.1-dev65):
 *  1. spawn the package's duckdb dispatcher worker (`duckdb-browser-eh.worker.js`),
 *  2. wrap it in an `AsyncDuckDB` handle and instantiate `duckdb-eh.wasm`,
 *  3. `openWarehouseWasm()` registers the 3 fetched parquet ArrayBuffers
 *     (transferred in via the `init` message) and creates the 4 warehouse views.
 *
 * After that it only answers `query`/`close` round-trips (see
 * `protocol.ts`) — the main thread never sees the duckdb connection.
 */
import { AsyncDuckDB, ConsoleLogger } from '@duckdb/duckdb-wasm';
import duckdbDispatcherWorkerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import duckdbWasmUrl from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import {
  openWarehouseWasm,
  type TableName,
  type WarehouseHandle,
} from '@repo/wasm/open_warehouse.js';
import type { WorkerInboundMessage } from './protocol.js';

let warehouse: WarehouseHandle | null = null;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function bootWarehouse(parquets: Record<TableName, ArrayBuffer>): Promise<WarehouseHandle> {
  const dispatcher = new Worker(duckdbDispatcherWorkerUrl);
  const db = new AsyncDuckDB(new ConsoleLogger(), dispatcher);
  try {
    await db.instantiate(duckdbWasmUrl);
    await db.open({});
    return await openWarehouseWasm(db, parquets);
  } catch (e) {
    dispatcher.terminate();
    throw e;
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data;

  if (msg.type === 'init') {
    (async () => {
      try {
        const parquets = {} as Record<TableName, ArrayBuffer>;
        for (const p of msg.parquets) {
          parquets[p.name as TableName] = p.buffer;
        }
        warehouse = await bootWarehouse(parquets);
        self.postMessage({ type: 'ready' });
      } catch (e) {
        warehouse = null;
        self.postMessage({ type: 'error', id: null, message: errorMessage(e) });
      }
    })();
    return;
  }

  if (msg.type === 'query') {
    const id = msg.id;
    (async () => {
      if (!warehouse) {
        self.postMessage({ type: 'error', id, message: 'warehouse is not initialized' });
        return;
      }
      try {
        const result = await warehouse.engine.query(msg.sql);
        self.postMessage({ type: 'result', id, columns: result.columns, rows: result.rows });
      } catch (e) {
        self.postMessage({ type: 'error', id, message: errorMessage(e) });
      }
    })();
    return;
  }

  if (msg.type === 'close') {
    (async () => {
      if (warehouse) {
        await warehouse.close();
        warehouse = null;
      }
    })();
  }
});
