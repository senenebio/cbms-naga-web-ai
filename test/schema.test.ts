/**
 * Phase B — schema block tests over a fake `SqlEngine` (no duckdb-wasm,
 * no network): PII allowlist enforcement + C7 scoping + C8 conventions.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildSchemaBlock, resetSchemaCache, selectColumns, tableFacts } from '@repo/schema.js';
import { CBMS_DATASET } from '@workspace/brand-config';
import { allowedColumns } from '@repo/data.js';
import { buildSystemPrompt } from '@repo/llm/prompts.js';
import type { SqlEngine } from '@repo/llm/types.js';

const COUNTS: Record<string, number> = { household: 44_892, person: 181_197 };

/** Fake engine answering the schema builder's three query shapes. */
function makeWarehouseEngine(): SqlEngine {
  return {
    async query(sql: string) {
      let m = /^SELECT \* FROM "(\w+)" LIMIT 1$/.exec(sql);
      if (m) return { columns: columnsFor(m[1] as 'household' | 'person'), rows: [] };
      m = /^SELECT COUNT\(\*\) AS n FROM "(\w+)"$/.exec(sql);
      if (m) return { columns: ['n'], rows: [[COUNTS[m[1] as string] ?? 0]] };
      m = /^SELECT DISTINCT "([^"]+)" FROM "(\w+)" WHERE "\1" IS NOT NULL$/.exec(sql);
      if (m) {
        const col = m[1] as string;
        // Realistic observed values: the column's first two dictionary codes.
        const dict = CBMS_DATASET.dictionary.find((e) => e.variable_name === col && e.valueset);
        const values = (dict?.valueset ?? []).slice(0, 2).map((v) => v.value);
        return { columns: [col], rows: values.map((v) => [v]) };
      }
      throw new Error(`fake engine: unhandled query: ${sql}`);
    },
  };
}

/**
 * The warehouse view columns, modeled exactly like the WASM ingest:
 * `allowedColumns` over the physical columns (dict names + demo columns for
 * household). PII columns are therefore already excluded.
 */
function columnsFor(table: 'household' | 'person'): string[] {
  const all = [...new Set(CBMS_DATASET.dictionary.map((e) => e.variable_name))];
  const physical = table === 'household' ? [...all, 'address', 'lat', 'lon'] : all;
  return allowedColumns(table, physical, CBMS_DATASET);
}

/** PII columns that must never appear in the schema block. */
const PII_COLUMNS = [
  'ean',
  'bsn',
  'husn',
  'hsn',
  'longitude',
  'latitude',
  'contact_number',
  'contact_address',
];

describe('buildSchemaBlock over a fake SqlEngine', () => {
  beforeEach(() => {
    resetSchemaCache();
  });

  it('renders both tables with their row counts', async () => {
    const block = await buildSchemaBlock(makeWarehouseEngine(), CBMS_DATASET);
    expect(block).toContain(`## Table "household" (${COUNTS.household} rows)`);
    expect(block).toContain(`## Table "person" (${COUNTS.person} rows)`);
    expect(block).toContain('v_barangay_summary');
  });

  it('includes include=true dictionary columns', async () => {
    const block = await buildSchemaBlock(makeWarehouseEngine(), CBMS_DATASET);
    expect(block).toContain('a05_age');
    expect(block).toContain('n02_drinking_water');
    expect(block).toContain('b08_currently_pregnant');
  });

  it('never includes PII columns (ean/bsn/husn/hsn/coordinates/contact)', async () => {
    const block = await buildSchemaBlock(makeWarehouseEngine(), CBMS_DATASET);
    for (const col of PII_COLUMNS) {
      expect(block).not.toContain(`- ${col}:`);
      expect(block).not.toContain(`- ${col}/`);
    }
  });

  it('includes the household demo columns (address, lat/lon) in the full block', async () => {
    const block = await buildSchemaBlock(makeWarehouseEngine(), CBMS_DATASET);
    expect(block).toContain('- address: "Street address');
    expect(block).toContain('- lat/lon: "Household location');
  });

  it('exposes a05_age through tableFacts columns (dict allowlist intact)', async () => {
    const engine = makeWarehouseEngine();
    const facts = await tableFacts(engine, 'household');
    expect(facts.count).toBe(COUNTS.household);
    expect(facts.columns).toContain('a05_age');
    for (const col of PII_COLUMNS) expect(facts.columns).not.toContain(col);
  });
});

