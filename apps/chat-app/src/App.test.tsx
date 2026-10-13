/**
 * Phase F — App shell tests (jsdom / @testing-library/react).
 *
 * Ported from react-test-renderer to @testing-library/react (React 19).
 * The app receives injected `openWarehouse` + `resolveProvider` stubs —
 * no network, no duckdb-wasm, no real localStorage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App, { type AppDeps } from './App';
import { BRAND } from './brand';
import { stubEngine } from './testStubs';
import type { BrowserWarehouseHandle } from './wasm/engine';
import type { ProviderResolution } from './core/provider';

function stubWarehouse() {
  return async (): Promise<BrowserWarehouseHandle> => ({ engine: stubEngine(), close: vi.fn() });
}

function unconfigured() {
  return (): ProviderResolution => ({ status: 'unconfigured' });
}

async function renderApp(deps: AppDeps = {}) {
  const view = render(<App deps={deps} />);
  // Let the initial warehouse-open effect settle.
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

  it('renders the topbar, chat panel, and a loading note before the warehouse opens', async () => {
    const openWarehouse = vi.fn(async () => new Promise<BrowserWarehouseHandle>(() => {})); // never resolves
    await renderApp({ openWarehouse, resolveProvider: unconfigured() });
    expect(screen.getByText(BRAND.name)).toBeInTheDocument();
    expect(screen.getByText(/Loading the warehouse/)).toBeInTheDocument();
  });

  it('shows the unconfigured model label and opens the settings dialog', async () => {
    await renderApp({
      openWarehouse: stubWarehouse(),
      resolveProvider: unconfigured(),
    });
    // The model label updates once the warehouse opens + provider resolves.
    await vi.waitFor(() => expect(screen.getByText(/not configured/)).toBeInTheDocument());

    const gear = screen.getByRole('button', { name: 'Open LLM settings' });
    fireEvent.click(gear);
    await vi.waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'LLM settings' })).toBeInTheDocument(),
    );
  });

  it('surfaces the warehouse error when openWarehouse rejects', async () => {
    const openWarehouse = vi.fn(async () => Promise.reject(new Error('parquet fetch failed')));
    await renderApp({ openWarehouse, resolveProvider: unconfigured() });
    expect(screen.getByText(/parquet fetch failed/)).toBeInTheDocument();
  });
});
