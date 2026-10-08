/**
 * Phase E — browser-facing chat API.
 *
 * THIN wrapper over the driver-free shared core (`src/llm/chat.ts`):
 * `streamQuestion`/`systemForQuestion`/`askQuestion`/`runSelect` are
 * reused as-is — this module only composes a session (engine + pre-built
 * full system prompt) with a per-question system prompt and yields the
 * same `ChatEvent` stream the UI renders.
 */
import { streamQuestion, systemForQuestion, type ChatEvent } from '../../../src/llm/chat.js';
import type { LLMClient, Message, SqlEngine } from '../../../src/llm/types.js';
import { buildSchemaBlock } from '../../../src/schema.js';
import { buildSystemPrompt } from '../../../src/llm/prompts.js';

export type { ChatEvent };

/** One chat session: the warehouse engine + its full system prompt. */
export interface BrowserChatSession {
  engine: SqlEngine;
  /** Pre-built full system prompt (also warms the schema-block cache). */
  fullSystem: string;
}

/**
 * Build a chat session. Runs the full schema block over the engine once
 * (memoized by the shared core) so the per-question scoping (C7) has a
 * warm fallback.
 */
export async function createChatSession(engine: SqlEngine): Promise<BrowserChatSession> {
  const fullSystem = buildSystemPrompt(await buildSchemaBlock(engine));
  return { engine, fullSystem };
}

export interface ChatQuestionArgs {
  session: BrowserChatSession;
  /** Null when no LLM is configured → a single friendly `error` event. */
  client: LLMClient | null;
  /** Previous turns (user/assistant messages; last 6 kept by the core). */
  history: Message[];
  question: string;
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
  );
  yield* streamQuestion({
    client: args.client,
    system,
    history: args.history,
    question: args.question,
    engine: args.session.engine,
  });
}
