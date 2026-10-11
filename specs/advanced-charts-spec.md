# Feature Spec — Advanced Charts (Recharts)

**Status:** complete (P1–P4; all 138 tests + lint + build green)
**Date:** 2026-10-08
**Parent spec:** `browser-only-spec.md` (complete; this is a follow-on feature)
**Branch:** `feat/advanced-charts`

## Goal

Add **rich, real charts** to chat answers, beyond the current hand-rolled CSS
comparison bars. The LLM expresses charts through a dedicated **`make_chart`
tool call** carrying a small, validated **`ChartSpec`**, rendered by
**[Recharts](https://recharts.org)** (React-native SVG, themed via CSS custom
properties). Charts render **inline, after the narrative text**, visible by
default.

This complements — not replaces — the existing 2-column-table → CSS-bars path
and the "Show SQL / Raw rows" debug sections.

## Decisions (from 2026-10-08 planning Q&A)

| # | Decision |
|---|---|
| C1 | **Dedicated `make_chart` tool** in the driver-free core, registered alongside `run_select`. Declarative (no engine access); it validates + records a `ChartSpec` and confirms back to the LLM. |
| C2 | **Recharts** for rendering (React-native SVG, themable via CSS vars, ~110 KB gzip). |
| C3 | **Full chart set:** `bar` (incl. grouped/stacked via multi-series), `line`, `area`, `pie`, `scatter`. |
| C4 | **Inline, after the narrative text**, visible by default (not behind "Show SQL"). |
| C5 | **Reveal when the answer finishes** — charts render after the final text streams in (the tool phase precedes the text). |
| C6 | **LLM curates the data** — it passes the numbers it already computed via `run_select`, aggregated to ≤ ~20 points (prompt guidance); hard cap `MAX_CHART_POINTS = 50` in validation. |
| C7 | **Contracts** (ChartSpec, validation, tool spec, prompt wording) agreed with "reasonable defaults" for the minor open fields. |
| C8 | Existing CSS comparison bars **kept** (they coexist; the LLM chooses via the prompt). |

## The `make_chart` contract

### `ChartSpec` (`src/llm/chart.ts`)

```ts
export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'scatter';

export interface ChartSpec {
  type: ChartType;
  title?: string;
  /** Data rows; each is an object keyed by column name. Capped at MAX_CHART_POINTS. */
  data: Array<Record<string, string | number>>;
  /** Label/category column (bar/line/area/pie) or numeric x-axis (scatter).
   *  Defaults: 'name' (bar/line/area/pie), 'x' (scatter). */
  xKey?: string;
  /** Numeric value columns (one per series).
   *  bar/line/area: required (multi-series when > 1).
   *  pie: the value column. scatter: the y-axis column.
   *  Defaults: 'value' (pie), 'y' (scatter). */
  series?: string[];
  /** Multi-series bar: stacked (true) vs grouped (false, default). */
  stacked?: boolean;
}
```

### Validation (`validateChartSpec(raw): ChartSpec` — throws `ChartSpecError`)

1. `type` ∈ {`bar`, `line`, `area`, `pie`, `scatter`}.
2. `data` is a non-empty array of objects, length ≤ `MAX_CHART_POINTS` (**50**).
3. `xKey` and every `series` key present on every row.
4. `series` must not be coordinate/identifier columns (`lat`/`lon`/`latitude`/`longitude`/`psgc_code`, case-insensitive — the shared `NON_METRIC_COLUMNS` set in `src/data.ts`); they are not plottable metrics.
5. `series` values are finite numbers (numeric strings coerced; non-numeric rejected).
6. bar/line/area → `series` non-empty; pie → `series` length 1; scatter → `series` length ≥ 1.
7. Defaults (`xKey`, `series`) are filled in so the renderer receives a fully-resolved spec.

### Tool spec (`MAKE_CHART_TOOL_SPEC`)

