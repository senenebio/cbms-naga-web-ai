/**
 * Single-endpoint provider config normalization + key masking tests
 * (pure helpers, no env / no storage / no network).
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeProviderConfig,
  maskKey,
  maskedView,
  ProviderConfigError,
} from '@repo/llm/provider.js';

describe('normalizeProviderConfig', () => {
  it('resolves a valid config and trims fields', () => {
    const cfg = normalizeProviderConfig({
      baseUrl: ' http://localhost:11434/v1 ',
      apiKey: ' sk-abc123 ',
      model: ' llama3.1 ',
    });
    expect(cfg).toEqual({
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'sk-abc123',
      model: 'llama3.1',
    });
  });

  it('normalizes a blank/missing apiKey to "noop"', () => {
    expect(normalizeProviderConfig({ baseUrl: 'http://localhost:11434/v1', model: 'm' }).apiKey).toBe(
      'noop',
    );
    expect(normalizeProviderConfig({ baseUrl: 'http://localhost:11434/v1', model: 'm', apiKey: '' }).apiKey).toBe(
      'noop',
    );
    expect(
      normalizeProviderConfig({ baseUrl: 'http://localhost:11434/v1', model: 'm', apiKey: null }).apiKey,
    ).toBe('noop');
  });

  it('rejects a missing baseUrl', () => {
    expect(() => normalizeProviderConfig({ model: 'm' })).toThrow(ProviderConfigError);
  });

  it('rejects a missing/blank model', () => {
    expect(() => normalizeProviderConfig({ baseUrl: 'http://localhost:11434/v1' })).toThrow(
      ProviderConfigError,
    );
    expect(() =>
      normalizeProviderConfig({ baseUrl: 'http://localhost:11434/v1', model: '  ' }),
    ).toThrow(ProviderConfigError);
  });

  it('rejects a non-URL baseUrl', () => {
    expect(() =>
      normalizeProviderConfig({ baseUrl: 'not a url', model: 'm' }),
    ).toThrow(ProviderConfigError);
    expect(() =>
      normalizeProviderConfig({ baseUrl: 'ftp://example.com/v1', model: 'm' }),
    ).toThrow(ProviderConfigError);
  });

  it('rejects a non-object payload', () => {
    expect(() => normalizeProviderConfig('http://localhost:11434/v1')).toThrow(ProviderConfigError);
    expect(() => normalizeProviderConfig(null)).toThrow(ProviderConfigError);
  });

  it('rejects the legacy preset shape (any payload with a provider field)', () => {
    expect(() =>
      normalizeProviderConfig({ provider: 'openrouter', apiKey: 'sk-x', model: 'm' }),
    ).toThrow(ProviderConfigError);
    expect(() =>
      normalizeProviderConfig({ provider: 'local', baseUrl: 'http://localhost:11434/v1', model: 'm' }),
    ).toThrow(ProviderConfigError);
    expect(() => normalizeProviderConfig({ provider: null, baseUrl: 'http://x/v1', model: 'm' })).toThrow(
      ProviderConfigError,
    );
  });
});

describe('maskKey / maskedView (S8 — never return the full key)', () => {
  it('masks long keys with a 7-char prefix and 4-char suffix', () => {
    expect(maskKey('sk-or-v1-abcdefgh1234')).toBe('sk-o…1234');
  });

  it('fully masks short keys', () => {
    expect(maskKey('short')).toBe('****');
  });

  it('exposes only the masked key in the public view', () => {
    const view = maskedView({ baseUrl: 'http://x/v1', apiKey: 'sk-or-v1-abcdefgh1234', model: 'm' });
    expect(view.keyMasked).toBe('sk-o…1234');
    expect(JSON.stringify(view)).not.toContain('sk-or-v1-abcdefgh1234');
  });
});
