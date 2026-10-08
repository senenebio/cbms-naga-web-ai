/**
 * Bundled data dictionary + PII allowlists (driver-free, importable by
 * the browser bundle).
 *
 * The 2024 CBMS data dictionary is a **static JSON import** (spec decision 7),
 * so `loadDataDictionary()` is synchronous. The dictionary `include=true`
 * flag is the PII allowlist: ean/bsn/husn/hsn/coordinates/contact columns
 * are never exposed.
 */
import dictionaryJson from '../data/2024-CBMS-Data-Dictionary.json';

export interface DictEntry {
  variable_name: string;
  data_type: string;
  type: string;
  input_data: string;
  label: string;
  include: boolean;
  valueset?: { value: unknown; label: string }[];
}

export function loadDataDictionary(): DictEntry[] {
  const d = dictionaryJson as DictEntry[];
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
