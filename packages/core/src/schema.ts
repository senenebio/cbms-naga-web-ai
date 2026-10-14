/**
 * Schema prompt builder (driver-free).
 *
 * Builds the schema block injected into the LLM system prompt (spec R6):
 *  - table columns with PSA 2024 CBMS question labels (from
 *    `2024-CBMS-Data-Dictionary.json`, include=true entries only),
 *  - value-code meanings (e.g. `1=Yes 0=No` conventions from `valueset`),
 *  - the 27-barangay reference for Naga City (code, name, urban/rural).
 *
 * Rewritten to take the shared `SqlEngine` contract (duckdb-wasm in
 * production, a throwaway fake in unit tests) — no throwaway Node
 * connections. `tableFacts` / `observedColumnValues` query the warehouse
 * views directly.
 */
import type { Dataset } from '@workspace/brand-config';
import type { SqlEngine } from './llm/types.js';
import { allowedColumns } from './data.js';

export type SchemaTable = 'household' | 'person';

/** Format a valueset as `1=Yes, 0=No` style text. */
export function formatValueCodes(valueset: { value: unknown; label: string }[]): string {
  return valueset.map((v) => `${String(v.value)}=${v.label}`).join(', ');
}

/**
 * Read a warehouse table's columns + row count from the given engine.
 */
export async function tableFacts(
  engine: SqlEngine,
  table: SchemaTable,
): Promise<{ columns: string[]; count: number }> {
  const colRes = await engine.query(`SELECT * FROM "${table}" LIMIT 1`);
  const countRes = await engine.query(`SELECT COUNT(*) AS n FROM "${table}"`);
  const count = Number(countRes.rows[0]?.[0]);
  return { columns: colRes.columns, count };
}

/**
 * Fetch the observed (DISTINCT, non-NULL) values for every coded column of
 * a table — i.e. columns that carry a valueset in the data dictionary.
 * Used to prune the schema block's value-code lists down to the codes that
 * actually appear in the data (context reduction spec C1).
 */
export async function observedColumnValues(
  engine: SqlEngine,
  table: SchemaTable,
  columns: string[],
  dataset: Dataset,
): Promise<Map<string, Set<string>>> {
  const dict = dataset.dictionary;
  const coded = columns.filter((c) =>
    dict.some(
      (e) => e.include === true && e.variable_name === c && e.valueset && e.valueset.length > 0,
    ),
  );
  if (coded.length === 0) return new Map();
  const out = new Map<string, Set<string>>();
  for (const col of coded) {
    const res = await engine.query(
      `SELECT DISTINCT "${col}" FROM "${table}" WHERE "${col}" IS NOT NULL`,
    );
    out.set(col, new Set(res.rows.map((r) => String(r[0]))));
  }
  return out;
}

interface SchemaLine {
  column: string;
  label: string;
  data_type: string;
  valueset?: { value: unknown; label: string }[];
}

/**
 * C8 — canonical coding conventions. A column whose (C1-pruned) valueset is
 * a non-empty subset of a convention's pairs is referenced as
 * `values: (<id>)` and the convention is stated once per table block,
 * instead of inlining the per-column code list. 276 of the dictionary's
 * columns use the plain `1=Yes, 2=No` convention, so this is a large win
 * in the full schema; pruned single-code columns (e.g. only `1` observed)
 * still resolve via the convention line.
 */
export const CODE_CONVENTIONS: { id: string; pairs: [number, string][] }[] = [
  {
    id: 'yes_no',
    pairs: [
      [1, 'Yes'],
      [2, 'No'],
    ],
  },
  {
    id: 'sex',
    pairs: [
      [1, 'Male'],
      [2, 'Female'],
    ],
  },
];

/** Return the convention id whose pairs exactly cover `valueset` (subset match on value+label). */
function conventionFor(valueset: { value: unknown; label: string }[]): string | undefined {
  if (valueset.length === 0) return undefined;
  for (const c of CODE_CONVENTIONS) {
    const pairs = new Map(c.pairs.map(([v, l]) => [String(v), l]));
    if (valueset.every((v) => pairs.get(String(v.value)) === v.label)) return c.id;
  }
  return undefined;
}