```ts
export const MAKE_CHART_TOOL_NAME = 'make_chart';
export const MAKE_CHART_TOOL_SPEC: ToolSpec = {
  type: 'function',
  function: {
    name: 'make_chart',
    description:
      'Create a chart to visualize data you already computed with run_select. ' +
      'It renders in the answer. Use for rankings, comparisons, trends, share/breakdowns, ' +
      'and correlations. Aggregate to at most ~20 data points first.',
    parameters: {
      type: 'object',
      properties: {
        type:    { type: 'string', enum: ['bar', 'line', 'area', 'pie', 'scatter'] },
        title:   { type: 'string', description: 'Short heading for the chart.' },
        data:    { type: 'array', items: { type: 'object' }, description: 'Rows; each is an object keyed by column name.' },
        xKey:    { type: 'string', description: 'Label/category column (numeric x-axis for scatter).' },
        series:  { type: 'array', items: { type: 'string' }, description: 'Numeric value columns (one per series); pie value column; scatter y-axis column.' },
        stacked: { type: 'boolean', description: 'Stack multi-series bars (default false = grouped).' },
      },
      required: ['type', 'data'],
    },
  },
};
```

Tool result back to the LLM: `{"status":"ok","chart_id":n}` on success,
`{"error":"..."}` on a validation failure (so it can retry).

### Prompt (`src/llm/prompts.ts` → ANSWER_STYLE)

Replacing current rules 3 & 6 (which pin charts to the 2-column table):

> 3. Simple comparison: a 2-column `Thing | Value` table (up to ~5 rows, plain numeric values) renders as compact bars.
> 4. Richer visuals: call `make_chart` for rankings, comparisons, trends, share/breakdowns, and correlations. Pass the data you computed with `run_select` (aggregate to at most ~20 points). Pick the type that fits — bar for rankings/comparisons, pie for share-of-total, line/area for trends, scatter for correlations — and give it a short title.
> 6. Keep it short. For the same numbers, use a chart **or** a table — don't show them as both.
> 7. Never draw charts with ASCII art, code fences, emoji, or mermaid.

(Rules 1, 2, 5 stay unchanged.)

## Components

### Core (driver-free, `src/llm/chart.ts`)

- `ChartType`, `ChartSpec`, `ChartSpecError`.
- `MAX_CHART_POINTS = 50`.
- `validateChartSpec(raw: unknown): ChartSpec` (rules above; returns a fully-resolved spec).
- `MAKE_CHART_TOOL_NAME`, `MAKE_CHART_TOOL_SPEC: ToolSpec`.

### Tool loop (`src/llm/client.ts`)

- Register `[RUN_SELECT_TOOL_SPEC, MAKE_CHART_TOOL_SPEC]`.
- In the tool-call loop, branch on `tc.name`:
  - `run_select` → existing path.
  - `make_chart` → `validateChartSpec(JSON.parse(tc.arguments))`; push the resolved
    spec to `chartCalls`; reply `{"status":"ok","chart_id":n}` (or `{"error":...}`).
- `AskOutcome` gains `chartCalls: ChartSpec[]` (populated on **both** the normal
  and the max-rounds forced-answer return paths).

### Event stream (`src/llm/chat.ts`)

- `ChatEvent` gains `{ type: 'chart'; n: number; spec: ChartSpec }`.
- `streamQuestion` yields one `chart` event per entry in `chartCalls` (after the
  `sql`/`rows` events, before the `token` chunks — matches C5).
- `web/src/core/chat.ts` re-exports `ChatEvent` unchanged (the new variant flows
  through automatically).

### UI (`web/src/components/ChartBlock.tsx` — new)

- Renders one `ChartSpec` via Recharts: `ResponsiveContainer` + the right
  component per type (`BarChart`/`LineChart`/`AreaChart`/`PieChart`/`ScatterChart`).
- Multi-series → multiple `<Bar>`/`<Line>`/`<Area>` children; `stacked` →
  `stacked` prop on `<Bar>`. Pie → `<Pie>` with a `<Cell>` per slice. Scatter →
  `<Scatter>` with `x`/`y`.
