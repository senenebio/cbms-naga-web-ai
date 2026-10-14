/**
 * H3 — `openWarehouseBrowser` must terminate the worker when boot fails.
 *
 * The worker import (`./db.worker?worker`) is mocked with a fake that
 * simulates a duckdb boot failure (a top-level `error` message, `id === null`)
 * after `postMessage`. We assert `worker.terminate()` is called before the
 * rejection propagates, so a failed open does not leak a live worker.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openWarehouseBrowser } from './engine';

/** Shared registry of fake worker instances, hoisted for the mock factory. */
const workerState = vi.hoisted(() => ({
  instances: [] as {
    terminate: ReturnType<typeof vi.fn>;
    postMessage: ReturnType<typeof vi.fn>;
  }[],
}));

vi.mock('./db.worker?worker', () => {
  class FakeWorker {
    private messageListeners: ((e: { data: unknown }) => void)[] = [];
    terminate = vi.fn();
    postMessage = vi.fn(() => {
      // Simulate a duckdb boot failure: the worker posts a top-level error
      // (id === null) on the message channel, which rejects the ready promise.
      setTimeout(() => {
        for (const l of this.messageListeners) {
          l({ data: { type: 'error', id: null, message: 'boot failed' } });
        }
      }, 0);
    });
    addEventListener = vi.fn((type: string, cb: (e: { data: unknown }) => void) => {
      if (type === 'message') this.messageListeners.push(cb);
    });
    constructor() {
      workerState.instances.push(this);
    }
  }
  return { default: FakeWorker };
});

describe('openWarehouseBrowser (H3)', () => {
  beforeEach(() => {
    workerState.instances.length = 0;
    // Stub the parquet fetches so `openWarehouseBrowser` gets past the
    // `fetch` step and reaches the worker boot.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      })),
    );
  });

  it('terminates the worker when boot fails', async () => {
    await expect(openWarehouseBrowser()).rejects.toThrow('boot failed');
    expect(workerState.instances).toHaveLength(1);
    const worker = workerState.instances[0]!;
    expect(worker.terminate).toHaveBeenCalled();
  });
});
