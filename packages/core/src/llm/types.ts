/**
 * Shared contracts for the LLM tool loop and the SQL engine.
 *
 * These two interfaces are what make the implementation phases independent —
 * later phases implement them and import these names, never the internals:
 *
 *  - `SqlEngine` — a driver-free SELECT executor. `WasmSqlEngine` (duckdb-wasm)
 *    is the single real implementation; a throwaway fake is used in unit tests.
 *  - `LLMClient` — a chat completion client with tool (function) calling.
 *    Implemented by a thin `fetch` client (browser/Node) and by test mocks.
 */

export interface ToolCall {
  id: string;
  name: string;
  /** JSON-encoded function arguments. */
  arguments: string;
}

export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; name: string; content: string };

export type AssistantMessage = Extract<Message, { role: 'assistant' }>;

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** A chat completion client. Implemented by the fetch client (prod) and mocks (tests). */
export interface LLMClient {
  chat(messages: Message[], tools: ToolSpec[], signal?: AbortSignal): Promise<AssistantMessage>;
}

/**
 * A driver-free SELECT executor. The LLM's `run_select` tool runs over this.
 * `WasmSqlEngine` (duckdb-wasm) is the single production implementation.
 */
export interface SqlEngine {
  query(sql: string): Promise<{ columns: string[]; rows: unknown[][] }>;
}
