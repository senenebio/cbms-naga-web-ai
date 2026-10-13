/**
 * Phase F — markdown + infographic answer rendering (ported from the
 * reference UI).
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
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
});

describe('<AnswerMarkdown />', () => {
  it('renders a callout for a headline number', () => {
    const tree = ReactTestRenderer.create(
      React.createElement(AnswerMarkdown, { text: '**1,200** households were surveyed.' }),
    );
    const json = tree.toJSON()!;
    expect(JSON.stringify(json)).toContain('1,200');
    expect(JSON.stringify(json)).toContain('callout');
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
    const tree = ReactTestRenderer.create(React.createElement(AnswerMarkdown, { text: md }));
    const json = tree.toJSON()!;
    expect(JSON.stringify(json)).toContain('bars');
    expect(JSON.stringify(json)).toContain('A');
  });

  it('caps plain tables at MAX_TABLE_ROWS_SHOWN with an overflow note', () => {
    const rows = Array.from({ length: 27 }, (_, i) => `| B${i} | ${i} | x${i} | y${i} |`);
    const md = ['| Barangay | HH | Persons | Rate |', '| --- | --- | --- | --- |', ...rows].join('\n');
    const tree = ReactTestRenderer.create(React.createElement(AnswerMarkdown, { text: md }));
    const json = JSON.stringify(tree.toJSON());
    // Not a bar table (4 columns) → plain capped table.
    expect(json).toContain('table-scroll');
    expect(json).toContain('B0');
    // 27 data rows: rows 0..14 shown, row 15 (B15) is the first hidden one.
    expect(json).toContain(`B${MAX_TABLE_ROWS_SHOWN - 1}`);
    // B15 is the first hidden row (B150+ do not exist, so this is unambiguous).
    expect(json).not.toContain(`B${MAX_TABLE_ROWS_SHOWN}`);
    // The note is a template literal, so the renderer splits it into children.
    expect(json).toContain('table-more');
    expect(json).toContain('"27"');
  });

  it('does not cap short plain tables', () => {
    const md = ['| A | 1 |', '| --- | --- |', '| x | y |', '| 1 | 2 |'].join('\n');
    const json = JSON.stringify(ReactTestRenderer.create(React.createElement(AnswerMarkdown, { text: md })).toJSON());
    expect(json).toContain('table-scroll');
    expect(json).not.toContain('showing ');
  });
});
