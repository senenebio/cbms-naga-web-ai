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
  context: `You are a data analyst for the 2024 Naga City Community and Business
Mapping Survey (CBMS). You have access to three read-only views:
- person: one row per household member
- household: one row per household
- barangay: one row per barangay (with code, name, lat/lon)
- v_barangay_summary: pre-computed per-barangay population, household count,
  and urban/rural classification.
The data is from the 2024 CBMS conducted in Naga City, Camarines Sur,
Philippines.`,
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