describe('schema scoping (C7)', () => {
  beforeEach(() => {
    resetSchemaCache();
  });

  it('selects water columns for a water-source question', () => {
    const sel = selectColumns('What is the main source of drinking water in the household?', CBMS_DATASET);
    expect(sel).not.toBeNull();
    expect(sel?.has('n02_drinking_water')).toBe(true);
  });

  it('falls back (null) for aggregate / ambiguous questions', () => {
    expect(selectColumns('What is the total population of Naga City?', CBMS_DATASET)).toBeNull();
    expect(selectColumns('hello there', CBMS_DATASET)).toBeNull();
    expect(selectColumns('', CBMS_DATASET)).toBeNull();
  });

  it('scoped block contains only the selected columns', async () => {
    const sel = selectColumns('What is the main source of drinking water in the household?', CBMS_DATASET);
    expect(sel).not.toBeNull();
    const block = await buildSchemaBlock(makeWarehouseEngine(), CBMS_DATASET, sel!);
    expect(block).toContain('n02_drinking_water');
    // Unrelated coded columns must not leak into the scoped block.
    expect(block).not.toContain('a05_age');
    expect(block).not.toContain('f02_availed_medical_treatment');
  });

  it('memoizes per selection (no re-query on a cache hit)', async () => {
    let queries = 0;
    const counting: SqlEngine = {
      query: async (sql) => {
        queries += 1;
        return makeWarehouseEngine().query(sql);
      },
    };
    const sel = selectColumns('What is the main source of drinking water in the household?', CBMS_DATASET);
    expect(sel).not.toBeNull();
    resetSchemaCache();
    await buildSchemaBlock(counting, CBMS_DATASET, sel!);
    const afterCold = queries;
    expect(afterCold).toBeGreaterThan(0);
    await buildSchemaBlock(counting, CBMS_DATASET, sel!);
    expect(queries).toBe(afterCold);
  });

  it('targeted question yields a system prompt with only selected columns', async () => {
    const sel = selectColumns('What is the main source of drinking water in the household?', CBMS_DATASET);
    expect(sel).not.toBeNull();
    const prompt = buildSystemPrompt(await buildSchemaBlock(makeWarehouseEngine(), CBMS_DATASET, sel!), CBMS_DATASET);
    expect(prompt).toContain('n02_drinking_water');
    expect(prompt).not.toContain('a05_age');
  });
});

describe('value codes only for selected columns (C8)', () => {
  beforeEach(() => {
    resetSchemaCache();
  });

  it('states a regular coding convention once and references it per column', async () => {
    const sel = selectColumns('How many female household members are pregnant?', CBMS_DATASET);
    expect(sel).not.toBeNull();
    const block = await buildSchemaBlock(makeWarehouseEngine(), CBMS_DATASET, sel!);
    expect(block).toContain('b08_currently_pregnant');
    // The convention is stated once per table block (never per column), and
    // the matching columns reference it.
    const convLines = block.split('\n').filter((l) => l.startsWith('- Coding conventions:'));
    expect(convLines.length).toBeGreaterThanOrEqual(1);
    expect(convLines.length).toBeLessThanOrEqual(2);
    for (const line of convLines) {
      expect(line.match(/yes_no = 1=Yes, 2=No/g)).toHaveLength(1);
    }
    expect(block).toContain('values: (yes_no)');
    // The full per-column list is NOT inlined.
    expect(block).not.toContain('values: 1=Yes, 2=No');
  });

  it('non-regular valuesets keep their inline code list', async () => {
    const sel = selectColumns('What is the main source of drinking water in the household?', CBMS_DATASET);
    expect(sel).not.toBeNull();
    const block = await buildSchemaBlock(makeWarehouseEngine(), CBMS_DATASET, sel!);
    // n02_drinking_water's codes are not a regular convention → inline list.
    expect(block).toContain('values: 11=Piped into dwelling');
    expect(block).not.toContain('values: (');
  });
});
