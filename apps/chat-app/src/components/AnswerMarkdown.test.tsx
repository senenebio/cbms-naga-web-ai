/**
 * Phase F — markdown + infographic answer rendering (ported from the
 * reference UI).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AnswerMarkdown, { sanitizeAnswer, extractCallout, MAX_TABLE_ROWS_SHOWN } from './AnswerMarkdown';

describe('sanitizeAnswer', () => {
  it('strips sql code blocks', () => {
    const out = sanitizeAnswer('text\n```sql\nSELECT 1\n```\ntail');
    expect(out).not.toContain('SELECT 1');
    expect(out).toContain('text');
    expect(out).toContain('tail');
  });

  it('strips generic code fences', () => {
    const out = sanitizeAnswer('a\n```\ncode\n```\nb');
    expect(out).not.toContain('code');
  });

  it('removes raw HTML tags', () => {
    const out = sanitizeAnswer('hi <b>bold</b> <script>alert(1)</script>end');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<b>');
    expect(out).toContain('bold');
  });
});

describe('extractCallout', () => {
  it('lifts the first bold span containing a number', () => {
    const { callout, rest } = extractCallout('**31.0%** of barangays — the rest.');
    expect(callout).toBe('31.0%');
    expect(rest).toContain('of barangays');
    expect(rest).not.toContain('**31.0%**');
  });

  it('returns null callout when no number is bolded', () => {
    const { callout } = extractCallout('**just text** here');
    expect(callout).toBeNull();
  });

  it('ignores bold spans without digits', () => {
    const { callout } = extractCallout('**no digits** and **42 houses**');
    expect(callout).toBe('42 houses');
  });

  it('extracts from the correct occurrence when a paragraph repeats', () => {
    // Same paragraph text appears twice; the bold-number span is in the
    // first occurrence. The fix uses `m.index` (absolute offset) so the
    // callout is removed from the right copy, not the first.
    const plainPara = 'The sample covers 500 households.';
    const boldPara = 'The sample covers **500** households.';
    const md = `${boldPara}\n\nMore text here.\n\n${plainPara}`;
    const { callout, rest } = extractCallout(md);
    expect(callout).toBe('500');
    // The bold span should be removed (only one bold span existed).
    expect(rest).not.toContain('**500**');
    // The plain occurrence of the paragraph text survives.
    expect(rest).toContain('The sample covers 500 households.');
  });
});

describe('<AnswerMarkdown />', () => {
  it('renders a callout for a headline number', () => {
    render(<AnswerMarkdown text="**1,200** households were surveyed." />);
    const callout = screen.getByText('1,200');
    expect(callout).toBeInTheDocument();
    expect(callout.closest('div')).toHaveClass('border-brand-primary');
  });

  it('renders comparison bars for a 2-column numeric table', () => {
    const md = [
      '## Barangay ranking',
      '',
      '| Barangay | Share |',
      '| --- | --- |',
      '| A | 31.0% |',
      '| B | 22.5% |',
    ].join('\n');
    const { container } = render(<AnswerMarkdown text={md} />);
    expect(container.querySelector('[class*="grid-cols-[minmax(120px,160px)_1fr_80px]"]')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('caps plain tables at MAX_TABLE_ROWS_SHOWN with an overflow note', () => {
    const rows = Array.from({ length: 27 }, (_, i) => `| B${i} | ${i} | x${i} | y${i} |`);
    const md = ['| Barangay | HH | Persons | Rate |', '| --- | --- | --- | --- |', ...rows].join('\n');
    const { container } = render(<AnswerMarkdown text={md} />);
    // Not a bar table (4 columns) → plain capped table.
    expect(container.querySelector('.max-h-80')).toBeInTheDocument();
    expect(screen.getByText('B0')).toBeInTheDocument();
    // 27 data rows: rows 0..14 shown, row 15 (B15) is the first hidden one.
    expect(screen.getByText(`B${MAX_TABLE_ROWS_SHOWN - 1}`)).toBeInTheDocument();
    // B15 is the first hidden row (B150+ do not exist, so this is unambiguous).
    expect(screen.queryByText(`B${MAX_TABLE_ROWS_SHOWN}`)).not.toBeInTheDocument();
    expect(screen.getByText('showing 15 of 27 rows')).toBeInTheDocument();
  });

  it('does not cap short plain tables', () => {
    const md = ['| A | 1 |', '| --- | --- |', '| x | y |', '| 1 | 2 |'].join('\n');
    const { container } = render(<AnswerMarkdown text={md} />);
    expect(container.querySelector('.max-h-80')).toBeInTheDocument();
    expect(screen.queryByText(/showing \d+ of \d+ rows/)).not.toBeInTheDocument();
  });
});
