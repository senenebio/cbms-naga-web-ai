/**
 * H2 — the composer's Stop button aborts the in-flight turn.
 *
 * `stop()` must clear `busy` and KEEP the in-progress message (D5: the
 * partial answer stays in place, the conversation is not cleared), and no
 * error is surfaced for a manual abort.
 */
import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { useChat } from './use-chat';
import type { LLMClient, SqlEngine } from '@repo/llm/types.js';

const stubEngine: SqlEngine = {
  async query(sql: string) {
    void sql;
    return { columns: ['n'], rows: [[1]] };
  },
};

/** A client that "hangs" until its signal is aborted, then throws AbortError. */
function makeAbortingClient(): LLMClient {
  return {
    async chat(_messages, _tools, signal) {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve();
        else signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      const err = new Error('This operation was aborted');
      err.name = 'AbortError';
      throw err;
    },
  };
}

describe('useChat (H2 — Stop button)', () => {
  it('stop() aborts the turn, clears busy, and keeps the message with no error', async () => {
    const { result } = renderHook(() =>
      useChat({ engine: stubEngine, client: makeAbortingClient() }),
    );

    act(() => {
      void result.current.ask('q');
    });
    await waitFor(() => expect(result.current.busy).toBe(true));

    act(() => {
      result.current.stop();
    });

    await waitFor(() => expect(result.current.busy).toBe(false));
    // The conversation is NOT cleared: user + in-progress assistant message remain.
    expect(result.current.messages).toHaveLength(2);
    const assistant = result.current.messages[1]!;
    if (assistant.role !== 'assistant') throw new Error('expected assistant message');
    expect(assistant.error).toBeNull();
    expect(assistant.thinking).toBe(false);
  });
});
