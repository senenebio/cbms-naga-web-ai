// @vitest-environment node
/**
 * Phase D gate — full tool-loop E2E under Node (mock LLM + real WASM warehouse).
 *
 * Boots the real duckdb-wasm warehouse (3 parquets → 4 views), builds the
 * system prompt via `systemForQuestion` (with `buildSchemaBlock`), and drives
 * `askQuestion()` with the deterministic `mock_client` and an `execute`
 * callback that runs `runSelect(engine, sql)`. Asserts:
 *  - the mock's scripted SQL was emitted AND actually executed through
 *    `runSelect` against the WASM views;
 *  - the SQL is a valid read-only SELECT (re-validated by
 *    `validateSelectOnly` and independently re-executed on the engine);
 *  - the final answer is non-empty and consistent with the mock's scripted
 *    behavior (cites the real warehouse numbers).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as duckdb from '@duckdb/duckdb-wasm/blocking';
import { CBMS_DATASET } from '@workspace/brand-config';
import { openWarehouseWasm, type WarehouseHandle } from '@repo/wasm/open_warehouse.js';
import type { Message, SqlEngine } from '@repo/llm/types.js';
import { askQuestion, type AskOutcome } from '@repo/llm/client.js';
import { createMockClient, MOCK_SCRIPTS } from '@repo/llm/mock_client.js';
import { runSelect, validateSelectOnly } from '@repo/llm/sql_tool.js';
import { buildSchemaBlock } from '@repo/schema.js';
import { buildSystemPrompt } from '@repo/llm/prompts.js';
import { systemForQuestion } from '@repo/llm/chat.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DUCKDB_DIST = path.join(here, '..', 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');

/** One of the mock client's scripted demo questions (deterministic). */
const QUESTION = 'What is the average household size in urban vs. rural barangays?';

function toArrayBuffer(file: string): ArrayBuffer {
  const buf = readFileSync(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

let wh: WarehouseHandle | null = null;
let engine: SqlEngine | null = null;
let system: string = '';

beforeAll(async () => {
  const db = await duckdb.createDuckDB(
    {
      mvp: { mainModule: path.join(DUCKDB_DIST, 'duckdb-mvp.wasm'), mainWorker: '' },
      eh: { mainModule: path.join(DUCKDB_DIST, 'duckdb-eh.wasm'), mainWorker: '' },
    },
    new duckdb.ConsoleLogger(),
    duckdb.NODE_RUNTIME,
  );
  await db.instantiate();
  wh = await openWarehouseWasm(db, {
    person: toArrayBuffer(path.join(here, '..', 'data', 'cbms', 'warehouse', 'person.parquet')),
    household: toArrayBuffer(path.join(here, '..', 'data', 'cbms', 'warehouse', 'household.parquet')),
    barangay: toArrayBuffer(path.join(here, '..', 'data', 'cbms', 'warehouse', 'barangay.parquet')),
  }, CBMS_DATASET);
  engine = wh.engine;

  // Warm the full schema block (C7 fallback) and build the system prompt.
  const fullSystem = buildSystemPrompt(await buildSchemaBlock(engine, CBMS_DATASET), CBMS_DATASET);
  system = await systemForQuestion(QUESTION, fullSystem, engine, CBMS_DATASET);
}, 60_000);

afterAll(async () => {
  await wh?.close();
});

describe('E2E: mock LLM + real WASM warehouse through askQuestion', () => {
  it('system prompt is built from the real schema block', () => {
    expect(system.length).toBeGreaterThan(0);
    // Dataset context (R4) + schema block (R6) are both present.
    expect(system).toContain('Naga City');
    expect(system).toContain('DATA SCHEMA');
    // The question targets the aggregate view → the full schema block is the
    // C7 fallback (household + person table lines).
    expect(system).toContain('## Table "household"');
    expect(system).toContain('## Table "person"');
  });

  it('runs the scripted SQL through runSelect and answers from the real data', async () => {
    const expected = MOCK_SCRIPTS.find((s) => s.match.test(QUESTION));
    expect(expected).toBeDefined();
    const script = expected as (typeof MOCK_SCRIPTS)[number];

    const client = createMockClient();
    const outcome: AskOutcome = await askQuestion({
      client,
      system,
      history: [],
      question: QUESTION,
      execute: (sql: string) => runSelect(engine as SqlEngine, sql),
    });

    // 1) Exactly one SQL call, and it is the mock's scripted query.
    expect(outcome.sqlCalls).toHaveLength(1);
    const call = outcome.sqlCalls[0] as (typeof outcome.sqlCalls)[number];
    expect(call.sql).toBe(script.sql);

    // 2) The SQL is a valid read-only SELECT (guardrail re-validation).
    expect(() => validateSelectOnly(call.sql)).not.toThrow();

    // 3) The SQL was actually executed against the WASM warehouse: the
    //    captured result matches an independent direct query on the engine.
    expect(call.result.columns).toEqual([
      'urban_rural',
      'barangays',
      'population',
      'households',
      'avg_household_size',
    ]);
    expect(call.result.rows).toHaveLength(2);
    const direct = await (engine as SqlEngine).query(call.sql);
    expect(direct.columns).toEqual(call.result.columns);
    for (let i = 0; i < direct.rows.length; i += 1) {
      for (let j = 0; j < direct.columns.length; j += 1) {
        const a = (direct.rows[i] as unknown[])[j];
        const b = call.result.rows[i]?.[j];
        if (typeof a === 'number' || typeof b === 'number') {
          expect(Number(a)).toBeCloseTo(Number(b), 12);
        } else {
          expect(String(a)).toBe(String(b));
        }
      }
    }

    // 4) Final answer: non-empty, consistent with the mock's scripted
    //    behavior, and cites the real warehouse numbers.
    const answer = outcome.answer;
    expect(answer.length).toBeGreaterThan(0);
    expect(answer).toContain('Average household size by barangay class');
    expect(answer).toContain('persons per household');
    expect(answer).toContain('Urban');
    expect(answer).toContain('Rural');
    const urbanRow = call.result.rows.find((r) => (r[0] as string) === 'urban') as number[];
    expect(urbanRow).toBeDefined();
    expect(answer).toContain(`${urbanRow[4]} persons per household`);

    // 5) History is updated: user turn + final assistant turn (no tool_calls).
    const history = outcome.history as Message[];
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ role: 'user', content: QUESTION });
    const last = history[1] as Extract<Message, { role: 'assistant' }>;
    expect(last.role).toBe('assistant');
    expect(last.tool_calls).toBeUndefined();
    expect(last.content).toBe(answer);
  }, 30_000);
});
