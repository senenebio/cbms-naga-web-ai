/**
 * Phase B — pure client helpers + `askQuestion` tool-loop tests.
 * Mock LLM client + fake `SqlEngine` (no duckdb-wasm, no network).
 */
import { describe, it, expect } from 'vitest';
import {
  askQuestion,
  toApiMessages,
  trimHistory,
  RUN_SELECT_TOOL_SPEC,
  RUN_SELECT_TOOL_NAME,
} from '../src/llm/client.js';
import { createMockClient } from '../src/llm/mock_client.js';
import { runSelect, SqlRejectedError } from '../src/llm/sql_tool.js';
import type { AssistantMessage, LLMClient, Message, SqlEngine, ToolSpec } from '../src/llm/types.js';

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

describe('RUN_SELECT_TOOL_SPEC', () => {
  it('describes the single read-only run_select tool', () => {
    expect(RUN_SELECT_TOOL_SPEC.function.name).toBe(RUN_SELECT_TOOL_NAME);
    expect(RUN_SELECT_TOOL_SPEC.function.parameters.properties).toEqual({
      sql: { type: 'string', description: 'A single SELECT statement (no other statements).' },
    });
    expect(RUN_SELECT_TOOL_SPEC.function.parameters.required).toEqual(['sql']);
  });
});

describe('askQuestion tool loop (mock client + fake engine)', () => {
  it('runs the scripted SQL through execute and composes the answer', async () => {
    const executed: string[] = [];
    const outcome = await askQuestion({
      client: createMockClient(),
      system: 'system',
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

  it('caps history at the last 6 messages (R8)', async () => {
    const history: Message[] = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `h${i}`,
    }));
    const outcome = await askQuestion({
      client: createMockClient(),
      system: 'system',
      history,
      question: 'How many households and people were surveyed in Naga City?',
      execute: (sql: string) => runSelect(makeEngine(), sql),
    });
    // 8 prior turns + user + assistant = 10 → slice(-6) → 6 (h4…h7, user, assistant).
    expect(outcome.history.length).toBe(6);
    expect(outcome.history[0]?.content).toBe('h4');
  });

  it('reports execute errors back to the LLM as tool output', async () => {
    const outcome = await askQuestion({
      client: createMockClient(),
      system: 'system',
      history: [],
      question: 'How many households and people were surveyed in Naga City?',
      execute: () => Promise.reject(new SqlRejectedError('boom')),
    });
    expect(outcome.answer).toContain('The query failed');
  });

  it('records nothing when the mock declines (no scripted question)', async () => {
    const outcome = await askQuestion({
      client: createMockClient(),
      system: 'system',
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
    const outcome = await askQuestion({
      client,
      system: 'system',
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
      askQuestion({
        client,
        system: 'system',
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
    const outcome = await askQuestion({
      client,
      system: 'system',
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
    const outcome = await askQuestion({
      client,
      system: 'system',
      history: [],
      question: 'chart it',
      execute: async () => ({ columns: ['x'], rows: [[1]], truncated: false }),
    });
    expect(outcome.chartCalls).toEqual([]);
    expect(sawErrorTool).toBe(true);
    expect(outcome.answer).toBe('Final answer after the bad chart.');
  });
});
