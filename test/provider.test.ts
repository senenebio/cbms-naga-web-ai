/**
 * Phase B — provider config normalization + key masking tests
 * (pure helpers, no env / no storage / no network).
 */
import { describe, it, expect } from 'vitest';
import {
  PROVIDER_PRESETS,
  normalizeProviderConfig,
  maskKey,
  maskedView,
  ProviderConfigError,
} from '../src/llm/provider.js';

describe('PROVIDER_PRESETS', () => {
  it('ships local / openrouter / openai (no mock in the UI set)', () => {
    expect(Object.keys(PROVIDER_PRESETS).sort()).toEqual(['local', 'openai', 'openrouter']);
    expect(PROVIDER_PRESETS.local?.baseUrl).toBe('http://localhost:11434/v1');
    expect(PROVIDER_PRESETS.local?.model).toBe('llama3.1');
    expect(PROVIDER_PRESETS.openrouter?.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(PROVIDER_PRESETS.openai?.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('openrouter preset defaults to the OpenRouter Free Router model', () => {
    expect(PROVIDER_PRESETS.openrouter?.model).toBe('openrouter/free');
  });
});

describe('normalizeProviderConfig', () => {
  it('applies local presets (baseUrl + apiKey + model)', () => {
    const cfg = normalizeProviderConfig({ provider: 'local' });
    expect(cfg).toEqual({
      provider: 'local',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'ollama',
      model: 'llama3.1',
    });
  });

  it('keeps user-provided local values (custom port)', () => {
    const cfg = normalizeProviderConfig({
      provider: 'local',
      baseUrl: 'http://127.0.0.1:8080/v1',
      model: 'qwen2.5-coder',
    });
    expect(cfg.baseUrl).toBe('http://127.0.0.1:8080/v1');
    expect(cfg.model).toBe('qwen2.5-coder');
    expect(cfg.apiKey).toBe('ollama');
  });

  it('fills the openrouter preset model when blank, and keeps explicit models', () => {
    expect(normalizeProviderConfig({ provider: 'openrouter', apiKey: 'sk-or-v1-x' }).model).toBe(
      'openrouter/free',
    );
    const cfg = normalizeProviderConfig({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-x',
      model: 'google/gemma-4-31b-it:free',
    });
    expect(cfg.model).toBe('google/gemma-4-31b-it:free');
    expect(cfg.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  it('accepts openai with an API key', () => {
    const cfg = normalizeProviderConfig({ provider: 'openai', apiKey: 'sk-abc123' });
    expect(cfg.baseUrl).toBe('https://api.openai.com/v1');
    expect(cfg.model).toBe('gpt-4o-mini');
  });

  it('rejects an unknown provider', () => {
    expect(() => normalizeProviderConfig({ provider: 'mock' })).toThrow(ProviderConfigError);
    expect(() => normalizeProviderConfig({ provider: 'anthropic' })).toThrow(ProviderConfigError);
  });

  it('rejects openrouter without an API key', () => {
    expect(() => normalizeProviderConfig({ provider: 'openrouter' })).toThrow(ProviderConfigError);
  });

  it('rejects openai without an API key', () => {
    expect(() => normalizeProviderConfig({ provider: 'openai' })).toThrow(ProviderConfigError);
  });

  it('rejects a non-URL local baseUrl', () => {
    expect(() => normalizeProviderConfig({ provider: 'local', baseUrl: 'not a url' })).toThrow(
      ProviderConfigError,
    );
  });

  it('rejects a non-object payload', () => {
    expect(() => normalizeProviderConfig('local')).toThrow(ProviderConfigError);
    expect(() => normalizeProviderConfig(null)).toThrow(ProviderConfigError);
  });
});

describe('maskKey / maskedView (S8 — never return the full key)', () => {
  it('masks long keys with a 7-char prefix and 4-char suffix', () => {
    expect(maskKey('sk-or-v1-abcdefgh1234')).toBe('sk-or-v…1234');
  });

  it('fully masks short keys', () => {
    expect(maskKey('short')).toBe('****');
  });

  it('exposes only the masked key in the public view', () => {
    const view = maskedView({
      provider: 'openrouter',
      apiKey: 'sk-or-v1-abcdefgh1234',
      model: 'm',
    });
    expect(view.keyMasked).toBe('sk-or-v…1234');
    expect(JSON.stringify(view)).not.toContain('sk-or-v1-abcdefgh1234');
  });
});
