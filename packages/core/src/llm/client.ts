/**
 * Pure message helpers + the `run_select` tool loop (spec D5, R8).
 *
 * `toApiMessages()` converts the internal `Message` list to the plain
 * OpenAI chat-completions **wire format** (no `openai` SDK — the fetch
 * `LLMClient` that sends this shape comes in a later phase).
 * `askQuestion()` runs the multi-turn tool loop:
 *  user question → (optional) run_select tool call(s) → final answer,
 * keeping only the last 6 history messages in context (R8).
 */
import type { LLMClient, Message, ToolSpec } from './types.js';
import { serializeResult, type RunSelectResult } from './sql_tool.js';
import { validateChartSpec, MAKE_CHART_TOOL_SPEC, MAKE_CHART_TOOL_NAME, type ChartSpec } from './chart.js';

export const RUN_SELECT_TOOL_NAME = 'run_select';

export const RUN_SELECT_TOOL_SPEC: ToolSpec = {
  type: 'function',
  function: {
    name: RUN_SELECT_TOOL_NAME,
    description:
      'Run a single read-only SELECT query against the CBMS Naga City DuckDB warehouse ' +
      '(views: household, person, barangay, v_barangay_summary). Returns {columns, rows}, ' +
      'capped at 100 rows / 50 KB of text.',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'A single SELECT statement (no other statements).' },
      },
      required: ['sql'],
    },
  },
};

/**
 * OpenAI chat-completions wire format for one message (a plain object —
 * no SDK types). Assistant tool_calls must carry `type: "function"` and a
 * nested `function` object, or the API rejects the request with
 * "Failed to parse messages: Missing tool call type".
 */
export type ApiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null | undefined;
      tool_calls?: {
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

/** Converts internal messages to the OpenAI chat-completions wire format. */
export function toApiMessages(messages: Message[]): ApiMessage[] {
  return messages.map((m) => {
    if (m.role === 'assistant') {
      return {
        role: 'assistant' as const,
        content: m.content ?? undefined,
        tool_calls: m.tool_calls?.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
    }
    if (m.role === 'tool') {
      return {
        role: 'tool' as const,
        tool_call_id: m.tool_call_id,
        content: m.content,
      };
    }
    return { role: m.role, content: m.content };
  });
}

/** R8 (context-reduction C2): keep only the last `max` history messages in context. */
export function trimHistory(history: Message[], max = 6): Message[] {
  return history.slice(-max);
}

export interface SqlCallRecord {
  sql: string;
  result: RunSelectResult;
}

export interface AskOutcome {
  answer: string;
  /** Updated conversation history (last 6 messages, R8 / context-reduction C2). */
  history: Message[];
  sqlCalls: SqlCallRecord[];
  /** Charts requested via make_chart, in creation order. */
  chartCalls: ChartSpec[];
}

export interface AskQuestionOptions {
  client: LLMClient;
  system: string;
  /** Previous turns (user/assistant messages). */
  history: Message[];
  question: string;
  /** Executes a run_select call; errors are reported back to the LLM as tool output. */
  execute: (sql: string) => Promise<RunSelectResult>;
  maxToolRounds?: number;
}

/**
 * Runs one user turn through the LLM + tool loop and returns the final
 * answer plus every SQL that was executed.
 * Each tool round re-sends the full system prompt plus all prior tool
 * results, so the cap is kept low (4, context-reduction spec C3).
 */
export async function askQuestion(opts: AskQuestionOptions): Promise<AskOutcome> {
  const maxToolRounds = opts.maxToolRounds ?? 4;
  const userMsg: Message = { role: 'user', content: opts.question };
  const messages: Message[] = [
    { role: 'system', content: opts.system },
    ...trimHistory(opts.history),
    userMsg,
  ];
  const sqlCalls: SqlCallRecord[] = [];
  const chartCalls: ChartSpec[] = [];

  let rounds = 0;
  for (;;) {
    const resp = await opts.client.chat(messages, [RUN_SELECT_TOOL_SPEC, MAKE_CHART_TOOL_SPEC]);
    if (resp.tool_calls && resp.tool_calls.length > 0) {
      rounds += 1;
      if (rounds > maxToolRounds) {
        // Weak models can keep querying forever; force a final answer from
        // the data already collected (one more call, no tools).
        messages.push({
          role: 'user',
          content:
            'You have reached the query limit. Stop calling tools and give your final '
            + 'answer now, using only the tool results above.',
        });
        const forced = await opts.client.chat(messages, []);
        const answer = (forced.content ?? '').trim();
        if (!answer) {
          throw new Error(`LLM exceeded ${maxToolRounds} tool rounds without a final answer`);
        }
        const history: Message[] = [...opts.history, userMsg, forced].slice(-6);
        return { answer, history, sqlCalls, chartCalls };
      }
      messages.push(resp);
      for (const tc of resp.tool_calls) {
        let toolContent: string;
        if (tc.name === MAKE_CHART_TOOL_NAME) {
          try {
            const args = JSON.parse(tc.arguments) as Record<string, unknown>;
            const spec = validateChartSpec(args);
            chartCalls.push(spec);
            toolContent = JSON.stringify({ status: 'ok', chart_id: chartCalls.length });
          } catch (e) {
            toolContent = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
          }
        } else if (tc.name === RUN_SELECT_TOOL_NAME) {
          try {
            const args = JSON.parse(tc.arguments) as { sql?: unknown };
            if (typeof args.sql !== 'string')
              throw new Error('run_select requires a "sql" string argument');
            const result = await opts.execute(args.sql);
            sqlCalls.push({ sql: args.sql, result });
            toolContent = serializeResult(result);
          } catch (e) {
            toolContent = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
          }
        } else {
          toolContent = JSON.stringify({ error: `unknown tool "${tc.name}"` });
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: toolContent });
      }
      continue;
    }
    const answer = resp.content ?? '';
    const history: Message[] = [...opts.history, userMsg, resp].slice(-6);
    return { answer, history, sqlCalls, chartCalls };
  }
}
