/**
 * Advanced-chart contract for the LLM `make_chart` tool (spec C1–C7).
 *
 * Driver-free: imported by `web/` and by Node tests. No `node:` imports.
 *
 * The LLM expresses a chart as a small, validated `ChartSpec` through the
 * `make_chart` tool. `validateChartSpec` coerces + normalizes the raw tool
 * arguments into a fully-resolved spec (defaults filled, series values
 * numeric, labels kept as-is) so the renderer (`web/.../ChartBlock.tsx`) can
 * trust its shape. Invalid input throws `ChartSpecError` — the tool loop feeds
 * the message back to the LLM so it can retry.
 */

import { isNonMetricColumn } from '../data.js';

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'scatter';

export interface ChartSpec {
  type: ChartType;
  /** Optional short heading. */
  title?: string;
  /** Normalized rows: only the referenced keys, series values numeric. */
  data: Array<Record<string, string | number>>;
  /** Label/category column (numeric x-axis for scatter). Always resolved. */
  xKey: string;
  /** Numeric value columns (one per series). Always resolved. */
  series: string[];
  /** Multi-series bar: stacked (true) vs grouped (false). */
  stacked?: boolean;
}

export class ChartSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChartSpecError';
  }
}

/** Hard cap on the number of data points in a single chart. */
export const MAX_CHART_POINTS = 50;

const CHART_TYPES: ReadonlySet<string> = new Set<string>([
  'bar',
  'line',
  'area',
  'pie',
  'scatter',
]);

const DEFAULT_X_KEY: Record<ChartType, string> = {
  bar: 'name',
  line: 'name',
  area: 'name',
  pie: 'name',
  scatter: 'x',
};

const DEFAULT_SERIES: Record<ChartType, string[]> = {
  bar: ['value'],
  line: ['value'],
  area: ['value'],
  pie: ['value'],
  scatter: ['y'],
};

/** Coerce a JSON value to a finite number; `undefined` if not numeric. */
function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Validate + normalize a raw `make_chart` argument object into a `ChartSpec`.
 * Throws `ChartSpecError` with a human-readable message on any violation.
 */
