/**
 * Phase E — browser `SqlEngine` facade.
 *
 * Boots `db.worker.ts` (which owns the duckdb-wasm engine), fetches the 3
 * bundled parquets from `/data/...` as ArrayBuffers, and hands them to the
 * worker. The duckdb connection lives inside the worker, so the
 * `SqlEngine` implemented here runs over the worker message protocol
 * (`protocol.ts`) — one in-flight query per `id`, serialized results.
 */
import DbWorker from './db.worker?worker';
import type { SqlEngine } from '@repo/llm/types.js';
import { TABLES, type TableName } from '@repo/wasm/open_warehouse.js';
import type { WorkerInboundMessage, WorkerOutboundMessage } from './protocol.js';

export interface BrowserWarehouseHandle {
  engine: SqlEngine;
  close(): Promise<void>;
}

const DATA_BASE = `/data/${(import.meta.env.VITE_BRAND_ID ?? 'cbms')}`;
// Per-deploy version stamp: keeps each build's asset URLs cache-fresh so a
// stale edge-cached 404 from an earlier deployment can't break this one.
const DATA_VERSION = `?v=${__DATA_VERSION__}`;

/**
 * A `SqlEngine` backed by the duckdb-wasm Web Worker: queries are posted
 * to the worker and resolved by the matching `result`/`error` message.
 */
export class WorkerSqlEngine implements SqlEngine {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: { columns: string[]; rows: unknown[][] }) => void;
      reject: (reason: Error) => void;
    }
  >();

  constructor(worker: Worker) {
    this.worker = worker;
    worker.addEventListener('message', (event: MessageEvent<WorkerOutboundMessage>) => {
      const msg = event.data;
      if (msg.type === 'result') {
        const pending = this.pending.get(msg.id);
        if (pending) {
          this.pending.delete(msg.id);
          pending.resolve({ columns: msg.columns, rows: msg.rows });
        }
      } else if (msg.type === 'error') {
        const id = msg.id;
        if (id !== null) {
          const pending = this.pending.get(id);
          if (pending) {
            this.pending.delete(id);
            pending.reject(new Error(msg.message));
          }
        }
      }
    });
    worker.addEventListener('error', (event: ErrorEvent) => {
      for (const [id, pending] of this.pending) {
        this.pending.delete(id);
        pending.reject(new Error(`duckdb worker crashed: ${event.message}`));
      }
    });
  }

  query(sql: string): Promise<{ columns: string[]; rows: unknown[][] }> {
    const id = this.nextId++;
    const promise = new Promise<{ columns: string[]; rows: unknown[][] }>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    const msg: WorkerInboundMessage = { type: 'query', id, sql };
    this.worker.postMessage(msg);
    return promise;
  }

  close(): Promise<void> {
    const msg: WorkerInboundMessage = { type: 'close' };
    this.worker.postMessage(msg);
    this.worker.terminate();
    return Promise.resolve();
  }
}

/**
 * Fetch the 3 parquets, boot the duckdb worker, and return the browser
 * `SqlEngine` over the warehouse. Rejects if any fetch or the worker init
 * fails.
 */
export async function openWarehouseBrowser(): Promise<BrowserWarehouseHandle> {
  const parquets: Record<TableName, ArrayBuffer> = {} as Record<TableName, ArrayBuffer>;
  await Promise.all(
    TABLES.map(async (table) => {
      const res = await fetch(`${DATA_BASE}/${table}.parquet${DATA_VERSION}`);
      if (!res.ok)
        throw new Error(`failed to fetch ${DATA_BASE}/${table}.parquet (HTTP ${res.status})`);
      parquets[table] = await res.arrayBuffer();
    }),
  );

  const worker = new DbWorker();
  const engine = new WorkerSqlEngine(worker);
  const ready = new Promise<void>((resolve, reject) => {
    worker.addEventListener('message', (event: MessageEvent<WorkerOutboundMessage>) => {
      const msg = event.data;
      if (msg.type === 'ready') {
        resolve();
      } else if (msg.type === 'error' && msg.id === null) {
        reject(new Error(msg.message));
      }
    });
    worker.addEventListener('error', (event: ErrorEvent) => {
      reject(new Error(`duckdb worker failed to start: ${event.message}`));
    });
  });

  const transfers: Transferable[] = [];
  for (const table of TABLES) {
    transfers.push(parquets[table]);
  }
  const init: WorkerInboundMessage = {
    type: 'init',
    parquets: TABLES.map((table) => ({ name: table, buffer: parquets[table] })),
  };
  worker.postMessage(init, transfers);
  await ready;

  return {
    engine,
    close: () => engine.close(),
  };
}
