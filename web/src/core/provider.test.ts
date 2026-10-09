/**
 * Phase E — provider resolution from localStorage BYOK (stub storage,
 * no real network).
 */
import { describe, expect, it } from 'vitest';
import {
  clearStoredConfig,
  PROVIDER_STORAGE_KEY,
  readStoredConfig,
  resolveProvider,
  saveStoredConfig,
  type KeyValueStorage,
} from './provider.js';
import { maskKey } from '../../../src/llm/provider.js';

function stubStorage(): KeyValueStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

describe('core/provider.ts (localStorage BYOK)', () => {
  it('is unconfigured when nothing is stored', () => {
    expect(resolveProvider(stubStorage())).toEqual({ status: 'unconfigured' });
  });

  it('is unconfigured for a malformed stored payload', () => {
    const storage = stubStorage();
    storage.setItem(PROVIDER_STORAGE_KEY, '{not json');
    expect(resolveProvider(storage)).toEqual({ status: 'unconfigured' });
  });

  it('is unconfigured for the legacy preset shape (regression)', () => {
    const storage = stubStorage();
    storage.setItem(
      PROVIDER_STORAGE_KEY,
      JSON.stringify({ provider: 'openrouter', apiKey: 'sk-x', model: 'm' }),
    );
    expect(resolveProvider(storage)).toEqual({ status: 'unconfigured' });
  });

  it('resolves a configured endpoint with a masked key', () => {
    const storage = stubStorage();
    saveStoredConfig(
      { baseUrl: 'http://localhost:11434/v1', apiKey: 'sk-abc1234567890', model: 'llama3.1' },
      storage,
    );
    const resolved = resolveProvider(storage);
    expect(resolved.status).toBe('configured');
    if (resolved.status !== 'configured') return;
    expect(resolved.config.baseUrl).toBe('http://localhost:11434/v1');
    expect(resolved.config.model).toBe('llama3.1');
    expect(resolved.masked.keyMasked).toBe(maskKey('sk-abc1234567890'));
    expect(resolved.masked.keyMasked).not.toBe('sk-abc1234567890');
    expect(typeof resolved.client.chat).toBe('function');
  });

  it('defaults a missing key to "noop" and clears on demand', () => {
    const storage = stubStorage();
    saveStoredConfig({ baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' }, storage);
    const resolved = resolveProvider(storage);
    expect(resolved.status).toBe('configured');
    if (resolved.status !== 'configured') return;
    expect(resolved.config.apiKey).toBe('noop');
    expect(resolved.masked.keyMasked).toBeUndefined();

    clearStoredConfig(storage);
    expect(resolveProvider(storage)).toEqual({ status: 'unconfigured' });
    expect(readStoredConfig(storage)).toBeNull();
  });
});
