/**
 * Phase F — full markdown + infographic rendering of chat answers (ported
 * from the reference UI, U7, I1/I4).
 *
 * Pipeline (LLM text is untrusted):
 *  1. `sanitizeAnswer` strips code fences (each executed SQL already has its
 *     own collapsible "SQL N" section) and removes raw HTML tags, so a
 *     `<script>` payload can never reach the DOM.
 *  2. `extractCallout` lifts the first bold span that contains a number out
 *     of the text and renders it as a large headline callout (lead with the
 *     headline number).
 *  3. `ReactMarkdown` (+ remark-gfm) renders the remaining markdown as React
 *     elements: headings, bullets, numbered lists, tables, bold/italic,
 *     inline code.
 *  4. Custom `table` renderer: any 2-column markdown table whose value
 *     column is numeric is drawn as horizontal CSS comparison bars (I4,
 *     hand-rolled, no chart library); other tables render as plain tables.
 */
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Strips code fences and raw HTML tags from LLM text before markdown
 * parsing. ReactMarkdown would never execute raw HTML, but removing the
 * tags guarantees inert `<script>` payloads even as visible text.
 */
export function sanitizeAnswer(text: string): string {
  let t = text.replace(/```sql[\s\S]*?```/g, '');
  t = t.replace(/```[\s\S]*?```/g, '');
  t = t.replace(/<script[\s\S]*?<\/script>/gi, '');
  t = t.replace(/<[^<>\n]*>/g, '');
  return t;
}

/**
 * Pulls the first bold span containing a number from the opening
 * paragraph of the answer and returns it for headline-callout rendering.
 * Returns `{ callout: null }` when no headline number is present.
 */
export function extractCallout(md: string): { callout: string | null; rest: string } {
  // The answer may start with a `##` heading line, so scan paragraphs in
  // order and take the first bold span containing a number.
  for (const para of md.split(/\n\s*\n/)) {
    const hit = [...para.matchAll(/\*\*([^*\n]+)\*\*/g)].find((m) => /\d/.test(m[1] ?? ''));
    if (!hit) continue;
    const start = md.indexOf(para) + (hit.index ?? 0);
    const callout = (hit[1] ?? '').replace(/\s+/g, ' ').trim();
    // Remove only the bold span so the surrounding sentence stays intact.
    // Collapse runs of spaces/tabs only — newlines must survive (markdown structure).
    const rest = (md.slice(0, start) + md.slice(start + (hit[0] ?? '').length))
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    return { callout, rest };
  }
  return { callout: null, rest: md };
}

interface BarItem {
  label: string;
  value: string;
}

/** Parses a cell like "31.0%" / "1,234" / "4.35" → number (or NaN). */
function cellNumber(value: string): number {
  const m = value.match(/-?[\d][\d,.]*/);
  return m ? Number(m[0].replace(/,/g, '')) : NaN;
}

/** Reads all text under a hast element (handles bold/italic children). */
function hastText(node: unknown): string {
  let out = '';
  const walk = (n: unknown) => {
    if (n && typeof n === 'object') {
      const el = n as { value?: unknown; children?: unknown[] };
      if (typeof el.value === 'string') out += el.value;
      (el.children ?? []).forEach(walk);
    }
  };
  walk(node);
  return out.trim();
}

/**
 * Extracts `[label, value]` rows from a hast `table` node. remark-gfm
 * wraps rows in `thead`/`tbody` elements, so those are flattened first.
 */
function tableRows(node: unknown): string[][] {
  const trs: unknown[] = [];
  for (const child of (node as { children?: unknown[] }).children ?? []) {
    const el = child as { tagName?: string; children?: unknown[] };
    if (el.tagName === 'thead' || el.tagName === 'tbody') {
      for (const inner of el.children ?? []) {
        if ((inner as { tagName?: string }).tagName === 'tr') trs.push(inner);
      }
    } else if (el.tagName === 'tr') {
      trs.push(child);
    }
  }
  return trs.map((row) =>
    ((row as { children?: unknown[] }).children ?? [])
      .filter((c) => {
        const el = c as { tagName?: string };
        return el.tagName === 'th' || el.tagName === 'td';
      })
      .map((cell) => hastText(cell)),
  );
}

/**
 * The bar-table convention: exactly two columns and every data row's second
 * column parses as a number (optionally with a unit like `%` or a
 * comma-separated number).
 */
function isBarTable(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  if (!rows.every((r) => r.length === 2)) return false;
  return rows.slice(1).every((r) => Number.isFinite(cellNumber(r[1] ?? '')));
}

/**
 * Hand-rolled horizontal comparison bars (I4): label + proportional track +
 * value. Decorative/informational — not a data-viz product, no chart lib.
 */
function ComparisonBars({ rows }: { rows: string[][] }) {
  const items: BarItem[] = rows
    .slice(1)
    .map((row) => ({ label: row[0] ?? '', value: row[1] ?? '' }));
  const nums = items.map((i) => cellNumber(i.value)).filter((n) => Number.isFinite(n));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return (
    <div className="bars">
      {items.map((item, i) => {
        const v = cellNumber(item.value);
        const pct = max > 0 && Number.isFinite(v) ? Math.max((v / max) * 100, 6) : 0;
        return (
          <div className="bar-row" key={`${item.label}-${i}`}>
            <span className="bar-label" title={item.label}>
              {item.label}
            </span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="bar-value">{item.value}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Row cap for plain (non-bar) markdown tables in answers — a 27-barangay ×
 * 4-column dump must not wreck the chat panel. Mirrors ResultTable's cap.
 */
export const MAX_TABLE_ROWS_SHOWN = 15;

/**
 * Plain table renderer: rebuilt from parsed rows inside a scrollable,
 * max-height container, capped at MAX_TABLE_ROWS_SHOWN data rows with a
 * "showing X of Y" note for the overflow.
 */
function PlainTable({ rows }: { rows: string[][] }) {
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const shown = body.slice(0, MAX_TABLE_ROWS_SHOWN);
  const hidden = body.length - shown.length;
  return (
    <div className="table-scroll">
      <table>
        {header.length > 0 && (
          <thead>
            <tr>
              {header.map((cell, i) => (
                <th key={i}>{cell}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {shown.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 && <div className="table-more">showing {shown.length} of {body.length} rows</div>}
    </div>
  );
}

/** Custom table renderer: 2-column numeric tables become CSS bars, others get the capped plain table. */
const markdownComponents: Components = {
  table: ({ node }) => {
    const rows = tableRows(node);
    if (isBarTable(rows)) return <ComparisonBars rows={rows} />;
    return <PlainTable rows={rows} />;
  },
};

export default function AnswerMarkdown({ text }: { text: string }) {
  const md = sanitizeAnswer(text);
  const { callout, rest } = extractCallout(md);
  return (
    <div className="answer">
      {callout && (
        <div className="callout">
          <span className="callout-value">{callout}</span>
        </div>
      )}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {rest}
      </ReactMarkdown>
    </div>
  );
}
