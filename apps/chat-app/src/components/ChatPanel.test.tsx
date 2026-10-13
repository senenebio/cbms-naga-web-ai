/**
 * ChatPanel — presentational feed tests.
 *
 * Tests the message list, welcome text, and unconfigured hint.
 * The chat logic (streaming, charts, maps) is tested via useChat / App.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatPanel from './ChatPanel';
import { stubEngine } from '../testStubs';
import type { ChatMsg } from '../hooks/use-chat.js';

function renderPanel(props: Partial<React.ComponentProps<typeof ChatPanel>> = {}) {
  return render(
    <ChatPanel
      messages={[]}
      busy={false}
      engine={stubEngine()}
      client={null}
      onOpenSettings={() => {}}
      showSql={false}
      {...props}
    />,
  );
}

describe('ChatPanel (presentational feed)', () => {
  it('shows the welcome text when there are no messages', () => {
    renderPanel();
    expect(screen.getByText(/Explore Naga City/)).toBeInTheDocument();
  });

  it('shows the unconfigured hint when no client is set', () => {
    renderPanel({ client: null });
    expect(screen.getByText(/No LLM configured/)).toBeInTheDocument();
  });

  it('shows the engine error', () => {
    renderPanel({ engine: null, engineError: 'parquet fetch failed' });
    expect(screen.getByText(/parquet fetch failed/)).toBeInTheDocument();
  });

  it('shows the loading note when engine is null and no messages', () => {
    renderPanel({ engine: null, client: null });
    expect(screen.getByText(/Loading the warehouse/)).toBeInTheDocument();
  });

  it('renders user and assistant messages', () => {
    const messages: ChatMsg[] = [
      { role: 'user', content: 'How many households?' },
      {
        role: 'assistant',
        text: 'There are 1,200 households.',
        thinking: false,
        startedAt: Date.now(),
        sql: [],
        rows: [],
        charts: [],
        done: true,
        error: null,
      },
    ];
    renderPanel({ messages });
    expect(screen.getByText('How many households?')).toBeInTheDocument();
    expect(screen.getByText(/1,200 households/)).toBeInTheDocument();
  });

  it('renders an error message in the assistant bubble', () => {
    const messages: ChatMsg[] = [
      { role: 'user', content: 'Test' },
      {
        role: 'assistant',
        text: '',
        thinking: false,
        startedAt: Date.now(),
        sql: [],
        rows: [],
        charts: [],
        done: false,
        error: 'Something went wrong',
      },
    ];
    renderPanel({ messages });
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
  });

  it('shows thinking indicator for an in-progress assistant message', () => {
    const messages: ChatMsg[] = [
      { role: 'user', content: 'Test' },
      {
        role: 'assistant',
        text: '',
        thinking: true,
        startedAt: Date.now(),
        sql: [],
        rows: [],
        charts: [],
        done: false,
        error: null,
      },
    ];
    renderPanel({ messages });
    expect(screen.getByText(/Thinking/)).toBeInTheDocument();
  });
});
