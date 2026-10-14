/**
 * Pure LLM provider config helpers (settings-dialog backend).
 *
 * Single mode: an OpenAI-compatible endpoint identified by Base URL +
 * API key + Model (spec: `specs/openai-endpoint-spec.md`). No provider
 * presets — `mock` is test-only and never part of the stored shape.
 *
 * No localStorage/env resolution here — that comes in a later phase.
 * Keys are never logged or returned unmasked (S8).
 */

/** A fully-resolved LLM config (after validation). */
export interface ResolvedLlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Public (masked) view of a config — safe for UI display. */
export interface MaskedProviderConfig {
  baseUrl?: string;
  model?: string;
  keyMasked?: string;
}

export class ProviderConfigError extends Error {}

export const UNCONFIGURED_MESSAGE = 'No LLM configured — open the Settings dialog (gear icon).';

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
 * Validate a settings payload. Throws `ProviderConfigError` with an
 * actionable message on invalid input:
 *  1. non-object payload → error
 *  2. payload has a `provider` property (legacy preset shape) → error
 *  3. `baseUrl` required, valid http(s) URL
 *  4. `model` required, non-empty
 *  5. `apiKey` optional → trimmed, blank → `'noop'`
 */
export function normalizeProviderConfig(input: unknown): ResolvedLlmConfig {
  if (typeof input !== 'object' || input === null) {
    throw new ProviderConfigError('Settings payload must be a JSON object.');
  }
  const payload = input as Record<string, unknown>;
  if ('provider' in payload) {
    throw new ProviderConfigError(
      'Settings use a single OpenAI-compatible endpoint (Base URL + API key + Model) — no provider field.',
    );
  }
  const baseUrl = asTrimmedString(payload.baseUrl);
  const model = asTrimmedString(payload.model);
  if (!baseUrl) throw new ProviderConfigError('baseUrl is required.');
  if (!isValidHttpUrl(baseUrl)) {
    throw new ProviderConfigError(
      'baseUrl must be a valid http(s) URL, e.g. http://localhost:11434/v1',
    );
  }
  if (!model) throw new ProviderConfigError('model is required.');
  const apiKey = asTrimmedString(payload.apiKey) ?? 'noop';
  return { baseUrl, apiKey, model };
}

/** Mask a key for display: `sk-o…wxyz`. Never returns the full key. */
export function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function maskedView(cfg: ResolvedLlmConfig): MaskedProviderConfig {
  const out: MaskedProviderConfig = {
    baseUrl: cfg.baseUrl,
    model: cfg.model,
  };
  // `'noop'` is the normalization default, never a real key — don't display it.
  if (cfg.apiKey && cfg.apiKey !== 'noop') out.keyMasked = maskKey(cfg.apiKey);
  return out;
}
