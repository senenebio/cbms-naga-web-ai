/**
 * Phase B — Guardrail tests for the read-only SQL tool (spec R5) with a
 * fake `SqlEngine` (no duckdb-wasm, no network).
 */
import { describe, it, expect } from 'vitest';
import {
  runSelect,
  validateSelectOnly,
  serializeResult,
  SqlRejectedError,
  MAX_ROWS,
  MAX_RESULT_TEXT_BYTES,
  type RunSelectResult,
} from '@repo/llm/sql_tool.js';
import type { SqlEngine } from '@repo/llm/types.js';

/**
 * Fake `SqlEngine` that emulates the `runSelect` row-limit wrapper:
 * `SELECT * FROM (<inner>) AS "cbms_limited" LIMIT <n>` → inner handler
 * with its rows sliced to `<n>`.
 */
function makeLimitingEngine(
  inner: (sql: string) => { columns: string[]; rows: unknown[][] },
): SqlEngine {
  return {
    async query(sql: string) {
      const m = /^SELECT \* FROM \((.*)\) AS "cbms_limited" LIMIT (\d+)$/s.exec(sql);
      if (!m) throw new Error(`fake engine only handles the runSelect wrapper, got: ${sql}`);
      const res = inner(m[1] as string);
      const limit = Number(m[2]);
      return { columns: res.columns, rows: res.rows.slice(0, limit) };
    },
  };
}

describe('validateSelectOnly (R5)', () => {
  describe('rejects non-SELECT / DDL / DML', () => {
    const cases = [
      'DELETE FROM "person"',
      'delete from "person"',
      'UPDATE "household" SET "hh_size" = 1',
      'DROP TABLE "person"',
      'CREATE TABLE x AS SELECT 1',
      'ALTER TABLE "household" RENAME COLUMN "hh_size" TO s',
      'TRUNCATE TABLE "person"',
      'INSERT INTO "barangay" VALUES (28, \'X\')',
      "ATTACH 'tmp.db' AS tmp",
      'PRAGMA database_list',
      'SELECT 1; SELECT 2',
      'SELECT 1; DROP TABLE "person"',
      '',
    ];

    for (const sql of cases) {
      it(`rejects: ${sql || '(empty)'}`, () => {
        expect(() => validateSelectOnly(sql)).toThrow(SqlRejectedError);
      });
    }

    it('rejects a trailing multi-statement semicolon', () => {
      expect(() => validateSelectOnly('SELECT 1;')).not.toThrow();
      expect(() => validateSelectOnly('SELECT 1; SELECT 2;')).toThrow(SqlRejectedError);
    });

    it('rejects forbidden keywords even when embedded in a WITH query', () => {
      expect(() => validateSelectOnly('WITH x AS (SELECT 1) DELETE FROM t')).toThrow(
        SqlRejectedError,
      );
    });
  });

  describe('allows legitimate SELECT shapes', () => {
    it('accepts WITH (CTE) and quoted identifiers', () => {
      expect(validateSelectOnly('WITH t AS (SELECT 1 AS x) SELECT * FROM t')).toBeTypeOf('string');
      expect(validateSelectOnly('SELECT "hh_size" FROM "household" LIMIT 1')).toBeTypeOf('string');
    });

    it('accepts a string literal containing forbidden keywords', () => {
      // "drop" appears only inside a string literal → allowed
      expect(validateSelectOnly(`SELECT 'I want to DROP tables' AS msg`)).toBeTypeOf('string');
    });

    it('strips comments before validating', () => {
      expect(validateSelectOnly('-- comment\nSELECT 1 /* block */')).toBe('SELECT 1');
    });

    it('accepts comment markers inside string literals (L2)', () => {
      // `--` and `/*` inside a literal are data, not comments.
      const result = validateSelectOnly(`SELECT 'a -- b' AS x`);
      expect(result).toContain("'a -- b'");
      const result2 = validateSelectOnly(`SELECT 'a /* b */' AS x`);
      expect(result2).toContain("'a /* b */'");
    });
  });
});

describe('runSelect over a fake SqlEngine (R5 caps)', () => {
  it('returns {columns, rows} for a small result, not truncated', async () => {
    const engine = makeLimitingEngine(() => ({ columns: ['n'], rows: [[181197]] }));
    const res = await runSelect(engine, `SELECT COUNT(*) AS n FROM "person"`);
    expect(res.columns).toEqual(['n']);
    expect(res.rows).toEqual([[181197]]);
    expect(res.truncated).toBe(false);
  });

  it('rejects non-SELECT SQL before touching the engine', async () => {
    let queried = false;
    const engine: SqlEngine = {
      query: async () => {
        queried = true;
        return { columns: [], rows: [] };
      },
    };
    await expect(runSelect(engine, 'DROP TABLE "person"')).rejects.toThrow(SqlRejectedError);
    expect(queried).toBe(false);
  });

  it('caps at 100 rows and flags truncated', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => [i]);
    const engine = makeLimitingEngine(() => ({ columns: ['x'], rows }));
    const res = await runSelect(engine, 'SELECT x FROM t');
    expect(res.rows.length).toBe(MAX_ROWS);
    expect(res.truncated).toBe(true);
  });

  it('keeps a result at exactly the row cap intact when the text fits', async () => {
    const rows = Array.from({ length: MAX_ROWS }, (_, i) => [i]);
    const engine = makeLimitingEngine(() => ({ columns: ['x'], rows }));
    const res = await runSelect(engine, 'SELECT x FROM t');
    expect(res.rows.length).toBe(MAX_ROWS);
    expect(res.truncated).toBe(true);
  });

  it('shrinks wide results (binary search) to fit ~50 KB of result text', async () => {
    // 100 rows × 1000 chars ≈ 100 KB > 50 KB → must shrink the row count.
    const rows = Array.from({ length: MAX_ROWS }, () => ['a'.repeat(1000)]);
    const engine = makeLimitingEngine(() => ({ columns: ['big'], rows }));
    const res = await runSelect(engine, 'SELECT big FROM t');
    expect(serializeResult(res).length).toBeLessThanOrEqual(MAX_RESULT_TEXT_BYTES);
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows.length).toBeLessThan(MAX_ROWS);
    expect(res.truncated).toBe(true);
  });

  it('rejects a single row too wide to fit the 50 KB cap', async () => {
    const engine = makeLimitingEngine(() => ({ columns: ['big'], rows: [['a'.repeat(60_000)]] }));
    await expect(runSelect(engine, 'SELECT big FROM t')).rejects.toThrow(SqlRejectedError);
  });

  it('converts bigint cells to numbers', async () => {
    const engine = makeLimitingEngine(() => ({ columns: ['n'], rows: [[123n]] }));
    const res: RunSelectResult = await runSelect(engine, 'SELECT n FROM t');
    expect(res.rows[0]?.[0]).toBe(123);
  });
});