- **Theming:** axis/tooltip/cursor/tick colors read CSS custom properties
  (`var(--ink)`, `var(--muted)`, `var(--border)`, `var(--accent)`), so
  light/dark flips with the existing `theme.ts`.
- Optional `<title>` heading + a small caption; a scrollable/max-height container.
- **Graceful degradation:** an unresolvable spec (shouldn't happen post-validation)
  falls back to a plain table of `data`, never a blank box.

### ChatPanel (`web/src/components/ChatPanel.tsx`)

- Assistant message gains `charts: { n: number; spec: ChartSpec }[]`.
- `handleEvent` appends on `chart` events.
- Renders `<ChartBlock>` for each chart **after** the `AnswerMarkdown` text and
  **before** the "Show SQL / Raw rows" sections (visible by default, C4/C5).

### Prompt (`src/llm/prompts.ts`)

- Update ANSWER_STYLE rules 3 & 6 (and add 7) as above.

## Constraints

- **One new dependency:** `recharts`. This is the sole `package.json` change
  (rule-gated — confirmed in planning). No `web/vite.config.ts` change.
- No `node:` imports in `src/llm/chart.ts` (driver-free; imported by `web/` and Node tests).
- SQL guardrails, PII allowlists, and warehouse view shapes are **unchanged** —
  `make_chart` never touches the engine or runs SQL.
- Charts read only data the LLM already produced; they never query themselves.

## Task breakdown

Each task is independently verifiable (its own tests); phases P1–P4 are each
independently shippable. Every task keeps `npm test` + `npm run lint` green.

### P1 — Contract + core
- **T1.1** Add `src/llm/chart.ts` types: `ChartType`, `ChartSpec`, `ChartSpecError`,
  `MAX_CHART_POINTS = 50`. *Done:* module compiles, exports present, no `node:` imports.
- **T1.2** Implement `validateChartSpec(raw: unknown): ChartSpec` (all 6 rules + defaults).
  *Done:* each type resolves; numeric strings coerced; throws `ChartSpecError` with a clear
  message on bad type / empty data / over-cap / missing keys / non-numeric; defaults filled.
- **T1.3** Add `MAKE_CHART_TOOL_NAME` + `MAKE_CHART_TOOL_SPEC: ToolSpec`.
  *Done:* matches the agreed JSON; `parameters` is a valid JSON-Schema object.
- **T1.4** `test/chart.test.ts` — validation matrix + tool-spec shape.
  *Done:* covers every type, the cap, coercion, missing keys, non-numeric, empty data, and
  default application; all green.

### P2 — Tool loop
- **T2.1** Register `MAKE_CHART_TOOL_SPEC` in `askQuestion` (the `client.chat` call uses
  `[RUN_SELECT_TOOL_SPEC, MAKE_CHART_TOOL_SPEC]`). *Done:* both tools offered each round.
- **T2.2** Branch on `tc.name` in the loop: `make_chart` → validate + record + reply
  `ok`/`error`; unknown name → `error` tool result (defensive). *Done:* `run_select` path
  unchanged; `make_chart` handled.
- **T2.3** Add `chartCalls: ChartSpec[]` to `AskOutcome`; populate on **both** the normal
  and the max-rounds forced-answer return paths. *Done:* charts survive the forced path too.
- **T2.4** Add `{ type: 'chart'; n: number; spec: ChartSpec }` to `ChatEvent`; yield one per
  chart in `streamQuestion` (after `sql`/`rows`, before `token`). *Done:* event order correct.
- **T2.5** `test/client.test.ts` — a `make_chart` call is recorded + returned in
  `chartCalls`; a bad spec is fed back as an `error` tool result. *Done:* green; existing
  `run_select` tests unaffected.
- **T2.6** `web/src/core/chat.test.ts` — a `chart` event is yielded for a chart call.
  *Done:* green.

### P3 — Renderer
- **T3.1** `ChartBlock.tsx` scaffold: props, `ResponsiveContainer`, title, container, and
  theme colors. *Done:* colors follow the active theme via a `theme` prop (a JS palette that
  mirrors the CSS custom properties — SVG paint attributes can't use `var()`, and the prop
  keeps the component testable under react-test-renderer). Empty container renders + themes.
  The Recharts renderer is **code-split** into `ChartRenderer.tsx` and loaded on demand
  (`React.lazy` + dynamic `import()`), so Recharts is not in the main bundle — see the
  bundle-size note in Open items.
- **T3.2** Implement all five chart types + multi-series + `stacked`. *Done:* bar (grouped +
  stacked), line, area, pie, scatter each render from a resolved spec.
- **T3.3** Fallback: an unresolvable spec renders a plain table of `data` (never a blank box).
  *Done:* fallback path exercised.
- **T3.4** `web/src/components/ChartBlock.test.tsx`. *Done:* each type renders; multi-series;
  stacked; scatter; fallback — all green.

### P4 — Wiring + prompt
- **T4.1** `ChatPanel`: assistant message gains `charts[]` + a `done` flag; `handleEvent`
  appends on `chart`; render `<ChartBlock>` after the `AnswerMarkdown` text, before the
  SQL/raw-rows sections, **gated on the `done` flag** (charts appear once the answer text
  finishes). `ChatPanel` gains a `theme` prop (default `'light'`) forwarded to `ChartBlock`.
  *Done:* charts visible by default, in creation order, after the text finishes.
- **T4.2** Update `ANSWER_STYLE` (rules 3, 4, 6, 7). *Done:* prompt matches the spec section.
- **T4.3** `web/src/styles.css` chart styles (container, title, caption), themed.
  *Done:* light + dark both correct.
- **T4.4** `web/src/components/ChatPanel.test.tsx` — charts render from `chart` events.
  *Done:* green.
- **T4.5** *(optional — skipped)* demo-question chip + scripted `make_chart` emission in
  `src/llm/mock_client.ts`. *Skipped:* the chart pipeline is already covered end-to-end by
  `ChartStubLlm` (a `make_chart`-emitting `LLMClient` in `web/src/testStubs.ts`) in the
  `ChatPanel` integration test, the `client.test.ts` tool-loop tests, and the `ChartBlock`
  smoke tests. `mock_client.ts` is test-only and unused by the UI, so no emission is needed.

## Testing

- **Unit (pure, Node):** `validateChartSpec` matrix + tool-spec shape.
- **Tool loop (Node):** `make_chart` recorded + returned; validation error fed back.
- **Component (react-test-renderer):** `ChartBlock` per type, multi-series, stacked,
  scatter, and the plain-table fallback.
- **Integration (React):** `ChatPanel` renders charts from the event stream.
- Full gate: `npm test` + `npm run lint` green before each phase closes.

## Open items (resolved at completion)

- `ChartBlock` height / responsiveness: fixed `CHART_HEIGHT = 280` with a 100%-width
  `ResponsiveContainer` — the chart scales to the narrow chat column and stays 280px tall.
- Per-chart "view data" toggle: **not added** (out of scope); the spec's plain-table
  fallback already covers the "see the raw rows" case for an unresolvable spec.
- Recharts bundle size: **code-split** — `ChartBlock` loads the Recharts renderer via
  `React.lazy` + dynamic `import()`, so Recharts lands in its own on-demand chunk
  (`ChartRenderer-*.js`, ~446 KB / ~126 KB gzip) and the main chunk stays under the 500 KB
  warning threshold (~495 KB / ~135 KB gzip). The chart chunk is fetched only when a chart
  first renders, so the initial page load is lighter. (`web/vite.config.ts` is on the
  never-modify list, so `manualChunks` / `chunkSizeWarningLimit` were not options — source-
  level code-splitting was the fix.)
