/**
 * Curated list of OpenRouter free models that support `tools`
 * (function calling — required by the `run_select` tool loop).
 *
 * The FIRST entry, `openrouter/free`, is OpenRouter's **Free Models Router**
 * (verified 2026-10-06): a router model id — no `:free` suffix — that
 * auto-picks a free model for you, so a BYOK user never has to choose a
 * model. It is the default (`DEFAULT_FREE_MODEL` / `PROVIDER_PRESETS`).
 *
 * The curated `:free` list below it is the "pick a specific model" path.
 * Verified 2026-10-05 against https://openrouter.ai/api/v1/models:
 * OpenRouter listed 17 free models, 16 of which support `tools`. The free
 * list churns over time — refresh this list manually when a model
 * disappears from OpenRouter's free tier.
 *
 * Excluded: `nvidia/nemotron-3.5-content-safety:free` (no `tools` support).
 */
export interface FreeModel {
  id: string;
  label: string;
  contextLength: number;
}

export const FREE_MODELS: FreeModel[] = [
  {
    id: 'openrouter/free',
    label: 'OpenRouter Free Router (auto-picks a free model)',
    contextLength: 128000,
  },
  {
    id: 'google/gemma-4-31b-it:free',
    label: 'Google Gemma 4 31B (Instruct)',
    contextLength: 32768,
  },
  {
    id: 'google/gemma-4-26b-a4b-it:free',
    label: 'Google Gemma 4 26B-A4B (Instruct)',
    contextLength: 32768,
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    label: 'NVIDIA Nemotron 3 Ultra 550B-A55B',
    contextLength: 1048576,
  },
  {
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    label: 'NVIDIA Nemotron 3 Super 120B-A12B',
    contextLength: 262144,
  },
  { id: 'qwen/qwen3.8-27b:free', label: 'Qwen 3.8 27B', contextLength: 262144 },
  { id: 'apodex/apodex-1.1-mini:free', label: 'Apodex 1.1 Mini', contextLength: 32768 },
  {
    id: 'thinkingmachines/inkling-small:free',
    label: 'Thinking Machines Inkling Small',
    contextLength: 1048576,
  },
  { id: 'poolside/laguna-s-2.1:free', label: 'Poolside Laguna S 2.1', contextLength: 32768 },
  { id: 'cohere/north-mini-code:free', label: 'Cohere North Mini Code', contextLength: 32768 },
];

/** Default OpenRouter free model used by the settings dialog. */
export const DEFAULT_FREE_MODEL = 'openrouter/free';
