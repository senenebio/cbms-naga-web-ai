/**
 * Phase F — chat panel wired to the Phase E browser core.
 *
 * Drives `createChatSession()` + `chatQuestion()` (driver-free core) and
 * renders the `ChatEvent` stream: `sql`/`rows` per executed query (the
 * collapsible "SQL N" / "Raw rows N" sections, off by default), `token`
 * chunks into a streaming markdown answer, and the final `done`/`error`.
 *
 * The `engine` and `client` are injected (from App) so component tests can
 * run with stubs — no network, no duckdb-wasm, no localStorage. When
 * `client` is null (no BYOK configured) the core yields a single friendly
 * `error` event (`UNCONFIGURED_MESSAGE`); we also surface an explicit
 * "open Settings" hint above the composer.
 */
import { useEffect, useRef, useState } from 'react';
import type { LLMClient, Message, SqlEngine } from '@repo/llm/types.js';
import { Button } from '@workspace/ui/components/button';
import { chatQuestion, createChatSession, type ChatEvent } from '../core/chat.js';
import type { ChartSpec } from '@repo/llm/chart.js';
import type { Theme } from '../theme.js';
import AnswerMarkdown from './AnswerMarkdown.js';
import ChartBlock from './ChartBlock.js';
import ResultTable from './ResultTable.js';
import MapSection from './MapSection.js';
import { isMapApplicable } from '@repo/map/geo.js';
import { DEMO_QUESTIONS } from '../demoQuestions.js';

const SHOW_SQL_KEY = 'cbms-show-sql';

