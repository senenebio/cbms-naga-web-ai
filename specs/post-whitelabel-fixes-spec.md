# Post-White-Label Fixes

**Status: DRAFT**

Three issues noticed after the monorepo/white-label restructure.

## 1. Case-insensitive + fuzzy name matching

**Problem:** The LLM generates `WHERE barangay = 'Carolina'` but the database stores `CAROLINA`. Queries return no rows. Minor typos ("Caroline" vs "Carolina") also fail.

**Fix (two layers):**

### 1a. System prompt convention (primary)

Add to the LLM system prompt:

> When filtering by name columns (barangay, household_member_name, etc.):
> - Always use `UPPER()` on both sides for case-insensitive matching.
> - If the user's spelling may not be exact, use `LIKE` with wildcards:
>   `WHERE UPPER(barangay) LIKE UPPER('%carolina%')`
> - Before filtering on a name, verify it exists:
>   `SELECT DISTINCT barangay FROM barangay WHERE UPPER(barangay) LIKE UPPER('%carolina%')`

### 1b. Application-level retry (safety net)

In `runSelect` (or the chat tool loop), when a query returns **0 rows**:
1. Detect if the SQL contains a `WHERE` clause with a string literal on a known name column (`barangay`, `household_member_name`).
2. If so, re-run the query replacing `= 'value'` with `LIKE '%value%'` (case-insensitive via `UPPER()`).
3. If the retry returns rows, use those results. If not, return a helpful error: "No barangay matching 'X' found. Available: CAROLINA, ..."

This catches cases where the LLM still uses exact `=` despite the prompt instruction.

**Scope:**
- `src/llm/` — system prompt assembly (add convention)
- `src/llm/` or `apps/chat-app/src/core/chat.ts` — 0-row retry logic

**Alternative considered:** Pre-query name resolution with edit-distance substitution. Rejected — overkill; `LIKE` + prompt instruction covers the realistic typo cases.

## 2. Move Show SQL + New Chat to footer

**Problem:** The Show SQL checkbox and New Chat button are in a toolbar above the chat feed. They should be in the lower-left, below the composer.

**Fix:**
- Remove the toolbar `<div>` from `ChatPanel`
- Add a footer bar below the `Composer` in `ChatLayout` (or at the bottom of `ChatPanel`) containing:
  - Left: Show SQL checkbox
  - Left: New Chat button
- Style: small, muted, unobtrusive — `text-xs text-muted-foreground`

**Layout sketch:**
```
┌─────────────────────────────┐
│ Header (brand + settings)   │
├─────────────────────────────┤
│                             │
│  Chat feed (ScrollArea)     │
│                             │
├─────────────────────────────┤
│ Composer (input)            │
├─────────────────────────────┤
│ [x] Show SQL   [New chat]   │  ← footer bar
└─────────────────────────────┘
```

## 3. Widen chat to ~90% viewport

**Problem:** `max-w-2xl` (672px) is too narrow. The chat should occupy ~90% of the screen width.

**Fix:** Change the inner card in `ChatLayout` from `max-w-2xl` to `w-[90%] max-w-none` (or `max-w-5xl` on large screens). Keep the outer centering + padding.

**Current:**
```tsx
<div className="flex h-full max-h-[90dvh] w-full max-w-2xl flex-col">
```

**Target:**
```tsx
<div className="flex h-full max-h-[90dvh] w-full max-w-5xl flex-col">
```

(Or `w-[90%]` if we want it truly fluid. `max-w-5xl` = 1024px caps it on ultrawide monitors.)

## Tasks

| # | Task | Files |
|---|------|-------|
| 1a | Add `UPPER()` convention to system prompt | `src/llm/` (prompt assembly) |
| 2a | Move Show SQL + New Chat to footer bar | `ChatPanel.tsx`, `ChatLayout` (or app shell) |
| 3a | Widen chat card | `packages/ui/src/components/ui/chat-layout.tsx` |

## Acceptance

- [ ] LLM uses `UPPER()` for name comparisons (verified in chat)
- [ ] Show SQL + New Chat visible in footer below composer
- [ ] Chat occupies ~90% viewport width (no awkward narrow column)
- [ ] `pnpm test` green, `pnpm typecheck` clean
