/**
 * Phase E smoke test — `core/chat.ts` with a stub engine + stub LLM.
 *
 * No real network, no duckdb-wasm: drives `chatQuestion()` and asserts
 * the full `ChatEvent` stream (sql/rows/token/done) plus the
 * unconfigured-client path.
 */
import { describe, expect, it } from 'vitest';
import { chatQuestion, createChatSession } from './chat.js';
import type { LLMClient, Message, SqlEngine, ToolCall } from '../../../src/llm/types.js';
import { UNCONFIGURED_MESSAGE } from '../../../src/llm/provider.js';
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
    const session = await createChatSession(stubEngine);
    const llm = new StubLlm();
    const events = await collect(
      chatQuestion({
        session,
        client: llm,
        history: [],
        question: 'How many barangays are there?',
      }),
    );

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('sql');
    expect(types).toEqual(['sql', 'rows', 'token', 'done']);

    const sql = events[0];
    expect(sql).toEqual({ type: 'sql', sql: 'SELECT code, barangay FROM "barangay" LIMIT 1' });
    const rows = events[1];
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
    const session = await createChatSession(stubEngine);
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
    const session = await createChatSession(stubEngine);
    const events = await collect(
      chatQuestion({ session, client: null, history: [], question: 'Hello?' }),
    );
    expect(events).toEqual([{ type: 'error', message: UNCONFIGURED_MESSAGE }]);
  });

  it('yields a chart event for a make_chart call (before the answer text)', async () => {
    const session = await createChatSession(stubEngine);
    const client: LLMClient = {
      async chat(messages: Message[], _tools: unknown[]) {
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
    expect(events.map((e) => e.type)).toEqual(['chart', 'token', 'done']);
    expect(events[0]).toEqual({
      type: 'chart',
      n: 1,
      spec: { type: 'bar', data: [{ name: 'A', value: 1 }], xKey: 'name', series: ['value'] },
    });
  });
});
