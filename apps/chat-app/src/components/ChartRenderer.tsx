/**
 * Advanced charts (Phase P3) — the Recharts renderer.
 *
 * This module is **loaded on demand** by `<ChartBlock />` via a dynamic
 * `import()` (see `ChartBlock.tsx`), so Recharts (~110 KB gzip) lands in its
 * own chunk and is not part of the main bundle.
 *
 * Renders all five chart types (`bar` / `line` / `area` / `pie` / `scatter`)
 * from a validated `ChartSpec`. `bar`/`line`/`area` support grouped/stacked
 * multi-series; `pie` and `scatter` use a single series.
 *
 * Theming: colors follow the active theme via the `palette` prop (a JS
 * palette mirroring the CSS custom properties in styles.css — SVG paint
 * attributes can't reference `var()`, and the prop keeps this testable
 * without a DOM — react-test-renderer).
 */
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useMemo } from 'react';
import type { ChartType } from '@repo/llm/chart.js';
import { type Palette } from './palette.js';

const seriesColor = (palette: Palette, i: number) =>
  palette.series[i % palette.series.length] ?? '#2563eb';

const CHART_HEIGHT = 280;

interface ChartRendererProps {
  type: ChartType;
  data: Array<Record<string, string | number>>;
  xKey: string;
  series: string[];
  stacked: boolean;
  palette: Palette;
}

export default function ChartRenderer({
  type,
  data,
  xKey,
  series,
  stacked,
  palette,
}: ChartRendererProps) {
  const multiSeries = series.length > 1;

  // U7: Pie chart guard — aggregate to top 9 + "Other" when >10 categories.
  const PIE_MAX_SLICES = 10;
  const pieAggregated = useMemo(() => {
    if (type !== 'pie' || data.length <= PIE_MAX_SLICES) return null;
    const valKey = series[0]!;
    const sorted = [...data].sort(
      (a, b) => (Number(b[valKey] ?? 0) - Number(a[valKey] ?? 0)),
    );
    const top = sorted.slice(0, PIE_MAX_SLICES - 1);
    const rest = sorted.slice(PIE_MAX_SLICES - 1);
    const otherValue = rest.reduce((sum, r) => sum + Number(r[valKey] ?? 0), 0);
    const other: Record<string, string | number> = { [xKey]: 'Other', [valKey]: otherValue };
    return { data: [...top, other], total: data.length };
  }, [type, data, xKey, series]);

  const pieData = pieAggregated ? pieAggregated.data : data;
  const tooltipStyle = {
    background: palette.panel,
    color: palette.ink,
    border: `1px solid ${palette.border}`,
    borderRadius: 6,
    fontSize: 12,
  };
  const axisProps = { stroke: palette.muted, tick: { fill: palette.muted, fontSize: 11 } };

  return (
    <>
      {type === 'bar' && (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid stroke={palette.border} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} />
            {multiSeries && <Legend />}
            {series.map((s, i) => (
              <Bar
                key={s}
                dataKey={s}
                stackId={stacked ? 'stack' : undefined}
                fill={seriesColor(palette, i)}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
      {type === 'line' && (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid stroke={palette.border} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} />
            {multiSeries && <Legend />}
            {series.map((s, i) => (
              <Line
                key={s}
                type="monotone"
                dataKey={s}
                stroke={seriesColor(palette, i)}
                dot={{ r: 2, fill: seriesColor(palette, i) }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
      {type === 'area' && (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid stroke={palette.border} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} />
            {multiSeries && <Legend />}
            {series.map((s, i) => (
              <Area
                key={s}
                type="monotone"
                dataKey={s}
                stackId={stacked ? 'stack' : undefined}
                stroke={seriesColor(palette, i)}
                fill={seriesColor(palette, i)}
                fillOpacity={0.35}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}
      {type === 'pie' && (
        <div>
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey={series[0]}
                nameKey={xKey}
                isAnimationActive={false}
              >
                {pieData.map((row, i) => (
                  <Cell key={i} fill={seriesColor(palette, i)} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
          {pieAggregated && (
            <p className="mt-1 text-xs text-muted-foreground">
              Showing top {PIE_MAX_SLICES - 1} of {pieAggregated.total} categories. See table for all.
            </p>
          )}
        </div>
      )}
      {type === 'scatter' && (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid stroke={palette.border} strokeDasharray="3 3" />
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis dataKey={series[0]} {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} />
            <Scatter data={data} fill={seriesColor(palette, 0)} />
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </>
  );
}
