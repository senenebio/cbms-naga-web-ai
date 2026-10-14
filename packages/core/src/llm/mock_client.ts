/**
 * Deterministic mock LLM client for testing (decision 6 — test-only;
 * never exposed in the UI or provider resolution).
 *
 * Implements the same `LLMClient` interface as the real fetch client:
 *  - on a user turn, it emits a `run_select` tool call with a scripted SQL
 *    (matched by keyword patterns);
 *  - once the tool result is back in the message history, it composes an
 *    answer that cites the actual rows returned.
 */
import type { AssistantMessage, LLMClient, Message, ToolSpec } from './types.js';
import { RUN_SELECT_TOOL_NAME } from './client.js';
import type { Cell } from './sql_tool.js';

export interface MockScript {
  match: RegExp;
  sql: string;
  answer: (columns: string[], rows: Cell[][]) => string;
}

const fmt = (v: Cell | undefined) => (v === null || v === undefined ? 'n/a' : String(v));

/** Maps a migration-level code to its PSA label (c04 valueset). */
const MIGRATION_LEVEL_LABELS: Record<number, string> = {
  1: 'International migrant',
  2: 'Inter-regional migrant',
  3: 'Inter-provincial migrant',
  4: 'Inter-municipal migrant',
  5: 'Inter-barangay migrant',
};

/** Maps a reason code to its PSA label (d06 valueset). */
export const REASON_LABELS: Record<number, string> = {
  1: 'Accessibility of school',
  2: 'Illness',
  3: 'Disability',
  4: 'Pregnancy',
  5: 'Marriage',
  6: 'High cost of educational/financial concern',
  7: 'Employment',
  8: 'Finished schooling',
  9: 'Looking for work',
  10: 'Lack of personal interest',
  11: 'Too young/old',
  12: 'Bullying',
  13: 'Family matters',
};

export const MOCK_SCRIPTS: MockScript[] = [
  {
    // Must come before the "how many households…" script: the migration
    // demo question also starts with "how many household members moved".
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

const FALLBACK_ANSWER =
  'I can only demo a handful of scripted questions in mock mode. Try one of the suggested ' +
  'demo questions, e.g. "How many households and people were surveyed in Naga City?" or ' +
  '"Rank the 10 barangays by the share of household members who did not avail medical treatment despite being sick."';

/**
 * Off-topic guardrail (context-reduction spec C4): clearly non-survey
 * questions get a polite refusal + survey-related suggestions, with no
 * `run_select` call. Keyword list is deliberately narrow to avoid
 * misfiring on in-scope questions.
 */
const OFF_TOPIC =
  /weather|forecast|recipe|stock market|stock price|cricket|basketball|football|soccer score|love (song|poem)|a (good|funny) joke|horoscope|bitcoin|who won (the|yesterday)/i;

const OFF_TOPIC_ANSWER =
  '## Outside my scope\n\n' +
  "I can only help with the 2024 CBMS survey for Naga City, so I can't answer that one. " +
  'Try a survey-related question instead, for example:\n' +
  '1. How many households and people were surveyed in Naga City?\n' +
  '2. What is the average household size in urban vs. rural barangays?\n' +
  '3. Which barangays have the most children not attending school?';

let callCounter = 0;

function lastUserMessage(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') return m.content;
  }
  return '';
}

function lastToolMessage(messages: Message[]): Extract<Message, { role: 'tool' }> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'tool') return m;
  }
  return undefined;
}

/**
 * Creates a mock LLM client (no API key needed).
 * `scripts` defaults to `MOCK_SCRIPTS`; pass a custom list for tests.
 */
export function createMockClient(scripts: MockScript[] = MOCK_SCRIPTS): LLMClient {
  return {
    async chat(messages, _tools: ToolSpec[], _signal?: AbortSignal): Promise<AssistantMessage> {
      const toolMsg = lastToolMessage(messages);
      if (toolMsg) {
        // Answer turn: compose the answer from the tool result.
        let parsed: { columns?: string[]; rows?: Cell[][]; error?: string };
        try {
          parsed = JSON.parse(toolMsg.content);
        } catch {
          parsed = {};
        }
        if (parsed.error) {
          return {
            role: 'assistant',
            content: `The query failed (${parsed.error}). Please ask me a different question.`,
          };
        }
        const script = scripts.find((s) => s.match.test(lastUserMessage(messages)));
        if (!script || !parsed.columns || !parsed.rows) {
          return {
            role: 'assistant',
            content: 'I ran the query but could not interpret the result in mock mode.',
          };
        }
        const body = script.answer(parsed.columns, parsed.rows);
        // v2.3 B2: SQL is hidden by default — the canned answer is the
        // interpretation only.
        return {
          role: 'assistant',
          content: body,
        };
      }

      // Question turn: pick a scripted query.
      const question = lastUserMessage(messages);
      if (OFF_TOPIC.test(question)) {
        // Scope guardrail: polite refusal, no SQL.
        return { role: 'assistant', content: OFF_TOPIC_ANSWER };
      }
      const script = scripts.find((s) => s.match.test(question));
      if (!script) {
        return { role: 'assistant', content: FALLBACK_ANSWER };
      }
      callCounter += 1;
      return {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: `mock_call_${callCounter}`,
            name: RUN_SELECT_TOOL_NAME,
            arguments: JSON.stringify({ sql: script.sql }),
          },
        ],
      };
    },
  };
}
