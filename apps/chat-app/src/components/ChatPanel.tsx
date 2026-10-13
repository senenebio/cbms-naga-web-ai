/**
 * ChatPanel — presentational chat feed (messages + toolbar).
 *
 * Renders the message list with streaming markdown, charts, tables, maps.
 * The composer input is handled by the parent (ChatLayout + Composer).
 *
 * `messages`, `busy`, etc. come from the `useChat` hook (in App).
 */
import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { LLMClient, SqlEngine } from '@repo/llm/types.js';
import type { ChatMsg } from '../hooks/use-chat.js';
import type { Theme } from '../theme.js';
import AnswerMarkdown from './AnswerMarkdown.js';
import ChartBlock from './ChartBlock.js';
import ResultTable from './ResultTable.js';
import MapSection from './MapSection.js';
import { isMapApplicable } from '@repo/map/geo.js';
import { BRAND } from '../brand.js';


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
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Sparkles className="size-4 animate-pulse text-primary" />
      <span>Thinking… {secs}s</span>
    </div>
  );
}

export interface ChatPanelProps {
  messages: ChatMsg[];
  busy: boolean;
  engine: SqlEngine | null;
  engineError?: string | null;
  client: LLMClient | null;
  onOpenSettings: () => void;
  theme?: Theme;
  showSql: boolean;
}

export default function ChatPanel({
  messages,
  busy,
  engine,
  engineError = null,
  client,
  onOpenSettings,
  theme = 'light',
  showSql,
}: ChatPanelProps) {
  const messagesEl = useRef<HTMLDivElement>(null);

  // Track whether the user is near the bottom (within 80px).
  const nearBottomRef = useRef(true);
  useEffect(() => {
    const el = messagesEl.current;
    if (!el) return;
    const onScroll = () => {
      nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-scroll: pin to bottom when user is already there (streaming tokens,
  // new messages). Instant during streaming to avoid jank.
  useEffect(() => {
    const el = messagesEl.current;
    if (!el || !nearBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const ready = engine !== null && !engineError;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Feed */}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pb-2" ref={messagesEl}>
        {/* Welcome text (before first message) */}
        {messages.length === 0 && !engineError && engine !== null && (
          <p className="py-4 text-center text-sm text-muted-foreground">{BRAND.welcomeText}</p>
        )}

        {engineError ? (
          <div className="text-sm text-destructive">
            ⚠️ Could not load the warehouse: {engineError}
          </div>
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

      {/* Unconfigured hint */}
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
    </div>
  );
}