/**
 * Build the per-table column lines for `table` from the data dictionary,
 * restricted to the columns actually present in the warehouse table.
 * When `observed` is given, valuesets are pruned to the codes that
 * actually appear in the data (context reduction spec C1).
 * When `selected` is given, only those variable names are kept (C7 scoping).
 */
function tableLines(
  table: SchemaTable,
  columns: string[],
  dataset: Dataset,
  observed?: Map<string, Set<string>> | undefined,
  selected?: Set<string> | undefined,
): SchemaLine[] {
  const allowed = new Set(allowedColumns(table, columns, dataset));
  const seen = new Set<string>();
  const lines: SchemaLine[] = [];
  for (const e of dataset.dictionary) {
    if (e.include !== true || !allowed.has(e.variable_name)) continue;
    if (selected && !selected.has(e.variable_name)) continue;
    // The dictionary covers household+person sections; keep one line per
    // (variable_name, label) so legitimately duplicated names with
    // section-specific labels are both preserved.
    const key = `${e.variable_name}::${e.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let valueset = e.valueset;
    if (valueset && observed) {
      const present = observed.get(e.variable_name);
      valueset = present ? valueset.filter((v) => present.has(String(v.value))) : undefined;
    }
    lines.push({ column: e.variable_name, label: e.label, data_type: e.data_type, valueset });
  }
  return lines;
}

function renderTableBlock(table: SchemaTable, lines: SchemaLine[], count: number): string {
  const withConv = lines.map((l) => ({
    ...l,
    conv: l.valueset?.length ? conventionFor(l.valueset) : undefined,
  }));
  const used = [
    ...new Set(withConv.map((l) => l.conv).filter((c): c is string => c !== undefined)),
  ];
  const out: string[] = [];
  out.push(`## Table "${table}" (${count} rows)`);
  if (used.length > 0) {
    // C8 — state each convention once; matching columns reference it below.
    out.push(
      `- Coding conventions: ${used
        .map((id) => {
          const c = CODE_CONVENTIONS.find((x) => x.id === id)!;
          return `${id} = ${c.pairs.map(([v, l]) => `${v}=${l}`).join(', ')}`;
        })
        .join('; ')}`,
    );
  }
  for (const l of withConv) {
    out.push(`- ${l.column}: "${l.label}" (${l.data_type})`);
    if (l.conv) {
      out.push(`    values: (${l.conv})`);
    } else if (l.valueset && l.valueset.length > 0) {
      out.push(`    values: ${formatValueCodes(l.valueset)}`);
    }
  }
  return out.join('\n');
}

/**
 * Module-level memo for schema blocks (context-reduction C10 + C7).
 *
 * `buildSchemaBlock()` re-queries the warehouse (tableFacts +
 * observedColumnValues) on every build. Blocks are STATIC per process,
 * so each distinct selection is computed once and the same string is
 * returned thereafter. For tests, `resetSchemaCache()` clears the memo.
 *
 * Each memo entry is a `Promise<string>` so concurrent cold-start builds
 * dedupe into a single set of queries.
 */
const schemaBlockCache = new Map<string, Promise<string>>();

/** Clear the memoized schema blocks (used by tests; a fresh process always starts clean). */
export function resetSchemaCache(): void {
  schemaBlockCache.clear();
}

/**
 * C7 — schema scoping pre-pass: pick the dictionary columns relevant to a
 * question via a deterministic keyword map over the data-dictionary labels
 * (no LLM call). Returns `null` when nothing matches (ambiguous / aggregate
 * question) so callers fall back to the FULL schema block — scoping never
 * silently under-selects.
 *
 * A column matches when at least 2 distinct question tokens (lowercased,
 * ≥3 chars, stopwords removed) appear in its label or variable name.
 */
export function selectColumns(question: string, dataset: Dataset): Set<string> | null {
  const tokens = new Set<string>(
    (question.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
      (t) => t.length >= 3 && !SCOPING_STOPWORDS.has(t),
    ),
  );
  if (tokens.size === 0) return null;
  const selected = new Set<string>();
  for (const e of dataset.dictionary) {
    if (e.include !== true) continue;
    const text = `${e.label ?? ''} ${e.variable_name}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (text.includes(t)) score++;
    }
    if (score >= 2) selected.add(e.variable_name);
  }
  return selected.size > 0 ? selected : null;
}

/** Generic question/dataset words that should not drive column selection (C7). */
const SCOPING_STOPWORDS = new Set([
  'what',
  'whats',
  'which',
  'who',
  'whom',
  'whose',
  'how',
  'many',
  'much',
  'where',
  'when',
  'why',
  'please',
  'show',
  'give',
  'list',
  'tell',
  'want',
  'need',
  'like',
  'know',
  'can',
  'could',
  'would',
  'should',
  'there',
  'their',
  'these',
  'those',
  'this',
  'that',
  'then',
  'than',
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'about',
  'across',
  'during',
  'over',
  'under',
  'per',
  'each',
  'every',
  'most',
  'least',
  'best',
  'worst',
  'total',
  'count',
  'number',
  'average',
  'percent',
  'percentage',
  'city',
  'naga',
  'survey',
  'cbms',
  'psa',
  'data',
  'sample',
]);

/**
 * Build the full schema block for the system prompt (spec R6).
 * The barangay table is described (not inlined) so the LLM can query it
 * via `run_select` when a specific barangay matters (context-reduction C6).
 *
 * Memoized per selection (C10 + C7): each distinct `selected` set is
 * computed once, then the same string is returned without re-querying.
 * When `selected` is omitted, the FULL schema block is built (C7 fallback).
 */
export async function buildSchemaBlock(
  engine: SqlEngine,
  dataset: Dataset,
  selected?: Set<string>,
): Promise<string> {
  const key = selected ? [...selected].sort().join('\n') : 'full';
  const cached = schemaBlockCache.get(key);
  if (cached) return cached;
  const promise = (async () => {
    const [household, person] = await Promise.all([
      tableFacts(engine, 'household'),
      tableFacts(engine, 'person'),
    ]);
    const [householdObserved, personObserved] = await Promise.all([
      observedColumnValues(engine, 'household', household.columns, dataset),
      observedColumnValues(engine, 'person', person.columns, dataset),
    ]);

    const parts: string[] = [];
    parts.push(`DATA SCHEMA (DuckDB views over the ${dataset.label} sample)`);
    parts.push('');
    parts.push(
      'Tables: "household" (one row per sampled household), "person" (one row per household ' +
        'member, joined to household via uuid), "barangay" (code, barangay). ' +
        'Aggregate view "v_barangay_summary": code, barangay, urban_rural, population, household_count.',
    );
    parts.push('');
    parts.push(
      renderTableBlock(
        'household',
        tableLines('household', household.columns, dataset, householdObserved, selected),
        household.count,
      ),
    );
    if (!selected && household.columns.includes('address')) {
      // Demo column (behavior spec v2.3, B4) — added by scripts/add_demo_address.mjs.
      // Demo columns are not in the data dictionary, so scoped selections (C7)
      // never include them.
      parts.push(
        `- address: "Street address (synthetic demo constant — always '123 DEMO St.')" (varchar)`,
      );
    }
    if (!selected && household.columns.includes('lat') && household.columns.includes('lon')) {
      // Demo columns (behavior spec v2.3, B6) — added by scripts/add_household_latlon.mjs.
      parts.push(
        '- lat/lon: "Household location (WGS-84, barangay-level — inherited from the household\'s barangay)" (double)',
      );
    }
    parts.push('');
    parts.push(
      renderTableBlock(
        'person',
        tableLines('person', person.columns, dataset, personObserved, selected),
        person.count,
      ),
    );
    return parts.join('\n');
  })();
  schemaBlockCache.set(key, promise);
  return promise;
}
