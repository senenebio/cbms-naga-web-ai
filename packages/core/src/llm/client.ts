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
import type { Dataset } from '@workspace/brand-config';
import type { LLMClient, Message, ToolSpec } from './types.js';
import { serializeResult, type RunSelectResult } from './sql_tool.js';
import { validateChartSpec, MAKE_CHART_TOOL_SPEC, MAKE_CHART_TOOL_NAME, type ChartSpec } from './chart.js';

export const RUN_SELECT_TOOL_NAME = 'run_select';

/**
 * Builds the `run_select` tool spec with a brand-specific description.
 * The dataset label (e.g. 'CBMS Naga 2024') is interpolated so the LLM
 * knows which warehouse it is querying.
 */
export function runSelectToolSpec(dataset: Dataset): ToolSpec {
  return {
    type: 'function',
    function: {
      name: RUN_SELECT_TOOL_NAME,
      description:
        `Run a single read-only SELECT query against the ${dataset.label} DuckDB warehouse ` +
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
}

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

/**
 * Events `askQuestion` yields in real time as the turn progresses (U3):
 * phase changes, each executed SQL + its rows, each requested chart, and the
 * final `{ answer, history }`.
 */
export type AskEvent =
  | { type: 'phase'; phase: 'thinking' | 'querying' | 'writing' }
  | { type: 'sql'; sql: string }
  | { type: 'rows'; columns: string[]; rows: unknown[][]; truncated: boolean }
  | { type: 'chart'; n: number; spec: ChartSpec }
  | { type: 'answer'; answer: string; history: Message[] };

export interface AskQuestionOptions {
  client: LLMClient;
  system: string;
  /** Dataset descriptor (brand label for tool spec). */
  dataset: Dataset;
  /** Previous turns (user/assistant messages). */
  history: Message[];
  question: string;
  /** Executes a run_select call; errors are reported back to the LLM as tool output. */
  execute: (sql: string) => Promise<RunSelectResult>;
  maxToolRounds?: number;
  /** Optional signal to abort the turn (H2 — user Stop button). */
  signal?: AbortSignal;
}

/**
 * Runs one user turn through the LLM + tool loop, yielding `AskEvent`s in
 * real time as the turn progresses (phase changes, each executed SQL + its
 * rows, each requested chart) and yielding the final `{ answer, history }`.
 * Each tool round re-sends the full system prompt plus all prior tool
 * results, so the cap is kept low (4, context-reduction spec C3).
 */
export async function* askQuestion(opts: AskQuestionOptions): AsyncGenerator<AskEvent> {
  const maxToolRounds = opts.maxToolRounds ?? 4;
  const userMsg: Message = { role: 'user', content: opts.question };
  const messages: Message[] = [
    { role: 'system', content: opts.system },
    ...trimHistory(opts.history),
    userMsg,
  ];
  let chartN = 0;

  let rounds = 0;
  for (;;) {
    if (rounds === 0) yield { type: 'phase', phase: 'thinking' };
    const resp = await opts.client.chat(messages, [runSelectToolSpec(opts.dataset), MAKE_CHART_TOOL_SPEC], opts.signal);
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
        const forced = await opts.client.chat(messages, [], opts.signal);
        const answer = (forced.content ?? '').trim();
        if (!answer) {
          throw new Error(`LLM exceeded ${maxToolRounds} tool rounds without a final answer`);
        }
        const history: Message[] = [...opts.history, userMsg, forced].slice(-6);
        yield { type: 'answer', answer, history };
        return;
      }
      messages.push(resp);
      for (const tc of resp.tool_calls) {
        let toolContent: string;
        if (tc.name === MAKE_CHART_TOOL_NAME) {
          try {
            const args = JSON.parse(tc.arguments) as Record<string, unknown>;
            const spec = validateChartSpec(args);
            chartN += 1;
            yield { type: 'chart', n: chartN, spec };
            toolContent = JSON.stringify({ status: 'ok', chart_id: chartN });
          } catch (e) {
            toolContent = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
          }
        } else if (tc.name === RUN_SELECT_TOOL_NAME) {
          try {
            const args = JSON.parse(tc.arguments) as { sql?: unknown };
            if (typeof args.sql !== 'string')
              throw new Error('run_select requires a "sql" string argument');
            yield { type: 'phase', phase: 'querying' };
            const result = await opts.execute(args.sql);
            yield { type: 'sql', sql: args.sql };
            yield {
              type: 'rows',
              columns: result.columns,
              rows: result.rows,
              truncated: result.truncated,
            };
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
    yield { type: 'answer', answer, history };
    return;
  }
}
