# CBMS Naga City — AI Chat

Ask questions about Naga City's 2024 community data in plain language.
The app runs a database (DuckDB) **in your browser**, connects it to an LLM
that you configure yourself (BYOK), and answers with text, charts, tables,
and maps.

No server. No signup. Your API key stays in your browser.

---

## Quick start

```bash
pnpm install
pnpm dev
```

Open the printed URL, click the **⚙️ gear** → **Connection…**, enter your
API key and endpoint, and start chatting.

Supported providers (any OpenAI-compatible endpoint):

| Provider    | Example endpoint                  |
| ----------- | --------------------------------- |
| Ollama (local) | `http://localhost:11434/v1`   |
| LM Studio   | `http://localhost:1234/v1`       |
| OpenRouter  | `https://openrouter.ai/api/v1`   |
| OpenAI      | `https://api.openai.com/v1`      |

## What it does

You type a question like *"Which barangays have the most households?"* and
the LLM:

1. Writes a SQL query against the warehouse
2. Runs it against DuckDB in your browser
3. Explains the results in plain English
4. Renders charts / tables / a barangay map when it makes sense

Name matching is **case-insensitive and fuzzy** — try "naga" or "PILAR" and
it'll find the right rows.

## The data

Three parquet files covering the **2024 CBMS survey for Naga City**:

- `person` — individual respondents
- `household` — household-level records
- `barangay` — the 27 barangays with aggregates

A data dictionary controls which columns are visible (PII like names, IDs,
and coordinates are blocked). The full schema is described in
[`docs/DATA-ASSETS.md`](docs/DATA-ASSETS.md).

## Building & deploying

```bash
pnpm build    # → apps/chat-app/dist/  (a plain static site)
pnpm start    # build + serve locally for a quick check
```

Drop the `dist/` folder on any static host:

- **Vercel** — Framework: *Other*, Root: `apps/chat-app`, Build: `pnpm build`
- **GitHub Pages** — set Vite `base` to your repo path

## Development

```bash
pnpm dev         # Vite dev server
pnpm test        # 205 tests (vitest)
pnpm typecheck   # TypeScript
pnpm lint        # ESLint
```

## How it's put together

```
apps/chat-app/            # the React app you see in the browser
packages/ui/              # shared UI (Tailwind globals, shadcn components)
packages/brand-config/    # brand identity (name, colors, welcome text)
src/                      # driver-free core: LLM client, SQL guardrails, map logic
data/                     # the actual parquet files + data dictionary
specs/                    # feature specs
docs/                     # guardrails & data docs
```

- **DuckDB** runs in a Web Worker via `duckdb-wasm` (single-threaded, no
  CORS headers needed).
- **LLM calls** go straight from your browser to the provider — nothing
  touches a server.
- **SQL is read-only** — only `SELECT` is allowed, enforced by a keyword
  blocklist. Results are capped at 100 rows.
- **UI** is Tailwind CSS v4 + shadcn/ui. Dark mode is a class toggle.

## License

MIT
