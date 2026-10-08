/**
 * Phase F — BYOK LLM settings dialog.
 *
 * Pick a provider (`local` / `openrouter` / `openai`), fill in the required
 * fields, and Save into `localStorage` (via `core/provider.ts`). Keys are
 * never shown unmasked (the stored config is displayed through
 * `maskKey`). No mock in the UI path — the only outcomes are `configured`
 * or `unconfigured`.
 */
import { useEffect, useState } from 'react';
import {
  maskedView,
  normalizeProviderConfig,
  PROVIDER_PRESETS,
  type ProviderKind,
} from '../../../src/llm/provider.js';
import {
  clearStoredConfig,
  readStoredConfig,
  saveStoredConfig,
  type KeyValueStorage,
} from '../core/provider.js';

const LOCAL_DEFAULT_URL = 'http://localhost:11434/v1';
const LOCAL_DEFAULT_MODEL = 'llama3.1';

const PROVIDER_LABELS: Record<ProviderKind, string> = {
  local: 'Local (Ollama / LM Studio / llama.cpp)',
  openrouter: 'OpenRouter (free tier)',
  openai: 'OpenAI (BYOK)',
};

/** Default model shown per provider (from the shared presets). */
function defaultModel(kind: ProviderKind): string {
  return PROVIDER_PRESETS[kind].model ?? '';
}

export interface SettingsDialogProps {
  /** localStorage (browser) or a stub in tests. */
  storage: KeyValueStorage;
  onClose: () => void;
  /** Called after a successful Save or Clear so the parent can re-resolve. */
  onSaved?: () => void;
}

export default function SettingsDialog({ storage, onClose, onSaved }: SettingsDialogProps) {
  const [provider, setProvider] = useState<ProviderKind>('openrouter');
  const [baseUrl, setBaseUrl] = useState(LOCAL_DEFAULT_URL);
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [maskedKey, setMaskedKey] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Prefill from the stored config (if any) on first render.
  useEffect(() => {
    const stored = readStoredConfig(storage);
    if (stored === null) return;
    try {
      const cfg = normalizeProviderConfig(stored);
      setProvider(cfg.provider);
      setBaseUrl(cfg.baseUrl ?? '');
      setModel(cfg.model);
      setMaskedKey(maskedView(cfg).keyMasked);
    } catch {
      /* invalid stored config: keep the defaults */
    }
  }, []);

  const selectProvider = (kind: ProviderKind) => {
    setProvider(kind);
    setBaseUrl(PROVIDER_PRESETS[kind].baseUrl ?? '');
    setModel(defaultModel(kind));
  };

  function buildPayload(): Record<string, string> {
    if (provider === 'local') {
      const payload: Record<string, string> = {
        provider: 'local',
        baseUrl: baseUrl.trim() || LOCAL_DEFAULT_URL,
        model: model.trim() || LOCAL_DEFAULT_MODEL,
      };
      const key = apiKey.trim();
      if (key) payload.apiKey = key;
      return payload;
    }
    return {
      provider,
      baseUrl: PROVIDER_PRESETS[provider].baseUrl ?? '',
      apiKey: apiKey.trim(),
      model: model.trim(),
    };
  }

  function handleSave() {
    setNotice(null);
    try {
      const payload = buildPayload();
      // Validate before persisting; throws `ProviderConfigError` with an
      // actionable message on invalid input.
      const resolved = normalizeProviderConfig(payload);
      saveStoredConfig(payload, storage);
      setMaskedKey(maskedView(resolved).keyMasked);
      setApiKey('');
      setNotice({ kind: 'ok', text: 'Saved to this browser (localStorage).' });
      onSaved?.();
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  function handleClear() {
    setNotice(null);
    clearStoredConfig(storage);
    setMaskedKey(undefined);
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

        <fieldset className="settings-provider">
          <legend>Provider</legend>
          {(['local', 'openrouter', 'openai'] as const).map((kind) => (
            <label key={kind}>
              <input
                type="radio"
                name="provider"
                value={kind}
                checked={provider === kind}
                onChange={() => selectProvider(kind)}
              />
              {PROVIDER_LABELS[kind]}
            </label>
          ))}
        </fieldset>

        <div className="settings-fields">
          <label>
            <span>Model</span>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={defaultModel(provider)}
            />
          </label>
          {provider === 'local' && (
            <label>
              <span>Base URL</span>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={LOCAL_DEFAULT_URL}
              />
              <small className="note">
                Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1 · llama.cpp:
                http://localhost:8080/v1
              </small>
            </label>
          )}
          <label>
            <span>API key{provider === 'local' ? ' (optional)' : ' (required)'}</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider === 'local' ? 'usually not needed for local servers' : 'sk-...'}
            />
            {maskedKey ? <small className="note">Current key: {maskedKey}</small> : null}
          </label>
        </div>

        <div className="settings-actions">
          <button type="button" className="ask-btn" onClick={handleSave}>
            Save
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
