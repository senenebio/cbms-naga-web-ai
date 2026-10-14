/**
 * Brand-specific mock scripts for the CBMS Naga 2024 dataset.
 *
 * These canned answers reference "Naga City" and CBMS-specific SQL —
 * they live in `test/` (not `packages/core`) to keep the core
 * brand-agnostic.
 */
import type { MockScript } from '@repo/llm/mock_client.js';
import { fmt, MIGRATION_LEVEL_LABELS, REASON_LABELS } from '@repo/llm/mock_client.js';
import type { Cell } from '@repo/llm/sql_tool.js';

export const MOCK_SCRIPTS: MockScript[] = [
  {
    match: /migrat|moved within the past 3 years/i,
    sql: `SELECT p.c04_migration_level AS level_code, COUNT(*) AS persons FROM "person" p WHERE p.c03_ever_experienced_migration = 1 GROUP BY p.c04_migration_level ORDER BY persons DESC LIMIT 5`,
    answer: (columns, rows) => {
      const idx = (c: string) => columns.indexOf(c);
      const total = rows.reduce((s, r) => s + Number(r[idx('persons')]), 0);
      const list = rows
        .filter((r) => Number(r[idx('level_code')]) > 0)
        .map(
          (r, i) =>
            `${i + 1}. **${MIGRATION_LEVEL_LABELS[Number(r[idx('level_code')])] ?? `code ${fmt(r[idx('level_code')])}`}** — ${Number(r[idx('persons')]).toLocaleString()} persons`,
        )
        .join('\n');
      return (
        `## Migration in the past 3 years\n\n` +
        `**${total.toLocaleString()} household members** in the 2024 sample reported experiencing migration in the past three years. ` +
        `Breakdown by migration level:\n${list}\n` +
        `Most movers relocated within or near Naga (inter-barangay / inter-municipal); a smaller share moved across regions or internationally.`
      );
    },
  },
  {
    match: /not (avail|availed)|rank.*treatment|treatment.*despite.*sick/i,
    sql: `SELECT b.barangay AS barangay, SUM(h."f01_with_member_who_has_been_sick" = 1 AND h."f02_availed_medical_treatment" = 2) AS not_availed, SUM(h."f01_with_member_who_has_been_sick" = 1) AS had_sick_member, ROUND(100.0 * SUM(h."f01_with_member_who_has_been_sick" = 1 AND h."f02_availed_medical_treatment" = 2) / NULLIF(SUM(h."f01_with_member_who_has_been_sick" = 1), 0), 1) AS pct_not_availed FROM "household" h JOIN "barangay" b ON h.barangay_code = b.code GROUP BY b.barangay ORDER BY pct_not_availed DESC, b.barangay ASC LIMIT 10`,
    answer: (columns, rows) => {
      const idx = (c: string) => columns.indexOf(c);
      const top = rows.slice(0, 3);
      const list = top
        .map(
          (r, i) =>
            `${i + 1}. **${String(r[idx('barangay')])}** — ${fmt(r[idx('pct_not_availed')])}% of its households with a sick member did not avail medical treatment (${fmt(r[idx('not_availed')])} of ${fmt(r[idx('had_sick_member')])} households)`,
        )
        .join('\n');
      const tableRows = top
        .map((r) => `| ${String(r[idx('barangay')])} | ${fmt(r[idx('pct_not_availed')])}% |`)
        .join('\n');
      const top1 = top[0];
      if (!top1) return '## Sick members without medical care\n\nNo data returned for this query.';
      return (
        `## Sick members without medical care\n\n` +
        `**${fmt(top1[idx('pct_not_availed')])}% of households** in ${String(top1[idx('barangay')])} — the top-ranked barangay — had a sick member in the last six months who did not avail medical treatment. ` +
        `Top 3 barangays:\n${list}\n\n` +
        `| Barangay | Share not availing treatment |\n| --- | --- |\n${tableRows}\n\n` +
        `Single-year 2024 survey sample; figures are self-reported.`
      );
    },
  },
  {
    match: /not attending school|children.*school/i,
    sql: `SELECT section, label, share_pct, persons FROM ( SELECT section, label, share_pct, persons, ROW_NUMBER() OVER (PARTITION BY section ORDER BY CASE WHEN section = 'barangay' THEN share_pct ELSE CAST(persons AS DECIMAL(20,1)) END DESC, label ASC) AS rn FROM ( SELECT 'barangay' AS section, b.barangay AS label, ROUND(100.0 * SUM(p."d01_currently_attending_school" = 2) / NULLIF(COUNT(*), 0), 1) AS share_pct, COUNT(*) AS persons FROM "person" p JOIN "barangay" b ON p.barangay_code = b.code WHERE p.a05_age BETWEEN 6 AND 17 GROUP BY b.barangay UNION ALL SELECT 'reason' AS section, CASE WHEN p.d06_reason_not_attending_school IS NULL OR p.d06_reason_not_attending_school = 0 THEN '0' ELSE CAST(p.d06_reason_not_attending_school AS VARCHAR) END AS label, NULL::DECIMAL(10,1) AS share_pct, COUNT(*) AS persons FROM "person" p WHERE p.a05_age BETWEEN 6 AND 17 AND p."d01_currently_attending_school" = 2 GROUP BY 2 ) u ) t WHERE (section = 'barangay' AND rn <= 5) OR (section = 'reason' AND rn <= 3) ORDER BY CASE WHEN section = 'barangay' THEN 0 ELSE 1 END, rn`,
    answer: (columns, rows) => {
      const idx = (c: string) => columns.indexOf(c);
      const barangays = rows.filter((r) => r[idx('section')] === 'barangay');
      const reasons = rows.filter((r) => r[idx('section')] === 'reason');
      const bList = barangays
        .map(
          (r, i) =>
            `${i + 1}. **${String(r[idx('label')])}** — ${fmt(r[idx('share_pct')])}% of its children aged 6–17 not attending (${Number(r[idx('persons')]).toLocaleString()} children)`,
        )
        .join('\n');
      const rList = reasons
        .map((r, i) => {
          const code = Number(r[idx('label')]);
          const name =
            code === 0
              ? 'no reason recorded'
              : (REASON_LABELS[code] ?? `code ${fmt(r[idx('label')])}`);
          return `${i + 1}. **${name}** — ${Number(r[idx('persons')]).toLocaleString()} children`;
        })
        .join('\n');
      const bTable = barangays
        .slice(0, 3)
        .map((r) => `| ${String(r[idx('label')])} | ${fmt(r[idx('share_pct')])}% |`)
        .join('\n');
      const topB = barangays[0];
      if (!topB) return '## Children not attending school\n\nNo data returned for this query.';
      return (
        `## Children not attending school\n\n` +
        `**${fmt(topB[idx('share_pct')])}% of children** aged 6–17 in ${String(topB[idx('label')])} — the top-ranked barangay — are not currently attending school. ` +
        `Top barangays:\n${bList}\n\n` +
        `| Barangay | Share of children not attending |\n| --- | --- |\n${bTable}\n\n` +
        `Top reasons among those not attending:\n${rList}\n\n` +
        `Single-year 2024 survey sample; figures are self-reported.`
      );
    },
  },
  {
    match: /how many.*(household|person|people)|total (households|population|people)/i,
    sql: `SELECT (SELECT COUNT(*) AS households FROM "household") AS households, (SELECT COUNT(*) AS persons FROM "person") AS persons`,
    answer: (columns, rows) => {
      const households = Number(rows[0]?.[columns.indexOf('households')]);
      const persons = Number(rows[0]?.[columns.indexOf('persons')]);
      const official = 210_545;
      return (
        `The 2024 CBMS sample for Naga City covers **${households.toLocaleString()} households** and ` +
        `**${persons.toLocaleString()} persons**. Compared with the city's official estimated population of ` +
        `~${official.toLocaleString()}, the sample represents about ` +
        `${((persons / official) * 100).toFixed(1)}% of the population — a sample-based snapshot, not a full census.`
      );
    },
  },
  {
    match: /urban.*rural|rural.*urban|average household size/i,
    sql: `SELECT urban_rural, COUNT(*) AS barangays, SUM(population) AS population, SUM(household_count) AS households, ROUND(SUM(population) / SUM(household_count), 2) AS avg_household_size FROM "v_barangay_summary" GROUP BY urban_rural ORDER BY urban_rural`,
    answer: (columns, rows) => {
      const idx = (c: string) => columns.indexOf(c);
      const get = (r: Cell[], c: string) => r[idx(c)];
      const urban = rows.find((r) => r[idx('urban_rural')] === 'urban');
      const rural = rows.find((r) => r[idx('urban_rural')] === 'rural');
      if (!urban || !rural) return 'Could not compute urban/rural comparison.';
      const diff = Math.abs(
        Number(get(urban, 'avg_household_size')) - Number(get(rural, 'avg_household_size')),
      ).toFixed(2);
      return (
        `## Average household size by barangay class\n\n` +
        `**${fmt(get(rural, 'avg_household_size'))} persons per household** in rural barangays — ${diff} larger than urban barangays in this sample. ` +
        `1. **Urban** — ${fmt(get(urban, 'avg_household_size'))} persons per household (${fmt(get(urban, 'barangays'))} barangays, ${Number(get(urban, 'population')).toLocaleString()} people)\n` +
        `2. **Rural** — ${fmt(get(rural, 'avg_household_size'))} persons per household (${fmt(get(rural, 'barangays'))} barangays, ${Number(get(rural, 'population')).toLocaleString()} people)\n\n` +
        `| Barangay class | Avg persons per household |\n| --- | --- |\n` +
        `| Urban | ${fmt(get(urban, 'avg_household_size'))} |\n` +
        `| Rural | ${fmt(get(rural, 'avg_household_size'))} |\n\n` +
        `Households in ${Number(get(urban, 'avg_household_size')) > Number(get(rural, 'avg_household_size')) ? 'urban' : 'rural'} barangays are larger in this sample. ` +
        `Single-year 2024 survey sample; figures are self-reported.`
      );
    },
  },
];

export const FALLBACK_ANSWER =
  'I can only demo a handful of scripted questions in mock mode. Try one of the suggested ' +
  'demo questions, e.g. "How many households and people were surveyed in Naga City?" or ' +
  '"Rank the 10 barangays by the share of household members who did not avail medical treatment despite being sick."';

export const OFF_TOPIC_ANSWER =
  '## Outside my scope\n\n' +
  "I can only help with the 2024 CBMS survey for Naga City, so I can't answer that one. " +
  'Try a survey-related question instead, for example:\n' +
  '1. How many households and people were surveyed in Naga City?\n' +
  '2. What is the average household size in urban vs. rural barangays?\n' +
  '3. Which barangays have the most children not attending school?';
