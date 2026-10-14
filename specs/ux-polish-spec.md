# UX Polish Spec

**Status:** PLANNED
**Branch:** (TBD)
**Parent spec:** `code-review-fixes-spec.md` (all items Done/Deferred)

---

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Reading width cap | `max-w-3xl` (768px) on answer bubbles |
| D2 | Welcome screen | 3 demo question chips + "More" expandable for the rest |
| D3 | Thinking indicator | 3 phases (Thinking / Running query / Writing answer) + elapsed seconds |
| D4 | Error retry | "Try again" button re-sends last user message |
| D5 | Loading progress | Byte progress bar for parquet fetches + step labels |
| D6 | Table cells | Wrap text with `max-w-48` cap (remove `whitespace-nowrap`) |
| D7 | Pie chart guard | Auto-convert to bar chart when >10 categories |
| D8 | Cyber theme | Keep, move to "Experimental" section in Settings |

---

## Items

### U1 — Reading width cap

**Problem:** Long AI answers stretch edge-to-edge on wide desktop screens (1280px+), creating a wall of text. No max-width is applied to answer bubbles.

**Fix:**
- Add `max-w-3xl` (768px) to the assistant message bubble div in `ChatPanel.tsx` (the `bg-muted` container).
- User bubbles already have `ml-[12%]` offset; add `max-w-3xl` for consistency.
- The `max-w-3xl` should be on the inner content container, not the flex row, so charts/tables can still use full bubble width if needed. Actually — apply it to the bubble div itself so charts/tables are also capped at 768px (they're already in a `ResponsiveContainer` that adapts).

**Files:**
- `apps/chat-app/src/components/ChatPanel.tsx` — add `max-w-3xl` to assistant + user bubble divs

**Verification:**
- Render a long answer (>500 words) in a 1440px viewport; text column should be ~768px wide with margin on both sides.
- Charts and tables inside the bubble should not exceed 768px.

---

### U2 — Welcome screen with demo question chips

**Problem:** First-time visitors see one grey line of `BRAND.welcomeText` and an empty input. The 5 ready-made `Dataset.demoQuestions` are never rendered. No discoverability.

**Fix:**
- In `ChatPanel.tsx`, when `messages.length === 0 && !engineError && engine !== null`, render:
  1. `BRAND.welcomeText` (existing)
  2. A row of **3 clickable chips** (first 3 from `dataset.demoQuestions`)
  3. A "More" button that expands to show the remaining 2
- Chips are small pill buttons (`rounded-full border px-3 py-1.5 text-xs`) that call `onQuestion(question)` when clicked.
- `onQuestion` is a new prop threaded from `App.tsx` → `ChatPanel`. In `App.tsx`, it calls `send(question)` (the same path as typing + Enter).
- After the first message is sent, the welcome block disappears (existing `messages.length === 0` guard).

**Files:**
- `apps/chat-app/src/components/ChatPanel.tsx` — render chips + "More" expand
- `apps/chat-app/src/App.tsx` — pass `onQuestion` prop
- `packages/brand-config/src/types.ts` — (no change; `demoQuestions` already exists)

**Verification:**
- Fresh load (no messages): welcome text + 3 chips visible.
- Click a chip: message appears in chat, chips disappear.
- "More" expands to show all 5 chips.
- After first message sent: welcome block gone.

---

### U3 — Phase indicator with elapsed seconds

**Problem:** "Thinking… 12s" gives no insight into what the app is doing. The user can't tell if the LLM is composing SQL, the query is running, or the answer is being written.

**Fix:**
- Add a `phase` event to the `streamQuestion` generator alongside existing `token`/`error` events:
  ```ts
  type StreamEvent =
    | { type: 'phase'; phase: 'thinking' | 'querying' | 'writing' }
    | { type: 'token'; text: string }
    | { type: 'error'; message: string }
    | { type: 'done' };
  ```
- In `client.ts` (`askQuestion`):
  - Fire `phase: 'thinking'` before the first `client.chat()` call.
  - Fire `phase: 'querying'` before `execute(sql)`.
  - Fire `phase: 'writing'` before the second `client.chat()` call (or on first token if streaming).
- In `use-chat.ts`:
  - Track `phase` state (default `'thinking'`).
  - Update on `phase` events.
  - Expose `phase` in the message object (alongside `thinking: true`).
- In `ChatPanel.tsx` (`Thinking` component):
  - Accept `phase` prop.
  - Render label based on phase:
    - `thinking` → "Thinking…"
    - `querying` → "Running query…"
    - `writing` → "Writing answer…"
  - Keep the elapsed-seconds ticker (existing `setInterval`).
  - Format: `"Thinking… 3s"`, `"Running query… 1s"`, `"Writing answer… 2s"`.

**Files:**
- `packages/core/src/llm/types.ts` — add `phase` to stream event union (or keep events as-is and add a separate callback; see implementation note)
- `packages/core/src/llm/client.ts` — fire phase events around LLM calls and SQL execution
- `packages/core/src/llm/chat.ts` — pass phase events through `streamQuestion`
- `apps/chat-app/src/hooks/use-chat.ts` — track phase state
- `apps/chat-app/src/components/ChatPanel.tsx` — render phase label

**Implementation note:** The current `streamQuestion` yields `StreamQuestionEvent` objects. The simplest approach is to add a `phase` field to the existing event shape or add a new event type. The `askQuestion` function currently doesn't yield events — it returns a final `AskOutcome`. So the phase events need to be generated at the `streamQuestion` level, which wraps `askQuestion`. Alternative: add an `onPhase` callback to `AskQuestionOptions` and `StreamQuestionOptions`.

**Verification:**
- Send a question; observe "Thinking… 1s" → "Running query… 0s" → "Writing answer… 1s" → text streams in.
- Phase transitions are visible (querying phase may be <1s, that's fine).
- Elapsed seconds tick every second within each phase.

---

### U4 — "Try again" button on errors

**Problem:** When a query or LLM call fails, the error is shown as red text with no action. The user must re-type the question from scratch.

**Fix:**
- In `ChatPanel.tsx`, when `m.error` is true, render a "Try again" button below the error text.
- The button calls `onRetry(messageIndex)` — a new prop from `App.tsx`.
- In `App.tsx` / `use-chat.ts`:
  - `retry(messageIndex)`: find the last user message before the error, clear the error message, and re-invoke `send()` with that user message's content.
  - Simplest approach: store the last user message text in a ref; `retry()` calls `send(lastUserText)`.
- The error message is replaced (not appended) — the assistant message gets `error: null`, `thinking: true` again.

**Files:**
- `apps/chat-app/src/components/ChatPanel.tsx` — render "Try again" button
- `apps/chat-app/src/hooks/use-chat.ts` — add `retry()` callback
- `apps/chat-app/src/App.tsx` — pass `onRetry` prop

**Verification:**
- Force an error (e.g. invalid API key); see red error + "Try again" button.
- Click "Try again": error clears, thinking indicator appears, new attempt starts.
- If the new attempt also fails: new error shown, "Try again" available again.

---

### U5 — Loading progress bar

**Problem:** First load downloads ~9 MB of parquet files + ~36 MB WASM, showing only a static "Loading…" line. On slow connections, this is 30+ seconds of nothing moving.

**Fix:**
- **Step labels** (3 stages):
  1. "Downloading data…" (parquet fetches)
  2. "Starting database…" (WASM instantiation + view creation)
  3. "Ready" (brief, then transitions to chat)
- **Byte progress bar** during step 1:
  - The parquet files are fetched via `fetch()` in the browser. Use `ReadableStream` to track bytes received vs `Content-Length`.
  - Show a progress bar (thin, `h-1 rounded-full`) with percentage: "Downloading data… 6.2/9.0 MB (69%)".
  - If `Content-Length` is unavailable (some servers), fall back to indeterminate bar.
- **WASM step:** No progress callback from `duckdb-wasm`. Show indeterminate spinner + "Starting database…".
- **State flow in `use-chat.ts` or a new `use-warehouse` hook:**
  - `loadingState: { step: 'fetch' | 'init' | 'ready', bytesLoaded: number, bytesTotal: number }`
  - Expose to `ChatPanel` for rendering.

**Files:**
- `apps/chat-app/src/wasm/engine.ts` — expose fetch progress (bytes loaded/total) via callback
- `apps/chat-app/src/hooks/use-chat.ts` (or new hook) — track loading state
- `apps/chat-app/src/components/ChatPanel.tsx` — render progress bar + step label
- `apps/chat-app/src/App.tsx` — wire loading state

**Verification:**
- Hard-reload with network throttled (Chrome DevTools → 3G): progress bar fills as parquets download.
- Step label transitions: "Downloading data… 45%" → "Starting database…" → chat appears.
- No progress bar flicker; smooth updates (throttle to ~100ms).

---

### U6 — Table cell word-wrap

**Problem:** All table cells use `whitespace-nowrap`, so long text (reasons, addresses) creates unbreakable columns → horizontal scroll on narrow screens.

**Fix:**
- Remove `whitespace-nowrap` from table cells in:
  - `ResultTable.tsx` — header (`th`) and body (`td`) cells
  - `AnswerMarkdown.tsx` — `PlainTable` component (`th` and `td` cells)
- Add `max-w-48` (12rem ≈ 192px) + `break-words` to body cells (`td`) only. Headers can stay `whitespace-nowrap` (they're short column names).
- Long text wraps within the 12rem cap. Table stays compact, no horizontal scroll.

**Files:**
- `apps/chat-app/src/components/ResultTable.tsx` — remove `whitespace-nowrap` from `td`, add `max-w-48 break-words`
- `apps/chat-app/src/components/AnswerMarkdown.tsx` — same for `PlainTable` `td` cells

**Verification:**
- Render a table with a 200-char cell value; it wraps to ~4 lines within the 12rem cap.
- No horizontal scrollbar on the table container.
- Short cells (numbers, codes) are unaffected.

---

### U7 — Pie chart category guard

**Problem:** If the LLM's SQL returns 27 rows and it picks `pie`, you get 27 slices cycling through 5 colors. Unreadable.

**Fix:**
- In `ChartRenderer.tsx`, when `type === 'pie'` and `data.length > 10`:
  - Sort data by value descending.
  - Take top 9 slices.
  - Aggregate the rest into a single "Other" slice.
  - Render the pie with 10 slices max.
- Add a small caption below the chart: "Showing top 9 of 27 categories. See table for all."
- The raw data table (if shown) still has all 27 rows.

**Files:**
- `apps/chat-app/src/components/ChartRenderer.tsx` — add aggregation logic before `<Pie>` render

**Verification:**
- Feed a pie chart spec with 15 data points; render shows 10 slices (9 + "Other").
- Caption shows "Showing top 9 of 15 categories."
- Feed a pie chart with 8 data points; no aggregation, no caption.

---

### U8 — Cyber theme → Experimental section

**Problem:** The cyber/neon theme is presented as a normal theme option alongside Light and Dark. Inappropriate as a default for a government data app, but fun to keep.

**Fix:**
- In the Settings dialog (or theme picker), move "Cyber" to a separate "Experimental" section below the normal Light/Dark options.
- Add a subtle label: "Experimental — may be unstable or distracting".
- No functional change to the theme itself.

**Files:**
- `apps/chat-app/src/components/SettingsDialog.tsx` (or wherever the theme picker lives) — restructure theme list

**Verification:**
- Open Settings → theme picker shows Light, Dark, then a divider, then "Experimental" section with Cyber.
- Cyber theme still works when selected.

---

## Task table

| Task | Title | Effort | Status |
|------|-------|--------|--------|
| U1 | Reading width cap (`max-w-3xl`) | S | Pending |
| U2 | Welcome screen demo question chips | M | Pending |
| U3 | Phase indicator + elapsed seconds | M | Pending |
| U4 | "Try again" button on errors | S | Pending |
| U5 | Loading progress bar (byte progress + steps) | L | Pending |
| U6 | Table cell word-wrap (`max-w-48`) | S | Pending |
| U7 | Pie chart category guard (>10 → bar) | S | Pending |
| U8 | Cyber theme → Experimental section | S | Pending |

## Suggested order

1. U1 (reading width) — 1-line change, immediate visual win
2. U6 (table wrap) — 4-line change, fixes a real data-display bug
3. U7 (pie guard) — small, self-contained
4. U8 (cyber theme) — small, self-contained
5. U4 (retry button) — small, needs hook wiring
6. U2 (welcome chips) — medium, new prop + UI
7. U3 (phase indicator) — medium, touches core LLM chain
8. U5 (loading progress) — largest, touches fetch + state + UI

## Acceptance

- [ ] U1: Answer bubbles capped at 768px on wide viewports
- [ ] U2: 3 demo chips + "More" expand on welcome screen; chips send question on click
- [ ] U3: Three phase labels visible with elapsed seconds during a query
- [ ] U4: "Try again" button appears on errors; re-sends last user message
- [ ] U5: Byte progress bar during parquet download; step labels for all 3 stages
- [ ] U6: Long table cells wrap at 12rem; no horizontal scroll
- [ ] U7: Pie charts with >10 categories aggregate to top 9 + "Other"
- [ ] U8: Cyber theme in "Experimental" section of Settings
