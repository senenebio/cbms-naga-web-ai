/**
 * BYOK LLM settings dialog — Radix Dialog (shadcn).
 *
 * A single OpenAI-compatible endpoint: Base URL + API key + Model.
 * Save persists into `localStorage` (via `core/provider.ts`).
 * Keys are never shown unmasked (the stored config is displayed
 * through `maskKey`). Saving with a blank API-key field keeps the
 * previously stored key.
 */
import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog.js';
import { Button } from '@workspace/ui/components/button.js';
import {
  maskKey,
  normalizeProviderConfig,
} from '@repo/llm/provider.js';
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
      if (cfg.apiKey !== 'noop') setStoredKey(cfg.apiKey);
    } catch {
      /* invalid stored config: keep the defaults */
    }
  }, [storage]);

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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connection</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3.5">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            <span>Base URL</span>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434/v1"
              className="rounded-md border bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <small className="text-xs font-normal text-muted-foreground">
              Any OpenAI-compatible endpoint — Ollama: <code>http://localhost:11434/v1</code> · LM
              Studio: <code>http://localhost:1234/v1</code> · llama.cpp: <code>http://localhost:8080/v1</code>{' '}
              · OpenRouter: <code>https://openrouter.ai/api/v1</code>
            </small>
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            <span>API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="secret-BYOK-secret"
              className="rounded-md border bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            {storedKey ? (
              <small className="text-xs font-normal text-muted-foreground">
                Current key: {maskKey(storedKey)}
              </small>
            ) : null}
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            <span>Model</span>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="any model name"
              className="rounded-md border bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <small className="text-xs font-normal text-muted-foreground">
              e.g. <code>ukisai/Swift-1.5-Qwen3.8-27B-GGUF:IQ3_XXS</code> or <code>openrouter/free</code>
            </small>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={handleSave}>
            Save
          </Button>
          <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? 'Testing…' : 'Test'}
          </Button>
          <Button type="button" variant="outline" onClick={handleClear}>
            Clear
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>

        {notice ? (
          <p className={notice.kind === 'error' ? 'text-sm text-destructive' : 'text-xs text-muted-foreground'}>
            {notice.text}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Settings and the API key are stored in this browser only (localStorage) — never sent to
          any server.
        </p>
      </DialogContent>
    </Dialog>
  );
}
