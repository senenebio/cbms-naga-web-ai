/**
 * Phase F — shared sortable result table for raw query rows (ported from
 * the reference UI). Sortable columns, null → "n/a", first 50 rows shown,
 * and a truncation note when the read-only SQL gate's 100-row / 50 KB cap
 * fired.
 */
import { useMemo, useState } from 'react';

export const MAX_ROWS_SHOWN = 50;

export type SortDir = 'asc' | 'desc';

/**
 * Pure sort step (unit-testable): numeric-looking values compare as
 * numbers, everything else as strings; nulls sort last regardless of
 * direction.
 */
export function sortRows(rows: unknown[][], keyIndex: number, dir: SortDir): unknown[][] {
  const sign = dir === 'asc' ? 1 : -1;
  const isNum = (v: unknown) => typeof v === 'number';
  return [...rows].sort((a, b) => {
    const av = a[keyIndex] ?? null;
    const bv = b[keyIndex] ?? null;
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (isNum(av) && isNum(bv)) return sign * ((av as number) - (bv as number));
    return sign * String(av).localeCompare(String(bv));
  });
}

export function formatCell(v: unknown): string {
  return v === null || v === undefined ? 'n/a' : String(v);
}

interface ResultTableProps {
  columns: string[];
  rows: unknown[][];
  truncated?: boolean;
}

export default function ResultTable({ columns, rows, truncated = false }: ResultTableProps) {
  const [sortKey, setSortKey] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const sorted = useMemo(
    () => (sortKey === null ? rows : sortRows(rows, sortKey, sortDir)),
    [rows, sortKey, sortDir],
  );
  const shown = sorted.slice(0, MAX_ROWS_SHOWN);

  const toggleSort = (i: number) => {
    if (sortKey === i) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(i);
      setSortDir('asc');
    }
  };

  return (
    <>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={c}
                aria-sort={
                  sortKey === i ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
                }
                className="border bg-muted px-2 py-1 text-left whitespace-nowrap"
              >
                <button
                  type="button"
                  className="cursor-pointer font-bold"
                  onClick={() => toggleSort(i)}
                >
                  {c} {sortKey === i ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j} className="border px-2 py-1 whitespace-nowrap">
                  {formatCell(v)}
                </td>
              ))}
            </tr>
          ))}
          {shown.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="border px-2 py-1 text-sm text-muted-foreground">
                No rows returned.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <div className="pt-1 text-xs text-muted-foreground">
          Showing first {shown.length} of {rows.length} rows.
        </div>
      )}
      {truncated && (
        <div className="pt-1 text-xs text-muted-foreground">
          Result truncated by the read-only SQL gate (100-row / 50 KB cap). Showing first{' '}
          {shown.length} rows.
        </div>
      )}
    </>
  );
}
