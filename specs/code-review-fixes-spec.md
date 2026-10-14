# Code Review Fixes

**Status:** IN PROGRESS — H2, H3, M1, L6 done; M2, M3, M4, L1b, L2, L3, L4, L5, L7 pending; L1a deferred; M5 already resolved
**Date:** 2026-10-14
**Source:** Senior code review of the current tree (typecheck ✅, lint ✅, 205/205 tests ✅, build ✅)
**Branch:** `fix/code-review`

This spec turns the code review into a concrete, ordered plan. It is a **plan, not an implementation** — no source files are touched until this is approved and picked up.

Each in-scope item lists the **problem**, the **fix** (with exact files), and the **test/verification** that proves it. Task IDs (H1, M1, …) are stable references for the task table and acceptance list.

---

## Decisions (2026-10-14)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Scope of this pass | **All High + all Medium + all Low items except L1a (COI).** H1 retracted; M5 already resolved in-tree. L1a deferred (documented). |
| D2 | COI duckdb build (L1a) | **Investigate + pursue COI now.** Confirm Vercel can serve the required headers; switch if it's a clear win. |
| D3 | Dependencies (M1, L6) | **Add `eslint-plugin-react-hooks` (M1) and move `react`/`react-dom` to `dependencies` (L6).** Both approved per project invariants. |
| D4 | H2 cancellation | **Stop button only — no automatic first-response timeout.** The user aborts hangs manually. |
| D5 | H2 — partial answer on Stop | **Keep the partial in-flight answer** in place (do not clear the message). |
| D6 | H2 — Stop control presentation | The composer's **send button morphs into a Stop button** while `busy`. |
| D7 | L7 — Dataset label source | **Add `label: string` to `Dataset` interface** (new required field). CBMS gets `label: 'CBMS Naga 2024'`. Core reads `dataset.label` directly. |
| D8 | L7 — mock_client.ts brand content | **Move brand-specific scripts to a test fixture** (`test/fixtures/mock-scripts.ts`). `mock_client.ts` stays in `packages/core` as a generic `LLMClient` factory; brand-specific canned answers move to `test/`. |

## Scope for this pass

**In scope (14 items):** H2, H3 (High) · M1, M2, M3, M4, M5 (Medium) · L1b, L2, L3, L4, L5, L6, L7 (Low). See each section below.
**Deferred:** L1a (COI duckdb build) — documented with a DEFER decision (no clear win); kept in the *Deferred* section at the bottom.
**Retracted / already resolved:** H1 (false finding) and M5 (PII blocklist already exact-match in the current tree) — recorded so they are not re-investigated.

---

## High severity

### H1 — (RETRACTED) Invalid duckdb import subpath

**No action required.** The original finding claimed `db.worker.ts` imports `@duckdb/duckdb-wasm/node` (an unexported subpath) behind a misleading comment. That is **incorrect** for the current tree. `apps/chat-app/src/wasm/db.worker.ts:14-16` already imports the package **root** (`@duckdb/duckdb-wasm`) plus two valid `dist` subpaths:

- `@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url`
- `@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url`

The header comment accurately describes the browser-build boot sequence. There is no `node` subpath import and no misleading comment to fix. H1 is removed from scope and recorded here only so it is not re-investigated.

---

### H2 — No LLM request cancellation / Stop button  *(D4: no auto timeout)*

**Problem.** `FetchLlmClient.chat` (`apps/chat-app/src/core/llm.ts:95-98`) calls `fetch` with no `AbortSignal`. A hung/slow BYOK endpoint leaves the UI on "Thinking…" indefinitely. The only escape is starting a new chat (the only path that aborts `controllerRef` in `use-chat.ts`).

**Why it matters.** Users plug in arbitrary endpoints; a hang is the most likely real-world failure.

**Scope note (D4).** This pass adds **manual Stop only**. An automatic first-response timeout is **out of scope** — explicitly declined.

