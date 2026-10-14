/**
 * Phase E — browser-facing chat API.
 *
 * THIN wrapper over the driver-free shared core (`src/llm/chat.ts`):
 * `streamQuestion`/`systemForQuestion`/`askQuestion`/`runSelect` are
 * reused as-is — this module only composes a session (engine + pre-built
 * full system prompt) with a per-question system prompt and yields the
 * same `ChatEvent` stream the UI renders.
 */
import type { Dataset } from '@workspace/brand-config';
import { streamQuestion, systemForQuestion, type ChatEvent } from '@repo/llm/chat.js';
import type { LLMClient, Message, SqlEngine } from '@repo/llm/types.js';
import { buildSchemaBlock } from '@repo/schema.js';
import { buildSystemPrompt } from '@repo/llm/prompts.js';

export type { ChatEvent };

/** One chat session: the warehouse engine, its dataset, and full system prompt. */
export interface BrowserChatSession {
  engine: SqlEngine;
  /** The brand's dataset descriptor (schema block + scoping + context). */
  dataset: Dataset;
  /** Pre-built full system prompt (also warms the schema-block cache). */
  fullSystem: string;
}

/**
 * Build a chat session. Runs the full schema block over the engine once
 * (memoized by the shared core) so the per-question scoping (C7) has a
 * warm fallback.
 */
export async function createChatSession(
  engine: SqlEngine,
  dataset: Dataset,
): Promise<BrowserChatSession> {
  const fullSystem = buildSystemPrompt(await buildSchemaBlock(engine, dataset), dataset);
  return { engine, dataset, fullSystem };
}

export interface ChatQuestionArgs {
  session: BrowserChatSession;
  /** Null when no LLM is configured → a single friendly `error` event. */
  client: LLMClient | null;
  /** Previous turns (user/assistant messages; last 6 kept by the core). */
  history: Message[];
  question: string;
  /** Optional signal to abort the turn (H2 — user Stop button). */
  signal?: AbortSignal;
}

/**
 * Run one user turn and yield the `ChatEvent` stream
 * (`sql`/`rows` per executed query, `token` chunks, `done`, or `error`).
 */
export async function* chatQuestion(args: ChatQuestionArgs): AsyncGenerator<ChatEvent> {
  const system = await systemForQuestion(
    args.question,
    args.session.fullSystem,
    args.session.engine,
    args.session.dataset,
  );
  yield* streamQuestion({
    client: args.client,
    system,
    history: args.history,
    question: args.question,
    engine: args.session.engine,
    signal: args.signal,
  });
}
