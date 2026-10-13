/**
 * Phase F — shared sortable result table (ported from the reference UI).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  it('renders a truncation note when truncated', () => {
    render(<ResultTable columns={['a']} rows={[[1]]} truncated />);
    expect(screen.getByText(/truncated by the read-only SQL gate/)).toBeInTheDocument();
  });

  it('caps the rendered rows at MAX_ROWS_SHOWN', () => {
    const rows = Array.from({ length: MAX_ROWS_SHOWN + 20 }, (_, i) => [i]);
    const { container } = render(<ResultTable columns={['i']} rows={rows} />);
    // header row + MAX_ROWS_SHOWN data rows
    expect(container.querySelectorAll('tbody tr').length).toBe(MAX_ROWS_SHOWN);
    expect(screen.getByText(/Showing first 50 of 70 rows/)).toBeInTheDocument();
  });

  it('toggles ascending → descending sort', () => {
    const rows = [
      ['a', 10],
      ['b', 3],
      ['c', 25],
    ];
    render(<ResultTable columns={['name', 'n']} rows={rows} />);
    fireEvent.click(screen.getByRole('button', { name: 'n' }));
    expect(screen.getByRole('button', { name: /n ▲/ })).toBeInTheDocument();
  });
});