**Fix.**
- `packages/core/src/llm/types.ts`: add an optional `AbortSignal` as a 3rd param to `LLMClient.chat` (`chat(messages, tools, signal?)`), keeping existing callers working.
- **Every `LLMClient` implementation** takes the new optional param: `FetchLlmClient` (`apps/chat-app/src/core/llm.ts`), `MockClient` (`packages/core/src/llm/mock_client.ts`), and the test stubs `StubLlm` ×2 + `ChartStubLlm` (`apps/chat-app/src/testStubs.ts`, `apps/chat-app/src/core/chat.test.ts`).
- `apps/chat-app/src/core/llm.ts`: `FetchLlmClient.chat` passes the signal into `fetch({ ..., signal })`.
- `packages/core/src/llm/client.ts` (`askQuestion`): accept the signal in `AskQuestionOptions` and pass it to **both** `client.chat(...)` call sites (the normal tool loop, and the forced-final call at the tool-round cap).
- `packages/core/src/llm/chat.ts` (`streamQuestion`): accept the signal in `StreamQuestionOptions` and pass it to `askQuestion`. **Critically:** in the `catch`, detect an `AbortError` and do **not** yield a generic `error` event — return cleanly, so a manual Stop does not surface "This operation was aborted" as an error.
- `apps/chat-app/src/core/chat.ts` (`chatQuestion`): thread the signal from `ChatQuestionArgs` into `streamQuestion`.
- `apps/chat-app/src/hooks/use-chat.ts`: pass the **existing** per-turn `controllerRef.current.signal` into `chatQuestion` (no new controller needed — one already exists). Expose a `stop()` that calls `controllerRef.current?.abort()` **without** clearing messages (unlike `newChat`), leaving the partial in-flight answer in place.
- `apps/chat-app/src/App.tsx` + `ChatPanel.tsx` / `Composer` (`packages/ui/src`): the composer's **send button morphs into a Stop button** while `busy` (D6), wired to `stop()`. On Stop, the partial in-flight answer is kept in place (D5).

**Verification.**
- Unit: `FetchLlmClient` with a mocked `fetch` asserts the `signal` is forwarded and that abort surfaces an `AbortError` as a chat error.
- Hook/component test: pressing Stop while a streaming `StubLlm` is mid-answer aborts the turn and ends `busy`.
- Manual: point the endpoint at a hanging URL; Stop returns control immediately.

---

### H3 — Worker leak on warehouse init failure

**Problem.** `openWarehouseBrowser` (`apps/chat-app/src/wasm/engine.ts:94-131`): if the `ready` promise (line 107) rejects (worker boot failure), the `Worker` is never terminated — it has already imported the ~36 MB duckdb build.

**Fix.**
- `apps/chat-app/src/wasm/engine.ts`: restructure so the `ready` rejection path also calls `worker.terminate()` before rejecting (e.g. wrap the init in a helper that attaches a `.catch` which terminates, then re-rejects).

**Verification.**
- Unit test: stub the `Worker` global (as `App.test.tsx` already does for the engine) so `init` rejects; assert `worker.terminate` was called and the returned promise rejects.

---

## Medium

### M1 — Add `eslint-plugin-react-hooks`

**Problem.** `eslint.config.js` only configures `@typescript-eslint`. Several effects rely on deliberate, non-obvious dependency choices (`LeafletBarangayMap.tsx` init effect omits `model`/`selectedCode`/`fillOpacity`/`palette` and is paired with a second restyle effect; `use-chat.ts` closures keyed on `messages.length`). All correct today, but a stale-closure regression would go undetected.

**Fix.**
- Add `eslint-plugin-react-hooks` as a devDependency (approved by D3).
- `eslint.config.js`: register the plugin and enable `react-hooks/rules-of-hooks` (`error`) + `react-hooks/exhaustive-deps` (`warn`).
- Resolve any newly-flagged existing violations (add the missing deps, or add a targeted `// eslint-disable-next-line` with a rationale comment where the omission is intentional).

