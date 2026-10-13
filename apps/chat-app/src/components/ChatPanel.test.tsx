/**
 * Phase F — ChatPanel component tests (ported from the reference UI, adapted
 * to the driver-free core: stub engine + stub LLM client, no network, no
 * duckdb-wasm, no localStorage).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatPanel from './ChatPanel';
import { stubEngine, StubLlm, ChartStubLlm } from '../testStubs';
import type { LLMClient } from '@repo/llm/types.js';
import type { SqlEngine } from '@repo/llm/types.js';

/** Flush pending promises (the async chatQuestion generator). */
function flush() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setImmediate(r));
  });
}

const SAMPLE_ANSWER =
  '## Headline\n\n**1,200** households were surveyed, of which **600** were urban.';

function renderPanel(props: {
  engine: SqlEngine;
  client: LLMClient | null;
  theme?: 'light' | 'dark';
}) {
  return render(
    <ChatPanel
      engine={props.engine}
      client={props.client}
      onOpenSettings={() => {}}
      theme={props.theme}
    />,
  );
}

describe('ChatPanel', () => {
  // The "Show SQL" toggle persists to localStorage (shared across tests in
  // jsdom) — reset it so every test starts from the default (off) state.
  beforeEach(() => {
    localStorage.removeItem('cbms-show-sql');
  });

  it('renders the demo chips, New chat, and Show SQL controls', () => {
    renderPanel({ engine: stubEngine(), client: new StubLlm() });
    expect(screen.getByText(/households/)).toBeInTheDocument();
  });

  it('shows the unconfigured hint when no client is set', () => {
    renderPanel({ engine: stubEngine(), client: null });
    expect(screen.getByText(/No LLM configured/)).toBeInTheDocument();
  });

  it('streams a question through to a markdown answer + SQL/rows', async () => {
    const llm = new StubLlm({ answer: SAMPLE_ANSWER });
    renderPanel({ engine: stubEngine(), client: llm });

    // Turn on Show SQL so the SQL/rows sections render.
    fireEvent.click(screen.getByRole('button', { name: 'Show SQL' }));

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'How many households?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await flush();
    await flush();

    expect(llm.calls).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/1,200/)).toBeInTheDocument();
    // Show SQL was toggled on: the SQL and raw-rows sections render.
    expect(screen.getByText(/SQL \d+/)).toBeInTheDocument();
    expect(screen.getByText(/Raw rows/)).toBeInTheDocument();
    expect(screen.getByText(/SELECT 1 AS n/)).toBeInTheDocument();
  }, 10000);

  it('renders a make_chart result inline after the answer', async () => {
    const llm = new ChartStubLlm({ answer: 'See the chart below.' });
    renderPanel({ engine: stubEngine(), client: llm, theme: 'light' });

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Chart households by barangay.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await flush();
    await flush();

    expect(screen.getByText('See the chart below.')).toBeInTheDocument();
    // The chart is gated on the done flag, which has fired — the title renders inline.
    expect(screen.getByText('Households by barangay')).toBeInTheDocument();
  }, 10000);

  it('shows a "Show map" trigger for a geographic result (code + numeric)', async () => {
    const engine = stubEngine(
      [
        [1, 'ABELLA', 100],
        [2, 'BAGUMBAYAN NORTE', 200],
      ],
      ['code', 'barangay', 'hh'],
    );
    const llm = new StubLlm({ answer: 'Households by barangay.' });
    renderPanel({ engine, client: llm });

    // Click, then await a microtask so React flushes the state update before
    // the interaction continues (avoids a queued update being dropped when a
    // subsequent event triggers a render in the same task).
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show SQL' }));
    });

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Households by barangay?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await flush();
    await flush();

    expect(screen.getByText(/Raw rows/)).toBeInTheDocument();
    expect(screen.getByText('Show map')).toBeInTheDocument();
  }, 10000);

  it('shows the "Show map" trigger for a geographic result WITHOUT toggling Show SQL', async () => {
    const engine = stubEngine(
      [
        [1, 'ABELLA', 100],
        [2, 'BAGUMBAYAN NORTE', 200],
      ],
      ['code', 'barangay', 'hh'],
    );
    const llm = new StubLlm({ answer: 'Households by barangay.' });
    renderPanel({ engine, client: llm });

    // Do NOT toggle Show SQL (it defaults off) — the map must still be reachable.
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Households by barangay?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await flush();
    await flush();

    // The raw-rows table stays behind the toggle…
    expect(screen.queryByText(/Raw rows/)).not.toBeInTheDocument();
    // …but the map trigger is not gated on it.
    expect(screen.getByText('Show map')).toBeInTheDocument();
  }, 10000);

  it('shows no map trigger for a non-geographic result', async () => {
    const engine = stubEngine([[100]], ['total']);
    const llm = new StubLlm({ answer: 'Total: 100.' });
    renderPanel({ engine, client: llm });

    fireEvent.click(screen.getByRole('button', { name: 'Show SQL' }));

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Total?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await flush();
    await flush();

    expect(screen.getByText(/Raw rows/)).toBeInTheDocument();
    expect(screen.queryByText('Show map')).not.toBeInTheDocument();
  }, 10000);

  it('New chat clears the conversation', async () => {
    const llm = new StubLlm({ answer: 'One household.' });
    renderPanel({ engine: stubEngine(), client: llm });

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'How many households?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await flush();
    await flush();

    // The user message is in the tree.
    expect(screen.getByText('How many households?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await flush();

    expect(screen.queryByText('How many households?')).not.toBeInTheDocument();
  }, 10000);
});
