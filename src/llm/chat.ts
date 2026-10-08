/**
 * Shared chat engine (spec D4, R4, R8) — driver-free.
 *
 * Reuses `askQuestion()` (LLM + `run_select` tool loop) and `runSelect()`
 * (read-only SQL gate) over the shared `SqlEngine` contract.
 * `streamQuestion()` runs one turn and yields fine-grained events so the
 * web UI can render tool activity and the answer progressively.
 */
import type { LLMClient, Message, SqlEngine } from './types.js';
import { askQuestion } from './client.js';
import { runSelect } from './sql_tool.js';
import { buildSchemaBlock, selectColumns } from '../schema.js';
import { buildSystemPrompt } from './prompts.js';
import { UNCONFIGURED_MESSAGE } from './provider.js';

/**
 * C7 — per-question system prompt: a scoped schema block when the question
 * maps to specific dictionary columns, the FULL schema otherwise (fallback
 * keeps behavior identical for ambiguous/aggregate questions). `fullSystem`
 * is the pre-built full-prompt system string (warm fallback, also warms
 * the full schema-block cache at startup).
 */
export async function systemForQuestion(
  question: string,
  fullSystem: string,
  engine: SqlEngine,
): Promise<string> {
  const selected = selectColumns(question);
  if (!selected) return fullSystem;
  return buildSystemPrompt(await buildSchemaBlock(engine, selected));
}

/** One event yielded by `streamQuestion()`. */
export type ChatEvent =
  | { type: 'sql'; sql: string }
  | { type: 'rows'; columns: string[]; rows: unknown[][]; truncated: boolean }
  | { type: 'token'; text: string }
  | { type: 'done'; answer: string; history: Message[] }
  | { type: 'error'; message: string };

export interface StreamQuestionOptions {
  /** Null when no LLM is configured → yields a single friendly `error` event. */
  client: LLMClient | null;
  system: string;
  /** Previous turns (user/assistant messages, last 6 kept per R8 / context-reduction C2). */
  history: Message[];
  question: string;
  engine: SqlEngine;
}

/**
 * Runs one user question through the LLM + `run_select` loop and yields:
 *  - one `sql` + one `rows` event per executed query, in order,
 *  - `token` events with the final answer split into small chunks,
 *  - a final `done` event carrying the full answer and updated history,
 *  - or a single `error` event if the turn failed.
 */
export async function* streamQuestion(opts: StreamQuestionOptions): AsyncGenerator<ChatEvent> {
  if (!opts.client) {
    yield { type: 'error', message: UNCONFIGURED_MESSAGE };
    return;
  }
  let answer: string;
  let history: Message[];
  let sqlCalls: {
    sql: string;
    result: { columns: string[]; rows: unknown[][]; truncated: boolean };
  }[];
  try {
    const outcome = await askQuestion({
      client: opts.client,
      system: opts.system,
      history: opts.history,
      question: opts.question,
      execute: (sql: string) => runSelect(opts.engine, sql),
    });
    answer = outcome.answer;
    history = outcome.history;
    sqlCalls = outcome.sqlCalls;
  } catch (e) {
    yield { type: 'error', message: e instanceof Error ? e.message : String(e) };
    return;
  }

  for (const call of sqlCalls) {
    yield { type: 'sql', sql: call.sql };
    yield {
      type: 'rows',
      columns: call.result.columns,
      rows: call.result.rows,
      truncated: call.result.truncated,
    };
  }

  // Stream the answer in small chunks so the client renders it progressively.
  const CHUNK = 32;
  for (let i = 0; i < answer.length; i += CHUNK) {
    yield { type: 'token', text: answer.slice(i, i + CHUNK) };
  }
  yield { type: 'done', answer, history };
}
