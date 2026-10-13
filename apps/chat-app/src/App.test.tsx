/**
 * Phase F — App shell tests (ported from the reference UI, adapted to the
 * driver-free core: injected `openWarehouse` + `resolveProvider` stubs, no
 * network, no duckdb-wasm, no real localStorage).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import createRenderer, {
  type ReactTestInstance,
  type ReactTestRenderer,
} from 'react-test-renderer';
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
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = createRenderer.create(React.createElement(App, { deps }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setImmediate(r));
  });
  return tree!;
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
    const tree = await renderApp({ openWarehouse, resolveProvider: unconfigured() });
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain(BRAND.name);
    expect(text).toContain('Loading the warehouse');
  });

  it('shows the unconfigured model label and opens the settings dialog', async () => {
    const tree = await renderApp({
      openWarehouse: stubWarehouse(),
      resolveProvider: unconfigured(),
    });
    expect(JSON.stringify(tree.toJSON())).toContain('not configured');

    const gear = tree.root
      .findAllByType('button')
      .find((b) => b.props['aria-label'] === 'Open LLM settings');
    expect(gear).toBeTruthy();
    await act(async () => {
      (gear as ReactTestInstance).props.onClick();
    });
    expect(JSON.stringify(tree.toJSON())).toContain('LLM settings');
  });

  it('surfaces the warehouse error when openWarehouse rejects', async () => {
    const openWarehouse = vi.fn(async () => Promise.reject(new Error('parquet fetch failed')));
    const tree = await renderApp({ openWarehouse, resolveProvider: unconfigured() });
    expect(JSON.stringify(tree.toJSON())).toContain('parquet fetch failed');
  });
});
