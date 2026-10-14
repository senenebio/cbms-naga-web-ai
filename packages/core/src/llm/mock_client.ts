/**
 * Deterministic mock LLM client for testing (decision 6 — test-only;
 * never exposed in the UI or provider resolution).
 *
 * Implements the same `LLMClient` interface as the real fetch client:
 *  - on a user turn, it emits a `run_select` tool call with a scripted SQL
 *    (matched by keyword patterns);
 *  - once the tool result is back in the message history, it composes an
 *    answer that cites the actual rows returned.
 */
import type { AssistantMessage, LLMClient, Message, ToolSpec } from './types.js';
import { RUN_SELECT_TOOL_NAME } from './client.js';
import type { Cell } from './sql_tool.js';

export interface MockScript {
  match: RegExp;
  sql: string;
  answer: (columns: string[], rows: Cell[][]) => string;
}

export const fmt = (v: Cell | undefined) => (v === null || v === undefined ? 'n/a' : String(v));

/** Maps a migration-level code to its PSA label (c04 valueset). */
export const MIGRATION_LEVEL_LABELS: Record<number, string> = {
  1: 'International migrant',
  2: 'Inter-regional migrant',
  3: 'Inter-provincial migrant',
  4: 'Inter-municipal migrant',
  5: 'Inter-barangay migrant',
};

/** Maps a reason code to its PSA label (d06 valueset). */
export const REASON_LABELS: Record<number, string> = {
  1: 'Accessibility of school',
  2: 'Illness',
  3: 'Disability',
  4: 'Pregnancy',
  5: 'Marriage',
  6: 'High cost of educational/financial concern',
  7: 'Employment',
  8: 'Finished schooling',
  9: 'Looking for work',
  10: 'Lack of personal interest',
  11: 'Too young/old',
  12: 'Bullying',
  13: 'Family matters',
};

/**
 * Off-topic guardrail (context-reduction spec C4): clearly non-survey
 * questions get a polite refusal + survey-related suggestions, with no
 * `run_select` call. Keyword list is deliberately narrow to avoid
 * misfiring on in-scope questions.
 */
const OFF_TOPIC =
  /weather|forecast|recipe|stock market|stock price|cricket|basketball|football|soccer score|love (song|poem)|a (good|funny) joke|horoscope|bitcoin|who won (the|yesterday)/i;

function lastUserMessage(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') return m.content;
  }
  return '';
}

function lastToolMessage(messages: Message[]): Extract<Message, { role: 'tool' }> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'tool') return m;
  }
  return undefined;
}

/**
 * Creates a mock LLM client (no API key needed).
 * Pass brand-specific scripts, fallback answer, and off-topic answer.
 */
export function createMockClient(
  scripts: MockScript[],
  fallbackAnswer: string,
  offTopicAnswer: string,
): LLMClient {
  let callCounter = 0;
  return {
    async chat(messages, _tools: ToolSpec[], _signal?: AbortSignal): Promise<AssistantMessage> {
      const toolMsg = lastToolMessage(messages);
      if (toolMsg) {
        // Answer turn: compose the answer from the tool result.
        let parsed: { columns?: string[]; rows?: Cell[][]; error?: string };
        try {
          parsed = JSON.parse(toolMsg.content);
        } catch {
          parsed = {};
        }
        if (parsed.error) {
          return {
            role: 'assistant',
            content: `The query failed (${parsed.error}). Please ask me a different question.`,
          };
        }
        const script = scripts.find((s) => s.match.test(lastUserMessage(messages)));
        if (!script || !parsed.columns || !parsed.rows) {
          return {
            role: 'assistant',
            content: 'I ran the query but could not interpret the result in mock mode.',
          };
        }
        const body = script.answer(parsed.columns, parsed.rows);
        // v2.3 B2: SQL is hidden by default — the canned answer is the
        // interpretation only.
        return {
          role: 'assistant',
          content: body,
        };
      }

      // Question turn: pick a scripted query.
      const question = lastUserMessage(messages);
      if (OFF_TOPIC.test(question)) {
        // Scope guardrail: polite refusal, no SQL.
        return { role: 'assistant', content: offTopicAnswer };
      }
      const script = scripts.find((s) => s.match.test(question));
      if (!script) {
        return { role: 'assistant', content: fallbackAnswer };
      }
      callCounter += 1;
      return {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: `mock_call_${callCounter}`,
            name: RUN_SELECT_TOOL_NAME,
            arguments: JSON.stringify({ sql: script.sql }),
          },
        ],
      };
    },
  };
}
