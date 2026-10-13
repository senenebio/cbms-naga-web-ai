# Post-White-Label Fixes

**Status: COMPLETE**

Issues noticed after the monorepo/white-label restructure, plus follow-up UX improvements.

## 1. Case-insensitive + fuzzy name matching ✅

**Problem:** The LLM generates `WHERE barangay = 'Carolina'` but the database stores `CAROLINA`. Queries return no rows. Minor typos ("Caroline" vs "Carolina") also fail.

**Fix (two layers):**

### 1a. System prompt convention (primary) ✅

Added rule 8 to the LLM system prompt in `packages/core/src/llm/prompts.ts`:

> When filtering by name columns (barangay, household_member_name, etc.):
> - Always use `UPPER()` on both sides for case-insensitive matching.
> - If the user's spelling may not be exact, use `LIKE` with wildcards.

### 1b. Application-level retry (safety net) ✅

In `runSelectWithFuzzyRetry` (`packages/core/src/llm/chat.ts`), when a query returns **0 rows**:
1. Detect if the SQL contains a `WHERE` clause with a string literal on a known name column (`barangay`, `household_member_name`).
2. Replace `= 'value'` with `UPPER(col) LIKE UPPER('%value%')`.
3. Re-run; if still 0 rows, return a helpful message.

## 2. Move Show SQL + New Chat to footer ✅

**Problem:** The Show SQL checkbox and New Chat button were in a toolbar above the chat feed.

**Fix:**
- Removed toolbar from `ChatPanel`
- Added `footer` prop to `ChatLayout`, rendered below the composer
- `showSql` state lifted to `App.tsx` (persisted via `localStorage`)

## 3. Widen chat to 95% viewport ✅

**Problem:** `max-w-2xl` (672px) was too narrow.

**Fix:** Changed inner card to `w-[95%] max-w-7xl` (95% viewport, capped at 1280px). Switched from flex centering to block layout with `mx-auto` for proper responsive resize.

## 4. Refactor: `src/` → `packages/core/` ✅

**Problem:** Root `src/` was a monorepo anti-pattern — code should live in `packages/`.

**Fix:**
- `src/` → `packages/core/src/`
- Added `packages/core/package.json` (`@workspace/core`)
- Updated `@repo/` alias in tsconfig, vite, vitest to point to `packages/core/src/`
- Test files updated to use `@repo/` alias

## 5. Sparkle pulse thinking indicator ✅

**Problem:** "Thinking… Ns" was plain text, hard to notice.

**Fix:** Replaced with `Sparkles` (lucide) icon + `animate-pulse` + seconds ticker. In cyber night theme, uses a custom `cyber-pulse` keyframe with glow `drop-shadow`.

## 6. Auto-scroll fix ✅

**Problem:** Auto-scroll didn't work during streaming (smooth scroll was interrupted on every token; rAF cleanup cancelled before frame fired).

**Fix:**
- Track `nearBottom` via scroll listener (80px threshold)
- Instant `scrollTop` on message updates when user is at bottom
- No auto-scroll when user has scrolled up (respects reading position)

## 7. Cyber Night theme variant ✅

**Problem:** No dark-neon aesthetic option for users who want a cyberpunk look.

**Fix:**
- `.cyber` class in `globals.css`: near-black bg, cyan/magenta neon accents, scanline CRT overlay, glow shadows, monospace font, `cyber-pulse` animation
- `Theme` type extended: `'light' | 'dark' | 'cyber'`
- SettingsMenu: theme selector (Light / Dark / Cyber Night) with icons
- `palette.ts`: cyber fallback colors (cyan, magenta, green, orange, amber)
- Removed standalone sun/moon toggle button (now in settings menu)

## 8. README + AGENTS.md updates ✅

- README rewritten (human-friendly, monorepo structure, pnpm commands)
- AGENTS.md layout updated for `packages/core/`

## Final layout structure

```
apps/chat-app/          # React app (ChatLayout, Composer, SettingsMenu, chat feed)
packages/core/          # @workspace/core: LLM client, SQL guardrails, schema, map, wasm
packages/ui/            # @workspace/ui: Tailwind v4, shadcn, ChatLayout, Composer
packages/brand-config/  # @workspace/brand-config: brand types, CBMS brand #1
data/                   # parquet files + data dictionary
test/                   # root-level Node tests
```

## Tasks (all complete)

| # | Task | Status |
|---|------|--------|
| 1a | Add `UPPER()` convention to system prompt | ✅ |
| 1b | 0-row fuzzy retry in `runSelectWithFuzzyRetry` | ✅ |
| 2a | Move Show SQL + New Chat to footer bar | ✅ |
| 3a | Widen chat card to `w-[95%] max-w-7xl` | ✅ |
| 4a | Move `src/` → `packages/core/` | ✅ |
| 5a | Sparkle pulse thinking indicator | ✅ |
| 6a | Auto-scroll fix (instant, near-bottom tracking) | ✅ |
| 7a | Cyber Night theme variant | ✅ |
| 8a | README + AGENTS.md updates | ✅ |

## Acceptance

- [x] LLM uses `UPPER()` for name comparisons (verified in chat)
- [x] Show SQL + New Chat visible in footer below composer
- [x] Chat occupies 95% viewport width (capped 1280px), resizes with window
- [x] `pnpm test` green (205 tests), `pnpm typecheck` clean
- [x] Sparkle thinking indicator with pulse animation
- [x] Auto-scroll pins to bottom during streaming, respects user scroll position
- [x] Cyber Night theme: neon-on-black, scanline overlay, glow, mono font
- [x] Theme selector in settings menu (Light / Dark / Cyber Night)
- [x] Monorepo structure clean (no root `src/`)
