# Code Review Fixes

**Status:** DRAFT — planning only, nothing implemented
**Date:** 2026-10-14
**Source:** Senior code review of the current tree (typecheck ✅, lint ✅, 205/205 tests ✅, build ✅)
**Branch:** `fix/code-review`

This spec turns the code review into a concrete, ordered plan. It is a **plan, not an implementation** — no source files are touched until this is approved and picked up.

Each in-scope item lists the **problem**, the **fix** (with exact files), and the **test/verification** that proves it. Task IDs (H1, M1, …) are stable references for the task table and acceptance list.

---

## Decisions (2026-10-14)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Scope of this pass | **High severity (H2–H3) + the three explicitly-approved gated items (M1, L1a, L6).** All other Medium/Low items are deferred to a follow-up spec. H1 was **retracted** after re-verification (see note under High severity). |
| D2 | COI duckdb build (L1a) | **Investigate + pursue COI now.** Confirm Vercel can serve the required headers; switch if it's a clear win. |
| D3 | Dependencies (M1, L6) | **Add `eslint-plugin-react-hooks` (M1) and move `react`/`react-dom` to `dependencies` (L6).** Both approved per project invariants. |
| D4 | H2 cancellation | **Stop button only — no automatic first-response timeout.** The user aborts hangs manually. |
| D5 | H2 — partial answer on Stop | **Keep the partial in-flight answer** in place (do not clear the message). |
| D6 | H2 — Stop control presentation | The composer's **send button morphs into a Stop button** while `busy`. |

## Scope for this pass

**In scope (5 items):** H2, H3, M1, L1a, L6 — see each section below.
**Deferred to follow-up spec:** M2, M3, M4, M5 (Medium) and L1b, L2, L3, L4, L5 (Low). These are captured in the *Deferred* section at the bottom for the next spec; they are **not** done in this pass.
**Retracted:** H1 — the original finding was based on stale review notes; the current code is already correct (see note).

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

## In-scope gated items (approved by D2/D3)

### M1 — Add `eslint-plugin-react-hooks`  *(approved, D3)*

**Problem.** `eslint.config.js` only configures `@typescript-eslint`. Several effects rely on deliberate, non-obvious dependency choices (`LeafletBarangayMap.tsx` init effect omits `model`/`selectedCode`/`fillOpacity`/`palette` and is paired with a second restyle effect; `use-chat.ts` closures keyed on `messages.length`). All correct today, but a stale-closure regression would go undetected.

**Fix.**
- Add `eslint-plugin-react-hooks` as a devDependency (approved by D3).
- `eslint.config.js`: register the plugin and enable `react-hooks/exhaustive-deps` (start at `warn` to avoid blocking, promote to `error` once clean).
- Resolve any newly-flagged existing violations (add the missing deps, or add a targeted `// eslint-disable-next-line` with a rationale comment where the omission is intentional).

**Verification.** `pnpm lint` runs the hook rules; no new errors.

---

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

The dominant first-load cost is the ~7.7 MB wasm regardless of build. Keeping the EH build is the lower-risk choice. Recorded in *Deferred* for a follow-up spec.

---

### L6 — Move `react`/`react-dom` to `dependencies`  *(approved, D3)*

**Problem.** `react`/`react-dom` are in `devDependencies` (root + workspace packages). Unusual for a shipped app, though harmless for a private, Vite-bundled repo.

**Fix.**
- Move `react`, `react-dom` (and `@types/react`, `@types/react-dom`) to `dependencies` at the root where they are actually consumed.

**Verification.** `pnpm install` + `pnpm build` + `pnpm test` green after the move.

---

## Task table (this pass)

| # | Task | Severity | Files | Status |
|---|------|----------|-------|--------|
| H2 | Thread `AbortSignal` + Stop button (no timeout, D4) | High | `types.ts`, `client.ts`, `chat.ts` (core **and** app), `core/llm.ts`, `mock_client.ts`, test stubs, `hooks/use-chat.ts`, `App.tsx`, `packages/ui` Composer | Done |
| H3 | Terminate worker on init failure | High | `apps/chat-app/src/wasm/engine.ts` | Done |
| M1 | Add `eslint-plugin-react-hooks` (D3) | Medium | `package.json`, `eslint.config.js` | Done |
| L1a | Pursue COI duckdb build (D2) | Low | (decision only — no code) | Deferred (documented) |
| L6 | Move react deps to `dependencies` (D3) | Low | `package.json` | Done |

## Suggested order (this pass)

1. **H3** (leak, small)
2. **H2** (user-facing hang — the biggest real-world risk; largest change, own commit)
3. **M1** (lint safety net; resolve any newly-flagged violations)
4. **L6** (dep relocation; quick)
5. **L1a** (investigate → decide → implement if clear win; may end as a documented deferral)

## Acceptance (this pass)

- [x] H2: Stop button aborts an in-flight turn; `signal` forwarded to `fetch`; abort surfaces a clean error; unit + hook tests added
- [x] H3: worker `terminate()` called on init rejection; test added
- [x] M1: `pnpm lint` runs `react-hooks` rules with no new errors
- [x] L1a: written go/defer decision on COI with rationale (DEFER — see L1a section)
- [x] L6: react deps moved; install/build/test green

## Global acceptance

- [x] `pnpm typecheck` clean
- [x] `pnpm lint` clean
- [x] `pnpm test` — all existing tests green **plus** the new unit/hook tests from H2 and H3 (209 passing)
- [x] `pnpm build` green
- [x] No new dependencies added without approval (M1 and L6 are approved via D3)

---

## Deferred to a follow-up spec (D1)

Not done in this pass. Captured here so the next spec can pick them up.

| # | Task | Severity | Files |
|---|------|----------|-------|
| L1a | Re-evaluate COI duckdb build (deferred 2026-10-14: no compressed-size win, COI needs strict headers) | Low | `vite.config.ts`, `vercel.json`, `wasm/db.worker.ts` |
| M2 | `extractCallout` use `m.index` instead of `indexOf` | Medium | `apps/chat-app/src/components/AnswerMarkdown.tsx` |
| M3 | Escape `LIKE` wildcards in `fuzzyRetrySql` | Medium | `packages/core/src/llm/chat.ts` |
| M4 | Remove dead `engineError` hook param | Medium | `use-chat.ts`, `App.tsx` |
| M5 | Exact-match PII blocklist (vs substring) | Medium | `packages/core/src/data.ts` |
| L1b | Warehouse loading progress indicator | Low | `App.tsx` |
| L2 | Reorder SQL comment/literal stripping in `sql_tool.ts` | Low | `packages/core/src/llm/sql_tool.ts` |
| L3 | Per-instance mock `callCounter` | Low | `packages/core/src/llm/mock_client.ts` |
| L4 | Pie `Cell` duplicate-key fix | Low | `apps/chat-app/src/components/ChartRenderer.tsx` |
| L5 | Shorten `maskKey` to 4 chars | Low | `apps/chat-app/src/components/SettingsDialog.tsx` |

## Out of scope / decisions needed

- **H2 timeout** is explicitly **out of scope** (D4) — manual Stop only.
- **COI build (L1a)** is a build + deploy-header change; the go/defer decision is a required deliverable before touching `vite.config.ts`/`vercel.json`.
- **New dependencies** (`eslint-plugin-react-hooks` via M1, and the L6 relocation) are **approved** via D3.
- The 36 MB engine download is inherent to duckdb-wasm; the COI build may reduce it, but no data-asset or schema changes are in scope here.
- No changes to bundled data assets, warehouse view shapes, or the read-only reference repo.
