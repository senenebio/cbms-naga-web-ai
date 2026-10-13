/**
 * PII allowlists + column guards (driver-free, importable by the browser
 * bundle).
 *
 * The data dictionary, demo columns, and rural classification are owned by
 * the brand's dataset descriptor (`@workspace/brand-config` — single
 * dictionary owner, data-aware spec D3); core modules receive them via the
 * `Dataset` parameter. The dictionary `include=true` flag is the PII
 * allowlist: ean/bsn/husn/hsn/coordinates/contact columns are never exposed.
 */
import type { Dataset } from '@workspace/brand-config';

/**
 * Explicit PII blocklist — these columns are never exposed, even when the
 * bundled dictionary marks them `include=true` (the 2024 dictionary flags
 * longitude/latitude/contact_address as includable, but the demo spec keeps
 * coordinates + contact details out of the LLM surface).
 */
export const PII_EXCLUDED_COLUMNS = new Set([
  'ean',
  'bsn',
  'husn',
  'hsn',
  'longitude',
  'latitude',
  'contact_number',
  'contact_address',
]);

/**
 * Column names that are exposed but not meaningful chart/map metrics —
 * coordinates and identifier codes — excluded from metric lists
 * (case-insensitive). Distinct from `PII_EXCLUDED_COLUMNS` (which are never
 * exposed at all): these columns ARE exposed, just not plottable values.
 * The warehouse exposes `lat`/`lon` (demo columns); LLM queries may alias
 * them (`AS latitude`). `psgc_code` is an integer identifier, not a value.
 */
export const NON_METRIC_COLUMNS = new Set([
  'lat',
  'lon',
  'latitude',
  'longitude',
  'psgc_code',
]);

export function isNonMetricColumn(name: string): boolean {
  return NON_METRIC_COLUMNS.has(name.trim().toLowerCase());
}

/**
 * Columns allowed in a view: dictionary include=true entries that actually
 * exist among the table's columns (dictionary covers household+person
 * sections, so names legitimately repeat), minus the explicit PII
 * blocklist, plus the dataset's demo columns (only when present in the
 * parquet).
 */
export function allowedColumns(table: string, tableColumns: string[], dataset: Dataset): string[] {
  const dict = new Map<string, boolean>();
  for (const e of dataset.dictionary) dict.set(e.variable_name, e.include);
  const dictCols = tableColumns.filter((c) => dict.get(c) === true && !PII_EXCLUDED_COLUMNS.has(c));
  const demoCols = (dataset.demoColumns[table] ?? []).filter((c) => tableColumns.includes(c));
  return [...dictCols, ...demoCols];
}
