/**
 * P1 — Unit tests for the `make_chart` contract (`src/llm/chart.ts`):
 * `validateChartSpec` (validation matrix, defaults, caps, coercion) and the
 * shape of `MAKE_CHART_TOOL_SPEC`. Pure (no DOM, no engine).
 */
import { describe, it, expect } from 'vitest';
import {
  validateChartSpec,
  ChartSpecError,
  MAX_CHART_POINTS,
  MAKE_CHART_TOOL_SPEC,
  type ChartSpec,
} from '../src/llm/chart.js';

describe('validateChartSpec — happy paths + defaults', () => {
  it('applies bar defaults (xKey "name", series ["value"]) and normalizes', () => {
    const spec = validateChartSpec({
      type: 'bar',
      data: [
        { name: 'A', value: 10, _ignored: 'x' },
        { name: 'B', value: '25' }, // numeric string coerced
      ],
    });
    expect(spec.type).toBe('bar');
    expect(spec.xKey).toBe('name');
    expect(spec.series).toEqual(['value']);
    expect(spec.data).toEqual([
      { name: 'A', value: 10 },
      { name: 'B', value: 25 },
    ]);
  });

  it('applies scatter defaults (xKey "x", series ["y"]) and coerces the x-axis to a number', () => {
    const spec = validateChartSpec({ type: 'scatter', data: [{ x: 1, y: 2 }, { x: '3', y: 4 }] });
    expect(spec.xKey).toBe('x');
    expect(spec.series).toEqual(['y']);
    expect(spec.data).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });

  it('supports multi-series bar with a title and stacked flag', () => {
    const spec = validateChartSpec({
      type: 'bar',
      title: 'Husn by barangay',
      xKey: 'barangay',
      series: ['urban', 'rural'],
      stacked: true,
      data: [
        { barangay: 'P1', urban: 1, rural: 2 },
        { barangay: 'P2', urban: 3, rural: 4 },
      ],
    });
    expect(spec.title).toBe('Husn by barangay');
    expect(spec.series).toEqual(['urban', 'rural']);
    expect(spec.stacked).toBe(true);
  });
});

describe('validateChartSpec — type', () => {
  it('rejects a missing or unknown type', () => {
    expect(() => validateChartSpec({ data: [{ name: 'A', value: 1 }] })).toThrow(ChartSpecError);
    expect(() =>
      validateChartSpec({ type: 'donut', data: [{ name: 'A', value: 1 }] }),
    ).toThrow(ChartSpecError);
  });

  it('rejects a non-object top level', () => {
    expect(() => validateChartSpec(null)).toThrow(ChartSpecError);
    expect(() => validateChartSpec('bar')).toThrow(ChartSpecError);
    expect(() => validateChartSpec([])).toThrow(ChartSpecError);
  });
});

describe('validateChartSpec — data', () => {
  it('rejects missing, non-array, and empty data', () => {
    expect(() => validateChartSpec({ type: 'bar' })).toThrow(ChartSpecError);
    expect(() => validateChartSpec({ type: 'bar', data: 'no' })).toThrow(ChartSpecError);
    expect(() => validateChartSpec({ type: 'bar', data: [] })).toThrow(ChartSpecError);
  });

  it('rejects a row that is not a plain object', () => {
    expect(() =>
      validateChartSpec({ type: 'bar', data: [{ name: 'A', value: 1 }, [1, 2]] }),
    ).toThrow(ChartSpecError);
  });

  it('enforces the MAX_CHART_POINTS cap', () => {
    const data = Array.from({ length: MAX_CHART_POINTS + 1 }, (_, i) => ({
      name: `P${i}`,
      value: i,
    }));
    expect(() => validateChartSpec({ type: 'bar', data })).toThrow(ChartSpecError);
    // Exactly at the cap is allowed.
    const ok = validateChartSpec({ type: 'bar', data: data.slice(0, MAX_CHART_POINTS) });
    expect(ok.data.length).toBe(MAX_CHART_POINTS);
  });
});

describe('validateChartSpec — xKey / series keys', () => {
  it('rejects a missing referenced column on a row', () => {
    expect(() =>
      validateChartSpec({ type: 'bar', data: [{ name: 'A' }] }), // no "value"
    ).toThrow(ChartSpecError);
  });

  it('rejects a non-empty-string xKey', () => {
    expect(() =>
      validateChartSpec({ type: 'bar', xKey: '', data: [{ name: 'A', value: 1 }] }),
    ).toThrow(ChartSpecError);
  });

  it('rejects an empty or non-string series entry', () => {
    expect(() =>
      validateChartSpec({ type: 'bar', series: [], data: [{ name: 'A', value: 1 }] }),
    ).toThrow(ChartSpecError);
    expect(() =>
      validateChartSpec({ type: 'bar', series: [42], data: [{ name: 'A', value: 1 }] }),
    ).toThrow(ChartSpecError);
  });
});

describe('validateChartSpec — series cardinality per type', () => {
  it('rejects a pie with more than one series', () => {
    expect(() =>
      validateChartSpec({
        type: 'pie',
        series: ['a', 'b'],
        data: [{ name: 'A', a: 1, b: 2 }],
      }),
    ).toThrow(ChartSpecError);
  });

  it('rejects a scatter with more than one series', () => {
    expect(() =>
      validateChartSpec({
        type: 'scatter',
        series: ['y', 'z'],
        data: [{ x: 1, y: 2, z: 3 }],
      }),
    ).toThrow(ChartSpecError);
  });
});

describe('validateChartSpec — numeric coercion', () => {
  it('accepts numeric strings and rejects non-numeric series values', () => {
    expect(
      () => validateChartSpec({ type: 'bar', data: [{ name: 'A', value: 'oops' }] }),
    ).toThrow(ChartSpecError);
  });

  it('accepts numeric strings for series values', () => {
    const spec: ChartSpec = validateChartSpec({
      type: 'bar',
      data: [{ name: 'A', value: '12' }],
    });
    expect(spec.data[0]?.value).toBe(12);
  });

  it('rejects a non-numeric scatter x-axis', () => {
    expect(() =>
      validateChartSpec({ type: 'scatter', data: [{ x: 'n/a', y: 2 }] }),
    ).toThrow(ChartSpecError);
  });
});

describe('validateChartSpec — optional fields', () => {
  it('rejects a non-boolean stacked and a non-string title', () => {
    expect(() =>
      validateChartSpec({ type: 'bar', stacked: 'yes', data: [{ name: 'A', value: 1 }] }),
    ).toThrow(ChartSpecError);
    expect(() =>
      validateChartSpec({ type: 'bar', title: 5, data: [{ name: 'A', value: 1 }] }),
    ).toThrow(ChartSpecError);
  });
});

describe('MAKE_CHART_TOOL_SPEC — shape', () => {
  it('is a function tool named make_chart with a valid JSON-Schema parameters object', () => {
    expect(MAKE_CHART_TOOL_SPEC.type).toBe('function');
    const fn = MAKE_CHART_TOOL_SPEC.function;
    expect(fn.name).toBe('make_chart');
    const params = fn.parameters as Record<string, unknown>;
    expect(params.type).toBe('object');
    const props = params.properties as Record<string, unknown>;
    for (const key of ['type', 'data', 'xKey', 'series', 'stacked', 'title']) {
      expect(props).toHaveProperty(key);
    }
    const required = params.required as string[];
    expect(required).toContain('type');
    expect(required).toContain('data');
    const typeProp = props.type as Record<string, unknown>;
    expect(typeProp.enum).toEqual(['bar', 'line', 'area', 'pie', 'scatter']);
  });
});
