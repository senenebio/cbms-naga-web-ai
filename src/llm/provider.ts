/**
 * Pure LLM provider config helpers (settings-dialog backend, spec v2.2).
 *
 * Provider set (decision 5): `local` (Ollama / LM Studio / llama.cpp via an
 * OpenAI-compatible endpoint), `openrouter`, and `openai` (direct BYOK).
 * `mock` is test-only and NOT a UI-facing preset.
 *
 * No localStorage/env resolution here — that comes in a later phase.
 * Keys are never logged or returned unmasked (S8).
 */
import { DEFAULT_FREE_MODEL } from './free_models.js';

export type ProviderKind = 'local' | 'openrouter' | 'openai';

/** A fully-resolved LLM config (after preset defaults + validation). */
export interface ResolvedLlmConfig {
  provider: ProviderKind;
  baseUrl?: string;
  apiKey?: string;
  model: string;
}

/** Public (masked) view of a config — safe for UI display. */
export interface MaskedProviderConfig {
  provider: ProviderKind;
  baseUrl?: string;
  model?: string;
  keyMasked?: string;
}

export class ProviderConfigError extends Error {}

export const UNCONFIGURED_MESSAGE = 'No LLM configured — open the Settings dialog (gear icon).';

/** Default values per provider, applied when a field is left blank. */
export const PROVIDER_PRESETS: Record<
  ProviderKind,
  { baseUrl?: string; apiKey?: string; model?: string }
> = {
  local: { baseUrl: 'http://localhost:11434/v1', apiKey: 'ollama', model: 'llama3.1' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: DEFAULT_FREE_MODEL },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
};

function isValidHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function asTrimmedString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/**
 * Validate a settings payload and fill in provider defaults.
 * Throws `ProviderConfigError` with an actionable message on invalid input.
 */
export function normalizeProviderConfig(input: unknown): ResolvedLlmConfig {
  if (typeof input !== 'object' || input === null) {
    throw new ProviderConfigError('Settings payload must be a JSON object.');
  }
  const { provider, baseUrl, apiKey, model } = input as Record<string, unknown>;
  if (provider !== 'local' && provider !== 'openrouter' && provider !== 'openai') {
    throw new ProviderConfigError('provider must be one of: "local", "openrouter", "openai".');
  }
  const cfg: ResolvedLlmConfig = {
    provider,
    baseUrl: asTrimmedString(baseUrl),
    apiKey: asTrimmedString(apiKey),
    model: asTrimmedString(model) ?? '',
  };
  const preset = PROVIDER_PRESETS[provider];
  cfg.baseUrl ??= preset.baseUrl;
  if (provider === 'local') cfg.apiKey ??= preset.apiKey;
  cfg.model ||= preset.model ?? '';

  if (provider === 'local') {
    if (!isValidHttpUrl(cfg.baseUrl ?? '')) {
      throw new ProviderConfigError(
        'baseUrl must be a valid http(s) URL, e.g. http://localhost:11434/v1',
      );
    }
    if (!cfg.model) throw new ProviderConfigError('model is required for a local provider.');
  } else if (provider === 'openrouter') {
    if (!cfg.apiKey)
      throw new ProviderConfigError('apiKey is required for OpenRouter (free tier included).');
    if (!cfg.model) throw new ProviderConfigError('model is required for OpenRouter.');
  } else if (provider === 'openai') {
    if (!cfg.apiKey) throw new ProviderConfigError('apiKey is required for OpenAI.');
    if (!cfg.model) throw new ProviderConfigError('model is required for OpenAI.');
  }
  return cfg;
}

/** Mask a key for display: `sk-or-v1-abc…wxyz`. Never returns the full key. */
export function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

export function maskedView(cfg: ResolvedLlmConfig): MaskedProviderConfig {
  const out: MaskedProviderConfig = {
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
  };
  if (cfg.apiKey) out.keyMasked = maskKey(cfg.apiKey);
  return out;
}
