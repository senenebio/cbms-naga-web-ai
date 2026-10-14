/**
 * Read-only SQL execution tool for the LLM (spec R5).
 *
 * `runSelect(engine, sql)`:
 *  - only a single `SELECT` (or `WITH … SELECT`) statement is accepted;
 *    DDL/DML (CREATE, DROP, INSERT, UPDATE, DELETE, ALTER, …) and
 *    multi-statement strings are rejected;
 *  - results are capped at 100 rows and ~50 KB of serialized result text.
 *
 * Driver-free: takes the shared `SqlEngine` contract (duckdb-wasm in
 * production, a throwaway fake in unit tests).
 */
import type { SqlEngine } from './types.js';

export const MAX_ROWS = 100;
export const MAX_RESULT_TEXT_BYTES = 50 * 1024;

export class SqlRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlRejectedError';
  }
}

export type Cell = number | string | null;

export interface RunSelectResult {
  columns: string[];
  rows: Cell[][];
  /** True when the 100-row or 50 KB cap caused the result to be cut short. */
  truncated: boolean;
}

/**
 * Validate that `sql` is exactly one read-only SELECT statement.
 * Returns a normalized (comment-stripped) version of the SQL.
 * Throws SqlRejectedError otherwise.
 */
export function validateSelectOnly(sql: string): string {
  if (typeof sql !== 'string' || sql.trim() === '') {
    throw new SqlRejectedError('empty SQL statement');
  }
  // Protect string literals and quoted identifiers from comment stripping.
  // A `--` or `/*` inside a literal is data, not a comment.
  const literals: string[] = [];
  let s = sql
    .replace(/'([^']*)'/g, (_, body: string) => {
      literals.push(`'${body}'`);
      return `__LIT_${literals.length - 1}__`;
    })
    .replace(/`[^`]*`/g, (m) => {
      literals.push(m);
      return `__LIT_${literals.length - 1}__`;
    });

  // Strip block comments, then line comments (safe — literals are protected).
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/--[^\n]*/g, ' ');

  // Restore literals.
  s = s.replace(/__LIT_(\d+)__/g, (_, i: string) => literals[Number(i)] ?? '');
  s = s.trim();

  // At most one trailing semicolon; any further semicolon means multi-statement.
  if (s.endsWith(';')) s = s.slice(0, -1).trim();
  if (s.includes(';')) {
    throw new SqlRejectedError('multiple statements are not allowed; run exactly one SELECT');
  }

  const first = s.match(/^\s*([A-Za-z_]+)\b/);
  const firstWord = (first?.[1] ?? '').toLowerCase();
  if (firstWord !== 'select' && firstWord !== 'with') {
    throw new SqlRejectedError(
      `only SELECT statements are allowed (rejected statement starting with "${firstWord.toUpperCase()}")`,
    );
  }

  // Block dangerous keywords outside of string literals / identifiers.
  const stripped = s.replace(/'[^']*'/g, "' '").replace(/`[^`]*`/g, '" "');
  const forbidden =
    /\b(insert|update|delete|drop|create|alter|truncate|merge|attach|detach|copy|vacuum|checkpoint|pragma|grant|revoke|install|load|call|exec|set|use|begin|commit|rollback|explain)\b/i;
  const m = stripped.match(forbidden);
  if (m) {
    throw new SqlRejectedError(
      `statement contains forbidden keyword "${(m[1] ?? '').toUpperCase()}"; only SELECT is allowed`,
    );
  }
  return s;
}

function toCells(rows: unknown[][]): Cell[][] {
  return rows.map((r) =>
    r.map((v) => {
      if (typeof v === 'bigint') return Number(v);
      return v as Cell;
    }),
  );
}

async function fetchRows(
  engine: SqlEngine,
  sql: string,
  limit: number,
): Promise<{ columns: string[]; rows: Cell[][] }> {
  const wrapped = `SELECT * FROM (${sql}) AS "cbms_limited" LIMIT ${limit}`;
  const res = await engine.query(wrapped);
  return { columns: res.columns, rows: toCells(res.rows) };
}

/** JSON text of a result, as sent to the LLM / shown in the UI. */
export function serializeResult(result: RunSelectResult): string {
  return JSON.stringify({ columns: result.columns, rows: result.rows });
}

/**
 * Execute a read-only SELECT against the warehouse.
 * Capped at `MAX_ROWS` rows and `MAX_RESULT_TEXT_BYTES` of result text.
 */
export async function runSelect(engine: SqlEngine, sql: string): Promise<RunSelectResult> {
  const normalized = validateSelectOnly(sql);

  const full = await fetchRows(engine, normalized, MAX_ROWS);
  const fullText = serializeResult({ columns: full.columns, rows: full.rows, truncated: false });
  if (fullText.length <= MAX_RESULT_TEXT_BYTES) {
    // `truncated` means the cap may have cut the result short (exactly the
    // row cap, so the true count could be higher).
    return { columns: full.columns, rows: full.rows, truncated: full.rows.length === MAX_ROWS };
  }

  // Result text too large: shrink the row count (binary search) until it fits.
  let lo = 0;
  let hi = full.rows.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const text = serializeResult({
      columns: full.columns,
      rows: full.rows.slice(0, mid),
      truncated: true,
    });
    if (text.length <= MAX_RESULT_TEXT_BYTES) lo = mid;
    else hi = mid - 1;
  }
  if (lo === 0)
    throw new SqlRejectedError('result rows are too wide to fit the 50 KB result-text cap');
  return { columns: full.columns, rows: full.rows.slice(0, lo), truncated: true };
}
