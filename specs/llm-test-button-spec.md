# Plan: "Test" button in the LLM settings dialog

**Status:** implemented
**Date:** 2026-10-09
**Parent spec:** `openai-endpoint-spec.md` (follow-on)

## Goal

Add a **Test** button to the Settings dialog that probes the configured
OpenAI-compatible endpoint with a minimal `chat/completions` request and
shows success/failure in the dialog — so users can verify Base URL + key +
model without leaving Settings.

## Decisions

| # | Decision |
|---|---|
| T1 | **Probe = minimal chat completion.** `POST {baseUrl}/chat/completions` with `{ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }`, `Authorization: Bearer {apiKey}`. No `tools` (avoids tool-incompatible endpoints failing the probe). |
| T2 | **Tests the current dialog fields**, not the stored config: blank key field uses the preserved stored key (same rule as Save, E9). Config is validated with `normalizeProviderConfig` first — invalid fields show the validation error, no network call. |
| T3 | **Result in the dialog notice area.** OK → "Endpoint OK — {model} responded." Failure → the error message (HTTP status + body snippet, or network/CORS message). No toast, no new UI region. |
| T4 | **Button state.** `Test` → `Testing…` (disabled) while the probe is in flight; re-enabled after. Save/Clear remain enabled. |
| T5 | **No persistence side effects.** Test never writes to localStorage and does not call `onSaved`. |

## Contracts

- `testLlmConnection(cfg: { baseUrl: string; apiKey: string; model: string }): Promise<void>` in `web/src/core/llm.ts`:
  - resolves on HTTP 2xx
  - throws `Error` with: `HTTP {status}: {body ≤ 300 chars}` on non-2xx; `Connection failed: {message}` on network failure.
  - Trims trailing slashes on `baseUrl` (same as `FetchLlmClient`).

## Tasks

1. `web/src/core/llm.ts` — add `testLlmConnection`.
2. `web/src/components/SettingsDialog.tsx` — add Test button + `testing` state + `handleTest` (validate → probe → notice).
3. Tests — `web/src/core/llm.test.ts` (fetch mocked: 2xx ok, 401 → status+body, network error → message); `SettingsDialog.test.tsx` (Test button present; invalid config → no fetch; valid config → fetch called with probe payload incl. preserved key; success/failure notices).
4. Gates: `npm test` + `npm run lint` + `npm run build:web`.

## Non-goals

No changes to the chat path, `FetchLlmClient.chat`, provider config, guardrails, or wire format. No auto-retry. No timeout (the fetch follows browser defaults).
