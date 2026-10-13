/**
 * Phase F — App shell: chat + settings only (no workspace pane).
 *
 * Wires the Phase E browser core:
 *  - On mount, opens the DuckDB warehouse via `openWarehouseBrowser()`
 *    (fetches the 3 parquets, boots the worker) and hands its `SqlEngine`
 *    to the single `ChatPanel`.
 *  - Resolves the BYOK `LLMClient` from `localStorage` via `resolveProvider()`
 *    (re-resolved after a Settings save/clear).
 *
 * `deps` is injectable so React component tests run with stubs — no network,
 * no duckdb-wasm, no real localStorage.
 */
import { useEffect, useRef, useState } from 'react';
import type { LLMClient, SqlEngine } from '@repo/llm/types.js';
import type { BrowserWarehouseHandle } from './wasm/engine.js';
import { openWarehouseBrowser } from './wasm/engine.js';
import { resolveProvider, type KeyValueStorage, type ProviderResolution } from './core/provider.js';
import ChatPanel from './components/ChatPanel.js';
import SettingsDialog from './components/SettingsDialog.js';
import { applyTheme, getInitialTheme, saveTheme, type Theme } from './theme.js';

export interface AppDeps {
  /** Open the warehouse (stubbed in tests to avoid duckdb-wasm/network). */
  openWarehouse?: () => Promise<BrowserWarehouseHandle>;
  /** Resolve the BYOK client from storage (stubbed in tests). */
  resolveProvider?: (storage?: KeyValueStorage) => ProviderResolution;
}

export default function App({ deps = {} }: { deps?: AppDeps }) {
  const openWarehouse = deps.openWarehouse ?? openWarehouseBrowser;
  const resolve = deps.resolveProvider ?? resolveProvider;

  const [engine, setEngine] = useState<SqlEngine | null>(null);
  const [warehouseError, setWarehouseError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<ProviderResolution | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [reload, setReload] = useState(0);
  const closeRef = useRef<(() => Promise<void>) | null>(null);

  // Open the warehouse once on mount.
  useEffect(() => {
    let cancelled = false;
    setWarehouseError(null);
    openWarehouse()
      .then((handle) => {
        if (cancelled) {
          void handle.close();
          return;
        }
        closeRef.current = handle.close;
        setEngine(handle.engine);
      })
      .catch((e: unknown) => {
        if (!cancelled) setWarehouseError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [openWarehouse]);

  // Resolve the BYOK client (re-run after a Settings save/clear via `reload`).
  useEffect(() => {
    setResolution(resolve());
  }, [resolve, reload]);

  // Apply + persist the theme.
  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  const client: LLMClient | null =
    resolution && resolution.status === 'configured' ? resolution.client : null;

  const modelLabel = warehouseError
    ? 'Warehouse: failed to load'
    : engine === null
      ? 'Warehouse: loading…'
      : resolution === null
        ? 'Model: …'
        : resolution.status === 'unconfigured'
          ? 'Model: not configured — open Settings'
          : `Model: ${resolution.config.model}`;

  return (
    <div className="app">
      <header className="topbar">
        <span className="title">CBMS Naga City — AI interpretation demo (CBMS 2024)</span>
        <span className="model-label">{modelLabel}</span>
        <button
          type="button"
          className="settings-toggle"
          aria-label="Open LLM settings"
          title="LLM settings"
          onClick={() => setSettingsOpen(true)}
        >
          ⚙️
        </button>
        <button
          type="button"
          className="theme-toggle"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to light mode'}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to light mode'}
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </header>

      {settingsOpen && (
        <SettingsDialog
          storage={localStorage}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => setReload((n) => n + 1)}
        />
      )}

      <main className="panes single">
        <section className="panel">
          <ChatPanel
            engine={engine}
            client={client}
            engineError={warehouseError}
            onOpenSettings={() => setSettingsOpen(true)}
            theme={theme}
          />
        </section>
      </main>
    </div>
  );
}
