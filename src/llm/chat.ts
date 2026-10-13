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
import type { ChartSpec } from './chart.js';
import { runSelect, type RunSelectResult } from './sql_tool.js';
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
  | { type: 'chart'; n: number; spec: ChartSpec }
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
 * Known name columns that benefit from case-insensitive / fuzzy matching.
 */
const NAME_COLUMNS = ['barangay', 'household_member_name'] as const;

/**
 * Matches `column = 'value'` or `column != 'value'` on known name columns.
 * Returns the replacement SQL fragment or null if no match.
 */
function fuzzyRetrySql(sql: string): string | null {
  for (const col of NAME_COLUMNS) {
    // Match: col = 'value' (not already UPPER/LIKE)
    const re = new RegExp(`(\\b${col}\\s*==?\\s*)('([^']+)')`, 'i');
    const m = sql.match(re);
    if (m) {
      const value = m[3];
      const replacement = `UPPER(${col}) LIKE UPPER('%${value}%')`;
      return sql.replace(re, replacement);
    }
  }
  return null;
}

/**
 * Executes SQL via runSelect. If the result is 0 rows and the SQL contains
 * a name-column equality filter, retries with a fuzzy LIKE match.
 */
async function runSelectWithFuzzyRetry(
  engine: SqlEngine,
  sql: string,
): Promise<RunSelectResult> {
  const result = await runSelect(engine, sql);
  if (result.rows.length > 0) return result;
  // 0 rows — try fuzzy retry
  const retrySql = fuzzyRetrySql(sql);
  if (!retrySql) return result;
  const retry = await runSelect(engine, retrySql);
  if (retry.rows.length > 0) return retry;
  // Still 0 rows — return a helpful message
  return {
    columns: ['note'],
    rows: [['No matching names found. Try a different spelling or check available names.']],
    truncated: false,
  };
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
  let chartCalls: ChartSpec[];
  try {
    const outcome = await askQuestion({
      client: opts.client,
      system: opts.system,
      history: opts.history,
      question: opts.question,
      execute: (sql: string) => runSelectWithFuzzyRetry(opts.engine, sql),
    });
    answer = outcome.answer;
    history = outcome.history;
    sqlCalls = outcome.sqlCalls;
    chartCalls = outcome.chartCalls;
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

  // Charts come after the SQL/rows activity and before the answer text (C5).
  for (let i = 0; i < chartCalls.length; i++) {
    yield { type: 'chart', n: i + 1, spec: chartCalls[i]! };
  }

  // Stream the answer in small chunks so the client renders it progressively.
  const CHUNK = 32;
  for (let i = 0; i < answer.length; i += CHUNK) {
    yield { type: 'token', text: answer.slice(i, i + CHUNK) };
  }
  yield { type: 'done', answer, history };
}
