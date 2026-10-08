/**
 * Phase E — provider resolution from `localStorage` BYOK (decisions 5/7).
 *
 * The Settings dialog persists a raw settings payload under
 * `PROVIDER_STORAGE_KEY`; `resolveProvider()` normalizes it with the
 * shared `normalizeProviderConfig()` (preset defaults + validation) and
 * builds the `fetch`-based `LLMClient`. No mock in the UI path — the
 * only outcomes are `configured` or `unconfigured`.
 */
import {
  maskedView,
  normalizeProviderConfig,
  type MaskedProviderConfig,
  type ResolvedLlmConfig,
} from '../../../src/llm/provider.js';
import type { LLMClient } from '../../../src/llm/types.js';
import { FetchLlmClient } from './llm.js';

/** localStorage key holding the raw settings payload (BYOK). */
export const PROVIDER_STORAGE_KEY = 'cbms.llm.config';

/** Minimal storage surface (localStorage in the browser, a stub in tests). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type ProviderResolution =
  | {
      status: 'configured';
      client: LLMClient;
      config: ResolvedLlmConfig;
      masked: MaskedProviderConfig;
    }
  | { status: 'unconfigured' };

/** The default storage (browser `localStorage`). */
function defaultStorage(): KeyValueStorage | undefined {
  return typeof localStorage !== 'undefined' ? localStorage : undefined;
}

/** Parse the raw payload persisted by the Settings dialog, or null. */
export function readStoredConfig(storage: KeyValueStorage = defaultStorage()!): unknown {
  const raw = storage.getItem(PROVIDER_STORAGE_KEY);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Persist a raw settings payload (the Settings dialog writes this). */
export function saveStoredConfig(
  payload: unknown,
  storage: KeyValueStorage = defaultStorage()!,
): void {
  storage.setItem(PROVIDER_STORAGE_KEY, JSON.stringify(payload));
}

/** Forget the stored settings. */
export function clearStoredConfig(storage: KeyValueStorage = defaultStorage()!): void {
  storage.removeItem(PROVIDER_STORAGE_KEY);
}

/**
 * Resolve the effective LLM client from stored BYOK settings.
 * Missing, malformed, or invalid payloads resolve to `unconfigured`
 * (the UI shows the Settings prompt — never a crash).
 */
export function resolveProvider(storage: KeyValueStorage = defaultStorage()!): ProviderResolution {
  const stored = readStoredConfig(storage);
  if (stored === null) return { status: 'unconfigured' };
  let config: ResolvedLlmConfig;
  try {
    config = normalizeProviderConfig(stored);
  } catch (e) {
    if (e instanceof Error) console.warn('ignoring invalid stored LLM config:', e.message);
    return { status: 'unconfigured' };
  }
  const client = new FetchLlmClient({
    model: config.model,
    baseUrl: config.baseUrl ?? '',
    apiKey: config.apiKey,
  });
  const masked: MaskedProviderConfig = maskedView(config);
  return { status: 'configured', client, config, masked };
}
