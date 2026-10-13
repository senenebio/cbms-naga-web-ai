/**
 * Bundled data dictionary + PII allowlists (driver-free, importable by
 * the browser bundle).
 *
 * The dictionary is owned by the brand's dataset descriptor
 * (`@workspace/brand-config` — single dictionary owner, data-aware spec D3).
 * `loadDataDictionary()` is a **temporary re-export** backed by
 * `CBMS_DATASET` (data-aware spec Phase 1); core modules will receive the
 * dictionary via a `Dataset` parameter in Phase 2.
 *
 * The dictionary `include=true` flag is the PII allowlist: ean/bsn/husn/hsn/
 * coordinates/contact columns are never exposed.
 */
import { CBMS_DATASET, type DictEntry } from '@workspace/brand-config';

export type { DictEntry };

export function loadDataDictionary(): DictEntry[] {
  const d = CBMS_DATASET.dictionary;
  if (!Array.isArray(d) || d.length === 0) {
    throw new Error('Bundled data dictionary is empty or malformed');
  }
  return d;
}

/**
 * Demo-only columns exposed beyond the dictionary include=true allowlist
 * (behavior spec v2.3):
 *  - B4: synthetic `address` column appended to the household parquet,
 *  - B5: `lat`/`lon` (WGS-84, from the verified barangay points) appended
 *    to the barangay parquet,
 *  - B6: `lat`/`lon` (WGS-84, barangay-level — inherited from the
 *    household's barangay) appended to the household parquet.
 * The ingestion pipeline and the data dictionary are intentionally
 * unchanged.
 */
export const DEMO_COLUMNS: Record<string, string[]> = {
  household: ['address', 'lat', 'lon'],
  barangay: ['lat', 'lon'],
};

/**
 * Urban/rural classification per barangay name, from
 * "Naga City stats from Gemini.md" (27 barangays, 6 rural).
 */
export const RURAL_BARANGAYS: string[] = [
  'CARARAYAN',
  'CAROLINA',
  'PACOL',
  'PANICUASON',
  'SAN FELIPE',
  'SAN ISIDRO',
];

export function isRural(barangayName: string): boolean {
  return RURAL_BARANGAYS.includes(barangayName.toUpperCase());
}

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
 * blocklist, plus the documented demo columns above (only when present in
 * the parquet).
 */
export function allowedColumns(table: string, tableColumns: string[]): string[] {
  const dict = new Map<string, boolean>();
  for (const e of loadDataDictionary()) dict.set(e.variable_name, e.include);
  const dictCols = tableColumns.filter((c) => dict.get(c) === true && !PII_EXCLUDED_COLUMNS.has(c));
  const demoCols = (DEMO_COLUMNS[table] ?? []).filter((c) => tableColumns.includes(c));
  return [...dictCols, ...demoCols];
}
