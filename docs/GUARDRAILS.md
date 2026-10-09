# Guardrails

## SQL guardrails

All LLM SQL must go through `runSelect` (`src/llm/sql_tool.ts`):

- Single read-only `SELECT` (`validateSelectOnly` + keyword blocklist)
- 100-row cap
- ~50 KB result-text cap
- Binary-search shrink on failure
- No ad-hoc query paths

Do not weaken any of these.

## PII allowlists

Only data-dictionary `include=true` columns are exposed. `ean`, `bsn`, `husn`, `hsn`,
coordinates, and contact fields stay out. Keep `DEMO_COLUMNS` and `RURAL_BARANGAYS`
(`src/data.ts`) intact.

## LLM client

- No `openai` SDK — the LLM client is a thin `fetch` implementation of the `LLMClient` interface.
- BYOK keys live in `localStorage` only.
