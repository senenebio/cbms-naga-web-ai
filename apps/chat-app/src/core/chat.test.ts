/**
 * Phase E smoke test — `core/chat.ts` with a stub engine + stub LLM.
 *
 * No real network, no duckdb-wasm: drives `chatQuestion()` and asserts
 * the full `ChatEvent` stream (sql/rows/token/done) plus the
 * unconfigured-client path.
 */
import { describe, expect, it } from 'vitest';
import { BRAND } from '../brand.js';
import { chatQuestion, createChatSession } from './chat.js';
import { fuzzyRetrySql } from '@repo/llm/chat.js';
import type { LLMClient, Message, SqlEngine, ToolCall } from '@repo/llm/types.js';
import { UNCONFIGURED_MESSAGE } from '@repo/llm/provider.js';
import type { ChatEvent } from './chat.js';

const stubEngine: SqlEngine = {
  async query(sql: string) {
    void sql;
    return { columns: ['code', 'barangay'], rows: [[1, 'TEST']] };
  },
};

class StubLlm implements LLMClient {
  readonly calls: { system: string | null; tools: unknown[] }[] = [];

  async chat(
    messages: Message[],
    tools: unknown[],
    _signal?: AbortSignal,
  ): Promise<Extract<Message, { role: 'assistant' }>> {
    const system = messages.find((m) => m.role === 'system');
    this.calls.push({ system: system && system.role === 'system' ? system.content : null, tools });
    const toolCalls: ToolCall[] = [
      {
        id: 'tc-1',
        name: 'run_select',
        arguments: JSON.stringify({ sql: 'SELECT code, barangay FROM "barangay" LIMIT 1' }),
      },
    ];
    const prior = messages.filter((m) => m.role === 'tool').length;
    if (prior === 0) {
      return { role: 'assistant', content: null, tool_calls: toolCalls };
    }
    return { role: 'assistant', content: '**1 barangay** — TEST (code 1).' };
  }
}

async function collect(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe('core/chat.ts (stub engine + stub LLM)', () => {
  it('streams sql/rows/token/done events for a tool-calling turn', async () => {
    const session = await createChatSession(stubEngine, BRAND.dataset);
    const llm = new StubLlm();
    const events = await collect(
      chatQuestion({
        session,
        client: llm,
        history: [],
        question: 'How many barangays are there?',
      }),
    );

    // U3: phase events are yielded before sql/rows/tokens.
    const nonPhase = events.filter((e) => e.type !== 'phase');
    const types = nonPhase.map((e) => e.type);
    expect(types[0]).toBe('sql');
    expect(types).toEqual(['sql', 'rows', 'token', 'done']);

    const sql = nonPhase[0];
    expect(sql).toEqual({ type: 'sql', sql: 'SELECT code, barangay FROM "barangay" LIMIT 1' });
    const rows = nonPhase[1];
    expect(rows).toEqual({
      type: 'rows',
      columns: ['code', 'barangay'],
      rows: [[1, 'TEST']],
      truncated: false,
    });

    const tokens = events.filter((e) => e.type === 'token');
    const answer = tokens.map((e) => (e.type === 'token' ? e.text : '')).join('');
    expect(answer).toBe('**1 barangay** — TEST (code 1).');

    const done = events[events.length - 1];
    expect(done).toEqual({
      type: 'done',
      answer: '**1 barangay** — TEST (code 1).',
      history: expect.arrayContaining([
        expect.objectContaining({ role: 'user' }),
        expect.objectContaining({ role: 'assistant' }),
      ]),
    });
  });

  it('sends the warehouse schema in the system prompt and the run_select tool spec', async () => {
    const session = await createChatSession(stubEngine, BRAND.dataset);
    const llm = new StubLlm();
    await collect(
      chatQuestion({
        session,
        client: llm,
        history: [],
        question: 'How many barangays are there?',
      }),
    );

    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[0]?.system).toContain('DATA SCHEMA');
    expect(llm.calls[0]?.system).toContain('v_barangay_summary');
    const tool = llm.calls[0]?.tools?.[0] as { type: string; function: { name: string } };
    expect(tool.type).toBe('function');
    expect(tool.function.name).toBe('run_select');
  });

  it('yields a single friendly error event when no LLM is configured', async () => {
    const session = await createChatSession(stubEngine, BRAND.dataset);
    const events = await collect(
      chatQuestion({ session, client: null, history: [], question: 'Hello?' }),
    );
    expect(events).toEqual([{ type: 'error', message: UNCONFIGURED_MESSAGE }]);
  });

  it('yields a chart event for a make_chart call (before the answer text)', async () => {
    const session = await createChatSession(stubEngine, BRAND.dataset);
    const client: LLMClient = {
      async chat(messages: Message[], _tools: unknown[], _signal?: AbortSignal) {
        const prior = messages.filter((m) => m.role === 'tool').length;
        if (prior === 0) {
          return {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'mc-1',
                name: 'make_chart',
                arguments: JSON.stringify({ type: 'bar', data: [{ name: 'A', value: 1 }] }),
              },
            ],
          };
        }
        return { role: 'assistant', content: 'charted.' };
      },
    };
    const events = await collect(
      chatQuestion({ session, client, history: [], question: 'chart it' }),
    );
    // U3: phase events precede the chart/token/done events.
    const nonPhase = events.filter((e) => e.type !== 'phase');
    expect(nonPhase.map((e) => e.type)).toEqual(['chart', 'token', 'done']);
    expect(nonPhase[0]).toEqual({
      type: 'chart',
      n: 1,
      spec: { type: 'bar', data: [{ name: 'A', value: 1 }], xKey: 'name', series: ['value'] },
    });
  });

  it('ends the turn cleanly (no error event) when the signal is aborted (H2)', async () => {
    const session = await createChatSession(stubEngine, BRAND.dataset);
    const controller = new AbortController();
    const client: LLMClient = {
      async chat(_messages: Message[], _tools: unknown[], signal?: AbortSignal) {
        if (signal?.aborted) {
          const err = new Error('This operation was aborted');
          err.name = 'AbortError';
          throw err;
        }
        return { role: 'assistant', content: 'never reached' };
      },
    };
    controller.abort();
    const events = await collect(
      chatQuestion({ session, client, history: [], question: 'q', signal: controller.signal }),
    );
    // A manual Stop is not an error: the stream ends with no events at all,
    // so the caller keeps whatever partial answer it has already streamed.
    expect(events).toEqual([]);
  });
});

describe('fuzzyRetrySql', () => {
  it('escapes LIKE wildcards in the value', () => {
    const sql = "SELECT * FROM barangay WHERE barangay = '50%_test'";
    const result = fuzzyRetrySql(sql);
    expect(result).not.toBeNull();
    expect(result).toContain("ESCAPE '\\'");
    // % and _ are escaped with a backslash
    expect(result).toContain('50\\%\\_test');
  });

  it('passes through values without wildcards unchanged', () => {
    const sql = "SELECT * FROM barangay WHERE barangay = 'Naga'";
    const result = fuzzyRetrySql(sql);
    expect(result).not.toBeNull();
    expect(result).toContain("UPPER(barangay) LIKE UPPER('%Naga%') ESCAPE '\\'");
  });

  it('returns null for non-name columns', () => {
    expect(fuzzyRetrySql("SELECT * FROM household WHERE address = 'x'")).toBeNull();
  });
});
