# Plan: Single OpenAI-compatible endpoint (replaces provider presets)

**Status:** implemented (2026-10-09; Task 7 manual verification pending)
**Date:** 2026-10-09
**Parent spec:** `browser-only-spec.md` (complete; this is a follow-on revision)

## Goal

Replace the 3-provider preset system (`local` / `openrouter` / `openai`) with **one uniform mode**: an OpenAI-compatible endpoint identified by **Base URL + API key + Model**. The wire layer is already OpenAI-compatible — this is a settings/validation/UI simplification, not a protocol change.

## Decisions (from 2026-10-09 planning Q&A)

| # | Decision |
|---|---|
| E1 | **Single mode.** No `ProviderKind`, no `PROVIDER_PRESETS`. Stored shape: `{ baseUrl, apiKey?, model }`. |
| E2 | **Uniform API key field.** Always present; blank/missing normalizes to `'noop'` (Bearer `noop` — harmless for local servers). |
| E3 | **Legacy shape → unconfigured.** Any stored payload containing a `provider` field is rejected by validation → `resolveProvider()` returns `unconfigured`. No migration. |
| E4 | **No tools-rejection fallback.** Endpoint errors surface to chat as-is. |
| E5 | **Free-text model.** Any model string; delete `src/llm/free_models.ts` (no curated list). |
| E6 | **BaseUrl: validate only.** Must be a valid http(s) URL; no rewriting (no trailing-slash strip, no `/v1` appending). UI shows a hint line with example endpoints. |
| E7 | **Dialog copy.** Title stays "LLM settings"; the "Provider" radio fieldset is replaced by three plain fields (Base URL, API key, Model). |
| E8 | **Wire layer untouched.** `FetchLlmClient`, `toApiMessages`, `askQuestion`, tool specs, `chat.ts` — no changes. |
| E9 | **Blank key preserves.** Saving with a blank API-key field keeps the previously stored key (dialog re-injects it from the stored payload); a typed key replaces it. `'noop'` is only the normalization default, never written by the dialog. |
| E10 | **Minor contract clarifications.** `baseUrl`/`model` are trimmed (as today); `apiKey: null` counts as blank → `'noop'`; legacy = any payload with a `provider` property present (any value, incl. `null`); dialog suppresses the "Current key:" line when the resolved key is `'noop'`. |

## Contracts (what makes the tasks independent)

- `ResolvedLlmConfig` → `{ baseUrl: string; apiKey: string; model: string }` (`apiKey` always resolved, defaults to `'noop'`).
- `MaskedProviderConfig` → `{ baseUrl?: string; model?: string; keyMasked?: string }` (no `provider`).
- `normalizeProviderConfig(input): ResolvedLlmConfig` — throws `ProviderConfigError`:
  1. non-object payload → error
  2. payload has a `provider` property (legacy shape) → error
  3. `baseUrl` required, valid http(s) URL
  4. `model` required, non-empty
  5. `apiKey` optional → trimmed, blank → `'noop'`
- `resolveProvider()` semantics unchanged: invalid/malformed/legacy → `unconfigured`.

## Phases (each ends with a green test gate: `npm test` + `npm run lint`)

**Task 1 — Core: single-mode provider config** (`src/llm/provider.ts`)
- Drop `ProviderKind`, `PROVIDER_PRESETS`, `free_models.js` import.
- Rewrite `normalizeProviderConfig` per contract; keep `maskKey`, `maskedView` (minus `provider`), `ProviderConfigError`, `UNCONFIGURED_MESSAGE`.

**Task 2 — Core tests** (`test/provider.test.ts`)
- Rewrite: valid config, `apiKey` blank → `noop`, missing `baseUrl`/`model` rejected, non-URL rejected, non-object rejected, **legacy `{provider:'openrouter',...}` payload rejected**, `maskKey`/`maskedView` (S8: never full key).
- *Gate: `npm test` green (this task alone breaks web/ imports — see Task 3 dependency note).*

**Task 3 — Web core: resolution** (`web/src/core/provider.ts`)
- Simplify imports/usage of the new config shape; update doc comments (drop "preset" language). `resolveProvider` logic itself is unchanged (normalization failure already → `unconfigured`).

**Task 4 — Web core tests** (`web/src/core/provider.test.ts`)
- Rewrite: unconfigured (empty / malformed / **legacy shape** regression), configured round-trip with masked key, save/clear.
- *Gate: `npm test` green.*

**Task 5 — UI: Settings dialog** (`web/src/components/SettingsDialog.tsx`)
- Remove radio group, `PROVIDER_LABELS`, `defaultModel`, preset imports.
- Three fields: Base URL (placeholder `http://localhost:11434/v1` + hint: Ollama / LM Studio / llama.cpp / any OpenAI-compatible endpoint), API key (placeholder `secret-BYOK-secret`), Model (free text, example hint: `ukisai/Swift-1.5-Qwen3.8-27B-GGUF:IQ3_XXS`).
- `buildPayload()` → `{ baseUrl, model, apiKey? }`; **blank key field → omit `apiKey` and re-inject the previously stored key** (E9); prefill from stored config; masked-key display kept (suppressed for `'noop'`, E10).

**Task 6 — Cleanup + app shell**
- Delete `src/llm/free_models.ts` (grep confirms imports only in `provider.ts` + its test).
- `web/src/App.tsx`: verify no provider references (scout found only `config.model` in `modelLabel` — likely zero changes; confirm).
- *Gate: `npm test` + `npm run lint` green.*

**Task 7 — Manual verification**
- `npm run dev:web` → Settings → point at a local OpenAI-compatible endpoint → ask a question; confirm Bearer header, chat works, legacy localStorage shape shows unconfigured.

## Dependencies

- Tasks 1→3→5 share the contract; 2 and 4 ride with their code tasks. **Tasks 1+2+3+4+5 must land together** (type break is repo-wide in between) — or as two commits: (1) core + its tests, (2) web + dialog + cleanup.
- Non-goals: no `baseUrl` normalization, no tools fallback, no migration, no wire changes. SQL guardrails / PII allowlists / `vite.config.ts` / data assets untouched.

## Risks

- `ResolvedLlmConfig`/`MaskedProviderConfig` are public surface of the driver-free core — confirmed consumers are only `web/` and tests (scout), so breaking the shape is safe.
- `SettingsDialog` has no component test today (only `chat.test.ts`/`provider.test.ts`); Task 5 is verified by build + manual (Task 7). Optionally add a dialog render test.
