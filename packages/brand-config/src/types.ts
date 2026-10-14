/**
 * Brand identity for white-label chat apps.
 *
 * A `Brand` is the complete identity of one deployment: the text shown in the
 * UI (name, welcome, version, license) plus the brand accent color. The rest
 * of the UI theme (backgrounds, borders, muted surfaces, dark mode) comes
 * from the app framework's neutral token set — the brand only layers its
 * identity + accent on top, so adding a brand is a pure data change.
 */
export interface DictEntry {
  variable_name: string;
  data_type: string;
  type: string;
  input_data: string;
  label: string;
  include: boolean;
  valueset?: { value: unknown; label: string }[];
}

/**
 * Dataset descriptor — the data a brand ships.
 *
 * A `Dataset` is the complete descriptor of one dataset: its dictionary,
 * table filenames, demo columns, rural classification, geojson, context
 * text, and demo questions. A brand statically references its dataset
 * (build-time pairing, spec D1).
 */
export interface Dataset {
  /** Stable id; also the asset directory name under /data/. */
  id: string;
  /** Short display label for the dataset (e.g. 'CBMS Naga 2024'). Used in tool specs and schema headers. */
  label: string;
  /** Dataset context text injected into the system prompt. */
  context: string;
  /** Data-dictionary entries (the PII allowlist = include=true). */
  dictionary: DictEntry[];
  /** Parquet asset filenames under /data/<id>/warehouse/. */
  tables: { person: string; household: string; barangay: string };
  /** Demo columns exposed beyond the dictionary allowlist, per table. */
  demoColumns: Record<string, string[]>;
  /** Barangay names classified rural (v_barangay_summary). */
  ruralBarangays: string[];
  /** GeoJSON asset filename under /data/<id>/. */
  geojson: string;
  /** Suggested demo-question chips. */
  demoQuestions: string[];
}

export interface Brand {
  /** Stable identifier (e.g. `cbms`). */
  id: string;
  /** Display name shown in the header. */
  name: string;
  /** Welcome text shown above the first message. */
  welcomeText: string;
  /** Product version string (e.g. "v1.0"), shown in the settings footer. */
  version: string;
  /** License string (e.g. "CC BY-NC 4.0"), shown in the settings footer. */
  license: string;
  /** Brand accent: user chat bubbles + UI accents. */
  colors: {
    primary: string;
    primaryForeground: string;
  };
  /** The dataset this brand ships. */
  dataset: Dataset;
}
