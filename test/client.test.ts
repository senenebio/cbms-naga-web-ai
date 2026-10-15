/**
 * Phase B — pure client helpers + `askQuestion` tool-loop tests.
 * Mock LLM client + fake `SqlEngine` (no duckdb-wasm, no network).
 */
import { describe, it, expect } from 'vitest';
import {
  askQuestion,
  toApiMessages,
  trimHistory,
  runSelectToolSpec,
  RUN_SELECT_TOOL_NAME,
  type AskEvent,
} from '@repo/llm/client.js';
import { createMockClient } from '@repo/llm/mock_client.js';
import { MOCK_SCRIPTS, FALLBACK_ANSWER, OFF_TOPIC_ANSWER } from './fixtures/mock-scripts.js';
import { CBMS_DATASET } from '@workspace/brand-config';
import { runSelect, SqlRejectedError } from '@repo/llm/sql_tool.js';
import type { ChartSpec } from '@repo/llm/chart.js';
import type { AssistantMessage, LLMClient, Message, SqlEngine, ToolSpec } from '@repo/llm/types.js';

const TOTALS_SQL = `SELECT (SELECT COUNT(*) AS households FROM "household") AS households, (SELECT COUNT(*) AS persons FROM "person") AS persons`;

/** Fake engine: returns the canned totals for the mock client's scripted SQL. */
function makeEngine(): SqlEngine {
  return {
    async query(sql: string) {
      // The mock client's SQL is wrapped by runSelect into the LIMIT form.
      if (sql.includes('COUNT(*)')) {
        return { columns: ['households', 'persons'], rows: [[44892, 181197]] };
      }
      return { columns: [], rows: [] };
    },
  };
}

/**
 * Consume the `askQuestion` generator and fold the real-time events back into
 * the aggregate shape the tests assert on (`answer`, `history`, `sqlCalls`,
 * `chartCalls`). Each SQL call yields a `sql` event followed by its `rows`
 * event; they are paired by index.
 */
async function runQuestion(opts: Parameters<typeof askQuestion>[0]) {
  const events: AskEvent[] = [];
  for await (const e of askQuestion(opts)) events.push(e);
  const answerEvent = events.find((e) => e.type === 'answer');
  const sqlEvents = events.filter((e) => e.type === 'sql');
  const rowEvents = events.filter((e) => e.type === 'rows');
  return {
    answer: answerEvent?.type === 'answer' ? answerEvent.answer : '',
    history: (answerEvent?.type === 'answer' ? answerEvent.history : []) as Message[],
    sqlCalls: sqlEvents.map((e, i) => {
      const row = rowEvents[i] as
        | { columns: string[]; rows: unknown[][]; truncated: boolean }
        | undefined;
      return {
        sql: e.type === 'sql' ? e.sql : '',
        result: row
          ? { columns: row.columns, rows: row.rows, truncated: row.truncated }
          : { columns: [], rows: [], truncated: false },
      };
    }),
    chartCalls: events.filter((e) => e.type === 'chart').map((e) =>
      e.type === 'chart' ? e.spec : (null as unknown as ChartSpec),
    ),
  };
}

