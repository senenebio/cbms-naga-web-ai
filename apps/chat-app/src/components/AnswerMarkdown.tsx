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
  // Scan the whole text for bold spans in document order; take the first
  // one containing a number. Using the match's absolute index (`m.index`)
  // avoids the ambiguity of `md.indexOf(para)` for repeated paragraphs.
  for (const m of md.matchAll(/\*\*([^*\n]+)\*\*/g)) {
    if (!/\d/.test(m[1] ?? '')) continue;
    const start = m.index ?? 0;
    const callout = (m[1] ?? '').replace(/\s+/g, ' ').trim();
    // Remove only the bold span so the surrounding sentence stays intact.
    // Collapse runs of spaces/tabs only — newlines must survive (markdown structure).
    const rest = (md.slice(0, start) + md.slice(start + (m[0] ?? '').length))
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
    <div className="my-2 flex flex-col gap-1.5">
      {items.map((item, i) => {
        const v = cellNumber(item.value);
        const pct = max > 0 && Number.isFinite(v) ? Math.max((v / max) * 100, 6) : 0;
        return (
          <div
            className="grid grid-cols-[minmax(120px,160px)_1fr_80px] items-center gap-2 text-xs"
            key={`${item.label}-${i}`}
          >
            <span className="truncate text-left font-medium" title={item.label}>
              {item.label}
            </span>
            <span className="h-3.5 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-brand-primary" style={{ width: `${pct}%` }} />
            </span>
            <span className="text-right font-medium tabular-nums">{item.value}</span>
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
    <div className="my-2 max-h-80 overflow-auto rounded-md border">
      <table className="w-full border-collapse text-xs">
        {header.length > 0 && (
          <thead>
            <tr>
              {header.map((cell, i) => (
                <th key={i} className="border bg-muted px-2 py-1 text-left whitespace-nowrap">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {shown.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} className="max-w-48 border break-words px-2 py-1">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 && (
        <div className="border-t px-2 py-1 text-xs text-muted-foreground">
          showing {shown.length} of {body.length} rows
        </div>
      )}
    </div>
  );
}

/** Custom markdown renderers: tables → bars/plain, plus text styling. */
const markdownComponents: Components = {
  table: ({ node }) => {
    const rows = tableRows(node);
    if (isBarTable(rows)) return <ComparisonBars rows={rows} />;
    return <PlainTable rows={rows} />;
  },
  p: ({ children }) => <p className="my-1.5">{children}</p>,
  h1: ({ children }) => <h1 className="mb-1.5 mt-2.5 text-sm font-semibold leading-tight">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-2.5 text-sm font-semibold leading-tight">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-2.5 text-sm font-semibold leading-tight">{children}</h3>,
  ul: ({ children }) => <ul className="my-1.5 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  code: ({ children }) => (
    <code className="rounded border bg-muted px-1 py-px text-xs">{children}</code>
  ),
};

export default function AnswerMarkdown({ text }: { text: string }) {
  const md = sanitizeAnswer(text);
  const { callout, rest } = extractCallout(md);
  return (
    <div className="whitespace-normal text-sm">
      {callout && (
        <div className="my-2 rounded-md border-l-4 border-brand-primary bg-brand-primary/10 px-3.5 py-2.5">
          <span className="block text-2xl font-extrabold leading-tight">{callout}</span>
        </div>
      )}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {rest}
      </ReactMarkdown>
    </div>
  );
}
