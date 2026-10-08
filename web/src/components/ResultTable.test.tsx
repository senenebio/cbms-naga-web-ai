/**
 * Phase F — shared sortable result table (ported from the reference UI).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import createRenderer, { type ReactTestInstance } from 'react-test-renderer';
import ResultTable, { sortRows, formatCell, MAX_ROWS_SHOWN } from './ResultTable';

describe('sortRows', () => {
  it('sorts numbers as numbers', () => {
    const rows = [
      ['a', 10],
      ['b', 3],
      ['c', 25],
    ];
    expect(sortRows(rows, 1, 'asc')).toEqual([
      ['b', 3],
      ['a', 10],
      ['c', 25],
    ]);
    expect(sortRows(rows, 1, 'desc')).toEqual([
      ['c', 25],
      ['a', 10],
      ['b', 3],
    ]);
  });

  it('puts nulls last', () => {
    const rows = [
      ['a', null],
      ['b', 5],
      ['c', 1],
    ];
    expect(sortRows(rows, 1, 'asc')).toEqual([
      ['c', 1],
      ['b', 5],
      ['a', null],
    ]);
  });

  it('string columns sort case-insensitively', () => {
    const rows = [['c'], ['A'], ['b']];
    expect(sortRows(rows, 0, 'asc')).toEqual([['A'], ['b'], ['c']]);
  });
});

describe('formatCell', () => {
  it('renders null as n/a', () => {
    expect(formatCell(null)).toBe('n/a');
    expect(formatCell(undefined)).toBe('n/a');
  });
  it('passes numbers through', () => {
    expect(formatCell(42)).toBe('42');
  });
});

describe('<ResultTable />', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() });
  });

  it('renders a truncation note when truncated', () => {
    const tree = createRenderer.create(
      React.createElement(ResultTable, { columns: ['a'], rows: [[1]], truncated: true }),
    );
    expect(JSON.stringify(tree.toJSON())).toContain('truncated by the read-only SQL gate');
  });

  it('caps the rendered rows at MAX_ROWS_SHOWN', () => {
    const rows = Array.from({ length: MAX_ROWS_SHOWN + 20 }, (_, i) => [i]);
    const tree = createRenderer.create(React.createElement(ResultTable, { columns: ['i'], rows }));
    const bodyRows = tree.root.findAllByType('tr').length;
    // header row + MAX_ROWS_SHOWN data rows
    expect(bodyRows).toBeLessThanOrEqual(1 + MAX_ROWS_SHOWN);
  });

  it('toggles ascending → descending sort', () => {
    const rows = [
      ['a', 10],
      ['b', 3],
      ['c', 25],
    ];
    const tree = createRenderer.create(
      React.createElement(ResultTable, { columns: ['name', 'n'], rows }),
    );
    const colBtn = tree.root
      .findAllByType('button')
      .find((b) => b.props.children.toString().includes('n'));
    expect(colBtn).toBeTruthy();
    act(() => {
      (colBtn as ReactTestInstance).props.onClick();
    });
    expect(JSON.stringify(tree.toJSON())).toContain('▲');
  });
});