/** Read the persisted "Show SQL" toggle (default off). */
function readShowSql(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(SHOW_SQL_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Persist the "Show SQL" toggle (best-effort; storage may be unavailable). */
function persistShowSql(value: boolean): void {
  try {
    localStorage.setItem(SHOW_SQL_KEY, value ? 'true' : 'false');
  } catch {
    /* ignore (e.g. storage disabled in the test environment) */
  }
}

type SqlPart = { n: number; sql: string };
type RowsPart = { n: number; columns: string[]; rows: unknown[][]; truncated: boolean };
type ChartPart = { n: number; spec: ChartSpec };

type ChatMsg =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      text: string;
      thinking: boolean;
      startedAt: number;
      sql: SqlPart[];
      rows: RowsPart[];
      charts: ChartPart[];
      done: boolean;
      error: string | null;
    };

/** "Thinking… Ns" ticker; re-renders every second until the first token. */
function Thinking({ startedAt }: { startedAt: number }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const update = () => setSecs(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return (
    <div className="text-xs text-muted-foreground">Thinking… {secs}s (querying the warehouse via the LLM)</div>
  );
}

interface ChatPanelProps {
  /** Warehouse engine; null while it is still loading. */
  engine: SqlEngine | null;
  /** LLM client; null when no BYOK provider is configured. */
  client: LLMClient | null;
  /** Surfaced when the warehouse failed to load (engine stays null). */
  engineError?: string | null;
  /** Opens the Settings dialog (used by the unconfigured hint). */
  onOpenSettings: () => void;
  /** Active theme (drives the chart palette). Defaults to light. */
  theme?: Theme;
}

export default function ChatPanel({
  engine,
  client,
  engineError = null,
  onOpenSettings,
  theme = 'light',
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [history, setHistory] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [showSql, setShowSql] = useState(readShowSql);

  const toggleShowSql = () => {
    const next = !showSql;
    setShowSql(next);
    persistShowSql(next);
  };
  const messagesEl = useRef<HTMLDivElement>(null);
  // Abort handle for the in-flight stream ("New chat" while streaming).
  const controllerRef = useRef<AbortController | null>(null);

  // Auto-scroll to the newest message.
  useEffect(() => {
    const el = messagesEl.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const ask = async (question: string) => {
    if (busy || !engine) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const startedAt = Date.now();
    const asstIndex = messages.length + 1;
    setBusy(true);
    setDraft('');
    setMessages((m) => [
      ...m,
      { role: 'user', content: question },
      { role: 'assistant', text: '', thinking: true, startedAt, sql: [], rows: [], charts: [], done: false, error: null },
    ]);

    let acc = '';
    let sqlN = 0;
    let error: string | null = null;
    const patch = (fn: (m: ChatMsg) => ChatMsg) =>
      setMessages((msgs) => msgs.map((m, i) => (i === asstIndex ? fn(m) : m)));

    const handleEvent = (e: ChatEvent): void => {
      if (e.type === 'sql') {
        sqlN += 1;
        const part: SqlPart = { n: sqlN, sql: e.sql };
        patch((m) => (m.role === 'assistant' ? { ...m, sql: [...m.sql, part] } : m));
      } else if (e.type === 'rows') {
        const part: RowsPart = {
          n: sqlN,
          columns: e.columns,
          rows: e.rows,
          truncated: e.truncated,
        };
        patch((m) => (m.role === 'assistant' ? { ...m, rows: [...m.rows, part] } : m));
      } else if (e.type === 'chart') {
        const part: ChartPart = { n: e.n, spec: e.spec };
        patch((m) => (m.role === 'assistant' ? { ...m, charts: [...m.charts, part] } : m));
      } else if (e.type === 'token') {
        acc += e.text;
        patch((m) => (m.role === 'assistant' ? { ...m, thinking: false, text: acc } : m));
      } else if (e.type === 'done') {
        acc = e.answer;
        setHistory(e.history);
        patch((m) => (m.role === 'assistant' ? { ...m, thinking: false, text: acc, done: true } : m));
      } else if (e.type === 'error') {
        error = e.message;
        patch((m) => (m.role === 'assistant' ? { ...m, thinking: false, error } : m));
      }
    };

    try {
      const session = await createChatSession(engine);
      for await (const e of chatQuestion({
        session,
        client,
        history,
        question,
      })) {
        if (controller.signal.aborted) break;
        handleEvent(e);
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        error = `Request failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    setBusy(false);
    patch((m) => (m.role === 'assistant' ? { ...m, thinking: false, text: acc, error } : m));
  };

  // Clear the conversation (messages, history window, draft). Aborts any
  // in-flight stream so no orphaned tokens land in the blank chat.
  const newChat = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setMessages([]);
    setHistory([]);
    setDraft('');
    setBusy(false);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = draft.trim();
    if (!q || busy) return;
    void ask(q);
  };

  const ready = engine !== null && !engineError;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 pb-2">
        <span className="text-sm font-semibold">Chat</span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="ml-auto"
          aria-pressed={showSql}
          title={
            showSql ? 'Hide the SQL and raw-rows sections' : 'Show the SQL and raw-rows sections'
          }
          onClick={toggleShowSql}
        >
          Show SQL
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={newChat}
          title="Clear the conversation and start a blank chat"
        >
          New chat
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5 py-2.5">
        {DEMO_QUESTIONS.map((q, i) => (
          <button
            key={i}
            type="button"
            disabled={busy || !ready}
            onClick={() => void ask(q)}
            className="rounded-md border bg-muted/50 px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-55"
          >
            {q}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pb-2" ref={messagesEl}>
        {engineError ? (
          <div className="text-sm text-destructive">⚠️ Could not load the warehouse: {engineError}</div>
        ) : engine === null && messages.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            Loading the warehouse (DuckDB in your browser)…
          </div>
        ) : null}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div
              key={i}
              className="ml-[12%] whitespace-pre-wrap break-words rounded-lg bg-brand-primary px-3 py-2.5 text-sm text-brand-primary-foreground"
            >
              <span className="mb-1 block text-[11px] uppercase tracking-wide opacity-70">You</span>
              {m.content}
            </div>
          ) : (
            <div
              key={i}
              className="whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2.5 text-sm"
            >
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                Assistant
              </span>
              {m.error ? (
                <div className="text-sm text-destructive">⚠️ {m.error}</div>
              ) : m.thinking ? (
                <Thinking startedAt={m.startedAt} />
              ) : m.text === '' ? (
                <div className="text-xs text-muted-foreground">(no answer returned)</div>
              ) : (
                <AnswerMarkdown text={m.text} />
              )}
              {m.done &&
                m.charts.map((c) => (
                  <ChartBlock key={c.n} spec={c.spec} theme={theme} />
                ))}
              {showSql &&
                m.sql.map((s) => (
                  <details
                    key={`sql-${s.n}`}
                    className="mt-2 rounded-md border bg-muted/40 text-xs"
                  >
                    <summary className="cursor-pointer select-none rounded-md px-2.5 py-1.5 font-medium text-foreground/80">
                      SQL {s.n} (click to expand)
                    </summary>
                    <div className="overflow-x-auto px-2.5 pb-2.5">
                      <pre className="whitespace-pre-wrap rounded-md bg-zinc-900 p-2.5 text-xs text-zinc-200">
                        {s.sql}
                      </pre>
                    </div>
                  </details>
                ))}
              {m.rows.map((r) =>
                showSql || isMapApplicable(r.columns, r.rows) ? (
                  <div key={`rows-${r.n}`} className="result-block">
                    {showSql && (
                      <details className="mt-2 rounded-md border bg-muted/40 text-xs">
                        <summary className="cursor-pointer select-none rounded-md px-2.5 py-1.5 font-medium text-foreground/80">
                          Raw rows {r.n} ({r.rows.length}
                          {r.truncated ? '+' : ''} rows)
                        </summary>
                        <div className="overflow-x-auto px-2.5 pb-2.5">
                          <ResultTable columns={r.columns} rows={r.rows} truncated={r.truncated} />
                        </div>
                      </details>
                    )}
                    {isMapApplicable(r.columns, r.rows) && (
                      <MapSection columns={r.columns} rows={r.rows} theme={theme} />
                    )}
                  </div>
                ) : null
              )}
            </div>
          ),
        )}
      </div>

      {client === null && (
        <div className="pt-2 text-xs text-muted-foreground">
          No LLM configured —{' '}
          <button
            type="button"
            className="text-primary underline underline-offset-2"
            onClick={onOpenSettings}
          >
            open Settings
          </button>{' '}
          to add a BYOK key (local / OpenRouter / OpenAI).
        </div>
      )}

      <form
        className="flex gap-2 pt-2.5"
        onSubmit={onSubmit}
      >
        <input
          type="text"
          value={draft}
          disabled={!ready}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about Naga City's 2024 CBMS survey, e.g. household size or medical treatment…"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-55"
        />
        <Button type="submit" disabled={busy || draft.trim() === '' || !ready}>
          {busy ? 'Waiting…' : 'Ask'}
        </Button>
      </form>
    </div>
  );
}