export function validateChartSpec(raw: unknown): ChartSpec {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ChartSpecError('chart spec must be an object');
  }
  const obj = raw as Record<string, unknown>;

  // 1. type
  if (typeof obj.type !== 'string' || !CHART_TYPES.has(obj.type)) {
    throw new ChartSpecError(
      `chart.type must be one of bar|line|area|pie|scatter, got ${JSON.stringify(obj.type)}`,
    );
  }
  const type = obj.type as ChartType;

  // 2. data: non-empty array of objects, length ≤ MAX_CHART_POINTS
  if (!Array.isArray(obj.data)) {
    throw new ChartSpecError('chart.data must be an array of rows');
  }
  const data = obj.data;
  if (data.length === 0) {
    throw new ChartSpecError('chart.data must not be empty');
  }
  if (data.length > MAX_CHART_POINTS) {
    throw new ChartSpecError(
      `chart.data has ${data.length} points; the cap is ${MAX_CHART_POINTS} — aggregate first`,
    );
  }
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new ChartSpecError(`chart.data[${i}] must be an object`);
    }
  }

  // 3. xKey (default per type; must be a non-empty string when given)
  let xKey: string;
  if (obj.xKey === undefined) {
    xKey = DEFAULT_X_KEY[type];
  } else if (typeof obj.xKey !== 'string' || obj.xKey.trim() === '') {
    throw new ChartSpecError('chart.xKey must be a non-empty string');
  } else {
    xKey = obj.xKey;
  }

  // 4. series (default per type; must be a non-empty array of strings when given)
  let series: string[];
  if (obj.series === undefined) {
    series = [...DEFAULT_SERIES[type]];
  } else {
    if (!Array.isArray(obj.series) || obj.series.length === 0) {
      throw new ChartSpecError('chart.series must be a non-empty array of column names');
    }
    series = obj.series.map((s, i) => {
      if (typeof s !== 'string' || s.trim() === '') {
        throw new ChartSpecError(`chart.series[${i}] must be a non-empty string`);
      }
      return s;
    });
  }

  // 4b. series must not be coordinate/identifier columns — not plottable metrics
  for (let i = 0; i < series.length; i++) {
    if (isNonMetricColumn(series[i])) {
      throw new ChartSpecError(
        `chart.series[${i}] "${series[i]}" is a coordinate/identifier column, not a plottable metric — use a value column (count, sum, or average)`,
      );
    }
  }

  // 5. type-specific series cardinality
  if (type === 'pie' && series.length !== 1) {
    throw new ChartSpecError('chart.type "pie" requires exactly one series column');
  }
  if (type === 'scatter' && series.length !== 1) {
    throw new ChartSpecError('chart.type "scatter" requires exactly one series column (the y-axis)');
  }

  // 6. per-row: referenced keys present; series numeric; scatter x-axis numeric
  for (let i = 0; i < data.length; i++) {
    const row = data[i] as Record<string, unknown>;
    for (const key of [xKey, ...series]) {
      if (!(key in row)) {
        throw new ChartSpecError(`chart.data[${i}] is missing column "${key}"`);
      }
    }
    if (type === 'scatter') {
      if (coerceNumber(row[xKey]) === undefined) {
        throw new ChartSpecError(`chart.data[${i}]["${xKey}"] (x-axis) must be a number`);
      }
    }
    for (const key of series) {
      if (coerceNumber(row[key]) === undefined) {
        throw new ChartSpecError(`chart.data[${i}]["${key}"] must be a number`);
      }
    }
  }

  // stacked (optional boolean)
  let stacked: boolean | undefined;
  if (obj.stacked !== undefined) {
    if (typeof obj.stacked !== 'boolean') {
      throw new ChartSpecError('chart.stacked must be a boolean');
    }
    stacked = obj.stacked;
  }

  // title (optional string)
  let title: string | undefined;
  if (obj.title !== undefined) {
    if (typeof obj.title !== 'string') {
      throw new ChartSpecError('chart.title must be a string');
    }
    title = obj.title;
  }

  // Normalize: keep only referenced keys; series numeric; label as string/number.
  const normalizedData = data.map((row) => {
    const r = row as Record<string, unknown>;
    const out: Record<string, string | number> = {};
    const xv = r[xKey];
    if (type === 'scatter') {
      out[xKey] = coerceNumber(xv) as number;
    } else if (typeof xv === 'string' || typeof xv === 'number') {
      out[xKey] = xv;
    } else {
      out[xKey] = String(xv);
    }
    for (const key of series) out[key] = coerceNumber(r[key]) as number;
    return out;
  });

  return {
    type,
    ...(title !== undefined ? { title } : {}),
    data: normalizedData,
    xKey,
    series,
    ...(stacked !== undefined ? { stacked } : {}),
  };
}

export const MAKE_CHART_TOOL_NAME = 'make_chart';

export const MAKE_CHART_TOOL_SPEC: ToolSpec = {
  type: 'function',
  function: {
    name: 'make_chart',
    description:
      'Create a chart to visualize data you already computed with run_select. ' +
      'It renders in the answer. Use for rankings, comparisons, trends, share/breakdowns, ' +
      'and correlations. Aggregate to at most ~20 data points first. ' +
      'type: bar|line|area|pie|scatter. data: array of row objects. xKey: label column ' +
      '(numeric x-axis for scatter; default "name", scatter "x"). series: numeric value ' +
      'columns, one per series (pie value column; scatter y-axis; default "value", scatter "y"). ' +
      'stacked: stack multi-series bars (default false = grouped).',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['bar', 'line', 'area', 'pie', 'scatter'] },
        title: { type: 'string', description: 'Short heading for the chart.' },
        data: {
          type: 'array',
          items: { type: 'object' },
          description: 'Rows; each is an object keyed by column name.',
        },
        xKey: {
          type: 'string',
          description: 'Label/category column (numeric x-axis for scatter).',
        },
        series: {
          type: 'array',
          items: { type: 'string' },
          description: 'Numeric value columns, one per series (scatter: the y-axis column).',
        },
        stacked: {
          type: 'boolean',
          description: 'Stack multi-series bars (default false = grouped).',
        },
      },
      required: ['type', 'data'],
    },
  },
};