**Verification.** `pnpm lint` runs the hook rules; no new errors.

### M2 — `extractCallout` use the match's absolute index

**Problem.** `extractCallout` (`apps/chat-app/src/components/AnswerMarkdown.tsx:43-53`) locates the paragraph being scanned with `md.indexOf(para)`. If the same paragraph text appears more than once in the answer, `indexOf` returns the *first* occurrence, so the callout span is sliced out of the wrong copy. The bold span's own absolute offset (`hit.index`) is ignored.

**Fix.**
- Drop the paragraph split + `indexOf` lookup. Scan the whole text with `md.matchAll(/\*\*([^*\n]+)\*\*/g)` and use the match's absolute index (`m.index`) to slice. This takes the first bold span containing a number in document order — the same intent, but the removal target is exact regardless of repeated paragraphs.

**Verification.**
- Existing `extractCallout` tests (first-number, no-number, ignores-no-digit) pass unchanged.
- Add a test: a text where the same paragraph repeats and the first bold-number span is in the *second* occurrence → assert the callout is removed from the correct (second) occurrence, not the first.

### M3 — Escape `LIKE` wildcards in `fuzzyRetrySql`

**Problem.** `fuzzyRetrySql` (`packages/core/src/llm/chat.ts:90-99`) builds a `LIKE` pattern by interpolating the matched value directly: `UPPER(${col}) LIKE UPPER('%${value}%')`. If the value contains `%` or `_` (e.g. a name like `50%` or `a_b`), those characters are interpreted as `LIKE` wildcards, so the fuzzy retry matches far more rows than intended.

