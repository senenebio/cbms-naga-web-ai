# Monorepo + White-Label Chat UI Spec

**Status: COMPLETE — Phase A–E implemented**

Restructure this repository (in place) into a **pnpm-workspace monorepo** with a
white-label, hyper-minimalist chat UI built on **React 19 + Vite + Tailwind CSS v4 +
shadcn/ui**. The existing CBMS app (DuckDB-wasm, BYOK LLM, charts, maps) is preserved
as **brand #1** of a generic white-label chat platform. No Turbo/Nx — native pnpm
workspaces only.

## Decisions (planning conversation)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scope | In-place restructure; CBMS = brand #1 of a generic white-label chat |
| 2 | Workspaces | **pnpm** (native workspaces, no Turbo/Nx) |
| 3 | Brand selection | **Build-time** (app imports its brand at build; CSS variables for instant theme/dark flips) |
| 4 | Settings surface | Gear → shadcn **DropdownMenu** (model, temperature, license/version); existing BYOK dialog kept, reachable from the dropdown as a "Connection…" item |
| 5 | React | Upgrade **18 → 19** (requires replacing `react-test-renderer` with `@testing-library/react`) |

## Hard constraints (unchanged invariants)

- All LLM SQL still goes through `runSelect` — guardrails, PII allowlists, view shapes
  untouched (see [GUARDRAILS.md](../docs/GUARDRAILS.md), [DATA-ASSETS.md](../docs/DATA-ASSETS.md)).
