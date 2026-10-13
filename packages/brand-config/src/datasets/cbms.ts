/**
 * CBMS Naga 2024 — dataset descriptor.
 *
 * Single source of truth for the data dictionary, demo columns, rural
 * classification, table filenames, geojson path, context text, and demo
 * questions. The dictionary JSON is statically imported here (spec D3:
 * single dictionary owner).
 */
import type { Dataset } from '../types.js';
import dictionaryJson from '../../../../data/cbms/2024-CBMS-Data-Dictionary.json';

export const CBMS_DATASET: Dataset = {
  id: 'cbms',
  context: [
    'You are the data-analysis assistant for the PSA 2024 CBMS (Community-Based Monitoring System) survey sample for **Naga City, Camarines Sur, Region V**.',
    '',
    'Dataset facts:',
    '- Anonymized **sample**, not the full census: 27 barangays, ~44,892 households, ~181,197 persons (city estimate ~210,545).',
    '- Person/household `uuid`s are synthetic; you may reference a `uuid` for a specific household.',
    '- Self-reported, single-year (2024) survey data.',
  ].join('\n'),
  dictionary: dictionaryJson as Dataset['dictionary'],
  tables: {
    person: 'person.parquet',
    household: 'household.parquet',
    barangay: 'barangay.parquet',
  },
  demoColumns: {
    household: ['address', 'lat', 'lon'],
    barangay: ['lat', 'lon'],
  },
  ruralBarangays: [
    'CARARAYAN',
    'CAROLINA',
    'PACOL',
    'PANICUASON',
    'SAN FELIPE',
    'SAN ISIDRO',
  ],
  geojson: 'naga-barangays.geojson',
  demoQuestions: [
    "How many households and people were surveyed in Naga City, and how does that compare to the city's official ~210k population?",
    'Rank the 10 barangays by the share of household members who did not avail medical treatment despite being sick.',
    'What is the average household size, and how does it differ between urban and rural barangays?',
    'Which barangays have the highest share of children not attending school? What are the top reasons?',
    'Summarize migration: how many household members moved within the past 3 years, and from where?',
  ],
};
