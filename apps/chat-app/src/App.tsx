/**
 * Phase F app shell: boots the DuckDB-in-browser warehouse, then renders
 * ChatLayout with the chat feed + composer.
 *
 * - `openWarehouse()` (Web Worker, duckdb-wasm) loads the 3 parquet
 *   fixtures and exposes the read-only views as `SqlEngine`.
 * - BYOK provider resolution (localStorage) builds the `fetch` LLM client.
 * - Theme toggle (light/dark) on `<html>`.
 * - SettingsMenu (gear) for model/temperature + "Connection…" → BYOK dialog.
 * - Composer (auto-growing textarea) pinned to the bottom of the layout.
 *
 * `deps` are injectable so the boot sequence can be tested in Node.
 */
import { useEffect, useRef, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import type { LLMClient, SqlEngine } from '@repo/llm/types.js';
import { ChatLayout } from '@workspace/ui/components/chat-layout.js';
import { Composer } from '@workspace/ui/components/composer.js';
import { SettingsMenu } from '@workspace/ui/components/settings-menu.js';
import { openWarehouseBrowser, type BrowserWarehouseHandle } from './wasm/engine.js';
import {
  readTemperature as readTempFromStorage,
  resolveProvider,
  type KeyValueStorage,
  type ProviderResolution,
} from './core/provider.js';
import SettingsDialog from './components/SettingsDialog.js';
import ChatPanel from './components/ChatPanel.js';
import { useChat } from './hooks/use-chat.js';
import { applyTheme, getInitialTheme, saveTheme, type Theme } from './theme.js';
import { BRAND } from './brand.js';

export interface AppDeps {
  openWarehouse: () => Promise<BrowserWarehouseHandle>;
  resolveProvider: () => ProviderResolution;
  /** Storage for the Settings dialog. */
  storage: KeyValueStorage;
}

const defaultDeps: AppDeps = {
  openWarehouse: () => openWarehouseBrowser(),
  resolveProvider: () => resolveProvider(),
  storage: localStorage,
};

export interface AppProps {
  deps?: AppDeps;
}

export default function App({ deps = defaultDeps }: AppProps) {
  const [engine, setEngine] = useState<SqlEngine | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderResolution | 'init'>('init');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [model, setModel] = useState<string>('');
  const [temperature, setTemperature] = useState<number>(0.7);
  const warehouseRef = useRef<BrowserWarehouseHandle | null>(null);
  const [theme, setThemeState] = useState<Theme>(() => getInitialTheme());

  // Boot the warehouse once (injected so tests can substitute a fake).
  useEffect(() => {
    let handle: BrowserWarehouseHandle | null = null;
    let cancelled = false;
    deps
      .openWarehouse()
      .then((h: BrowserWarehouseHandle) => {
        if (cancelled) {
          h.close();
          return;
        }
        handle = h;
        warehouseRef.current = h;
        setEngine(h.engine);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setEngineError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      handle?.close();
      warehouseRef.current = null;
    };
  }, [deps]);

  // Resolve the BYOK provider once (and after Settings saves).
  useEffect(() => {
    setProvider(deps.resolveProvider());
  }, [deps]);

  // Initialize model and temperature from localStorage.
  useEffect(() => {
    const storedModel = deps.storage.getItem('chat-model');
    if (storedModel) setModel(storedModel);
    setTemperature(readTempFromStorage(deps.storage));
  }, [deps]);

  // Theme: apply the .dark class on <html> + persist.
  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  const toggleTheme = () => {
    setThemeState((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      saveTheme(next);
      return next;
    });
  };

  const client: LLMClient | null =
    provider === 'init' || provider.status === 'unconfigured' ? null : provider.client;

  // Chat logic via hook.
  const { messages, busy, draft, setDraft, ask, newChat } = useChat({
    engine,
    client,
    engineError,
  });

  const modelLabel =
    provider !== 'init' && provider.status === 'configured'
      ? provider.masked.model ?? provider.config.model
      : 'No model set';

  const handleModelChange = (m: string) => {
    setModel(m);
    deps.storage.setItem('chat-model', m);
  };

  const handleTemperatureChange = (v: number) => {
    setTemperature(v);
    deps.storage.setItem('chat-temperature', String(v));
  };

  return (
    <ChatLayout
      title={BRAND.name}
      status={modelLabel}
      headerRight={
        <>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="inline-flex h-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <SettingsMenu
            models={['gpt-4o', 'gpt-4o-mini', 'llama3.1:8b', 'qwen3:8b']}
            model={model}
            onModelChange={handleModelChange}
            temperature={temperature}
            onTemperatureChange={handleTemperatureChange}
            brandName={BRAND.name}
            brandVersion={BRAND.version}
            brandLicense={BRAND.license}
            onConnection={() => setSettingsOpen(true)}
          />
        </>
      }
      composer={
        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={() => ask(draft)}
          disabled={busy || !engine || client === null}
          placeholder={
            client === null ? 'Configure a model first (gear icon)…' : 'Ask a question…'
          }
        />
      }
    >
      <ChatPanel
        messages={messages}
        busy={busy}
        engine={engine}
        engineError={engineError}
        client={client}
        onOpenSettings={() => setSettingsOpen(true)}
        theme={theme}
        onNewChat={newChat}
      />

      {settingsOpen && (
        <SettingsDialog
          storage={deps.storage}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            setProvider(deps.resolveProvider());
          }}
        />
      )}
    </ChatLayout>
  );
}