describe('toApiMessages (wire format)', () => {
  it('converts system/user messages', () => {
    const wire = toApiMessages([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
    expect(wire).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('emits assistant tool_calls with the nested function shape', () => {
    const wire = toApiMessages([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', name: 'run_select', arguments: '{"sql":"SELECT 1"}' }],
      },
      { role: 'tool', tool_call_id: 'call_1', name: 'run_select', content: '{}' },
    ]);
    expect(wire[0]).toEqual({
      role: 'assistant',
      content: undefined,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'run_select', arguments: '{"sql":"SELECT 1"}' },
        },
      ],
    });
    expect(wire[1]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{}' });
  });
});

describe('trimHistory (R8 / context-reduction C2)', () => {
  it('keeps only the last 6 messages by default', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`,
    })) as Message[];
    const trimmed = trimHistory(history);
    expect(trimmed.length).toBe(6);
    expect(trimmed[0]?.content).toBe('m4');
    expect(trimmed[5]?.content).toBe('m9');
  });

  it('keeps fewer when history is short', () => {
    const history = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ] as Message[];
    expect(trimHistory(history)).toHaveLength(2);
  });
});

describe('runSelectToolSpec', () => {
  it('describes the single read-only run_select tool', () => {
    const spec = runSelectToolSpec(CBMS_DATASET);
    expect(spec.function.name).toBe(RUN_SELECT_TOOL_NAME);
    expect(spec.function.parameters.properties).toEqual({
      sql: { type: 'string', description: 'A single SELECT statement (no other statements).' },
    });
    expect(spec.function.parameters.required).toEqual(['sql']);
    expect(spec.function.description).toContain(CBMS_DATASET.label);
  });
});

describe('askQuestion tool loop (mock client + fake engine)', () => {
  it('runs the scripted SQL through execute and composes the answer', async () => {
    const executed: string[] = [];
    const outcome = await runQuestion({
      client: createMockClient(MOCK_SCRIPTS, FALLBACK_ANSWER, OFF_TOPIC_ANSWER),
      system: 'system',
      dataset: CBMS_DATASET,
      history: [],
      question: 'How many households and people were surveyed in Naga City?',
      execute: async (sql: string) => {
        executed.push(sql);
        return runSelect(makeEngine(), sql);
      },
    });
    expect(outcome.sqlCalls.length).toBe(1);
    expect(outcome.sqlCalls[0]?.sql).toBe(TOTALS_SQL);
    expect(executed).toEqual([TOTALS_SQL]);
    expect(outcome.answer).toContain('44,892');
    expect(outcome.answer).toContain('181,197');
    // History: [user, assistant] → 2 messages.
    expect(outcome.history).toHaveLength(2);
  });

  it('yields phase events in real time (thinking → querying) before the answer', async () => {
    const events: AskEvent[] = [];
    for await (const e of askQuestion({
      client: createMockClient(MOCK_SCRIPTS, FALLBACK_ANSWER, OFF_TOPIC_ANSWER),
      system: 'system',
      dataset: CBMS_DATASET,
      history: [],
      question: 'How many households and people were surveyed in Naga City?',
      execute: (sql: string) => runSelect(makeEngine(), sql),
    })) {
      events.push(e);
    }
    const phases = events
      .filter((e) => e.type === 'phase')
      .map((e) => (e.type === 'phase' ? e.phase : ''));
    expect(phases).toEqual(['thinking', 'querying']);
    // Every phase precedes the answer event (real-time, not a post-hoc recap).
    const answerIndex = events.findIndex((e) => e.type === 'answer');
    const lastPhaseIndex = events.map((e) => e.type).lastIndexOf('phase');
    expect(lastPhaseIndex).toBeGreaterThanOrEqual(0);
    expect(lastPhaseIndex).toBeLessThan(answerIndex);
  });

  it('caps history at the last 6 messages (R8)', async () => {
    const history: Message[] = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `h${i}`,
    }));
    const outcome = await runQuestion({
      client: createMockClient(MOCK_SCRIPTS, FALLBACK_ANSWER, OFF_TOPIC_ANSWER),
      system: 'system',
      dataset: CBMS_DATASET,
      history,
      question: 'How many households and people were surveyed in Naga City?',
      execute: (sql: string) => runSelect(makeEngine(), sql),
    });
    // 8 prior turns + user + assistant = 10 → slice(-6) → 6 (h4…h7, user, assistant).
    expect(outcome.history.length).toBe(6);
    expect(outcome.history[0]?.content).toBe('h4');
  });

  it('reports execute errors back to the LLM as tool output', async () => {
    const outcome = await runQuestion({
      client: createMockClient(MOCK_SCRIPTS, FALLBACK_ANSWER, OFF_TOPIC_ANSWER),
      system: 'system',
      dataset: CBMS_DATASET,
      history: [],
      question: 'How many households and people were surveyed in Naga City?',
      execute: () => Promise.reject(new SqlRejectedError('boom')),
    });
    expect(outcome.answer).toContain('The query failed');
  });

  it('records nothing when the mock declines (no scripted question)', async () => {
    const outcome = await runQuestion({
      client: createMockClient(MOCK_SCRIPTS, FALLBACK_ANSWER, OFF_TOPIC_ANSWER),
      system: 'system',
      dataset: CBMS_DATASET,
      history: [],
      question: 'What is the capital of France?',
      execute: async () => {
        throw new Error('should not be called');
      },
    });
    expect(outcome.sqlCalls).toEqual([]);
    expect(outcome.answer).toContain('scripted');
  });

  it('forces a final answer (no tools) when tool rounds are exhausted', async () => {
    const calls: { tools: ToolSpec[]; messages: Message[] }[] = [];
    const client: LLMClient = {
      async chat(messages: Message[], tools: ToolSpec[]): Promise<AssistantMessage> {
        calls.push({ tools, messages });
        if (tools.length === 0) return { role: 'assistant', content: 'Forced final answer.' };
        return {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: `call_${calls.length}`, name: 'run_select', arguments: '{"sql":"SELECT 1"}' },
          ],
        };
      },
    };
    const outcome = await runQuestion({
      client,
      system: 'system',
      dataset: CBMS_DATASET,
      history: [],
      question: 'q',
      execute: async () => ({ columns: ['x'], rows: [[1]], truncated: false }),
    });
    // 4 tool rounds executed, then one forced call without tools.
    expect(outcome.sqlCalls).toHaveLength(4);
    expect(outcome.answer).toBe('Forced final answer.');
    const last = calls.at(-1);
    expect(last?.tools).toEqual([]);
    expect(last?.messages.at(-1)).toEqual({
      role: 'user',
      content: expect.stringContaining('final answer'),
    });
    expect(outcome.history).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'Forced final answer.' },
    ]);
  });

  it('still throws when the forced final call returns no content', async () => {
    const client: LLMClient = {
      async chat(_messages: Message[], tools: ToolSpec[]): Promise<AssistantMessage> {
        if (tools.length === 0) return { role: 'assistant', content: null };
        return {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_x', name: 'run_select', arguments: '{"sql":"SELECT 1"}' }],
        };
      },
    };
    await expect(
      runQuestion({
        client,
        system: 'system',
        dataset: CBMS_DATASET,
        history: [],
        question: 'q',
        execute: async () => ({ columns: ['x'], rows: [[1]], truncated: false }),
      }),
    ).rejects.toThrow('exceeded 4 tool rounds');
  });

  it('records a make_chart call and returns it in chartCalls', async () => {
    let n = 0;
    const client: LLMClient = {
      async chat(_messages: Message[], tools: ToolSpec[]) {
        if (tools.length === 0) return { role: 'assistant', content: 'Final.' };
        n += 1;
        if (n === 1) {
          return {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'mc_1',
                name: 'make_chart',
                arguments: JSON.stringify({
                  type: 'bar',
                  data: [{ name: 'A', value: 1 }, { name: 'B', value: 2 }],
                }),
              },
            ],
          };
        }
        return { role: 'assistant', content: 'Final answer with a chart.' };
      },
    };
    const outcome = await runQuestion({
      client,
      system: 'system',
      dataset: CBMS_DATASET,
      history: [],
      question: 'chart it',
      execute: async () => ({ columns: ['x'], rows: [[1]], truncated: false }),
    });
    expect(outcome.chartCalls).toHaveLength(1);
    expect(outcome.chartCalls[0]?.type).toBe('bar');
    expect(outcome.chartCalls[0]?.data).toEqual([
      { name: 'A', value: 1 },
      { name: 'B', value: 2 },
    ]);
    expect(outcome.chartCalls[0]?.xKey).toBe('name');
    expect(outcome.chartCalls[0]?.series).toEqual(['value']);
  });

  it('feeds a bad make_chart spec back to the LLM as a tool error (not recorded)', async () => {
    let sawErrorTool = false;
    const client: LLMClient = {
      async chat(messages: Message[], tools: ToolSpec[]) {
        if (tools.length === 0) return { role: 'assistant', content: 'Final.' };
        const lastTool = [...messages].reverse().find((m) => m.role === 'tool');
        if (lastTool && lastTool.role === 'tool' && lastTool.content.includes('error')) {
          sawErrorTool = true;
        }
        if (!sawErrorTool) {
          return {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'mc_bad', name: 'make_chart', arguments: JSON.stringify({ type: 'bar', data: [] }) },
            ],
          };
        }
        return { role: 'assistant', content: 'Final answer after the bad chart.' };
      },
    };
    const outcome = await runQuestion({
      client,
      system: 'system',
      dataset: CBMS_DATASET,
      history: [],
      question: 'chart it',
      execute: async () => ({ columns: ['x'], rows: [[1]], truncated: false }),
    });
    expect(outcome.chartCalls).toEqual([]);
    expect(sawErrorTool).toBe(true);
    expect(outcome.answer).toBe('Final answer after the bad chart.');
  });
});
