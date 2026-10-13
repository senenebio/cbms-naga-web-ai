/**
 * useChat — extracts the chat session logic from ChatPanel into a hook.
 *
 * Manages: messages, history, busy state, draft, streaming, abort.
 * The `ask` function drives the `createChatSession` + `chatQuestion` loop.
 */
import { useCallback, useRef, useState } from 'react';
import type { LLMClient, Message, SqlEngine } from '@repo/llm/types.js';
import { chatQuestion, createChatSession, type ChatEvent } from '../core/chat.js';
import type { ChartSpec } from '@repo/llm/chart.js';

export type SqlPart = { n: number; sql: string };
export type RowsPart = { n: number; columns: string[]; rows: unknown[][]; truncated: boolean };
export type ChartPart = { n: number; spec: ChartSpec };

export type ChatMsg =
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

export interface UseChatOptions {
  engine: SqlEngine | null;
  client: LLMClient | null;
  engineError?: string | null;
}

export interface UseChatResult {
  messages: ChatMsg[];
  busy: boolean;
  draft: string;
  setDraft: (v: string) => void;
  ask: (question: string) => Promise<void>;
  newChat: () => void;
}

export function useChat({ engine, client }: UseChatOptions): UseChatResult {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [history, setHistory] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const controllerRef = useRef<AbortController | null>(null);

  const ask = useCallback(
    async (question: string) => {
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
        {
          role: 'assistant',
          text: '',
          thinking: true,
          startedAt,
          sql: [],
          rows: [],
          charts: [],
          done: false,
          error: null,
        },
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
          patch((m) =>
            m.role === 'assistant' ? { ...m, thinking: false, text: acc, done: true } : m,
          );
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
    },
    [busy, engine, client, messages.length, history],
  );

  const newChat = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setMessages([]);
    setHistory([]);
    setDraft('');
    setBusy(false);
  }, []);

  return { messages, busy, draft, setDraft, ask, newChat };
}
