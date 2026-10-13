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
import type { ChartType } from '@repo/llm/chart.js';

export interface Palette {
  ink: string;
  muted: string;
  border: string;
  panel: string;
  surface: string;
}

/** Multi-series / pie palette (accent first, then stable companions). */
const SERIES_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

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
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
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
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                dot={{ r: 2, fill: SERIES_COLORS[i % SERIES_COLORS.length] }}
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
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                fillOpacity={0.35}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}
      {type === 'pie' && (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <PieChart>
            <Pie
              data={data}
              dataKey={series[0]}
              nameKey={xKey}
              isAnimationActive={false}
            >
              {data.map((row, i) => (
                <Cell key={String(row[xKey])} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )}
      {type === 'scatter' && (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid stroke={palette.border} strokeDasharray="3 3" />
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis dataKey={series[0]} {...axisProps} />
            <Tooltip contentStyle={tooltipStyle} />
            <Scatter data={data} fill={SERIES_COLORS[0]} />
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </>
  );
}