- No runtime server, no `/api` proxy.
- Bundled data assets (`data/`) and the `prebuild` copy step semantics unchanged.
- `npm test` → `pnpm test` stays green at the end of every phase.
- Approved new dependencies (this spec is the "ask first" sign-off): `tailwindcss`,
  `@tailwindcss/vite`, `tw-animate-css`, `class-variance-authority`, `clsx`,
  `tailwind-merge`, `lucide-react`, `@radix-ui/*` (via shadcn adds),
  `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, and the React 19
  bumps (`react`, `react-dom`, `@types/react`, `@types/react-dom`).

## 1. Workspace structure

```
/                          (repo root)
├── pnpm-workspace.yaml        # packages: apps/*, packages/*
├── package.json               # root: scripts + dev tooling (eslint, prettier, ts, vitest)
├── tsconfig.json              # root: shared compiler options + references
├── vitest.config.ts           # root: runs tests across workspaces
├── eslint.config.js
├── apps/
│   └── chat-app/              # the client-facing Vite SPA (was web/)
│       ├── components.json    # shadcn config (aliases → @workspace/ui)
│       ├── vite.config.ts
│       ├── index.html
│       ├── public/data/       # build-generated (gitignored)
│       └── src/
│           ├── main.tsx       # picks brand (build-time) + applies theme/brand
│           ├── app/           # page composition (single chat route)
│           ├── core/          # chat/llm/provider core (moved from web/src/core)
│           ├── wasm/          # duckdb-wasm worker
│           └── components/    # app-specific: AnswerMarkdown, ChartBlock, maps…
├── packages/
│   ├── ui/                    # shared component workshop
│   │   ├── components.json    # shadcn config (style/baseColor must match app)
│   │   ├── package.json       # name: @workspace/ui
│   │   └── src/
│   │       ├── components/    # shadcn primitives (button, textarea, scroll-area,
│   │       │                  #   dropdown-menu, dialog, slider, select…)
│   │       │                  # + ChatLayout, Composer, SettingsMenu, Bubble…
│   │       ├── hooks/         # useAutoResize, useTheme
│   │       ├── lib/           # cn() utility
│   │       └── styles/        # globals.css (Tailwind v4 entry, @theme inline, tokens)
│   └── brand-config/          # shared configuration package
│       ├── package.json       # name: @workspace/brand-config
│       └── src/
│           ├── types.ts       # Brand type
│           ├── brands/        # one file per brand (cbms.ts, …)
│           ├── index.ts       # BRANDS record + applyBrand()
│           └── (no CSS files — colors are TS values applied to CSS variables)
├── src/                       # driver-free core (unchanged: llm/, map/, data.ts…)
├── data/                      # source assets (unchanged)
└── specs/
```

- **Source-only packages.** `@workspace/ui` and `@workspace/brand-config` export raw
  TS/TSX; the app's Vite compiles them. No per-package build step, no `dist/`, no
  bundling config. Package `main`/`exports` point at `src/index.ts`.
- **Vite alias:** `@workspace/ui` → `packages/ui/src` (and `@workspace/brand-config`)
  so imports and CSS (`globals.css`) resolve cleanly in dev and build.
- **Routing:** single chat route for v1 — **no router library**. `app/` is structured
  so a router can be added later without churn.
- **shadcn monorepo setup:** use `pnpm dlx shadcn@latest init` conventions per the
  official monorepo guide — one `components.json` in each workspace, identical
  `style`/`iconLibrary`/`baseColor`, `tailwind.config` left empty (v4), aliases per
  the guide (`ui: @workspace/ui/components`, `utils: @workspace/ui/lib/utils`, …).
  Components are added with `pnpm dlx shadcn@latest add <component>` run from
  `apps/chat-app` so the CLI files them into `packages/ui`.
- Root scripts (replace npm equivalents): `dev` → `vite apps/chat-app`, `build`
  (with `prebuild` data copy), `test`, `typecheck`, `lint`, `format`.

## 2. Responsive chat layout (packages/ui)

- **`ChatLayout`** = master layout wrapper:
  - Full-viewport height via **`h-dvh`** (dynamic viewport units) so the composer is
    never hidden behind mobile Safari/Chrome URL bars; `min-h-0` on the scroll region.
  - Header row: brand name (left) + **settings gear** (right).
  - Chat feed: **centered, `max-w-2xl`**, full-height `ScrollArea`, auto-scroll to
    bottom on new tokens, `overscroll-behavior: contain`.
  - Composer row pinned to bottom inside the layout (never in a fixed position).
- Desktop: feed stays in a centered column with breathing room. Mobile: same
  column, safe-area padding (`env(safe-area-inset-bottom)`) on the composer.

## 3. Auto-growing Textarea (packages/ui)

- **`Composer`** wraps shadcn `Textarea` with a **`useAutoResize`** hook:
  - `useRef` on the textarea; on change/`useEffect`, measure `scrollHeight`,
    set `style.height = min(scrollHeight, 160)px`.
  - **Cap at 160px**; beyond that the textarea scrolls internally
    (`overflow-y: auto`).
  - CSS: `resize: none` (kills the browser drag handle), `overflow-hidden` until
    the cap is hit.
  - **Enter submits; Shift+Enter inserts a newline** (`onKeyDown` checks
    `e.key === 'Enter' && !e.shiftKey`).
  - Resets to auto height (single line) after submit.
  - Disabled while a response is streaming (submit button → stop/ignore).

## 4. Brand configuration (packages/brand-config)

- **Type:**
  ```ts
  export interface Brand {
    id: string;            // 'cbms'
    name: string;          // shown in header
    welcomeText: string;   // shown above the first message
    version: string;       // shown in settings footer
    license: string;       // e.g. 'CC BY-NC 4.0' — shown in settings footer
    colors: {
      primary: string;     // hex — user bubbles + accents
      primaryForeground: string;
      // (bot bubbles are intentionally neutral — no per-brand variable)
    };
  }
  export const BRANDS: Record<string, Brand>;   // { cbms: … }
  ```
- **`applyBrand(brand)`** writes CSS custom properties onto `:root`
  (`--brand-primary`, `--brand-primary-foreground`) and `document.title`.
  Tailwind maps them in `globals.css` via `@theme inline`
  (`--color-brand-primary: var(--brand-primary)`), so a swap is a pure CSS-variable
  repaint — **no re-render, no flash** (relevant if a runtime switch is added later).
- **Build-time selection:** `apps/chat-app/src/main.tsx` does
  `applyBrand(BRANDS.cbms)`. Adding a brand = new file in `brands/` + one import.
  No runtime brand picker in v1.
- Bubble colors (see §6): user = `bg-brand-primary text-brand-primary-foreground`;
  assistant = `bg-muted` (neutral gray in both modes).

## 5. Settings menu (packages/ui → `SettingsMenu`)

- **Gear icon** (`lucide-react` `Settings`) top-right of the `ChatLayout` header,
  subtle (ghost icon button).
- Opens a shadcn **`DropdownMenu`** (anchored bottom-right of the trigger):
  1. **Model selector** — shadcn `Select` with a curated list of common model IDs
     (e.g. `gpt-4o`, `claude-sonnet-4`, …) + "custom" free entry handled in the
     Connection dialog. Selection persists in `localStorage` and is passed to the
     LLM request.
  2. **Temperature slider** — shadcn `Slider`, 0–2, step 0.1, default 0.7.
     Persists in `localStorage`; **new wiring**: the LLM client gains a `temperature`
     field on the request body (currently not sent at all).
  3. **Footer** (separated): brand name + version + license from
     `@workspace/brand-config`, plus a **"Connection…"** item that opens the
     existing BYOK `Dialog` (Base URL / API key / Model / Test) — unchanged in
     behavior, restyled to shadcn.
- The old standalone settings trigger in the header is removed; the dropdown is the
  single entry point.

## 6. Styling baseline (Tailwind v4 + shadcn tokens)

- **Tailwind v4** via `@tailwindcss/vite`; single CSS entry
  `packages/ui/src/styles/globals.css` imported by the app. `@import "tailwindcss";`
  + `@import "tw-animate-css";` + `@theme inline` mapping shadcn tokens to
  CSS variables. No `tailwind.config.js`.
- **Dark mode:** shadcn class strategy — `.dark` on `<html>`. Existing `theme.ts`
  logic (localStorage `cbms-theme` → system preference → light) is kept, but
  switches from `data-theme` attribute to `classList.toggle('dark')`.
- **Colors:**
  - Assistant bubbles: `bg-muted` — neutral gray, identical in light/dark.
  - User bubbles: `bg-brand-primary` / `text-brand-primary-foreground`.
  - Base color: `neutral` (shadcn default).
- **Removal:** `web/src/styles.css` (hand-rolled CSS) is deleted once all
  components are restyled; no dual CSS systems.
- Both modes must be verified for: chat feed, composer, dropdown, dialog, charts
  (recharts theming follows `dark` class via CSS variables), tables, maps.

## 7. React 19 upgrade

- `react`/`react-dom` → 19, `@types/react` → 19.
- **`react-test-renderer` is not supported on React 19** → migrate all component
  tests to `@testing-library/react` (+ `@testing-library/jest-dom`, jsdom
  environment). This replaces the current `react-test-renderer` devDependency and
  `testStubs.ts` render helpers.
- `react-markdown`, `recharts`, `leaflet` compatibility check during migration
  (recharts v3 supports React 19; react-markdown v9 fine).

## 8. Testing strategy

- Root `vitest.config.ts` runs unit tests across `packages/*` and `apps/*`
  (colocated `*.test.tsx` as today).
  - `packages/ui`: `useAutoResize` (growth/cap/Enter behavior), `ChatLayout`
    smoke, `SettingsMenu` (persist + footer values), brand `applyBrand`.
  - `apps/chat-app`: existing core tests (chat/llm/provider) move with the app;
    component tests rewritten on `@testing-library/react`.
- duckdb-wasm Node tests unchanged (they live with the app).

## 9. Task breakdown (each task ≈ one commit; every phase ends with `pnpm test` green)

Legend: ✅ = acceptance check. A task is done when its ✅ hold.

### Phase A — Workspace skeleton (no visual change)

- **A1. pnpm bootstrap.** Replace npm tooling with pnpm: `pnpm-workspace.yaml`
  (`packages: ["apps/*", "packages/*"]`), root `package.json` workspaces field
  dropped (pnpm reads the yaml), delete `package-lock.json`, `pnpm install`.
  ✅ `pnpm install` + `pnpm test` + `pnpm typecheck` green; no npm lockfile remains.
- **A2. Move `web/` → `apps/chat-app/`.** Git-move `web/` (src, index.html,
  vite.config.ts, public/). Fix the `../../../src/...` relative imports to the new
  root-relative paths (or a `@repo` alias for the shared `src/`). Update root
  scripts: `dev`/`build`/`start` point at `apps/chat-app` (vite `--root`),
  `prebuild` data-copy target → `apps/chat-app/public/data/`.
  ✅ `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm typecheck` all green from root.
- **A3. `packages/brand-config`.** Create package (`@workspace/brand-config`),
  `types.ts` (`Brand`), `brands/cbms.ts`, `index.ts` (`BRANDS`, `applyBrand`) per §4.
  Unit test: `applyBrand` sets the CSS vars + title (jsdom).
  ✅ Package importable; test green.
- **A4. Wire brand into the app.** `main.tsx` calls `applyBrand(BRANDS.cbms)` and
  sets `document.title`. (Old CSS still drives visuals — no UI change.)
  ✅ App boots, title = brand name.

### Phase B — Tailwind v4 + shadcn (visual migration)

- **B1. Tailwind v4 plumbing.** Add `tailwindcss` + `@tailwindcss/vite` +
  `tw-animate-css`; create `packages/ui/src/styles/globals.css`
  (`@import "tailwindcss"` + `@theme inline` + shadcn neutral tokens, light + dark);
  import it from the app; add `@workspace/ui` alias in the app's Vite config.
  ✅ A trivial `bg-primary` class renders; typecheck green.
- **B2. shadcn init (monorepo mode).** `components.json` in `packages/ui` and
  `apps/chat-app` (identical `style: "new-york"`, `iconLibrary: "lucide"`,
  `baseColor: "neutral"`, empty `tailwind.config`, aliases per shadcn monorepo
  guide). `pnpm dlx shadcn@latest add button textarea scroll-area dropdown-menu
  dialog select slider label separator` from `apps/chat-app` → files land in
  `packages/ui/src/components`.
  ✅ Primitives importable as `@workspace/ui/components/button`.
- **B3. Dark mode switch.** `theme.ts`: `data-theme` attribute → `.dark` class on
  `<html>` (keep storage key + system-preference logic). Update token usage so all
  former `data-theme` CSS selectors map to shadcn tokens.
  ✅ Light/dark toggle works; `theme.test.ts` updated and green.
- **B4. Component restyle (incremental, one component per commit).** Order:
  1) `App` shell + header, 2) `ChatPanel` (feed + messages), 3) `AnswerMarkdown`,
  4) `ResultTable`, 5) `ChartBlock`/`ChartRenderer`, 6) `MapSection`,
  7) `SettingsDialog`, 8) composer input. Replace `styles.css` rules as each
  component moves; **delete `styles.css` on the last one.**
  ✅ Every ✅ above verified in light AND dark; `styles.css` deleted; tests green.
- **B5. Chart/map token pass.** Recharts + Leaflet colors read shadcn CSS vars
  (no hardcoded hex); map tiles get a dark filter in dark mode.
  ✅ Charts/maps legible in both modes.

### Phase C — React 19 + test migration

- **C1. Bump React 18 → 19** (`react`, `react-dom`, `@types/react`,
  `@types/react-dom`). Smoke: app boots, no peer-dep warnings.
  ✅ `pnpm test`/`typecheck` green (tests may still use the old renderer if C2
  hasn't landed — keep green by ordering C1 → C2 without a red gap if possible).
- **C2. Swap test stack.** Add `@testing-library/react`,
  `@testing-library/jest-dom`, `jsdom`; remove `react-test-renderer` +
  `@types/react-test-renderer`; vitest `environment: 'jsdom'` for component tests.
  Rewrite `testStubs.ts` render helpers as `render()` wrappers.
  ✅ Test infra runs; one pilot test migrated.
- **C3. Migrate component tests file-by-file** (AnswerMarkdown, ChartBlock,
  ChatPanel, LeafletBarangayMap, ResultTable, SettingsDialog).
  ✅ All green; zero `react-test-renderer` imports remain.

### Phase D — White-label components (the new UX)

- **D1. `ChatLayout`.** Master wrapper per §2: `h-dvh` flex column, header
  (brand name + gear), `ScrollArea` feed centered `max-w-2xl`, bottom composer
  slot. `App` becomes `ChatLayout` + existing chat logic.
  ✅ Layout test: feed capped at max-w-2xl, composer at bottom; no horizontal
  overflow at 320px and 1920px widths.
- **D2. `Composer` + `useAutoResize`.** shadcn `Textarea`, growth hook per §3
  (measure `scrollHeight`, cap 160px, `resize: none`, internal scroll past cap,
  Enter submits / Shift+Enter newline, reset after submit, disabled while
  streaming). Unit tests for the hook incl. cap behavior and key handling.
  ✅ Hook tests green; manual: 5+ lines scrolls inside, handle gone.
- **D3. `SettingsMenu`.** Gear `DropdownMenu` per §5: model `Select` (curated
  list, persisted), temperature `Slider` 0–2 step 0.1 (persisted), footer with
  brand name/version/license + **"Connection…"** opening the BYOK `Dialog`.
  ✅ Selections persist across reload; footer shows brand-config values.
- **D4. Temperature wiring.** LLM client request body gains `temperature` (from
  persisted setting, default 0.7); unit test on the fetch payload.
  ✅ Payload test asserts `temperature` present.
- **D5. Brand styling.** User bubble `bg-brand-primary`, assistant `bg-muted`;
  `welcomeText` rendered above the first message; header shows brand name.
  ✅ Screenshot/visual check both modes; bubble colors come only from CSS vars.
- **D6. Settings consolidation.** Remove the old standalone settings trigger;
  restyle BYOK `Dialog` to shadcn (same behavior: mask key, blank-keeps-key,
  test connection).
  ✅ Single gear entry point; dialog tests (rewritten on RTL) green.

### Phase E — Polish + docs

- **E1. Dark-mode audit** (all surfaces: dropdown, dialog, tables, charts, maps,
  markdown code blocks).
- **E2. Mobile audit** — iOS Safari + Android Chrome: `h-dvh` composer not
  clipped, keyboard open/close doesn't trap scroll, safe-area padding.
- **E3. a11y pass** — labels for slider/select, focus rings, dropdown keyboard
  nav, contrast of brand-primary foreground on user bubbles (auto-pick
  light/dark foreground).
- **E4. Perf check** — streaming tokens: no layout thrash (feed auto-scroll uses
  `scrollTo`/`requestAnimationFrame`, not per-token reflow of the whole list).
- **E5. Docs.** Update `AGENTS.md` (new layout, pnpm commands), `README.md`,
  mark this spec **complete**.
  ✅ `pnpm test`/`lint`/`typecheck`/`build` all green; AGENTS.md matches reality.

## 10. Open questions

1. **Model list** — curated preset list for the Select: which models, and is the
   list part of brand config (each brand advertises its own models) or global?
2. **Routing** — confirmed no router lib for v1; OK?
3. **Brand colors** — CBMS brand palette: keep the current demo's accent color, or
   pick a specific hex now?
4. **Welcome text** — exact copy for the CBMS brand's `welcomeText`?
5. **License/version strings** for the CBMS brand footer — values to use?