**Fix.**
- Add an `escapeLike(value)` helper that escapes the `LIKE` metacharacters (`%`, `_`, and the escape char `\`).
- Wrap the escaped value in `%…%` and append an explicit `ESCAPE '\\'` clause to the `LIKE`.

**Verification.**
- Add a unit test for the fuzzy-retry path asserting a value containing `%`/`_` produces an escaped pattern with `ESCAPE '\\'`, and that the escaped value does not act as a wildcard.
- Existing chat tests pass unchanged.

### M4 — Remove the dead `engineError` hook param

**Problem.** `UseChatOptions.engineError` (`apps/chat-app/src/hooks/use-chat.ts:40`) is declared but never read — `useChat({ engine, client })` destructures only `engine` and `client`. `App.tsx:100-104` passes `engineError` into the hook, so the prop is dead. The state itself is still used (passed to `ChatPanel`); only the hook param is vestigial.

**Fix.**
- Remove `engineError?: string | null` from `UseChatOptions`.
- Remove `engineError` from the `useChat({...})` call in `App.tsx`. The `engineError` state and its use by `ChatPanel` are unchanged.

**Verification.** Typecheck + lint clean (no unused-var). Existing `use-chat` and `App` tests pass unchanged.

### M5 — PII blocklist exact-match  *(already resolved — no action)*

**Problem (from review).** The PII blocklist was described as using substring matching, which is fragile (over/under-matches name variants).

**Status.** **Already resolved in the current tree.** `packages/core/src/data.ts` defines `PII_EXCLUDED_COLUMNS` as a `Set` and filters with `!PII_EXCLUDED_COLUMNS.has(c)` (exact match) in `allowedColumns`. No substring matching remains. The primary PII gate is the dictionary `include=true` allowlist; the blocklist is a secondary exact-match safety net.

**Fix.** No action needed. (Documented so the item is explicitly closed, mirroring the H1 retraction.)

**Verification.** `grep` confirms no `includes`/substring PII matching in `data.ts`. Existing `allowedColumns` tests pass unchanged.

---

## Low

### L1a — Pursue the COI duckdb build  *(approved, D2)*

**Problem.** First load pulls `duckdb-eh.wasm` (~36 MB) + a 775 KB EH worker chunk. The **COI** (cross-origin-isolated) build is smaller/faster and is the recommended browser path.

**Fix (investigate, then implement if it's a clear win).**
- Research the COI build (`duckdb-coi.wasm` + cross-origin-isolated worker) and its runtime requirements: `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Isolation: isolate` (and `Cross-Origin-Embedder-Policy`).
- Confirm the deploy target (Vercel) can serve those headers (`vercel.json` / project settings) before committing.
- If confirmed: switch `apps/chat-app/src/wasm/db.worker.ts` to the COI entry points and add the required headers to the Vercel config.
- If the headers can't be served reliably: document the finding and keep the EH build (record the decision in the follow-up spec).

**Verification.** Manual: measure first-load transfer on `pnpm start` before/after; confirm the worker boots under COI and the E2E (`test/end_to_end.test.ts`) stays green. A written go/defer decision is a required deliverable.

**Decision (2026-10-14): DEFER — keep the EH build.**

Measured against `@duckdb/duckdb-wasm@1.33.1-dev65.0/dist`:

| Artifact | raw | gzip (wire) |
|---|---|---|
| `duckdb-eh.wasm` (current) | 36.0 MB | **7.7 MB** |
| `duckdb-coi.wasm` | 35.7 MB | **7.8 MB** |
| `duckdb-browser-eh.worker.js` (current) | 760 KB | 0.2 MB |
| `duckdb-browser-coi.worker.js` | 868 KB | 0.2 MB |

- **No size win.** The COI wasm is *larger* in compressed (network) form (7.8 MB vs 7.7 MB); the raw-size delta does not survive compression. The COI dispatcher worker is also larger (868 KB vs 760 KB raw).
- **The speed win requires strict headers.** COI's real benefit (multi-threading via SharedArrayBuffer / the `.pthread.worker.js` variant) only works under `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Isolation: isolate` + `Cross-Origin-Embedder-Policy: require-corp`.
- **Deployment burden.** Adding those isolation headers to a pure-static, white-label, multi-brand Vercel deployment (there is no `vercel.json` today) adds complexity and risk for no size benefit, and the COI boot path is only exercisable in a real browser (the E2E test uses the Node blocking engine), so a regression would surface only in manual testing.

The dominant first-load cost is the ~7.7 MB wasm regardless of build. Keeping the EH build is the lower-risk choice. **Deferred** (see *Deferred* section).

### L1b — Warehouse loading progress indicator

**Problem.** While `engine === null` (warehouse still booting), `ChatPanel` shows a plain text line “Loading the warehouse (DuckDB in your browser)…” with no visual progress affordance. On slow connections the ~7.7 MB wasm boot can take several seconds with no feedback.

**Fix.**
- `apps/chat-app/src/components/ChatPanel.tsx`: add a `Loader2` icon from `lucide-react` (already a dependency) with `animate-spin` next to the existing loading text. DuckDB-wasm does not expose granular load progress, so a spinner + text is the practical indicator (no fake progress bar).

**Verification.**
- Render `ChatPanel` with `engine={null}` and assert the spinner is present.
- Existing `ChatPanel`/`App` tests pass unchanged.

### L2 — Reorder SQL comment/literal stripping

**Problem.** `validateSelectOnly` (`packages/core/src/llm/sql_tool.ts:52-54`) strips comments (`/*…*/` and `--…`) before string literals are protected. A `--` or `/*` inside a string literal (e.g. `SELECT 'a -- b'`) is treated as a comment and truncated, corrupting the literal and the subsequent validation.

**Fix.**
- In `validateSelectOnly`, protect string literals (`'…'`) and quoted identifiers (`` `…` ``) first by replacing them with null-char placeholders, strip comments, then restore the literals. The forbidden-keyword check (which already strips literals) is unchanged.

**Verification.**
- Existing `validateSelectOnly` tests (comment stripping, forbidden-keyword-in-literal) pass unchanged.
- Add a test: `SELECT 'a -- b' AS x` (line-comment marker inside a literal) is accepted and the literal survives intact; `SELECT 'a /* b */' AS x` likewise.

### L3 — Per-instance mock `callCounter`

**Problem.** `mock_client.ts:210` declares `let callCounter = 0` at module level. All `createMockClient()` instances share this counter, so tool-call ids (`mock_call_N`) are not isolated per client — tests that create multiple mock clients (or run in parallel) can interleave ids, and the counter grows unboundedly across the test process.

**Fix.**
- `packages/core/src/llm/mock_client.ts`: move `callCounter` inside `createMockClient` so each client instance has its own counter. The `mock_call_${callCounter}` id is now per-instance.

**Verification.** Existing mock-client tests (`client.test.ts`, `end_to_end.test.ts`) pass unchanged. The id format (`mock_call_N`) is preserved.

### L4 — Pie `Cell` duplicate-key fix

**Problem.** `ChartRenderer.tsx:149` renders pie `Cell`s with `key={String(row[xKey])}`. If two rows share the same `xKey` value (e.g. a category that appears twice), React gets duplicate keys and logs a warning; the fill color is already positional, so the key’s only job is uniqueness.

**Fix.**
- `apps/chat-app/src/components/ChartRenderer.tsx`: use the positional index as the key (`key={i}`). The pie data is static per render (no reorder animation), so index keys are safe.

**Verification.** Existing chart tests pass unchanged. Duplicate `xKey` rows no longer produce duplicate React keys.

### L5 — Shorten `maskKey` prefix to 4 chars

**Problem.** `maskKey` (`packages/core/src/llm/provider.ts:88-91`) shows 7 leading chars + 4 trailing chars (`sk-or-v…1234`). For short-ish keys the 7-char prefix leaks a meaningful chunk of the secret.

**Fix.**
- `packages/core/src/llm/provider.ts`: reduce the prefix to 4 chars (`key.slice(0, 4)`). Result: `sk-o…1234`. The `<= 8` → `****` short-key branch is unchanged.

**Verification.** Update `test/provider.test.ts` expectations from `sk-or-v…1234` → `sk-o…1234` (two assertions). The “never returns the full key” assertion still passes.

---

### L6 — Move `react`/`react-dom` to `dependencies`  *(approved, D3)*

**Problem.** `react`/`react-dom` are in `devDependencies` (root + workspace packages). Unusual for a shipped app, though harmless for a private, Vite-bundled repo.

**Fix.**
- Move `react`, `react-dom` (and `@types/react`, `@types/react-dom`) to `dependencies` at the root where they are actually consumed.

**Verification.** `pnpm install` + `pnpm build` + `pnpm test` green after the move.

---

---

### L7 — White-label leak: hardcoded "Naga City" in `packages/core`

**Problem.** `packages/core` is supposed to be brand-agnostic (it receives a `Dataset` descriptor from `@workspace/brand-config`), but "Naga City" is hardcoded in 3 places:

1. **`client.ts:22`** — `RUN_SELECT_TOOL_SPEC.description`: `"the CBMS Naga City DuckDB warehouse"`. Module-level constant, not parameterized. Goes into every LLM request as the `run_select` tool description for any brand. When brand #2 ships, its model is told it's querying "the CBMS Naga City warehouse" while the schema block says something else.
2. **`schema.ts:323`** — `buildSchemaBlock` header: `"the anonymized 2024 PSA CBMS sample for Naga City"`. Low-risk because `buildSchemaBlock()` already receives `dataset: Dataset`, and `Dataset.context` already carries the per-brand description. The header just wasn't derived from it.
3. **`mock_client.ts`** — canned demo answers reference "Naga City" / "2024 CBMS sample for Naga City". Only used by `test/` (never wired into the app), so it's a test fixture wearing a core costume.

**Why it matters now.** The whole point of `Dataset` is that `context` is the single source of truth for what the data is. Today the LLM gets two sources of truth: `dataset.context` (per-brand, correct) and the core's hardcoded strings (always Naga). For brand #1 they agree, so nothing visibly breaks — the bug is latent, and it will surface exactly when brand #2 is added per `data-aware-brand-deployment-spec.md`.

**Fix (D7 + D8).**
- `packages/brand-config/src/types.ts`: add `label: string` to the `Dataset` interface (new required field, with a doc comment: "Short display label for the dataset (e.g. 'CBMS Naga 2024'). Used in tool specs and schema headers.").
- `packages/brand-config/src/datasets/cbms.ts`: add `label: 'CBMS Naga 2024'` to `CBMS_DATASET`.
- `packages/core/src/llm/client.ts`: convert `RUN_SELECT_TOOL_SPEC` from a module-level constant to a factory `runSelectToolSpec(dataset: Dataset): ToolSpec`. The description becomes `"Run a single read-only SELECT query against the ${dataset.label} DuckDB warehouse ..."`. Thread `dataset` through `AskQuestionOptions` → `askQuestion` → the tool spec. The only call site is `askQuestion` line 131.
- `packages/core/src/llm/chat.ts`: thread `dataset` through `StreamQuestionOptions` → `streamQuestion` → `askQuestion`.
- `packages/core/src/schema.ts`: replace the hardcoded `"the anonymized 2024 PSA CBMS sample for Naga City"` header with `dataset.label` (e.g. `"DATA SCHEMA (DuckDB views over the ${dataset.label} sample)"`).
- `packages/core/src/llm/mock_client.ts`: move `MOCK_SCRIPTS`, `FALLBACK_ANSWER`, and `OFF_TOPIC_ANSWER` (the brand-specific canned answers) to a test fixture (e.g. `test/fixtures/mock-scripts.ts`). `mock_client.ts` keeps the generic `createMockClient(scripts)` factory and the `MockScript` type; brand-specific content moves to `test/`. Update test imports to use the fixture.

**Verification.**
- `grep -rn "Naga" packages/core/src/` returns no matches (or only in comments that are clearly generic).
- Typecheck passes (new `label` field on `Dataset`; all call sites updated).
- `test/client.test.ts` (which asserts on `RUN_SELECT_TOOL_SPEC`) is updated to use the factory and passes.
- All existing tests pass (including `end_to_end.test.ts` which uses `CBMS_DATASET` — it will now assert on brand-config content, which is the correct place).
- Build passes.

## Task table (this pass)

| # | Task | Severity | Files | Status |
|---|------|----------|-------|--------|
| H2 | Thread `AbortSignal` + Stop button (no timeout, D4) | High | `types.ts`, `client.ts`, `chat.ts` (core **and** app), `core/llm.ts`, `mock_client.ts`, test stubs, `hooks/use-chat.ts`, `App.tsx`, `packages/ui` Composer | Done |
| H3 | Terminate worker on init failure | High | `apps/chat-app/src/wasm/engine.ts` | Done |
| M1 | Add `eslint-plugin-react-hooks` | Medium | `package.json`, `eslint.config.js` | Done |
| M2 | `extractCallout` use `m.index` | Medium | `apps/chat-app/src/components/AnswerMarkdown.tsx` | Todo |
| M3 | Escape `LIKE` wildcards in `fuzzyRetrySql` | Medium | `packages/core/src/llm/chat.ts` | Todo |
| M4 | Remove dead `engineError` hook param | Medium | `use-chat.ts`, `App.tsx` | Todo |
| M5 | PII blocklist exact-match | Medium | `packages/core/src/data.ts` | Already resolved |
| L1a | Pursue COI duckdb build | Low | (decision only — no code) | Deferred (documented) |
| L1b | Warehouse loading progress indicator | Low | `ChatPanel.tsx` | Todo |
| L2 | Reorder SQL comment/literal stripping | Low | `packages/core/src/llm/sql_tool.ts` | Todo |
| L3 | Per-instance mock `callCounter` | Low | `packages/core/src/llm/mock_client.ts` | Todo |
| L4 | Pie `Cell` duplicate-key fix | Low | `apps/chat-app/src/components/ChartRenderer.tsx` | Todo |
| L5 | Shorten `maskKey` prefix to 4 chars | Low | `packages/core/src/llm/provider.ts` | Todo |
| L6 | Move react deps to `dependencies` | Low | `package.json` | Done |
| L7 | White-label leak: hardcoded "Naga City" in core | Low | `types.ts` (brand-config), `datasets/cbms.ts`, `client.ts`, `chat.ts`, `schema.ts`, `mock_client.ts`, `test/fixtures/` | Todo |

## Suggested order (this pass)

1. **H3** (leak, small)
2. **H2** (user-facing hang — the biggest real-world risk; largest change, own commit)
3. **M1** (lint safety net; resolve any newly-flagged violations)
4. **M2 / M3 / M4 / M5** (medium correctness/cleanups; M5 is already resolved — verify only)
5. **L2 / L3 / L4 / L5 / L1b / L6** (low polish + dep relocation; each small and independent)
6. **L7** (white-label leak — brand-agnostic core; touches 2 core files + 1 type + call sites + test fixture move)
7. **L1a** (deferred — documented; no code this pass)

## Acceptance (this pass)

- [x] H2: Stop button aborts an in-flight turn; `signal` forwarded to `fetch`; abort surfaces a clean error; unit + hook tests added
- [x] H3: worker `terminate()` called on init rejection; test added
- [x] M1: `pnpm lint` runs `react-hooks` rules with no new errors
- [ ] M2: `extractCallout` uses `m.index`; repeated-paragraph test added
- [ ] M3: `fuzzyRetrySql` escapes `%`/`_` with `ESCAPE '\\'`; test added
- [ ] M4: dead `engineError` hook param removed; typecheck/lint clean
- [x] M5: PII blocklist confirmed exact-match (no substring); no code change
- [ ] L1b: spinner shown while the warehouse boots
- [ ] L2: comment markers inside string literals are no longer stripped; test added
- [ ] L3: `callCounter` is per-instance
- [ ] L4: pie `Cell` keys use the index (no duplicate keys)
- [ ] L5: `maskKey` shows a 4-char prefix; `provider.test.ts` expectations updated
- [ ] L6: react deps moved; install/build/test green
- [ ] L7: no "Naga" in `packages/core/src/`; `Dataset.label` added; tool spec is a factory; mock scripts moved to test fixture; typecheck/tests/build green
- [x] L1a: written go/defer decision on COI with rationale (DEFER — see L1a section)

## Global acceptance

- [x] `pnpm typecheck` clean
- [x] `pnpm lint` clean
- [ ] `pnpm test` — all existing tests green **plus** the new unit tests from M2, M3, L2 (and the L5 expectation update)
- [ ] `pnpm build` green
- [x] No new dependencies added without approval (M1 is approved via D3; L1b reuses `lucide-react`, already a dependency)

---

## Deferred to a follow-up spec (D1)

Not done in this pass. Captured here so the next spec can pick them up.

| # | Task | Severity | Files |
|---|------|----------|-------|
| L1a | Re-evaluate COI duckdb build (deferred 2026-10-14: no compressed-size win, COI needs strict headers) | Low | `vite.config.ts`, `vercel.json`, `wasm/db.worker.ts` |

## Out of scope / decisions needed

- **H2 timeout** is explicitly **out of scope** (D4) — manual Stop only.
- **COI build (L1a)** is a build + deploy-header change; the go/defer decision is a required deliverable before touching `vite.config.ts`/`vercel.json`.
- **New dependencies:** only `eslint-plugin-react-hooks` (M1, approved via D3). L1b reuses `lucide-react` (already a dependency); the L6 relocation adds no dependency.
- The 36 MB engine download is inherent to duckdb-wasm; the COI build may reduce it, but no data-asset or schema changes are in scope here.
- No changes to bundled data assets, warehouse view shapes, or the read-only reference repo.
