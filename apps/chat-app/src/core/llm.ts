/**
 * Phase E — the browser `LLMClient`: a thin `fetch` implementation of the
 * OpenAI-compatible `/chat/completions` endpoint (decision 9 — no `openai`
 * SDK). Reuses `toApiMessages` from the shared pure core for the wire
 * format; tool specs are already in the OpenAI `tools` shape.
 *
 * Works for `openai`, `openrouter`, and any local OpenAI-compatible
 * server (Ollama / LM Studio / llama.cpp) — CORS-friendly BYOK calls.
 */
import type {
  AssistantMessage,
  LLMClient,
  Message,
  ToolCall,
  ToolSpec,
} from '@repo/llm/types.js';
import { toApiMessages } from '@repo/llm/client.js';

export interface FetchLlmOptions {
  model: string;
  /** OpenAI-compatible base URL, e.g. `https://api.openai.com/v1`. */
  baseUrl: string;
  apiKey?: string;
  /** Sampling temperature (0–2). Default 0.7. */
  temperature?: number;
}

/** OpenAI chat-completions wire types (the subset we consume). */
interface ApiToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

interface ApiChatCompletionResponse {
  choices: {
    message: {
      content: string | null;
      tool_calls?: ApiToolCall[];
    };
  }[];
}

/**
 * Probe an OpenAI-compatible endpoint with a minimal chat completion
 * (Settings dialog "Test" button). Resolves on HTTP 2xx; throws an
 * `Error` with an actionable message on non-2xx or network failure.
 */
export async function testLlmConnection(cfg: {
  baseUrl: string;
  apiKey: string;
  model: string;
}): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    });
  } catch (e) {
    throw new Error(`Connection failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300) || res.statusText}`);
  }
}

export class FetchLlmClient implements LLMClient {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly temperature: number;

  constructor(opts: FetchLlmOptions) {
    this.model = opts.model;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.temperature = opts.temperature ?? 0.7;
  }

  async chat(
    messages: Message[],
    tools: ToolSpec[],
    signal?: AbortSignal,
  ): Promise<AssistantMessage> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: toApiMessages(messages),
          tools,
          temperature: this.temperature,
        }),
        signal,
      });
    } catch (e) {
      // H2 — re-throw an abort as-is so callers can distinguish a manual
      // Stop from a real network failure (don't wrap it in a generic error).
      if (e instanceof Error && e.name === 'AbortError') throw e;
      throw new Error(
        `LLM request to ${this.baseUrl}/chat/completions failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LLM request failed (HTTP ${res.status}): ${body.slice(0, 500)}`);
    }

    const body = (await res.json()) as ApiChatCompletionResponse;
    const choice = body.choices[0];
    if (!choice) throw new Error('LLM response contained no choices');
    const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));
    return {
      role: 'assistant',
      content: choice.message.content,
      tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
