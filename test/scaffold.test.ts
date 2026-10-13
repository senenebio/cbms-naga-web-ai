import { describe, it, expect } from 'vitest';
import type { SqlEngine, LLMClient, Message, ToolSpec } from '@repo/llm/types.js';

describe('scaffold contracts', () => {
  it('exposes the SqlEngine and LLMClient contracts', async () => {
    const engine: SqlEngine = {
      query: async () => ({ columns: ['x'], rows: [[1]] }),
    };
    const client: LLMClient = {
      chat: async (_messages: Message[], _tools: ToolSpec[]) => ({
        role: 'assistant',
        content: 'ok',
      }),
    };

    const result = await engine.query('SELECT 1');
    expect(result.columns).toEqual(['x']);
    expect(result.rows).toEqual([[1]]);
    expect(client).toBeDefined();
  });
});
