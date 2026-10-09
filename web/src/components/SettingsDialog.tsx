/**
 * BYOK LLM settings dialog.
 *
 * A single OpenAI-compatible endpoint: Base URL + API key + Model. Save
 * persists into `localStorage` (via `core/provider.ts`). Keys are never
 * shown unmasked (the stored config is displayed through `maskKey`).
 * Saving with a blank API-key field keeps the previously stored key.
 */
import { useEffect, useState } from 'react';
import {
  maskKey,
  normalizeProviderConfig,
} from '../../../src/llm/provider.js';
import { testLlmConnection } from '../core/llm.js';
import {
  clearStoredConfig,
  readStoredConfig,
  saveStoredConfig,
  type KeyValueStorage,
} from '../core/provider.js';

export interface SettingsDialogProps {
  /** localStorage (browser) or a stub in tests. */
  storage: KeyValueStorage;
  onClose: () => void;
  /** Called after a successful Save or Clear so the parent can re-resolve. */
  onSaved?: () => void;
}

export default function SettingsDialog({ storage, onClose, onSaved }: SettingsDialogProps) {
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  /** The previously stored key (kept out of the input so a blank field preserves it). */
  const [storedKey, setStoredKey] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  // Prefill from the stored config (if any) on first render.
  useEffect(() => {
    const stored = readStoredConfig(storage);
    if (stored === null) return;
    try {
      const cfg = normalizeProviderConfig(stored);
      setBaseUrl(cfg.baseUrl);
      setModel(cfg.model);
      // `'noop'` is the normalization default, never a real stored key.
      if (cfg.apiKey !== 'noop') setStoredKey(cfg.apiKey);
    } catch {
      /* invalid stored config: keep the defaults */
    }
  }, []);

  function buildPayload(): Record<string, string> {
    const payload: Record<string, string> = {
      baseUrl: baseUrl.trim(),
      model: model.trim(),
    };
    const key = apiKey.trim();
    if (key) payload.apiKey = key;
    else if (storedKey) payload.apiKey = storedKey;
    return payload;
  }

  function handleSave() {
    setNotice(null);
    try {
      const payload = buildPayload();
      // Validate before persisting; throws `ProviderConfigError` with an
      // actionable message on invalid input.
      const resolved = normalizeProviderConfig(payload);
      saveStoredConfig(payload, storage);
      setStoredKey(resolved.apiKey === 'noop' ? undefined : resolved.apiKey);
      setApiKey('');
      setNotice({ kind: 'ok', text: 'Saved to this browser (localStorage).' });
      onSaved?.();
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Probe the endpoint with the current field values (no persistence). */
  async function handleTest() {
    setNotice(null);
    try {
      const payload = buildPayload();
      const resolved = normalizeProviderConfig(payload);
      setTesting(true);
      await testLlmConnection(resolved);
      setNotice({ kind: 'ok', text: `Endpoint OK — ${resolved.model} responded.` });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  function handleClear() {
    setNotice(null);
    clearStoredConfig(storage);
    setStoredKey(undefined);
    setApiKey('');
    setNotice({ kind: 'ok', text: 'Cleared — the app now runs unconfigured.' });
    onSaved?.();
  }

  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="LLM settings">
      <div className="settings-dialog">
        <header>
          <h2>LLM settings</h2>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </header>

        <div className="settings-fields">
          <label>
            <span>Base URL</span>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434/v1"
            />
            <small className="note">
              Any OpenAI-compatible endpoint — Ollama: <code>http://localhost:11434/v1</code> · LM
              Studio: <code>http://localhost:1234/v1</code> · llama.cpp: <code>http://localhost:8080/v1</code>{' '}
              · OpenRouter: <code>https://openrouter.ai/api/v1</code>
            </small>
          </label>
          <label>
            <span>API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="secret-BYOK-secret"
            />
            {storedKey ? <small className="note">Current key: {maskKey(storedKey)}</small> : null}
          </label>
          <label>
            <span>Model</span>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="any model name"
            />
            <small className="note">
              e.g. <code>ukisai/Swift-1.5-Qwen3.8-27B-GGUF:IQ3_XXS</code> or <code>openrouter/free</code>
            </small>
          </label>
        </div>

        <div className="settings-actions">
          <button type="button" className="ask-btn" onClick={handleSave}>
            Save
          </button>
          <button type="button" onClick={handleTest} disabled={testing}>
            {testing ? 'Testing…' : 'Test'}
          </button>
          <button type="button" onClick={handleClear}>
            Clear
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>

        {notice ? (
          <p className={notice.kind === 'error' ? 'error' : 'note'}>{notice.text}</p>
        ) : null}
        <p className="note">
          Settings and the API key are stored in this browser only (localStorage) — never sent to
          any server.
        </p>
      </div>
    </div>
  );
}
