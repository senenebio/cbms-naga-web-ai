/**
 * Phase F — shared stubs for React component tests.
 *
 * These replace the real duckdb-wasm engine and BYOK LLM client so the
 * component tests run with no network, no duckdb-wasm, and no localStorage.
 *
 * - `stubEngine` satisfies `SqlEngine` (the minimal `query` shape that
 *   `buildSchemaBlock()` needs — a single row is enough).
 * - `StubLlm` is a deterministic `LLMClient`: the first `chat()` call emits
 *   a `run_select` tool call, and the second returns a canned final answer.
 */
import type {
  AssistantMessage,
  LLMClient,
  Message,
  SqlEngine,
  ToolCall,
  ToolSpec,
} from '../../src/llm/types.js';

export function stubEngine(
  rows: unknown[][] = [[1, 'TEST']],
  columns: string[] = ['code', 'barangay'],
): SqlEngine {
  return {
    query: async () => ({ columns, rows }),
  };
}

export interface StubLlmOptions {
  /** Final answer text (sent whole on the second `chat()` call). */
  answer?: string;
}

export class StubLlm implements LLMClient {
  calls = 0;
  readonly answer: string;

  constructor(opts: StubLlmOptions = {}) {
    this.answer = opts.answer ?? '';
  }

  async chat(_messages: Message[], _tools: ToolSpec[]): Promise<AssistantMessage> {
    this.calls += 1;
    if (this.calls === 1) {
      const toolCalls: ToolCall[] = [
        { id: 'c1', name: 'run_select', arguments: '{"sql":"SELECT 1 AS n"}' },
      ];
      return { role: 'assistant', content: null, tool_calls: toolCalls };
    }
    return { role: 'assistant', content: this.answer };
  }
}
