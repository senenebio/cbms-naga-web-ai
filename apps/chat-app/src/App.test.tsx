/**
 * Phase F — App shell tests (jsdom / @testing-library/react).
 *
 * Ported from react-test-renderer to @testing-library/react (React 19).
 * The app receives injected `openWarehouse` + `resolveProvider` stubs —
 * no network, no duckdb-wasm, no real localStorage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App, { type AppDeps } from './App';
import { BRAND } from './brand';
import { stubEngine } from './testStubs';
import type { BrowserWarehouseHandle } from './wasm/engine';
import type { ProviderResolution, KeyValueStorage } from './core/provider';

function stubWarehouse() {
  return async (): Promise<BrowserWarehouseHandle> => ({ engine: stubEngine(), close: vi.fn() });
}

function unconfigured() {
  return (): ProviderResolution => ({ status: 'unconfigured' });
}

function stubStorage(): KeyValueStorage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
}

async function renderApp(deps: Partial<AppDeps> = {}) {
  const fullDeps: AppDeps = {
    openWarehouse: stubWarehouse(),
    resolveProvider: unconfigured(),
    storage: stubStorage(),
    ...deps,
  };
  const view = render(<App deps={fullDeps} />);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setImmediate(r));
  return view;
}

describe('App (static, chat + settings only)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the header, chat panel, and a loading note before the warehouse opens', async () => {
    const openWarehouse = vi.fn(async () => new Promise<BrowserWarehouseHandle>(() => {}));
    await renderApp({ openWarehouse });
    expect(screen.getByText(BRAND.name)).toBeInTheDocument();
    expect(screen.getByText(/Loading the warehouse/)).toBeInTheDocument();
  });

  it('shows the unconfigured model label and the settings gear', async () => {
    await renderApp();
    await vi.waitFor(() => expect(screen.getByText(/No model set/)).toBeInTheDocument());

    const gear = screen.getByRole('button', { name: 'Open settings' });
    expect(gear).toBeInTheDocument();
  });

  it('surfaces the warehouse error when openWarehouse rejects', async () => {
    const openWarehouse = vi.fn(async () => Promise.reject(new Error('parquet fetch failed')));
    await renderApp({ openWarehouse });
    expect(screen.getByText(/parquet fetch failed/)).toBeInTheDocument();
  });
});
